// Смена слова буквами, как подпись «Захостить»: буквы прежнего тают волной, нового
// проступают на том же месте (см. .hb-ch в app.css).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ownTapRecent, reducedMotion } from '../motion'

/**
 * Слово подписи «Захостить», разложенное на буквы: при смене слова буквы старого тают
 * волной, а нового на том же месте проявляются следом (см. .hb-ch). Морф идёт по
 * буквам, а не словом целиком: слово, сменившееся разом, читалось как мигание.
 */
export function MorphWord({ text, on }: { text: string; on: boolean }) {
  return (
    <span className={'hb-l' + (on ? ' on' : '')}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="hb-ch" style={{ '--i': i } as CSSProperties}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  )
}

/** Сколько идёт морф слова из n букв: волна до последней буквы и её переход (.hb-ch). */
const morphMs = (n: number): number => 90 + 18 * Math.max(0, n - 1) + 280

type Run = { from: string; on: boolean }

/**
 * Значение, выбранное своим касанием (время из листа, пункт меню), садится на место
 * языком «Захостить»: прежнее тает буквами, новое проступает там же, а ширина едет к
 * новой, как ник в пилле при «Взять визит», и соседи с краями капсулы не прыгают. Чужая
 * смена и смена со `still` встают сразу. `align` - край, у которого стоят слова, пока
 * едет ширина: у значения меню это край со значком, у пилюли времени середина.
 */
export function MorphValue({ text, align = 'start', still = false }: { text: string; align?: 'start' | 'center' | 'end'; still?: boolean }) {
  const [run, setRun] = useState<Run | null>(null)
  const last = useRef(text)
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const prev = last.current
    if (prev === text) return
    last.current = text
    setRun(!still && ownTapRecent() && !reducedMotion() ? { from: prev, on: false } : null)
  }, [text])

  // Ширина по словам целиком, какими они стоят до и после морфа (по буквам кернинг
  // теряется): первый кадр по прежнему слову, дальше переход CSS к новому (.vm).
  useLayoutEffect(() => {
    const box = ref.current
    if (!run || !box) return
    // Значение сменилось в скрытом слое (лист переноса, пока сверху вопрос с колёсами): морф
    // там не виден, а ширина по нулевому замеру выросла бы из нуля. Встаёт сразу.
    if (box.getClientRects().length === 0) {
      setRun(null)
      return
    }
    const [a, b] = Array.from(box.querySelectorAll<HTMLElement>('.vm-w'))
    if (a && b) box.style.width = `${(run.on ? b : a).offsetWidth}px`
  }, [run])

  useEffect(() => {
    if (!run) return
    if (!run.on) {
      const raf = requestAnimationFrame(() => setRun((r) => (r ? { ...r, on: true } : r)))
      return () => cancelAnimationFrame(raf)
    }
    const timer = window.setTimeout(() => setRun(null), morphMs(Math.max(run.from.length, text.length)))
    return () => window.clearTimeout(timer)
  }, [run])

  if (!run) return <>{text}</>
  // Слои и замерные копии скрыты от скринридера: на время морфа он читает только новое.
  return (
    <>
      <span className={'vm ' + align} ref={ref} aria-hidden="true">
        <span className="vm-w">{run.from}</span>
        <span className="vm-w">{text}</span>
        <MorphWord text={run.from} on={!run.on} />
        <MorphWord text={text} on={run.on} />
      </span>
      <span className="vh">{text}</span>
    </>
  )
}
