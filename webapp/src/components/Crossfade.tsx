// Блок, содержимое которого после своего тапа перетекает: старое гаснет поверх, новое
// проявляется снизу, высота едет между ними. Строка дня под чипами формы не вставляется
// рывком, сдвигая всё ниже. Чужую смену показывает сразу.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, clamp, E, ownTapRecent, pr } from '../motion'

export function Crossfade({ id, children }: { id: string; children: ReactNode }) {
  const [st, setSt] = useState<{ id: string; prev: ReactNode; n: number }>({ id, prev: null, n: 0 })
  const shown = useRef<ReactNode>(children)
  if (st.id !== id) setSt({ id, prev: ownTapRecent() ? shown.current : null, n: st.n + 1 })
  shown.current = children
  const box = useRef<HTMLDivElement>(null)
  const oldRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = box.current
    const a = oldRef.current
    const b = newRef.current
    if (!el || !a || !b || st.prev === null) return
    const h0 = a.offsetHeight
    const h1 = b.offsetHeight
    return animate(
      420,
      (t) => {
        el.style.height = `${(h0 + (h1 - h0) * pr(t, 0, 420, E.inOut)).toFixed(2)}px`
        const x = pr(t, 0, 300)
        a.style.opacity = String(clamp(1 - x * 1.6, 0, 1))
        a.style.transform = `translateY(${(-6 * x).toFixed(2)}px)`
        b.style.opacity = String(clamp(x * 1.6 - 0.6, 0, 1))
        b.style.transform = `translateY(${(6 * (1 - x)).toFixed(2)}px)`
      },
      () => {
        el.style.height = ''
        b.style.opacity = ''
        b.style.transform = ''
        setSt((s) => ({ ...s, prev: null }))
      },
    )
  }, [st.n])

  return (
    <div className="xfade" ref={box}>
      {st.prev !== null ? (
        <div className="xfade-old" ref={oldRef} aria-hidden="true">
          {st.prev}
        </div>
      ) : null}
      <div ref={newRef}>{children}</div>
    </div>
  )
}
