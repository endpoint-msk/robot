// Жест «вниз» на дне, ивенте и визите: экран отрывается карточкой с первого пикселя, и
// под ней проступает прежний экран. Дотянули или бросили вниз, и карточка уезжает вниз,
// продолжая движение пальца; не дотянули — пружина без перелёта возвращает её на место.
//
// Жест начинается только у самого верха прокрутки и только вниз: ось решается по первым
// 8 px, как у листалки дня, поэтому вбок по-прежнему листаются дни, а вверх прокрутка.

import { useEffect, type RefObject } from 'react'
import { clamp, EDGE_ZONE, holdSelection, landing, mix, project, spring, tracker, type SpringOpts } from '../motion'
import { hasOverlay } from '../overlays'
import { popStill, setUnder } from '../store'
import { haptic } from '../telegram'

/** Карточка, дотянутая или брошенная дальше этого, уходит. */
const CLOSE = 120
/** Ход карточки, на котором прежний экран проступил целиком. */
const FAR = 260
/** Насколько карточка уменьшается, пока её тянут. */
const SHRINK = 0.12
/** Скругление оторванной карточки на экране, px. */
const RADIUS = 28

const BACK_SPRING: SpringOpts = { response: 0.32, damping: 1 }
const AWAY_SPRING: SpringOpts = { response: 0.3, damping: 1 }

// Поля ввода и области, которые сами ведут пальцем (сетки статистики, колесо времени).
const FREE = 'input, textarea, select, [data-scrub], .tp-wheels'

/**
 * Кадр карточки. x, y — сдвиг левого верхнего угла, s — масштаб, r — скругление на
 * экране, under — насколько проступил прежний экран.
 */
type Frame = { x: number; y: number; s: number; r: number; under: number }

export function usePullDismiss(rootRef: RefObject<HTMLElement | null>, opts: { enabled?: boolean } = {}): void {
  const enabled = opts.enabled !== false

  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) return
    const screen = root.closest<HTMLElement>('.screen') ?? root
    const vt = tracker()
    let g: { y0: number; x0: number; mouse: number | null; axis: 0 | 2 } | null = null
    let motion: { stop: () => void } | null = null
    let leaving = false
    let d = 0
    let armed = false
    let releasedAt = 0
    let pulled = false
    let width = 393
    let unselect: (() => void) | null = null

    const zoom = (): HTMLElement | null => document.querySelector<HTMLElement>('.screen-under-zoom')
    const dim = (): HTMLElement | null => document.querySelector<HTMLElement>('.screen-under-dim')
    const bar = (): HTMLElement | null => document.querySelector<HTMLElement>('.bar-portal .bottom-bar')

    // Скругление — в координатах самой карточки, поэтому делится на масштаб.
    const put = (f: Frame): void => {
      screen.style.transform = `translate3d(${f.x.toFixed(2)}px, ${f.y.toFixed(2)}px, 0) scale(${f.s.toFixed(4)})`
      screen.style.clipPath = `inset(0 round ${(f.r / f.s).toFixed(2)}px)`
      const z = zoom()
      if (z) z.style.transform = `scale(${mix(0.94, 1, f.under).toFixed(4)})`
      const m = dim()
      if (m) m.style.opacity = (0.32 * (1 - f.under)).toFixed(3)
    }

    // Под пальцем карточка едет за ним один к одному, уменьшается к середине и скругляется.
    const dragFrame = (dist: number): Frame => {
      const k = clamp(dist / FAR, 0, 1)
      const s = 1 - SHRINK * k
      return { x: (width * (1 - s)) / 2, y: dist, s, r: RADIUS * clamp(dist / 60, 0, 1), under: k }
    }

    const paintDrag = (dist: number): void => {
      d = dist
      put(dragFrame(Math.max(0, dist)))
      const b = bar()
      if (b) b.style.opacity = (1 - clamp(dist / 80, 0, 1)).toFixed(3)
    }

    const begin = (): void => {
      if (pulled) return
      pulled = true
      armed = false
      width = screen.getBoundingClientRect().width
      screen.classList.add('pulled')
      setUnder('pull')
    }

    const finish = (): void => {
      pulled = false
      screen.classList.remove('pulled')
      for (const k of ['transform', 'clipPath'] as const) screen.style[k] = ''
      const z = zoom()
      if (z) z.style.transform = ''
      const m = dim()
      if (m) m.style.opacity = ''
      const b = bar()
      if (b) b.style.opacity = ''
      setUnder(null)
    }

    // Прежний экран под карточкой уже стоит, и подменять его незачем.
    const away = (v: number): void => {
      motion = spring(d, window.innerHeight + 40, Math.max(v, 900), AWAY_SPRING, paintDrag, () => {
        motion = null
        popStill()
      })
    }

    const release = (v: number): void => {
      releasedAt = performance.now()
      unselect?.()
      unselect = null
      if (d > 12 && v > -150 && d + project(v, 0.99) > CLOSE) {
        leaving = true
        away(v)
        return
      }
      motion = spring(d, 0, landing(d, v, BACK_SPRING), BACK_SPRING, paintDrag, () => {
        motion = null
        finish()
      })
    }

    const start = (x: number, y: number, t: number, target: EventTarget | null, mouse: number | null): void => {
      if (leaving) {
        g = null
        return
      }
      // Палец поймал карточку на обратном пути: тянем дальше с того же места.
      if (motion && pulled) {
        motion.stop()
        motion = null
        g = { x0: x, y0: y - d, mouse, axis: 2 }
        if (mouse !== null) unselect = holdSelection()
        vt.start(y, t)
        return
      }
      if (window.scrollY > 0 || hasOverlay() || x < EDGE_ZONE || (target as Element | null)?.closest(FREE)) {
        g = null
        return
      }
      g = { x0: x, y0: y, mouse, axis: 0 }
      vt.start(y, t)
    }

    const move = (x: number, y: number, t: number): boolean => {
      if (!g) return false
      if (g.axis === 0) {
        const dx = x - g.x0
        const dy = y - g.y0
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return false
        if (dy <= Math.abs(dx) || window.scrollY > 0) {
          g = null
          return false
        }
        // Карточка отрывается там, где решилась ось, а не прыгает на эти 8 px.
        g.axis = 2
        g.y0 = y
        if (g.mouse !== null) unselect = holdSelection()
        begin()
      }
      vt.move(y, t)
      const dist = Math.max(0, y - g.y0)
      // Щелчок на пороге «уйдёт» и обратно: палец чувствует, где решается судьба экрана.
      const over = dist > CLOSE
      if (over !== armed) {
        armed = over
        haptic.tick()
      }
      paintDrag(dist)
      return true
    }

    const end = (t: number): void => {
      const claimed = g?.axis === 2
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
    // Мышь в Telegram Desktop: зажатая кнопка тянет так же, как палец.
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      start(e.clientX, e.clientY, e.timeStamp, e.target, e.pointerId)
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || g.mouse !== e.pointerId) return
      if (move(e.clientX, e.clientY, e.timeStamp) && g?.axis === 2) {
        try {
          root.setPointerCapture(e.pointerId)
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

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd)
    root.addEventListener('touchcancel', onTouchEnd)
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('click', onClick, true)
    return () => {
      motion?.stop()
      unselect?.()
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchEnd)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('click', onClick, true)
    }
  }, [rootRef, enabled])
}
