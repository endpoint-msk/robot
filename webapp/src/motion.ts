// Общий язык движения: кривые, цвета сцен и проигрыватель кадров. Родом из движка
// знакомства (onboarding.ts), рабочие экраны берут движение отсюда же, чтобы
// длительности и перелёты везде были одни.
//
// Анимируется только ответ на нажатие самого человека: если данные поменял кто-то
// другой, экран просто показывает новое состояние (см. markOwnTap).

import { hasOverlay } from './overlays'
import { accent, resolvedTheme } from './theme'
import type { ResolvedTheme } from './types'

// --- кривые -------------------------------------------------------------------

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
export const mix = (a: number, b: number, p: number): number => a + (b - a) * p

export type Ease = (p: number) => number

export const E: Record<'out' | 'crisp' | 'inOut' | 'back', Ease> = {
  out: (p) => 1 - Math.pow(1 - p, 3),
  // Эталон рабочих экранов: та же кривая, что cubic-bezier(0.2, 0.8, 0.2, 1) у морфа
  // «Захостить» в пилл хоста. Быстрый старт, долгая мягкая остановка, без перелёта.
  crisp: (p) => 1 - Math.pow(1 - p, 4),
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: (p) => {
    const c1 = 1.4
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
  },
}

/** Прогресс участка [a; a + d] в момент t, через кривую. */
export const pr = (t: number, a: number, d: number, e: Ease = E.out): number => e(clamp((t - a) / d, 0, 1))

/** Горб 0 → 1 → 0 на участке [a; a + d]. */
export const pulse = (t: number, a: number, d: number): number => Math.sin(Math.PI * clamp((t - a) / d, 0, 1))

// --- цвет ---------------------------------------------------------------------

type Rgba = [number, number, number, number]

const parseColor = (c: string): Rgba => {
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3) h = h.replace(/./g, '$&$&')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  const m = (c.match(/[\d.]+/g) ?? []).map(Number)
  return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1]
}

export const mixc = (a: string, b: string, p: number): string => {
  const A = parseColor(a)
  const B = parseColor(b)
  return `rgba(${Math.round(mix(A[0], B[0], p))},${Math.round(mix(A[1], B[1], p))},${Math.round(mix(A[2], B[2], p))},${mix(A[3], B[3], p).toFixed(3)})`
}

/** Непрозрачный цвет в виде #RRGGBB: другой setHeaderColor не понимает. */
export const toHex = (c: string): string => {
  const [r, g, b] = parseColor(c)
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export type Tone = 'blue' | 'green' | 'indigo' | 'orange' | 'purple' | 'gray'

export type Palette = {
  bg: string
  /** Доля тона в подложке сцены: на чёрном тон приходится брать гуще. */
  mixp: number
  tones: Record<Tone, string>
  /** Обои Telegram под сценой шага «Бот». */
  wall: string
  /** Основной тон радужной подложки под картой резидента на «Готово». */
  pass: string
  text2: string
  dotOff: string
  /** Во сколько раз верх света полосы дальше от фона, чем сама подложка: на чёрном сильнее. */
  lift: number
  /** Блик сверху света полосы. */
  glint: string
}

const TONES = { blue: '#007aff', green: '#34c759', indigo: '#5856d6', orange: '#ff9500', purple: '#bf5af2' }

// Копия токенов app.css: сцену перекрашивает каждый кадр, и читать цвета из
// вычисленных стилей на каждом кадре дороже, чем держать их здесь.
const LIGHT: Palette = {
  bg: '#f2f2f7',
  mixp: 0.12,
  tones: { ...TONES, gray: '#8e8e93' },
  wall: '#a9cc9c',
  pass: '#e9ecf8',
  text2: 'rgba(60,60,67,.6)',
  dotOff: 'rgba(60,60,67,.2)',
  lift: 1.55,
  glint: 'rgba(255,255,255,.55)',
}
const DARK: Palette = {
  bg: '#000000',
  mixp: 0.21,
  tones: { ...TONES, gray: '#636366' },
  wall: '#0e1621',
  pass: '#08090f',
  text2: 'rgba(235,235,245,.6)',
  dotOff: 'rgba(235,235,245,.22)',
  lift: 1.9,
  glint: 'rgba(255,255,255,.08)',
}

let tinted: { key: string; value: Palette } | null = null

/** Палитра темы. Синий в ней - акцент (theme.ts): «сегодня» и сцены в тон кнопок Telegram человека. */
export const palette = (): Palette => {
  const base = resolvedTheme() === 'dark' ? DARK : LIGHT
  const blue = accent()
  if (blue === TONES.blue) return base
  const key = resolvedTheme() + blue
  if (tinted?.key !== key) tinted = { key, value: { ...base, tones: { ...base.tones, blue } } }
  return tinted.value
}

/** Подложка сцены в тон: тон поверх фона, на чёрном гуще. */
export const stageTint = (tone: Tone, C: Palette = palette()): string => mixc(C.bg, C.tones[tone], C.mixp)

/** Верх света полосы: подложка, отодвинутая от фона ещё дальше. Этим же цветом красится шапка Telegram. */
export const stageTop = (stage: string, C: Palette = palette()): string => {
  const [r, g, b] = parseColor(mixc(C.bg, stage, C.lift))
  return `rgb(${[r, g, b].map((v) => clamp(Math.round(v), 0, 255)).join(',')})`
}

/** На столько полоса света уходит ниже шапки, растворяясь в фоне страницы. */
export const BAND_FADE = 56

/**
 * Полоса тона светом, а не заливкой: сверху ярче подложки и с бликом, к низу шапки
 * подложка, ниже фон страницы без края. `head` - высота до низа шапки, без BAND_FADE.
 * Цвета смешиваются линейно, поэтому листалке хватает одного слоя: свет между двумя
 * днями - свет их смешанной подложки.
 */
export const bandLight = (stage: string, head: number, C: Palette = palette()): string => {
  const mid = ((head * 0.62) / (head + BAND_FADE)) * 100
  return `radial-gradient(130% 75% at 50% 0%, ${C.glint} 0%, transparent 60%), linear-gradient(to bottom, ${stageTop(stage, C)} 0%, ${stage} ${mid.toFixed(1)}%, ${C.bg} 100%)`
}

// --- тон афиши ----------------------------------------------------------------
// Ивент с фото красится в тон первой афиши (SpaceEvent.tone). Тон снимка почти всегда
// приглушённый, поэтому от него берутся только оттенок и насыщенность, а светлота
// считается: полосе в доле stageTint, тексту по контрасту с фоном, а не на глаз.

/** Каналы 0..1, а не 0..255, как у Rgba выше: в них считаются HSL и яркость по WCAG. */
type Rgb = [number, number, number]

/** HSL цвета с каналами 0..1: оттенок в градусах, насыщенность и светлота 0..1. */
export const hsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 1e-6) return { h: 0, s: 0, l }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)), l }
}

const fromHsl = (h: number, s: number, l: number): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b]: Rgb =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}

const rgbOf = (c: string): Rgb => {
  const [r, g, b] = parseColor(c)
  return [r / 255, g / 255, b / 255]
}

const hexOf = (c: Rgb): string =>
  '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')

const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/** Относительная яркость по WCAG 2. */
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

const contrast = (a: Rgb, b: Rgb): number => {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Акцент не бледнее этого: снимок обычно приглушённее, чем должны быть значок и кнопка. */
const TONE_SAT = 0.72
/** Контраст текста и значков с фоном: WCAG AA для обычного кегля. */
const INK_CONTRAST = 4.5
/** Карточка обеих тем: копия --card из app.css, как и палитры выше. */
const TONE_CARD: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#1c1c1e' }
/** Доля тона в подложке, как у --ev-bg: на чёрной карточке тон приходится брать гуще. */
const TONE_SOFT: Record<ResolvedTheme, number> = { light: 0.1, dark: 0.2 }

/**
 * Тон, сдвинутый по светлоте от средней, пока не наберёт контраст с фоном: от светлого
 * фона он темнеет, от тёмного светлеет.
 */
const inkOn = (h: number, s: number, bg: Rgb): Rgb => {
  const down = luminance(bg) > luminance(fromHsl(h, s, 0.5))
  let ink = fromHsl(h, s, 0.5)
  for (let k = 1; k <= 45 && contrast(ink, bg) < INK_CONTRAST; k++) ink = fromHsl(h, s, 0.5 + (down ? -k : k) / 100)
  return ink
}

export type ToneColors = {
  /** Полоса под афишей и шапка Telegram: тон поверх фона в той же доле, что stageTint. */
  band: string
  /** Текст и значки на карточке. */
  ink: string
  /** Подложка в тон: карточка ивента в превью редактора, плитка даты в «Позже». */
  soft: string
  /** Текст и значки на этой подложке. */
  softInk: string
}

/** Цвета ивента в тон его афиши для темы `theme`. */
export const toneColors = (tone: string, theme: ResolvedTheme = resolvedTheme()): ToneColors => {
  const [r, g, b] = rgbOf(tone)
  const { h, s } = hsl(r, g, b)
  const sat = Math.max(s, TONE_SAT)
  const vivid = fromHsl(h, sat, 0.5)
  const C = theme === 'dark' ? DARK : LIGHT
  const card = rgbOf(TONE_CARD[theme])
  const p = TONE_SOFT[theme]
  const soft: Rgb = [mix(card[0], vivid[0], p), mix(card[1], vivid[1], p), mix(card[2], vivid[2], p)]
  return {
    band: toHex(mixc(C.bg, hexOf(vivid), C.mixp)),
    ink: hexOf(inkOn(h, sat, card)),
    soft: hexOf(soft),
    softInk: hexOf(inkOn(h, sat, soft)),
  }
}

// --- проигрыватель ------------------------------------------------------------

/**
 * Слабый Android: Telegram пишет класс производительности в User-Agent
 * (`Telegram-Android/… (…; SDK 34; LOW)`), и документация прямо просит урезать на нём
 * движение. Кадры там рвутся, и анимация хуже её отсутствия.
 */
export const lowEnd = ((): boolean => {
  try {
    return /Telegram-Android\/[^(]*\([^)]*;\s*LOW\)/i.test(navigator.userAgent)
  } catch {
    return false
  }
})()

export const reducedMotion = (): boolean => {
  if (lowEnd) return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Поле ввода по высоте текста. Пока человек пишет, высота едет за 120 мс, как поле
 * сообщения в Telegram, а не прыгает строкой за кадр; `still` (текст поставил код, а не
 * человек) встаёт сразу. Выше `max` поле листается внутри.
 */
export function growField(el: HTMLTextAreaElement, { still = false, max = Infinity }: { still?: boolean; max?: number } = {}): void {
  const from = el.getBoundingClientRect().height
  el.style.transition = 'none'
  el.style.height = 'auto'
  const full = el.scrollHeight
  const to = Math.min(full, max)
  el.style.overflowY = full > max ? 'auto' : 'hidden'
  if (still || reducedMotion() || Math.abs(to - from) < 0.5) {
    el.style.height = `${to}px`
    el.style.transition = ''
    return
  }
  el.style.height = `${from}px`
  // Без чтения раскладки браузер склеил бы обе высоты в одну и перехода бы не было.
  void el.offsetHeight
  el.style.transition = 'height 0.12s cubic-bezier(0.2, 0.8, 0.2, 1)'
  el.style.height = `${to}px`
}

/**
 * Проигрывает кадры `frame(t)` от 0 до `dur` миллисекунд. Возвращает отмену. При
 * «уменьшении движения» сразу рисует конечный кадр.
 */
export const animate = (dur: number, frame: (t: number) => void, done?: () => void): (() => void) => {
  if (reducedMotion()) {
    frame(dur)
    done?.()
    return () => {}
  }
  const t0 = performance.now()
  let raf = 0
  const tick = (now: number): void => {
    const t = Math.min(dur, now - t0)
    frame(t)
    if (t < dur) {
      raf = requestAnimationFrame(tick)
      return
    }
    raf = 0
    done?.()
  }
  frame(0)
  raf = requestAnimationFrame(tick)
  return () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
}

// --- жесты --------------------------------------------------------------------
// Физика отпускания по WWDC18 «Designing Fluid Interfaces»: кривая с нулевой скоростью
// на старте заставляет брошенный элемент замереть, пружина подхватывает скорость пальца.

/** Резинка UIScrollView: за краем сдвиг растёт всё медленнее и не доходит до d. */
export const rubber = (over: number, d: number, c = 0.55): number => {
  const a = Math.abs(over)
  return (Math.sign(over) * a * d * c) / (d + c * a)
}

/**
 * Куда доехало бы тело, отпущенное со скоростью v (единиц в секунду), при замедлении
 * UIScrollView: 0.998 обычное, 0.99 быстрое.
 */
export const project = (v: number, rate = 0.998): number => ((v / 1000) * rate) / (1 - rate)

/** Пружина как в SwiftUI: response в секундах, damping это доля затухания (1 без перелёта). */
export type SpringOpts = { response: number; damping: number }

/** Смещение от цели и скорость через t секунд после старта со смещением x0 и скоростью v0. */
export const springAt = (x0: number, v0: number, s: SpringOpts, t: number): { x: number; v: number } => {
  const w0 = (2 * Math.PI) / s.response
  const z = s.damping
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z)
    const b = (v0 + z * w0 * x0) / wd
    const e = Math.exp(-z * w0 * t)
    const cos = Math.cos(wd * t)
    const sin = Math.sin(wd * t)
    return {
      x: e * (x0 * cos + b * sin),
      v: e * ((b * wd - z * w0 * x0) * cos - (x0 * wd + z * w0 * b) * sin),
    }
  }
  const e = Math.exp(-w0 * t)
  const b = v0 + w0 * x0
  return { x: e * (x0 + b * t), v: e * (b - w0 * (x0 + b * t)) }
}

/**
 * Пружина от from к to со стартовой скоростью velocity (единиц в секунду). `eps` это
 * точность в единицах значения. Возвращает остановку и текущую скорость: новое касание
 * подхватывает движение с того же места, а не с нуля.
 */
export const spring = (
  from: number,
  to: number,
  velocity: number,
  s: SpringOpts,
  frame: (x: number) => void,
  done?: () => void,
  eps = 0.5,
): { stop: () => void; velocity: () => number } => {
  if (reducedMotion()) {
    frame(to)
    done?.()
    return { stop: () => {}, velocity: () => 0 }
  }
  let cur = { x: from - to, v: velocity }
  const t0 = performance.now()
  let raf = 0
  const tick = (now: number): void => {
    // Метка кадра rAF бывает раньше старта пружины: отрицательное время отбросило бы
    // тело назад на первом кадре.
    cur = springAt(from - to, velocity, s, Math.max(0, now - t0) / 1000)
    if (Math.abs(cur.x) < eps && Math.abs(cur.v) < eps * 10) {
      raf = 0
      frame(to)
      done?.()
      return
    }
    frame(to + cur.x)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return {
    stop: () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
    velocity: () => cur.v,
  }
}

// --- кадры системе -----------------------------------------------------------------
// На iPhone с 120 Гц вебвью Telegram рисует то, что двигает requestAnimationFrame, на 60
// кадрах, а Web Animations по transform и opacity отдаёт Core Animation, и они идут на 120.
// Поэтому доводки без пальца уходят системе готовыми кадрами. Чтобы не дёрнулось:
// - в кадрах только transform и opacity: с любым другим свойством WebKit ведёт анимацию сам,
//   на 60, а то, что меняется в том же кадре другим путём, разъедется с ней (поэтому
//   листалки с полосой, высотой и точками и жест «вниз» с clip-path остаются на кадрах JS);
// - конечный вид ставится инлайном до старта, анимация без fill: в конце ничего не
//   откатывается и не залипает поверх следующих правок;
// - остановка сначала ставит инлайном вид текущего момента и только потом снимает анимацию:
//   пока она идёт, она перекрывает инлайн, и жест поверх неё был бы не виден.

/** Вид элемента: только то, что система ведёт сама. */
export type Look = { transform?: string; opacity?: string }
/** Элемент и его вид при значении v (время в мс или положение пружины). */
export type Track = readonly [HTMLElement | null | undefined, (v: number) => Look]

const waapi = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
/** Шаг кадров, 120 в секунду: между ними анимация линейна. */
const STEP_MS = 1000 / 120

const putLook = (el: HTMLElement, look: Look): void => {
  if (look.transform !== undefined) el.style.transform = look.transform
  if (look.opacity !== undefined) el.style.opacity = look.opacity
}
const keyframe = (look: Look, offset: number): Keyframe => {
  const k: Keyframe = { offset }
  if (look.transform !== undefined) k.transform = look.transform
  if (look.opacity !== undefined) k.opacity = look.opacity
  return k
}

/**
 * Проигрывает вид `tracks` от 0 до `dur` мс кадрами системы. Возвращает остановку: элементы
 * замирают там, где их застала остановка, а она отдаёт этот момент в мс. Без Web Animations
 * кадры рисует requestAnimationFrame, при уменьшенном движении сразу встаёт конечный вид.
 */
export function play(dur: number, tracks: readonly Track[], done?: () => void): { stop: () => number } {
  const live = tracks.filter((t): t is readonly [HTMLElement, (v: number) => Look] => Boolean(t[0]))
  const at = (t: number): void => live.forEach(([el, look]) => putLook(el, look(t)))
  const t0 = performance.now()
  let over = false
  if (!waapi || reducedMotion() || live.length === 0) {
    const cancel = animate(dur, at, () => {
      over = true
      done?.()
    })
    return {
      stop: () => {
        if (over) return dur
        over = true
        cancel()
        const t = Math.min(dur, performance.now() - t0)
        at(t)
        return t
      },
    }
  }
  const n = Math.max(1, Math.ceil(dur / STEP_MS))
  const anims = live.map(([el, look]) => {
    const frames: Keyframe[] = []
    for (let i = 0; i <= n; i++) frames.push(keyframe(look((dur * i) / n), i / n))
    putLook(el, look(dur))
    const a = el.animate(frames, { duration: dur, easing: 'linear' })
    // Снятая анимация отклоняет finished: без обработчика это ошибка в консоли.
    a.finished.catch(() => {})
    return a
  })
  anims[0]!.finished.then(
    () => {
      if (over) return
      over = true
      done?.()
    },
    () => {},
  )
  return {
    stop: () => {
      if (over) return dur
      over = true
      // До первого кадра время анимации ещё не идёт (null): тогда считаем от старта.
      const ct = anims[0]!.currentTime
      const t = clamp(typeof ct === 'number' ? ct : performance.now() - t0, 0, dur)
      at(t)
      anims.forEach((a) => a.cancel())
      return t
    },
  }
}

/**
 * `spring` с кадрами системе: `tracks` дают вид при положении x. `frame(x)` ставит положение
 * и его вид, как у `spring`: конечное до старта, текущее при остановке и конечное в конце.
 * Остановка, скорость и `value` отдают то, что сейчас на экране, и новое касание
 * подхватывает движение оттуда.
 */
export const springPlay = (
  from: number,
  to: number,
  velocity: number,
  s: SpringOpts,
  tracks: readonly Track[],
  frame: (x: number) => void,
  done?: () => void,
  eps = 0.5,
): { stop: () => void; velocity: () => number; value: () => number } => {
  if (!waapi || reducedMotion()) {
    let cur = from
    const sp = spring(from, to, velocity, s, (x) => {
      cur = x
      frame(x)
    }, done, eps)
    return { stop: sp.stop, velocity: sp.velocity, value: () => cur }
  }
  // Длина та же, что у spring: пока смещение и скорость не меньше точности.
  let len = 0
  for (let t = 0; t < 3; t += STEP_MS / 1000) {
    len = t
    const p = springAt(from - to, velocity, s, t)
    if (Math.abs(p.x) < eps && Math.abs(p.v) < eps * 10) break
  }
  const dur = Math.max(STEP_MS, len * 1000)
  const xAt = (ms: number): number => (ms >= dur ? to : to + springAt(from - to, velocity, s, ms / 1000).x)
  const t0 = performance.now()
  let stoppedAt: number | null = null
  frame(to)
  const run = play(
    dur,
    tracks.map(([el, look]): Track => [el, (ms) => look(xAt(ms))]),
    () => {
      frame(to)
      done?.()
    },
  )
  const elapsed = (): number => stoppedAt ?? Math.min(dur, performance.now() - t0)
  return {
    stop: () => {
      if (stoppedAt !== null) return
      stoppedAt = run.stop()
      frame(xAt(stoppedAt))
    },
    velocity: () => (elapsed() >= dur ? 0 : springAt(from - to, velocity, s, elapsed() / 1000).v),
    value: () => xAt(elapsed()),
  }
}

/**
 * Пружина без перелёта при любом броске: у критического затухания тело, брошенное к
 * цели быстрее w0·|x0|, проскакивает её и возвращается, и доводка читается желе. Такую
 * скорость срезаем до той, при которой оно ровно доезжает.
 */
export const landing = (x0: number, v0: number, s: SpringOpts): number => {
  if (x0 === 0) return 0
  const cap = (Math.abs(x0) * 2 * Math.PI) / s.response
  return Math.sign(v0) === Math.sign(x0) ? v0 : clamp(v0, -cap, cap)
}

/** Пружина листалок (дни, карточки): без перелёта, и доводка не тянется. */
export const PAGE_SPRING: SpringOpts = { response: 0.3, damping: 1 }

/**
 * Куда встанет листалка, отпущенная в дробной позиции p со скоростью v (страниц в
 * секунду): ближняя к месту страница, а бросок перелистывает на соседнюю в свою
 * сторону. Считается от того, где страница сейчас, а не от той, с которой начали:
 * дотянутая до третьей страницы встаёт на неё, а не откатывается ко второй.
 */
export const pageTarget = (p: number, v: number, width: number): number => {
  const near = Math.round(p)
  let to = Math.round(p + project(v, 0.99))
  // Короткий, но быстрый бросок всё равно листает.
  if (to === near && Math.abs(v * width) > 500) to = near + Math.sign(v)
  const flat = Number.isInteger(p)
  return clamp(to, Math.floor(p) - (flat ? 1 : 0), Math.ceil(p) + (flat ? 1 : 0))
}

/** Стрелка на клавиатуре листает, если её не ждёт поле ввода, шторка или сочетание клавиш. */
export const arrowStep = (e: KeyboardEvent): -1 | 0 | 1 => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return 0
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || hasOverlay()) return 0
  if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return 0
  return e.key === 'ArrowRight' ? 1 : -1
}

/**
 * Левые 30 pt вебвью Telegram iOS оставляет своему жесту перехода (у WebAppWebView в
 * исходниках клиента `interactiveTransitionGestureRecognizerTest` с `point.x > 30`).
 * Горизонтальные жесты миниаппа начинаются правее.
 */
export const EDGE_ZONE = 30

/**
 * Жест мышью тянет за собой выделение текста: браузер начинает его на нажатии, и к
 * решению оси под курсором уже синеют строки. На время жеста выделение снимается и не
 * начинается заново; вернувшаяся функция отпускает.
 */
export const holdSelection = (): (() => void) => {
  const html = document.documentElement
  window.getSelection()?.removeAllRanges()
  html.classList.add('no-select')
  const stop = (e: Event): void => e.preventDefault()
  document.addEventListener('selectstart', stop, true)
  return () => {
    html.classList.remove('no-select')
    document.removeEventListener('selectstart', stop, true)
  }
}

/**
 * Скорость пальца в единицах в секунду: сглаженная, и ноль, если палец замер перед
 * отпусканием. Одна последняя пара событий шумит, и случайный рывок перелистывал бы.
 */
export const tracker = () => {
  let v = 0
  let lx = 0
  let lt = 0
  return {
    start(x: number, t: number): void {
      v = 0
      lx = x
      lt = t
    },
    move(x: number, t: number): void {
      const dt = Math.max(1, t - lt)
      v = mix(v, ((x - lx) / dt) * 1000, 0.6)
      lx = x
      lt = t
    },
    release(t: number): number {
      return t - lt > 90 ? 0 : v
    },
  }
}

// --- свой тап -----------------------------------------------------------------

/**
 * Ответ сервера на собственный тап приходит новым bootstrap'ом, как и любое чужое
 * изменение. Отличить их можно только по времени: что пришло вскоре после своего
 * нажатия, то и анимируем. Окно с запасом на медленную сеть.
 */
export const OWN_TAP_WINDOW_MS = 5000

let ownTapAt = -Infinity

export const markOwnTap = (): void => {
  ownTapAt = performance.now()
}

export const ownTapRecent = (): boolean => performance.now() - ownTapAt < OWN_TAP_WINDOW_MS
