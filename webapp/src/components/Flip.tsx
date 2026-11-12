// Счётчик знакомства для рабочих экранов: когда число меняется в ответ на свой тап,
// старое уходит вверх, новое приходит снизу. Смену от чужих действий показывает без
// движения (см. ownTapRecent).

import { useLayoutEffect, useRef, useState } from 'react'
import { animate, E, mix, ownTapRecent, play, pr } from '../motion'

/**
 * `delay` сдвигает перещёлкивание: на одном тапе такты идут волной, а не все разом.
 * `still` меняет число без движения, даже после своего тапа: например, пока его крутит
 * колесо под пальцем.
 */
export function Flip({ value, delay = 0, still = false }: { value: number | string; delay?: number; still?: boolean }) {
  const text = String(value)
  const [from, setFrom] = useState<string | null>(null)
  const last = useRef(text)
  const boxRef = useRef<HTMLSpanElement>(null)
  const aRef = useRef<HTMLSpanElement>(null)
  const bRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (last.current === text) return
    const prev = last.current
    last.current = text
    if (!still && ownTapRecent()) setFrom(prev)
  }, [text])

  useLayoutEffect(() => {
    const box = boxRef.current
    const a = aRef.current
    const b = bRef.current
    if (from === null || !box || !a || !b) return
    const p = (t: number): number => pr(t, delay, 340, E.crisp)
    // Ширина едет от прежнего числа к новому той же кривой, что цифры: единица и разница
    // справа приезжают вместе с ними, а не встают в первом кадре поверх уходящих цифр.
    // Отдельно от play: системе уходят только transform и opacity.
    const w0 = a.offsetWidth
    const w1 = b.offsetWidth
    const width = w0 === w1 ? null : animate(delay + 340, (t) => void (box.style.width = `${mix(w0, w1, p(t)).toFixed(2)}px`))
    const run = play(
      delay + 340,
      [
        [a, (t) => ({ transform: `translateY(${(-p(t) * 100).toFixed(2)}%)`, opacity: String(Math.max(0, 1 - p(t) * 1.2)) })],
        [b, (t) => ({ transform: `translateY(${((1 - p(t)) * 100).toFixed(2)}%)` })],
      ],
      () => setFrom(null),
    )
    return () => {
      run.stop()
      width?.()
    }
  }, [from])

  if (from === null) return <>{text}</>
  // Невидимая копия нового числа держит базовую линию строки, а сами числа едут поверх неё.
  return (
    <span className="flip" ref={boxRef}>
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
 * приходит снизу, как подпись кнопки в знакомстве. Чужую смену и смену со `still`
 * показывает сразу. `glide` - однострочная подпись, от ширины которой зависит сосед
 * (колонки пары чисел в статистике): ширина едет от прежней к новой, иначе на время
 * перехода она держалась бы по длинной из двух и сосед прыгал бы в конце. `layer` -
 * класс каждого слоя, когда слой сам режет строки (текст баннера в превью уведомлений):
 * общая обрезка на двух слоях сразу на время перехода снялась бы.
 */
export function XText({
  text,
  delay = 0,
  still = false,
  glide = false,
  layer,
}: {
  text: string
  delay?: number
  still?: boolean
  glide?: boolean
  layer?: string
}) {
  const [from, setFrom] = useState<string | null>(null)
  const last = useRef(text)
  const boxRef = useRef<HTMLSpanElement>(null)
  const aRef = useRef<HTMLSpanElement>(null)
  const bRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (last.current === text) return
    const prev = last.current
    last.current = text
    if (!still && ownTapRecent()) setFrom(prev)
  }, [text])

  useLayoutEffect(() => {
    const box = boxRef.current
    const a = aRef.current
    const b = bRef.current
    if (from === null || !box || !a || !b) return
    const w0 = glide ? a.offsetWidth : 0
    const w1 = glide ? b.offsetWidth : 0
    return animate(
      delay + 260,
      (t) => {
        const p = pr(t, delay, 260)
        a.style.opacity = String(Math.max(0, 1 - p * 1.6))
        a.style.transform = `translateY(${(-7 * p).toFixed(2)}px)`
        b.style.opacity = String(Math.min(1, Math.max(0, p * 1.6 - 0.6)))
        b.style.transform = `translateY(${(7 * (1 - p)).toFixed(2)}px)`
        if (w0 !== w1) box.style.width = `${mix(w0, w1, p).toFixed(2)}px`
      },
      () => setFrom(null),
    )
  }, [from])

  if (from === null) return layer ? <span className={layer}>{text}</span> : <>{text}</>
  return (
    <span className={'xtext' + (glide ? ' glide' : '')} ref={boxRef}>
      <span className={layer} ref={bRef}>
        {text}
      </span>
      <span className={layer} ref={aRef} aria-hidden="true">
        {from}
      </span>
    </span>
  )
}
