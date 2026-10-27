// Назад свайпом, как в чатах Telegram: экран едет за пальцем вправо, под ним проступает
// прежний в той прокрутке, где его оставили, а решает бросок, а не место, где отпустили.
// Механика общая с жестом «вниз» (usePullDismiss): прежний экран рисует App по setUnder,
// а убирает верхний без въезда popStill.
//
// Жест берётся с любого места экрана, кроме тех, что ведут палец сами: строк со свайпом,
// колёс, сеток (data-scrub), полей ввода и всего, что прокручивается вбок. Листалка дней
// и карточек отдаёт его только со своей первой страницы. Ось решается по первым 8 px, как
// у листалок, поэтому прокрутка вниз жест не задевает.

import { useEffect, type RefObject } from 'react'
import { clamp, EDGE_ZONE, holdSelection, landing, project, spring, tracker, type SpringOpts } from '../motion'
import { hasOverlay } from '../overlays'
import { getState, popStill, setUnder, underMode } from '../store'
import { haptic } from '../telegram'

/** Насколько прежний экран отстаёт от верхнего и как он притенён в начале жеста. */
const PARALLAX = 0.3
const DIM = 0.2
const BACK_SPRING: SpringOpts = { response: 0.32, damping: 1 }
const AWAY_SPRING: SpringOpts = { response: 0.3, damping: 1 }
/** Тишина в событиях колеса, после которой жест трекпада считается законченным. */
const WHEEL_IDLE_MS = 110

const FREE = 'input, textarea, select, [contenteditable], .swipe-row, [data-scrub], .tp-wheels, [data-noback]'

/** Листалки сообщают, стоят ли на первой странице: только оттуда свайп вправо уводит назад. */
const pagerStarts = new WeakMap<Element, () => boolean>()

export function registerPagerStart(root: Element, atStart: () => boolean): () => void {
  pagerStarts.set(root, atStart)
  return () => {
    pagerStarts.delete(root)
  }
}

let active = false

/** Идёт свайп назад: листалки в это время не берут ни палец, ни колесо. */
export const swipingBack = (): boolean => active

/** Есть куда уйти, и поверх экрана ничего не открыто. */
export const canSwipeBack = (): boolean => getState().stack.length > 1 && !hasOverlay() && underMode() === null

/** Касание принадлежит чужому жесту: своему ведению, прокрутке вбок или листалке не на первой странице. */
const refused = (target: EventTarget | null, screen: HTMLElement): boolean => {
  const el = target instanceof Element ? target : null
  if (!el || el.closest(FREE)) return true
  for (let n: Element | null = el; n && n !== screen; n = n.parentElement) {
    const atStart = pagerStarts.get(n)
    if (atStart && !atStart()) return true
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

export function useSwipeBack(screenRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const screen = screenRef.current
    if (!screen || !enabled) return
    const vt = tracker()
    let g: { x0: number; y0: number; mouse: number | null; claimed: boolean } | null = null
    let motion: { stop: () => void } | null = null
    let x = 0
    let width = 393
    let swiped = false
    let leaving = false
    let armed = false
    let releasedAt = 0
    let unselect: (() => void) | null = null

    const zoom = (): HTMLElement | null => document.querySelector<HTMLElement>('.screen-under-zoom')
    const dim = (): HTMLElement | null => document.querySelector<HTMLElement>('.screen-under-dim')
    // Нижняя панель живёт вне .screen (порталом) и едет за ним сама.
    const bars = (): NodeListOf<HTMLElement> => document.querySelectorAll<HTMLElement>('.bar-portal .bottom-bar')

    const paint = (to: number): void => {
      x = to
      const k = clamp(to / width, 0, 1)
      const shift = `translate3d(${to.toFixed(2)}px, 0, 0)`
      screen.style.transform = shift
      bars().forEach((b) => (b.style.transform = shift))
      const z = zoom()
      if (z) z.style.transform = `translate3d(${(-PARALLAX * width * (1 - k)).toFixed(2)}px, 0, 0)`
      const m = dim()
      if (m) m.style.opacity = (DIM * (1 - k)).toFixed(3)
    }

    const begin = (): void => {
      if (swiped) return
      swiped = true
      active = true
      armed = false
      width = screen.getBoundingClientRect().width || 393
      // Въезд экрана ещё мог идти: CSS-анимация перебила бы сдвиг пальцем.
      screen.classList.remove('in-forward', 'in-back', 'in-fade')
      screen.classList.add('swiped')
      setUnder('swipe')
    }

    const finish = (): void => {
      swiped = false
      active = false
      screen.classList.remove('swiped')
      screen.style.transform = ''
      bars().forEach((b) => (b.style.transform = ''))
      const z = zoom()
      if (z) z.style.transform = ''
      const m = dim()
      if (m) m.style.opacity = ''
      setUnder(null)
    }

    // Прежний экран под верхним уже стоит целиком, подменять его незачем.
    const away = (v: number): void => {
      leaving = true
      motion = spring(x, width + 24, Math.max(v, 900), AWAY_SPRING, paint, () => {
        motion = null
        active = false
        popStill()
      })
    }

    const release = (v: number): void => {
      releasedAt = performance.now()
      unselect?.()
      unselect = null
      if (x > 12 && v > -150 && x + project(v, 0.99) > width * 0.5) {
        away(v)
        return
      }
      motion = spring(x, 0, landing(x, v, BACK_SPRING), BACK_SPRING, paint, () => {
        motion = null
        finish()
      })
    }

    // Щелчок на пороге «уйдёт» и обратно: палец чувствует, где решается судьба экрана.
    const follow = (to: number): void => {
      const over = to > width * 0.5
      if (over !== armed) {
        armed = over
        haptic.tick()
      }
      paint(to)
    }

    const start = (cx: number, cy: number, t: number, target: EventTarget | null, mouse: number | null): void => {
      if (leaving) {
        g = null
        return
      }
      // Палец поймал экран на обратном пути: тянем дальше с того же места.
      if (motion && swiped) {
        motion.stop()
        motion = null
        g = { x0: cx - x, y0: cy, mouse, claimed: true }
        if (mouse !== null) unselect = holdSelection()
        vt.start(cx, t)
        return
      }
      if (cx < EDGE_ZONE || !canSwipeBack() || refused(target, screen)) {
        g = null
        return
      }
      g = { x0: cx, y0: cy, mouse, claimed: false }
      vt.start(cx, t)
    }

    const move = (cx: number, cy: number, t: number): boolean => {
      if (!g) return false
      if (!g.claimed) {
        const dx = cx - g.x0
        const dy = cy - g.y0
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return false
        if (dx <= Math.abs(dy) || underMode() !== null) {
          g = null
          return false
        }
        // Экран отрывается там, где решилась ось, а не прыгает на эти 8 px.
        g.claimed = true
        g.x0 = cx
        if (g.mouse !== null) unselect = holdSelection()
        begin()
      }
      vt.move(cx, t)
      follow(Math.max(0, cx - g.x0))
      return true
    }

    const end = (t: number): void => {
      const claimed = g?.claimed
      g = null
      if (claimed) release(vt.release(t))
    }

    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (e.touches.length !== 1 || !t) {
        g = null
        return
      }
      start(t.clientX, t.clientY, e.timeStamp, e.target, null)
    }
    const onTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!g || g.mouse !== null || !t) return
      if (move(t.clientX, t.clientY, e.timeStamp) && e.cancelable) e.preventDefault()
    }
    const onTouchEnd = (e: TouchEvent): void => {
      if (g && g.mouse === null) end(e.timeStamp)
    }
    // Мышь в Telegram Desktop: зажатая кнопка тянет экран так же, как палец.
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      start(e.clientX, e.clientY, e.timeStamp, e.target, e.pointerId)
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || g.mouse !== e.pointerId) return
      if (move(e.clientX, e.clientY, e.timeStamp) && g?.claimed) {
        try {
          screen.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
    }
    const onUp = (e: PointerEvent): void => {
      if (g && g.mouse === e.pointerId) end(e.timeStamp)
    }
    // Отпущенный после жеста палец не должен нажать кнопку, над которой оказался.
    const onClick = (e: MouseEvent): void => {
      if (performance.now() - releasedAt < 300) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    // Трекпад: два пальца вправо приходят колесом с отрицательным deltaX, pointer-событий у
    // него нет. Экран едет за пальцами и уходит сам, когда намерение ясно (треть ширины);
    // не дотянули - после паузы в событиях возвращается. Остаток инерции macOS до паузы
    // глотаем: конец жеста у колеса только тишина.
    let wheel: { dist: number; done: boolean } | null = null
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wt = tracker()
    const onWheel = (e: WheelEvent): void => {
      if (e.defaultPrevented || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      if (!wheel) {
        if (e.deltaX >= 0 || leaving || motion || !canSwipeBack() || refused(e.target, screen)) return
        wheel = { dist: 0, done: false }
        begin()
        wt.start(0, e.timeStamp)
      }
      e.preventDefault()
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(() => {
        const w = wheel
        wheel = null
        if (w && !w.done) release(0)
      }, WHEEL_IDLE_MS)
      if (wheel.done) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1
      wheel.dist = Math.max(0, wheel.dist - e.deltaX * unit)
      wt.move(wheel.dist, e.timeStamp)
      follow(wheel.dist)
      if (wheel.dist > width / 3) {
        wheel.done = true
        releasedAt = performance.now()
        away(wt.release(e.timeStamp))
      }
    }

    screen.addEventListener('touchstart', onTouchStart, { passive: true })
    screen.addEventListener('touchmove', onTouchMove, { passive: false })
    screen.addEventListener('touchend', onTouchEnd)
    screen.addEventListener('touchcancel', onTouchEnd)
    screen.addEventListener('pointerdown', onDown)
    screen.addEventListener('pointermove', onMove)
    screen.addEventListener('pointerup', onUp)
    screen.addEventListener('pointercancel', onUp)
    screen.addEventListener('click', onClick, true)
    // Нативно и не пассивно: React вешает wheel пассивно, а без preventDefault macOS
    // уводит горизонтальный жест в навигацию браузера.
    screen.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      motion?.stop()
      unselect?.()
      clearTimeout(wheelIdle)
      // Экран ушёл посреди жеста (навигация кнопкой): флаг не должен остаться поднятым.
      if (swiped) {
        active = false
        setUnder(null)
      }
      screen.removeEventListener('touchstart', onTouchStart)
      screen.removeEventListener('touchmove', onTouchMove)
      screen.removeEventListener('touchend', onTouchEnd)
      screen.removeEventListener('touchcancel', onTouchEnd)
      screen.removeEventListener('pointerdown', onDown)
      screen.removeEventListener('pointermove', onMove)
      screen.removeEventListener('pointerup', onUp)
      screen.removeEventListener('pointercancel', onUp)
      screen.removeEventListener('click', onClick, true)
      screen.removeEventListener('wheel', onWheel)
    }
  }, [screenRef, enabled])
}
