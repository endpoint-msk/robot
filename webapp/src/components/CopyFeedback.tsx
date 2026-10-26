// Ответ на копирование там, где лежит палец: значок двух рамок дорисовывается в
// галочку, а над пальцем всплывает и гаснет «Скопировано».

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { icons } from '../icons'
import { animate, clamp, E, pr, reducedMotion } from '../motion'
import { haptic } from '../telegram'
import { accent } from '../theme'

/** Сколько значок держит галочку после копирования. */
const COPIED_MS = 1600
/** Сколько живёт плашка над пальцем. */
const SHOW_MS = 1300
/** Длина штриха галочки M2.5 7.5 l3 3 L11.5 4: по ней галочка дорисовывается. */
const CHECK_LEN = 13.09

/** Галочка уходит, рамки возвращаются: тот же значок, что был до копирования. */
function glyphBack(glyph: HTMLElement): () => void {
  const frames = glyph.querySelector<HTMLElement>('.cg-frames')
  const check = glyph.querySelector<SVGElement>('.cg-check')
  const clear = (): void => {
    if (frames) {
      frames.style.opacity = ''
      frames.style.transform = ''
    }
    if (check) check.style.opacity = ''
  }
  const stop = animate(
    260,
    (t) => {
      if (check) check.style.opacity = String(1 - pr(t, 0, 160))
      if (frames) {
        frames.style.opacity = String(pr(t, 60, 140))
        frames.style.transform = `scale(${(0.5 + 0.5 * pr(t, 60, 200, E.crisp)).toFixed(3)})`
      }
    },
    clear,
  )
  return () => {
    stop()
    clear()
  }
}

/**
 * Копирование с ответом. `glyph` встаёт в кнопку вместо значка копирования, `toast` -
 * куда угодно в разметку экрана. `copied` держится, пока стоит галочка. `copy`
 * возвращает false, если буфер обмена недоступен: что показать тогда, решает экран.
 */
export function useCopyFeedback(size: number): {
  copied: boolean
  copy: (text: string, e: MouseEvent) => Promise<boolean>
  glyph: ReactNode
  toast: ReactNode
} {
  const [copied, setCopied] = useState(false)
  const glyphRef = useRef<HTMLSpanElement>(null)
  const toastRef = useRef<HTMLDivElement>(null)
  const on = useRef(false)
  const timer = useRef(0)
  const show = useRef<(() => void) | null>(null)
  const back = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      show.current?.()
      back.current?.()
    },
    [],
  )

  const play = (e: MouseEvent): void => {
    const glyph = glyphRef.current
    const toast = toastRef.current
    show.current?.()
    back.current?.()
    show.current = null
    back.current = null
    // Повторный тап, пока стоит галочка, не рисует её заново, а только продлевает.
    const drawCheck = !on.current
    on.current = true
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      on.current = false
      setCopied(false)
      if (glyph) back.current = glyphBack(glyph)
    }, COPIED_MS)
    if (!toast) return

    const g = glyph?.getBoundingClientRect()
    const at = e.detail > 0 || !g ? { x: e.clientX, y: e.clientY } : { x: g.left + g.width / 2, y: g.top + g.height / 2 }
    toast.textContent = 'Скопировано'
    const tw = toast.offsetWidth
    const th = toast.offsetHeight
    const x = clamp(at.x - tw / 2, 10, window.innerWidth - 10 - tw)
    const y = Math.max(8, at.y - 24 - th)

    const frames = glyph?.querySelector<HTMLElement>('.cg-frames') ?? null
    const check = glyph?.querySelector<SVGElement>('.cg-check') ?? null
    const ink = check?.querySelector<SVGElement>('path') ?? null
    const reduced = reducedMotion()
    const clear = (): void => {
      toast.style.opacity = ''
      toast.style.transform = ''
      toast.textContent = ''
      if (frames) {
        frames.style.opacity = ''
        frames.style.transform = ''
      }
      if (check) check.style.opacity = ''
      if (ink) ink.style.strokeDashoffset = ''
    }

    // Без движения галочку ставит класс, а плашка просто стоит над пальцем и исчезает.
    if (reduced) {
      toast.style.transform = `translate(${x.toFixed(1)}px, ${(y - 12).toFixed(1)}px)`
      toast.style.opacity = '1'
      const hide = window.setTimeout(clear, SHOW_MS - 100)
      show.current = () => {
        window.clearTimeout(hide)
        clear()
      }
      return
    }

    const stop = animate(
      SHOW_MS,
      (t) => {
        if (drawCheck) {
          const o = pr(t, 40, 220, E.inOut)
          if (frames) {
            frames.style.opacity = String(1 - o)
            frames.style.transform = `scale(${(1 - 0.5 * o).toFixed(3)}) rotate(${(-30 * o).toFixed(1)}deg)`
          }
          if (check) check.style.opacity = t >= 130 ? '1' : '0'
          if (ink) ink.style.strokeDashoffset = (CHECK_LEN * (1 - pr(t, 130, 280, E.inOut))).toFixed(2)
        }
        const tin = pr(t, 80, 300, E.crisp)
        const tout = pr(t, 1000, 300)
        toast.style.opacity = (pr(t, 80, 140) * (1 - tout)).toFixed(3)
        toast.style.transform = `translate(${x.toFixed(1)}px, ${(y - 12 * tin - 6 * tout).toFixed(1)}px) scale(${(0.86 + 0.14 * tin).toFixed(3)})`
      },
      clear,
    )
    show.current = () => {
      stop()
      clear()
    }
  }

  const copy = async (text: string, e: MouseEvent): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    haptic.impact('light')
    play(e)
    return true
  }

  return {
    copied,
    copy,
    glyph: (
      <span className={'copy-glyph' + (copied ? ' on' : '')} ref={glyphRef} aria-hidden="true">
        <span className="cg-frames">{icons.copy(size, accent())}</span>
        <svg className="cg-check" width={size} height={size} viewBox="0 0 14 14">
          <path
            d="M2.5 7.5l3 3L11.5 4"
            fill="none"
            stroke="#34c759"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`}
          />
        </svg>
      </span>
    ),
    toast: createPortal(<div className="copy-toast" ref={toastRef} role="status" />, document.body),
  }
}
