// Общее для экранов журнала присутствия: форматирование длительностей и шкала
// тепловой карты. Цвета считаются в JS, потому что в градиент и в inline-стиль
// ячейки CSS-переменную темы подставить нельзя.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { plural } from './dates'

/** Часы одним числом: «148», «7,5». Для крупных цифр в карточках. */
export const hoursNum = (minutes: number): string => {
  const hours = minutes / 60
  if (hours >= 10) return String(Math.round(hours))
  return (Math.round(hours * 10) / 10).toString().replace('.', ',')
}

/**
 * Слово к крупной цифре из `hoursNum`. Дробное число требует родительного падежа
 * единственного числа («7,5 часа»), целое склоняется обычным правилом. Считаем по
 * той же строке, что и показываем: иначе округление 6,98 → «7» разошлось бы со
 * словом, посчитанным по исходным минутам.
 */
export const hoursNumWord = (minutes: number): string => {
  const shown = Number(hoursNum(minutes).replace(',', '.'))
  return Number.isInteger(shown) ? plural(shown, 'час', 'часа', 'часов') : 'часа'
}

export const hoursWord = (minutes: number): string => {
  const n = Math.round(minutes / 60)
  return `${n}\u00a0${plural(n, 'час', 'часа', 'часов')}`
}

/** «3 ч 20 мин», «45 мин» — длительность визита в строке списка. */
export const fmtDuration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  if (h === 0) return `${m}\u00a0мин`
  const rest = m % 60
  return rest > 0 ? `${h}\u00a0ч\u00a0${rest}\u00a0мин` : `${h}\u00a0ч`
}

/** Минуты от полуночи → 'HH:MM'. */
export const fmtMinutes = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Конец дня журнала. Визит, дошедший до полуночи, сервер заканчивает в «00:00», и
 * «с 19:20 до 00:00» читалось как время до начала суток, а не до их конца.
 */
export const dayEnd = (hhmm: string): string => (hhmm === '00:00' ? '24:00' : hhmm)

export const HEAT_LEVELS = 5

/**
 * Ступень шкалы: 0 — никого не было, 1..5 — сколько.
 *
 * Ноль отдельным уровнем, а не самой светлой ступенью: раньше «пусто» и «людей
 * было мало» отличались на 1.08:1 в светлой теме и 1.02:1 в тёмной, то есть
 * ровно то различие, ради которого карта нарисована, она и теряла.
 */
export const heatLevel = (v: number, max: number): number => {
  if (max <= 0 || v <= 0) return 0
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((v / max) * HEAT_LEVELS)))
}

/**
 * Класс и стиль ячейки карты. Три состояния читаются структурой, а не оттенком:
 * штриховка — данных нет, пустая клетка с контуром — никого, заливка — были.
 */
export const heatCell = (
  level: number,
  noData = false,
): { className: string; style?: { background: string } } => {
  if (noData) return { className: 'heat-cell nodata' }
  if (level <= 0) return { className: 'heat-cell zero' }
  return { className: 'heat-cell', style: { background: `var(--heat-${level})` } }
}

/** Человекочасы ячейки словами: «1,3 чел.». Без единицы цифра в подсказке нечитаема. */
export const heatValue = (v: number): string => `${(Math.round(v * 10) / 10).toString().replace('.', ',')}\u00a0чел.`

/** Двухчасовой интервал ячейки: «14–16». */
export const heatSlot = (bucket: number): string =>
  `${String(bucket * 2).padStart(2, '0')}–${String((bucket * 2 + 2) % 24).padStart(2, '0')}`

/**
 * Человек журнала в виде, который понимает `Avatar`: имён Telegram в сессиях нет,
 * там только ник — он же идёт и в букву заглушки, пока не приедет фото.
 */
export const statsAvatarUser = (p: { userId: number; username: string | null }) => ({
  userId: p.userId,
  username: p.username,
  name: p.username ?? 'Без ника',
})

// --- Ведение пальцем по графикам ---------------------------------------------

/** Сдвиг, по которому решается, куда пошёл палец: тот же порог, что у листалки дня. */
const SCRUB_SLOP = 8
/** Удержание на месте, после которого ведение начинается без сдвига. */
const SCRUB_HOLD_MS = 250
/** Сколько после ведения гасим клик: палец отпустили над кнопкой, но нажимать её не хотели. */
const SCRUB_CLICK_MS = 300

export type ScrubHandlers = {
  /** Можно ли брать жест сейчас: пока график перестраивается, ведения нет. */
  can?: () => boolean
  /**
   * Ведение только удержанием: сдвиг до него отдаёт палец листалке и свайпу назад. Для
   * сетки на листаемой карточке, где вбок листают людей. Область тогда `data-scrub="hold"`.
   */
  hold?: boolean
  /** Координаты экранные (clientX/clientY). */
  start: (x: number, y: number) => void
  move: (x: number, y: number) => void
  end: () => void
}

let scrubbing = false

/** Палец ведёт по сетке: листалки и свайп назад в это время палец не берут. */
export const scrubActive = (): boolean => scrubbing

/**
 * Ведение пальцем по карте и графикам, как в «Здоровье» на iPhone. Направление решается
 * по первым 8 px, как у листалки дня: палец пошёл вбок, значит ведём, и дальше он ходит
 * в любую сторону; пошёл вниз, это прокрутка экрана. Удержание на месте тоже начинает
 * ведение. Тап остаётся кликом по кнопке под пальцем, а клик, прилетевший после
 * ведения, гасится: удержание на клетке иначе тут же сняло бы с неё выбор.
 *
 * Зажатая мышь ведёт в любую сторону сразу: прокручивать ею нечего. Область получает
 * `data-scrub`, по нему же app.css отдаёт ей горизонталь (`touch-action: pan-y`).
 */
export function useScrub(ref: RefObject<HTMLElement | null>, handlers: ScrubHandlers): void {
  const live = useRef(handlers)
  useLayoutEffect(() => {
    live.current = handlers
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let g: { id: number; x0: number; y0: number; x: number; y: number; mouse: boolean; on: boolean; hold: number } | null =
      null
    // Ось пальца по touchmove: при `touch-action: pan-y` браузер сам ведёт вертикаль, и
    // без preventDefault лупа ехала бы, а экран под ней прокручивался.
    let touch: { x: number; y: number; axis: 0 | 1 | 2 } | null = null
    let quietUntil = 0

    const begin = (): void => {
      if (!g || g.on) return
      g.on = true
      scrubbing = true
      window.clearTimeout(g.hold)
      try {
        el.setPointerCapture(g.id)
      } catch {
        /* указатель уже отпущен */
      }
      live.current.start(g.x, g.y)
    }
    const finish = (): void => {
      if (!g) return
      window.clearTimeout(g.hold)
      const on = g.on
      g = null
      if (!on) return
      scrubbing = false
      quietUntil = performance.now() + SCRUB_CLICK_MS
      live.current.end()
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || g || live.current.can?.() === false) return
      const mouse = e.pointerType === 'mouse'
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mouse, on: false, hold: 0 }
      g.hold = window.setTimeout(begin, SCRUB_HOLD_MS)
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || e.pointerId !== g.id) return
      g.x = e.clientX
      g.y = e.clientY
      if (g.on) {
        live.current.move(e.clientX, e.clientY)
        return
      }
      const dx = Math.abs(e.clientX - g.x0)
      const dy = Math.abs(e.clientY - g.y0)
      if (dx < SCRUB_SLOP && dy < SCRUB_SLOP) return
      const down = touch && touch.axis !== 0 ? touch.axis === 2 : dy >= dx
      if ((!g.mouse && down) || live.current.hold) {
        window.clearTimeout(g.hold)
        g = null
        return
      }
      begin()
    }
    const onUp = (e: PointerEvent): void => {
      if (g && e.pointerId === g.id) finish()
    }
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, axis: 0 } : null
    }
    const onTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (touch && t && touch.axis === 0) {
        const dx = Math.abs(t.clientX - touch.x)
        const dy = Math.abs(t.clientY - touch.y)
        if (dx >= 6 || dy >= 6) touch.axis = dx > dy ? 1 : 2
      }
      // Пока ведём, экран стоит, куда бы ни шёл палец: после удержания лупа ходит и по
      // вертикали. До решения гасим только сдвиг вбок, вертикаль остаётся прокрутке.
      if ((g?.on || (touch?.axis === 1 && !live.current.hold)) && e.cancelable) e.preventDefault()
    }
    const onClick = (e: MouseEvent): void => {
      if (performance.now() >= quietUntil) return
      e.preventDefault()
      e.stopPropagation()
    }
    // Долгое нажатие на Android открывает контекстное меню, и оно обрывает жест.
    const onMenu = (e: Event): void => {
      if (g) e.preventDefault()
    }
    // Аватарка в строке дорожек утаскивается мышью нативным drag-and-drop, а тот шлёт
    // pointercancel посреди ведения.
    const onDrag = (e: Event): void => e.preventDefault()

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('click', onClick, true)
    el.addEventListener('contextmenu', onMenu)
    el.addEventListener('dragstart', onDrag)
    return () => {
      if (g) window.clearTimeout(g.hold)
      if (g?.on) scrubbing = false
      g = null
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('contextmenu', onMenu)
      el.removeEventListener('dragstart', onDrag)
    }
  }, [ref])
}
