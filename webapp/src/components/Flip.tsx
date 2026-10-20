// Счётчик знакомства для рабочих экранов: когда число меняется в ответ на свой тап,
// старое уходит вверх, новое приходит снизу с перелётом. Смену от чужих действий
// показывает без движения (см. ownTapRecent).

import { useLayoutEffect, useRef, useState } from 'react'
import { animate, E, ownTapRecent, pr } from '../motion'

/** `delay` сдвигает перещёлкивание: на одном тапе такты идут волной, а не все разом. */
export function Flip({ value, delay = 0 }: { value: number | string; delay?: number }) {
  const text = String(value)
  const [from, setFrom] = useState<string | null>(null)
  const last = useRef(text)
  const aRef = useRef<HTMLSpanElement>(null)
  const bRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (last.current === text) return
    const prev = last.current
    last.current = text
    if (ownTapRecent()) setFrom(prev)
  }, [text])

  useLayoutEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (from === null || !a || !b) return
    return animate(
      delay + 420,
      (t) => {
        const p = pr(t, delay, 420, E.back)
        a.style.transform = `translateY(${(-p * 100).toFixed(2)}%)`
        a.style.opacity = String(Math.max(0, 1 - p * 1.2))
        b.style.transform = `translateY(${((1 - p) * 100).toFixed(2)}%)`
      },
      () => setFrom(null),
    )
  }, [from])

  if (from === null) return <>{text}</>
  // Невидимая копия нового числа держит ширину и базовую линию строки, а сами
  // числа едут поверх неё.
  return (
    <span className="flip">
      <span className="flip-sp">{text}</span>
      <span className="flip-a" ref={aRef} aria-hidden="true">
        {from}
      </span>
      <span className="flip-b" ref={bRef} aria-hidden="true">
        {text}
      </span>
    </span>
  )
}

/**
 * Подпись, которая после своего тапа перетекает: старая уходит вверх и гаснет, новая
 * приходит снизу, как подпись кнопки в знакомстве. Чужую смену показывает сразу.
 */
export function XText({ text, delay = 0 }: { text: string; delay?: number }) {
  const [from, setFrom] = useState<string | null>(null)
  const last = useRef(text)
  const aRef = useRef<HTMLSpanElement>(null)
  const bRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (last.current === text) return
    const prev = last.current
    last.current = text
    if (ownTapRecent()) setFrom(prev)
  }, [text])

  useLayoutEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (from === null || !a || !b) return
    return animate(
      delay + 260,
      (t) => {
        const p = pr(t, delay, 260)
        a.style.opacity = String(Math.max(0, 1 - p * 1.6))
        a.style.transform = `translateY(${(-7 * p).toFixed(2)}px)`
        b.style.opacity = String(Math.min(1, Math.max(0, p * 1.6 - 0.6)))
        b.style.transform = `translateY(${(7 * (1 - p)).toFixed(2)}px)`
      },
      () => setFrom(null),
    )
  }, [from])

  if (from === null) return <>{text}</>
  return (
    <span className="xtext">
      <span ref={bRef}>{text}</span>
      <span ref={aRef} aria-hidden="true">
        {from}
      </span>
    </span>
  )
}
