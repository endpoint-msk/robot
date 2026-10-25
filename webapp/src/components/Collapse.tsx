// Блок, который после своего тапа вырастает из нуля по высоте и сворачивается обратно,
// как строка с ником на доске в знакомстве. Чужую смену показывает сразу: появился или
// пропал без движения.

import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, clamp, E, ownTapRecent, pr } from '../motion'

/**
 * `appear`: блок, смонтированный уже открытым, тоже вырастает из нуля, если это ответ на свой тап.
 * `as="span"` — внутри строки-кнопки, где блочный div недопустим.
 */
export function Collapse({
  open,
  delay = 0,
  appear = false,
  as = 'div',
  children,
}: {
  open: boolean
  delay?: number
  appear?: boolean
  as?: 'div' | 'span'
  children: ReactNode
}) {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  // Пока блок сворачивается, в нём остаётся то, что было до тапа: иначе он схлопнул
  // бы уже пустую карточку.
  const kept = useRef<ReactNode>(children)
  if (open) kept.current = children
  const ref = useRef<HTMLElement>(null)
  const was = useRef(appear ? false : open)

  useLayoutEffect(() => {
    const el = ref.current
    const prev = was.current
    was.current = open
    if (prev === open || !el) return
    if (!ownTapRecent()) {
      el.style.height = ''
      el.style.opacity = ''
      if (!open) setShown(false)
      return
    }
    const h = el.scrollHeight
    return animate(
      delay + 420,
      (t) => {
        const p = pr(t, delay, 420, E.inOut)
        const k = open ? p : 1 - p
        el.style.height = `${(k * h).toFixed(2)}px`
        el.style.opacity = String(clamp(k * 1.4, 0, 1))
      },
      () => {
        // Свёрнутый блок держит нулевую высоту до размонтирования: сброс показал бы его
        // целиком на кадр.
        if (!open) {
          setShown(false)
          return
        }
        el.style.height = ''
        el.style.opacity = ''
      },
    )
  }, [open, shown])

  if (!shown) return null
  return createElement(as, { className: 'collapse', ref }, open ? children : kept.current)
}
