// Картинку жмём в браузере: снимок с телефона — это несколько мегабайт, а на сервере
// ресайзить нечем (нативных зависимостей в проекте нет). Наружу всегда JPEG — его же
// ждёт бэкенд, он отдаёт афиши с image/jpeg и проверяет магию файла.

import { hsl } from './motion'

/** Длинная сторона афиши: карточка показывает картинку в ~350 CSS-px, запас на retina. */
const MAX_SIDE = 1600
const QUALITY = 0.82

/** Сторона копии, по которой считается тон: гистограмме оттенков хватает 576 точек. */
const TONE_SIDE = 24
/** Корзины оттенка по 15°. */
const HUE_BINS = 24
/** Серое, почти белое и почти чёрное за тон не голосует. */
const MIN_SAT = 0.28
const MIN_LIGHT = 0.12
const MAX_LIGHT = 0.88
/** С таким весом корзина берёт голоса соседних: большое спокойное пятно перевешивает мелкую яркую деталь. */
const NEIGHBOUR = 0.5
/** Голосов у победившей корзины меньше этой доли точек: насыщенного оттенка на снимке нет. */
const MIN_SHARE = 0.02
/** Сколько ждать картинку с сервера ради тона: дольше сохранение ивента не держим. */
const TONE_LOAD_MS = 4000

/**
 * Тон афиши ('#rrggbb'): средний цвет самого частого насыщенного оттенка снимка. Точка
 * голосует насыщенностью, у середины светлоты голос полный. null - насыщенного оттенка
 * нет (чёрно-белое фото, скриншот текста, схема), и экран ивента остаётся фиолетовым.
 */
export function imageTone(source: CanvasImageSource): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = TONE_SIDE
  canvas.height = TONE_SIDE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, TONE_SIDE, TONE_SIDE)
  const px = ctx.getImageData(0, 0, TONE_SIDE, TONE_SIDE).data
  const bins = Array.from({ length: HUE_BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]! / 255
    const g = px[i + 1]! / 255
    const b = px[i + 2]! / 255
    const { h, s, l } = hsl(r, g, b)
    if (s < MIN_SAT || l < MIN_LIGHT || l > MAX_LIGHT) continue
    const w = s * (1 - Math.abs(l - 0.5) * 1.4)
    const bin = bins[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS]!
    bin.w += w
    bin.r += r * w
    bin.g += g * w
    bin.b += b * w
  }
  let best = -1
  let bestVotes = 0
  for (let i = 0; i < HUE_BINS; i++) {
    const votes = bins[i]!.w + NEIGHBOUR * (bins[(i + HUE_BINS - 1) % HUE_BINS]!.w + bins[(i + 1) % HUE_BINS]!.w)
    if (votes > bestVotes) {
      bestVotes = votes
      best = i
    }
  }
  const top = bins[best]
  if (!top || top.w < TONE_SIDE * TONE_SIDE * MIN_SHARE) return null
  const hex = (v: number): string => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return '#' + hex(top.r / top.w) + hex(top.g / top.w) + hex(top.b / top.w)
}

/**
 * Тон картинки по адресу - для афиши, которую этот телефон не пропускал через
 * compressImage: из пересланного поста её качал сервер, а у сохранённого ивента первой
 * могла стать другая фото. Не загрузилась - тона нет.
 */
export async function imageToneAt(src: string): Promise<string | null> {
  const img = new Image()
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    setTimeout(() => resolve(false), TONE_LOAD_MS)
    img.src = src
  })
  if (!loaded) return null
  try {
    return imageTone(img)
  } catch {
    return null // холст не отдал пиксели
  }
}

/**
 * Кадр в JPEG-блоб нужного размера и тон афиши (см. imageTone). Бросает, если картинку
 * не прочитать.
 */
export async function compressImage(file: File): Promise<{ blob: Blob; tone: string | null }> {
  // from-image — иначе фото с телефона приезжает повёрнутым: EXIF-ориентация есть
  // в файле, но в canvas сама по себе не применяется.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('нет 2d-контекста')
  ctx.drawImage(bitmap, 0, 0, width, height)
  // Тон считаем здесь, пока снимок уже декодирован: второй раз его разбирать незачем.
  let tone: string | null = null
  try {
    tone = imageTone(bitmap)
  } catch {
    // Тон не обязателен: афиша уйдёт и без него, ивент останется фиолетовым.
  }
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('не удалось закодировать JPEG')
  return { blob, tone }
}
