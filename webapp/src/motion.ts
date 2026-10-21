// Общий язык движения: кривые, цвета сцен и проигрыватель кадров. Родом из движка
// знакомства (onboarding.ts), рабочие экраны берут движение отсюда же, чтобы
// длительности и перелёты везде были одни.
//
// Анимируется только ответ на нажатие самого человека: если данные поменял кто-то
// другой, экран просто показывает новое состояние (см. markOwnTap).

import { resolvedTheme } from './theme'

// --- кривые -------------------------------------------------------------------

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
export const mix = (a: number, b: number, p: number): number => a + (b - a) * p

export type Ease = (p: number) => number

export const E: Record<'out' | 'inOut' | 'back', Ease> = {
  out: (p) => 1 - Math.pow(1 - p, 3),
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
}
const DARK: Palette = {
  bg: '#000000',
  mixp: 0.21,
  tones: { ...TONES, gray: '#636366' },
  wall: '#0e1621',
  pass: '#08090f',
  text2: 'rgba(235,235,245,.6)',
  dotOff: 'rgba(235,235,245,.22)',
}

export const palette = (): Palette => (resolvedTheme() === 'dark' ? DARK : LIGHT)

/** Подложка сцены в тон: тон поверх фона, на чёрном гуще. */
export const stageTint = (tone: Tone, C: Palette = palette()): string => mixc(C.bg, C.tones[tone], C.mixp)

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
const OWN_TAP_WINDOW_MS = 5000

let ownTapAt = -Infinity

export const markOwnTap = (): void => {
  ownTapAt = performance.now()
}

export const ownTapRecent = (): boolean => performance.now() - ownTapAt < OWN_TAP_WINDOW_MS
