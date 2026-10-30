// Лупа над пальцем, пока ведут по сетке клеток: карта «Когда здесь людно» в статистике и
// «Когда приходит» в профиле. Ведение то же, что у графиков (useScrub в stats.ts).

import { useEffect, useRef, useState, type RefObject } from 'react'
import { animate, clamp, pr } from '../motion'
import { useScrub } from '../stats'
import { haptic } from '../telegram'

/** Лупа стоит над пальцем: сам палец закрывает ту клетку, ради которой его поставили. */
const LOUPE_LIFT = 34
/** Сколько лупа гаснет после отпускания. */
const LOUPE_OUT_MS = 160

export type LoupeOpts<P> = {
  /** Клетки, по которым ведут: ближайшая по центрам. Чего нет в выборке, то не берётся. */
  cells: string
  read: (el: HTMLElement) => P
  same: (a: P, b: P) => boolean
  /** Палец встал на клетку. */
  onPick: (p: P) => void
  onStart?: () => void
  /** Лупа гаснет, `p` от 0 до 1: подпись на месте лупы может проявляться следом. */
  onFade?: (p: number) => void
  /** Лупа только удержанием (ScrubHandlers.hold): вбок карточку листают. */
  hold?: boolean
}

/**
 * Ведение по клеткам с лупой. Клетка под пальцем ищется по центрам, на смене щелчок.
 * Лупа ходит над пальцем в пределах карточки, а отпустили - гаснет на месте, к своему
 * хвостику: перелёт к строке тянул глаз через всю карту. Ставит её вызывающий (`place`),
 * когда в лупе уже новая подпись: с подписью меняется ширина.
 */
export function useLoupe<P>(gridRef: RefObject<HTMLElement | null>, opts: LoupeOpts<P>) {
  // Палец на карте: клетка обведена, день недели под пальцем подсвечен.
  const [scrub, setScrub] = useState(false)
  // Лупа живёт дольше пальца: после отпускания она ещё гаснет.
  const [loupe, setLoupe] = useState(false)
  const loupeRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLElement>(null)
  const finger = useRef({ x: 0, y: 0 })
  const placed = useRef({ x: 0, y: 0 })
  const bounds = useRef({ left: 0, right: 0 })
  const cells = useRef<{ p: P; x: number; y: number }[]>([])
  const hovered = useRef<P | null>(null)
  const fading = useRef<(() => void) | null>(null)
  const live = useRef(opts)
  live.current = opts

  const place = (): void => {
    const el = loupeRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const { x, y } = finger.current
    const left = clamp(x - w / 2, bounds.current.left, bounds.current.right - w)
    const top = Math.max(4, y - LOUPE_LIFT - h)
    placed.current = { x: left, y: top }
    el.style.opacity = '1'
    el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`
    if (tailRef.current) tailRef.current.style.left = `${clamp(x - left, 18, w - 18).toFixed(1)}px`
  }

  useEffect(() => () => fading.current?.(), [])

  const hover = (x: number, y: number, first: boolean): void => {
    let best = cells.current[0]
    let bd = Infinity
    for (const c of cells.current) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2
      if (d < bd) {
        bd = d
        best = c
      }
    }
    if (!best || (!first && hovered.current !== null && live.current.same(hovered.current, best.p))) return
    hovered.current = best.p
    haptic.tick()
    live.current.onPick(best.p)
  }

  const fadeOut = (): void => {
    const el = loupeRef.current
    const done = (): void => {
      fading.current = null
      live.current.onFade?.(1)
      setLoupe(false)
    }
    if (!el) {
      done()
      return
    }
    const { x, y } = placed.current
    el.style.transformOrigin = `${tailRef.current?.style.left || '50%'} 100%`
    fading.current = animate(
      LOUPE_OUT_MS,
      (t) => {
        const p = pr(t, 0, LOUPE_OUT_MS)
        el.style.opacity = (1 - p).toFixed(3)
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - 0.08 * p).toFixed(3)})`
        live.current.onFade?.(p)
      },
      done,
    )
  }

  useScrub(gridRef, {
    hold: opts.hold,
    start(x, y) {
      fading.current?.()
      fading.current = null
      const grid = gridRef.current
      if (!grid) return
      const card = (grid.closest('.stats-card') ?? grid).getBoundingClientRect()
      bounds.current = { left: Math.max(8, card.left - 6), right: Math.min(window.innerWidth - 8, card.right + 6) }
      cells.current = Array.from(grid.querySelectorAll<HTMLElement>(live.current.cells)).map((el) => {
        const b = el.getBoundingClientRect()
        return { p: live.current.read(el), x: b.left + b.width / 2, y: b.top + b.height / 2 }
      })
      live.current.onStart?.()
      finger.current = { x, y }
      hovered.current = null
      setScrub(true)
      setLoupe(true)
      hover(x, y, true)
    },
    move(x, y) {
      finger.current = { x, y }
      hover(x, y, false)
      place()
    },
    end() {
      setScrub(false)
      fadeOut()
    },
  })

  return { scrub, loupe, loupeRef, tailRef, place }
}
