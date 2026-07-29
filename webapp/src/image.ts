// Картинку жмём в браузере: снимок с телефона — это несколько мегабайт, а на сервере
// ресайзить нечем (нативных зависимостей в проекте нет). Наружу всегда JPEG — его же
// ждёт бэкенд, он отдаёт афиши с image/jpeg и проверяет магию файла.

/** Длинная сторона афиши: карточка показывает картинку в ~350 CSS-px, запас на retina. */
const MAX_SIDE = 1600
const QUALITY = 0.82

/** Кадр в JPEG-блоб нужного размера. Бросает, если картинку не прочитать. */
export async function compressImage(file: File): Promise<Blob> {
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
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('не удалось закодировать JPEG')
  return blob
}
