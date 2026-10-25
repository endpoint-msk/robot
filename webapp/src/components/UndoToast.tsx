// Плашка «Вернуть» с отсчётом, как у удаления чата в Telegram: кольцо с секундами, что
// сделано, и кнопка. Появляется в ответ на свой тап и уходит по концу отсчёта, новое
// действие её сменяет, а смахнуть вниз можно раньше. Лежит над нижней панелью экрана и
// над шторками: отсчёт идёт и тогда, когда поверх открыли лист.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { animate, clamp, E, mix, pr, reducedMotion, spring, tracker } from '../motion'
import { dismissUndo, takeBack, UNDO_MS, useUndoOffer, type UndoOffer } from '../undo'

const RING = 2 * Math.PI * 11.5
const IN_MS = 300
const OUT_MS = 250

export function UndoToast() {
  const offer = useUndoOffer()
  // Ушедшая плашка дорисовывает уход, поэтому показанная живёт отдельно от текущей.
  const [shown, setShown] = useState<UndoOffer | null>(offer)
  const leaving = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const numRef = useRef<HTMLSpanElement>(null)
  // Где плашка сейчас: уход и возврат после смахивания продолжают с этого места.
  const pos = useRef({ y: 14, o: 0, drag: false })

  if (offer && offer !== shown && !leaving.current) setShown(offer)

  const put = (y: number, o: number): void => {
    const el = boxRef.current
    pos.current.y = y
    pos.current.o = o
    if (!el) return
    el.style.transform = `translateY(${y.toFixed(2)}px)`
    el.style.opacity = o.toFixed(3)
  }

  // Снята (отсчёт, «Вернуть», смахнули): уходит вниз и гаснет с того места, где была.
  useLayoutEffect(() => {
    if (!shown || offer === shown) return
    leaving.current = true
    const { y, o } = pos.current
    return animate(
      OUT_MS,
      (t) => {
        const p = pr(t, 0, OUT_MS, E.out)
        put(y + 14 * p, o * (1 - p))
      },
      () => {
        leaving.current = false
        setShown(offer)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, shown])

  // Появление, отсчёт и место над нижней панелью: правками style, без состояния React.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!shown || !el) return
    pos.current = { y: 14, o: 0, drag: false }
    const t0 = performance.now()
    let raf = 0
    let last = -1
    const tick = (now: number): void => {
      const t = now - t0
      if (!pos.current.drag && !leaving.current) {
        const p = reducedMotion() ? 1 : pr(t, 0, IN_MS, E.crisp)
        if (p < 1 || pos.current.o < 1) put(mix(14, 0, p), p)
      }
      const bar = document.querySelector<HTMLElement>('.bar-portal .bottom-bar')
      const top = bar ? bar.getBoundingClientRect().top : window.innerHeight
      el.style.bottom = `${Math.max(12, window.innerHeight - top + 8).toFixed(1)}px`
      const left = clamp(UNDO_MS - t, 0, UNDO_MS)
      ringRef.current?.setAttribute('stroke-dashoffset', (RING * (1 - left / UNDO_MS)).toFixed(2))
      const sec = Math.max(1, Math.ceil(left / 1000))
      if (sec !== last && numRef.current) {
        last = sec
        numRef.current.textContent = String(sec)
      }
      if (left <= 0) {
        dismissUndo(shown.id)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  // Смахнуть вниз: плашка идёт за пальцем и мышью, брошенная или дотянутая уходит.
  useEffect(() => {
    const el = boxRef.current
    if (!el || !shown) return
    const vt = tracker()
    let g: { y0: number; id: number } | null = null
    let back: { stop: () => void } | null = null
    const onDown = (e: PointerEvent): void => {
      if ((e.target as Element).closest('button') || leaving.current) return
      back?.stop()
      g = { y0: e.clientY - pos.current.y, id: e.pointerId }
      pos.current.drag = true
      vt.start(e.clientY, e.timeStamp)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* указатель уже отпущен */
      }
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || e.pointerId !== g.id) return
      vt.move(e.clientY, e.timeStamp)
      const raw = e.clientY - g.y0
      // Вверх плашка почти не идёт: уходит она только вниз.
      const y = raw > 0 ? raw : -Math.sqrt(-raw)
      put(y, clamp(1 - y / 90, 0, 1))
    }
    const onUp = (e: PointerEvent): void => {
      if (!g || e.pointerId !== g.id) return
      g = null
      const v = vt.release(e.timeStamp)
      if (pos.current.y > 28 || v > 400) {
        dismissUndo(shown.id)
        return
      }
      back = spring(pos.current.y, 0, v, { response: 0.3, damping: 1 }, (y) => put(y, clamp(1 - y / 90, 0, 1)), () => {
        pos.current.drag = false
      })
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      back?.stop()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [shown])

  if (!shown) return null
  return createPortal(
    <div
      className="undo-toast"
      ref={boxRef}
      role="status"
      aria-live="polite"
      key={shown.id}
      style={{ opacity: 0, transform: 'translateY(14px)' }}
    >
      <span className="undo-ring" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11.5" fill="none" stroke="rgba(255, 255, 255, 0.22)" strokeWidth="2.4" />
          <circle
            ref={ringRef}
            cx="14"
            cy="14"
            r="11.5"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={RING.toFixed(2)}
            strokeDashoffset="0"
          />
        </svg>
        <span className="undo-ring-n" ref={numRef}>
          5
        </span>
      </span>
      <span className="undo-text">{shown.text}</span>
      <button type="button" className="undo-btn" onClick={() => void takeBack(shown.id)}>
        Вернуть
      </button>
    </div>,
    document.body,
  )
}
