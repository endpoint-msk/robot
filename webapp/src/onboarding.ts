// Движок знакомства с ботом (screens/Onboarding.tsx). Всё движение - функция
// времени и дробной позиции листалки, и рисуется прямыми правками style через
// ref'ы: кадр обложки - это под сорок трансформов, и перерисовывать ради них
// дерево React незачем. Разметка сцен - в components/OnboardingScenes.tsx.

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
const pulse = (t: number, a: number, d: number): number => Math.sin(Math.PI * clamp((t - a) / d, 0, 1))

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

// --- DOM ----------------------------------------------------------------------

const q = (el: Element, s: string): HTMLElement | null => el.querySelector<HTMLElement>(s)
const qa = (el: Element, s: string): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(s))

const rise = (el: HTMLElement | null, t: number, a: number, d: number, dy = 14): void => {
  if (!el) return
  const p = pr(t, a, d)
  el.style.opacity = String(p)
  el.style.transform = `translateY(${((1 - p) * dy).toFixed(2)}px)`
}

// --- соты ---------------------------------------------------------------------

export type HiveCell = { x: number; y: number; rho: number; ang: number }
export type HivePerson = { name: string; username: string | null; inside: boolean }

export type HiveState = {
  cells: HiveCell[]
  people: HivePerson[]
  pan: { x: number; y: number }
  /** Чья подпись открыта. null - ничья. */
  tip: number | null
  /**
   * Какой из двух элементов подписи показывает текущую. Их два, чтобы при тапе по
   * другому человеку старая подпись успела погаснуть у своего кружка, пока новая
   * появляется у нового: один элемент просто перескочил бы.
   */
  tipSlot: 0 | 1
  /** Дальше этого соты тянутся резинкой. */
  maxPan: number
}

/** Шаг решётки: кружок в 70px плюс зазор под его обводку. */
const HIVE_STEP = 92

/**
 * Места в сотах, ближние к центру первыми. Колец столько, чтобы хватило на всех.
 * Неполное внешнее кольцо заполняется вразброс по кругу, а не подряд: иначе люди
 * сбились бы на одном боку.
 */
const hiveCells = (count: number): HiveCell[] => {
  if (count <= 0) return []
  let rings = 1
  while (3 * rings * (rings + 1) < count) rings++
  const d = HIVE_STEP
  const all: HiveCell[] = []
  for (let r = -rings; r <= rings; r++) {
    for (let c = -rings - 1; c <= rings + 1; c++) {
      const x = (c + (Math.abs(r) % 2 ? 0.5 : 0)) * d
      const y = (r * d * Math.sqrt(3)) / 2
      const rho = Math.hypot(x, y)
      if (rho < 1 || rho > rings * d + 1) continue
      all.push({ x, y, rho, ang: Math.atan2(y, x) })
    }
  }
  all.sort((a, b) => a.rho - b.rho || a.ang - b.ang)
  const out: HiveCell[] = []
  let i = 0
  while (i < all.length && out.length < count) {
    let j = i
    while (j < all.length && Math.abs(all[j]!.rho - all[i]!.rho) < 0.5) j++
    const shell = all.slice(i, j)
    const left = count - out.length
    if (shell.length <= left) out.push(...shell)
    else for (let k = 0; k < left; k++) out.push(shell[Math.floor((k * shell.length) / left)]!)
    i = j
  }
  return out
}

export const createHive = (people: HivePerson[]): HiveState => {
  const cells = hiveCells(people.length)
  const reach = cells.reduce((m, c) => Math.max(m, c.rho), 0)
  return { cells, people, pan: { x: 0, y: 0 }, tip: null, tipSlot: 0, maxPan: Math.max(reach + 9, 120) }
}

/**
 * Линза как на экране приложений Apple Watch: размер и прозрачность зависят от
 * расстояния до центра экрана, а не до вас, поэтому при перетаскивании в фокус
 * приезжают другие люди, а края мельчают и тают.
 */
const lens = (vx: number, vy: number): { x: number; y: number; f: number; op: number } => {
  const rho = Math.hypot(vx, vy)
  const k = Math.min(rho / 235, 1.3)
  const sq = 1 - 0.14 * k
  return {
    x: vx * sq,
    y: vy * sq,
    f: clamp(1 - 0.62 * Math.pow(k, 1.5), 0.1, 1),
    op: rho < 190 ? 1 : clamp(1 - (rho - 190) / 110, 0, 1),
  }
}

/**
 * Обложка: вы появляетесь первым, соты распускаются волной от вас. Сами они потом
 * не двигаются, только под пальцем.
 */
export const renderHive = (host: HTMLElement, t: number, hs: HiveState): void => {
  const h = q(host, '.ob-hive')
  if (!h) return
  const T = Number.isFinite(t) ? Math.max(0, t) : 6000
  const you = q(h, '.ob-you')
  const cellEls = qa(h, '.ob-cell[data-i]')

  const ox = hs.pan.x
  const oy = hs.pan.y
  for (const a of cellEls) {
    const c = hs.cells[Number(a.dataset.i)]
    if (!c) continue
    const at = 260 + c.rho * 2.1
    const sp = pr(T, at, 640, E.back)
    const mv = pr(T, at, 640)
    const L = lens(c.x + ox, c.y + oy)
    // Пока соты распускаются, кружки выходят из центра, а не возникают на месте.
    const em = 0.5 + 0.5 * mv
    a.style.opacity = (clamp(mv * 1.7, 0, 1) * L.op).toFixed(3)
    a.style.zIndex = String(Math.round(L.f * 100))
    a.style.transform = `translate(${(L.x * em - 35).toFixed(2)}px,${(L.y * em - 35).toFixed(2)}px) scale(${(L.f * Math.max(0, sp)).toFixed(4)})`
  }

  const Y = lens(ox, oy)
  const yz = String(Math.round(Y.f * 100) + 1)
  if (you) {
    you.style.opacity = (pr(T, 0, 180) * Y.op).toFixed(3)
    you.style.zIndex = yz
    you.style.transform = `translate(${(Y.x - 43).toFixed(2)}px,${(Y.y - 43).toFixed(2)}px) scale(${Math.max(0, pr(T, 0, 560, E.back) * Y.f).toFixed(4)})`
  }
  const tag = q(h, '.ob-you-tag')
  if (tag) {
    const tp = pr(T, 980, 380)
    tag.style.opacity = (tp * Y.op).toFixed(3)
    tag.style.zIndex = yz
    tag.style.transform = `translate(${Y.x.toFixed(2)}px,${(Y.y + 43 * Y.f - 11 + (1 - tp) * 8).toFixed(2)}px) translateX(-50%)`
  }

  // Погасшая подпись остаётся у своего кружка и тает там сама (CSS-переход), новая
  // появляется у нового.
  const tips = qa(h, '.ob-tip')
  const tip = tips[hs.tipSlot]
  tips[1 - hs.tipSlot]?.classList.remove('on')
  if (!tip) return
  const ti = hs.tip
  const c = ti === null ? undefined : hs.cells[ti]
  const who = ti === null ? undefined : hs.people[ti]
  if (!c || !who) {
    tip.classList.remove('on')
    return
  }
  if (tip.dataset.i !== String(ti)) {
    // Элемент мог ещё гаснуть после прошлого человека: переход начинаем заново,
    // иначе подпись на полпути прыгнет к новому кружку.
    tip.style.transition = 'none'
    tip.classList.remove('on')
    void tip.offsetWidth
    tip.style.transition = ''
    tip.dataset.i = String(ti)
    const name = q(tip, '.ob-tip-name')
    const nick = q(tip, '.ob-tip-nick')
    const on = q(tip, '.ob-tip-on')
    if (name) name.textContent = who.name
    if (nick) {
      nick.textContent = who.username ? '@' + who.username : ''
      nick.hidden = !who.username
    }
    if (on) on.hidden = !who.inside
  }
  const L2 = lens(c.x + ox, c.y + oy)
  // Подпись уходит от центра наружу, чтобы не ложиться на вас.
  const up = L2.y < -1
  tip.classList.toggle('up', up)
  tip.style.left = `${L2.x.toFixed(2)}px`
  tip.style.top = `${(L2.y + (up ? -1 : 1) * (35 * L2.f + 8)).toFixed(2)}px`
  tip.classList.add('on')
}

/**
 * Палец двигает соты, за краем - резинка. На отпускании критически
 * задемпфированная пружина без перелёта возвращает вас в центр. Тап по человеку
 * открывает подпись, тап по себе закрывает её.
 *
 * pointerdown дальше не всплывает: тот же жест иначе листал бы шаги. `scale` - во
 * сколько раз соты ужаты на низком экране: палец двигается в пикселях экрана.
 */
export const attachHiveDrag = (
  st: HTMLElement,
  hs: HiveState,
  render: () => void,
  scale: () => number = () => 1,
): (() => void) => {
  type Vec = { x: number; y: number }
  type Drag = { x0: number; y0: number; p0: Vec; lx: number; ly: number; lt: number; v: Vec; moved: boolean; target: Element; k: number }
  let drag: Drag | null = null
  let motion: { to: Vec; v: Vec; last: number } | null = null
  let raf = 0

  const band = (v: Vec): Vec => {
    const m = Math.hypot(v.x, v.y)
    if (m <= hs.maxPan) return v
    const m2 = hs.maxPan + (m - hs.maxPan) * 0.35
    return { x: (v.x / m) * m2, y: (v.y / m) * m2 }
  }

  const tick = (now: number): void => {
    raf = 0
    if (!motion) return
    const dt = Math.min(32, now - motion.last)
    motion.last = now
    const { v, to } = motion
    const p = hs.pan
    // Жёсткость и трение подобраны под «без перелёта»: c ≈ 2√k.
    const k = 0.000121
    const c = 0.022
    v.x += (-k * (p.x - to.x) - c * v.x) * dt
    v.y += (-k * (p.y - to.y) - c * v.y) * dt
    const nx = p.x + v.x * dt
    const ny = p.y + v.y * dt
    if (Math.hypot(nx - to.x, ny - to.y) < 0.25 && Math.hypot(v.x, v.y) < 0.004) {
      hs.pan = { x: to.x, y: to.y }
      motion = null
      render()
      return
    }
    hs.pan = { x: nx, y: ny }
    render()
    raf = requestAnimationFrame(tick)
  }

  const settle = (to: Vec, v: Vec): void => {
    motion = { to, v: { x: v.x, y: v.y }, last: performance.now() }
    if (!raf) raf = requestAnimationFrame(tick)
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button > 0 || (e.target as Element).closest('button')) return
    e.stopPropagation()
    motion = null
    const now = performance.now()
    drag = {
      x0: e.clientX,
      y0: e.clientY,
      p0: { x: hs.pan.x, y: hs.pan.y },
      lx: e.clientX,
      ly: e.clientY,
      lt: now,
      v: { x: 0, y: 0 },
      moved: false,
      target: e.target as Element,
      k: scale() || 1,
    }
    try {
      st.setPointerCapture(e.pointerId)
    } catch {
      /* указатель уже отпущен */
    }
  }

  const onMove = (e: PointerEvent): void => {
    if (!drag) return
    const dx = (e.clientX - drag.x0) / drag.k
    const dy = (e.clientY - drag.y0) / drag.k
    if (!drag.moved && Math.hypot(dx, dy) > 5 / drag.k) {
      drag.moved = true
      hs.tip = null
    }
    if (!drag.moved) return
    hs.pan = band({ x: drag.p0.x + dx, y: drag.p0.y + dy })
    const now = performance.now()
    const dt = Math.max(1, now - drag.lt)
    drag.v = {
      x: mix(drag.v.x, (e.clientX - drag.lx) / drag.k / dt, 0.6),
      y: mix(drag.v.y, (e.clientY - drag.ly) / drag.k / dt, 0.6),
    }
    drag.lx = e.clientX
    drag.ly = e.clientY
    drag.lt = now
    render()
  }

  const onEnd = (): void => {
    if (!drag) return
    const d = drag
    drag = null
    if (!d.moved) {
      const cell = d.target.closest<HTMLElement>('.ob-cell')
      const i = cell && !cell.classList.contains('ob-you') ? Number(cell.dataset.i) : null
      if (i === null || i === hs.tip) hs.tip = null
      else {
        // Подпись уже открыта у другого человека: она гаснет на своём месте, а новая
        // показывается во втором элементе.
        if (hs.tip !== null) hs.tipSlot = hs.tipSlot === 0 ? 1 : 0
        hs.tip = i
      }
      if (cell && cell.classList.contains('ob-you')) settle({ x: 0, y: 0 }, { x: 0, y: 0 })
      render()
      return
    }
    // Палец замер перед отпусканием - броска не было.
    if (performance.now() - d.lt > 90) d.v = { x: 0, y: 0 }
    const sp = Math.hypot(d.v.x, d.v.y)
    if (sp > 2.4) {
      d.v.x *= 2.4 / sp
      d.v.y *= 2.4 / sp
    }
    settle({ x: 0, y: 0 }, { x: d.v.x * 0.35, y: d.v.y * 0.35 })
  }

  st.addEventListener('pointerdown', onDown)
  st.addEventListener('pointermove', onMove)
  st.addEventListener('pointerup', onEnd)
  st.addEventListener('pointercancel', onEnd)
  return () => {
    st.removeEventListener('pointerdown', onDown)
    st.removeEventListener('pointermove', onMove)
    st.removeEventListener('pointerup', onEnd)
    st.removeEventListener('pointercancel', onEnd)
    if (raf) cancelAnimationFrame(raf)
  }
}

// --- сцены шагов --------------------------------------------------------------

/** Высота строки «@вы» на доске: меряется один раз, дальше строка растёт от нуля до неё. */
const lineHeights = new WeakMap<HTMLElement, number>()

/** Сбросить замеры строк: после смены размеров экрана или шрифта они врут. */
export const resetLineHeights = (root: Element): void => {
  for (const line of qa(root, '.ob-me-line')) {
    lineHeights.delete(line)
    line.style.height = ''
  }
}

/** Ваш ник встаёт в список, подсветка гаснет, счётчик перещёлкивается на единицу. */
const meLine = (st: HTMLElement, t: number, a: number): void => {
  const cnt = q(st, '.ob-cnt-in')
  if (cnt) cnt.style.transform = `translateY(${(-pr(t, a + 80, 400, E.back) * 1.36).toFixed(3)}em)`
  const line = q(st, '.ob-me-line')
  if (!line) return
  let hgt = lineHeights.get(line)
  if (!hgt) {
    line.style.height = ''
    hgt = line.scrollHeight >= 10 ? line.scrollHeight : 20
    lineHeights.set(line, hgt)
  }
  const p = pr(t, a, 420)
  line.style.height = `${(p * hgt).toFixed(2)}px`
  line.style.opacity = String(p)
  const me = q(line, '.ob-me')
  if (me) me.style.backgroundColor = `rgba(52,199,89,${mix(0.5, 0.2, pr(t, a + 450, 900)).toFixed(3)})`
}

export type SceneName = 'cover' | 'presence' | 'mac' | 'notify' | 'guests' | 'events' | 'dues' | 'bot' | 'done'

type Scene = { dur: number; render: (st: HTMLElement, t: number, hive: HiveState) => void }

/** Сцена шага: сколько длится и как выглядит в момент t (Infinity - конечный кадр). */
export const SCENES: Record<SceneName, Scene> = {
  // Волна доходит до внешнего кольца меньше чем за две секунды и на этом заканчивается.
  cover: { dur: 2000, render: (st, t, hive) => renderHive(st, t, hive) },
  // Карта резидента встаёт из наклона, как поднятая со стола, по ней проходит блик,
  // и печатается штрихкод.
  done: {
    dur: 2200,
    render: (st, t) => {
      const card = q(st, '.ob-pass')
      if (card) {
        const p = pr(t, 0, 760, E.back)
        card.style.opacity = String(pr(t, 0, 220))
        card.style.transform = `perspective(900px) translateY(${((1 - p) * 70).toFixed(2)}px) rotateX(${((1 - p) * 58).toFixed(3)}deg)`
      }
      const sheen = q(st, '.ob-pass-sheen')
      if (sheen) sheen.style.transform = `translateX(${(200 * pr(t, 560, 1000, E.inOut)).toFixed(2)}%)`
      const bars = q(st, '.ob-pass-bars')
      if (bars) bars.style.clipPath = `inset(0 ${((1 - pr(t, 860, 620, E.inOut)) * 100).toFixed(2)}% 0 0)`
    },
  },
  presence: {
    dur: 2000,
    render: (st, t) => {
      rise(q(st, '.ob-board'), t, 0, 460)
      meLine(st, t, 720)
    },
  },
  mac: {
    dur: 2400,
    render: (st, t) => {
      rise(q(st, '.ob-wifi'), t, 0, 420)
      const spin = q(st, '.ob-spin')
      const ck = q(st, '.ob-wf-check')
      if (spin) {
        spin.style.opacity = t >= 1050 ? '0' : String(pr(t, 200, 200))
        if (Number.isFinite(t)) spin.style.transform = `rotate(${Math.floor(Math.max(0, t) / 85) * 45}deg)`
      }
      if (ck) {
        const c = pr(t, 1050, 400, E.back)
        ck.style.opacity = String(clamp(c * 2, 0, 1))
        ck.style.transform = `scale(${c.toFixed(4)})`
      }
      rise(q(st, '.ob-mac-board'), t, 320, 460)
      meLine(st, t, 1320)
    },
  },
  // Баннеры приходят как в iOS: новый сверху, старые съезжают вниз.
  notify: {
    dur: 1700,
    render: (st, t) => {
      const nbs = qa(st, '.ob-nbs .ob-nb')
      const n = nbs.length
      nbs.forEach((nb, k) => {
        const a = (n - 1 - k) * 450
        let y = 0
        for (let j = 0; j < n; j++) {
          const a2 = (n - 1 - j) * 450
          if (a2 > a) y += 82 * pr(t, a2, 480)
        }
        const ap = pr(t, a, 440)
        const sp = pr(t, a, 560, E.back)
        nb.style.opacity = String(clamp(ap * 1.6, 0, 1))
        nb.style.transform = `translateY(${(y - (1 - ap) * 26).toFixed(2)}px) scale(${(0.94 + 0.06 * sp).toFixed(4)})`
      })
    },
  },
  guests: {
    dur: 2100,
    render: (st, t) => {
      const nb = q(st, '.ob-door-nb')
      if (!nb) return
      const a = pr(t, 520, 440)
      const s = pr(t, 520, 560, E.back)
      nb.style.opacity = String(a)
      nb.style.transform = `translateY(${((1 - a) * -26).toFixed(2)}px) scale(${(0.94 + 0.06 * s).toFixed(4)})`
    },
  },
  // Пост канала уходит назад, ивент из него встаёт вперёд на той же оси.
  events: {
    dur: 1800,
    render: (st, t) => {
      const post = q(st, '.ob-post')
      const ev = q(st, '.ob-ev')
      const a = pr(t, 0, 420)
      const b = pr(t, 760, 620, E.inOut)
      if (post) {
        post.style.opacity = String(a * (1 - 0.3 * b))
        post.style.transform = `translateY(${((1 - a) * 16 + (1 - b) * 30).toFixed(2)}px) scale(${(1 - 0.08 * b).toFixed(4)})`
        post.style.filter = `saturate(${(1 - 0.6 * b).toFixed(3)})`
      }
      if (ev) {
        const c = pr(t, 800, 640)
        ev.style.opacity = String(clamp(c * 1.4, 0, 1))
        ev.style.transform = `translateY(${((1 - c) * 72).toFixed(2)}px)`
      }
    },
  },
  // Одна карточка проходит путь отметки: «Я внёс», сверка, зачёт.
  dues: {
    dur: 3000,
    render: (st, t) => {
      rise(q(st, '.ob-pay'), t, 0, 460, 18)
      const w1 = pr(t, 1180, 220)
      const w2 = pr(t, 2400, 220)
      const w = [1 - w1, w1 * (1 - w2), w2]
      for (const el of qa(st, '[data-st]')) {
        const v = w[Number(el.dataset.st)] ?? 0
        el.style.opacity = String(v)
      }
      const btn = q(st, '.ob-pay-btn')
      if (btn) {
        const k = pulse(t, 960, 240)
        btn.style.transform = `scale(${(1 - 0.04 * k).toFixed(4)})`
        btn.style.filter = `brightness(${(1 - 0.14 * k).toFixed(3)})`
      }
    },
  },
  // Команда уходит, бот печатает, приходит ответ.
  bot: {
    dur: 2200,
    render: (st, t) => {
      const out = q(st, '.ob-chat .out')
      const ty = q(st, '.ob-typing')
      const msg = q(st, '.ob-reply')
      if (out) {
        const a = pr(t, 0, 380)
        out.style.opacity = String(a)
        out.style.transform = `translateX(${((1 - a) * 30).toFixed(2)}px)`
      }
      if (ty) {
        ty.style.opacity = String(pr(t, 620, 180) * (1 - pr(t, 1460, 150)))
        qa(ty, 'i').forEach((d, k) => {
          const ph = Number.isFinite(t) ? Math.max(0, Math.sin((t / 1000) * Math.PI * 3.2 - k * 0.7)) : 0
          d.style.transform = `translateY(${(-3.5 * ph).toFixed(2)}px)`
        })
      }
      if (msg) {
        const m = pr(t, 1460, 440)
        msg.style.opacity = String(m)
        msg.style.transform = `translateY(${((1 - m) * 12).toFixed(2)}px) scale(${(0.97 + 0.03 * m).toFixed(4)})`
      }
    },
  },
}
