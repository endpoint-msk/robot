// Перестановка вопросов формы-заявки за ручку (components/FormBuilder.tsx), как папок в
// настройках Telegram: вопрос приподнимается и едет за пальцем, соседи расступаются на его
// высоту, отпущенный доезжает в свой слот. Высота у вопросов разная (у выбора варианты),
// поэтому шаг не общий, как у ленты афиш (useReorder), а своя высота каждого.
//
// Берут только за ручку и сразу, без удержания: остальная карточка это поля ввода, а ручка
// ни для чего другого не нужна. У ручки touch-action: none, иначе палец прокручивал бы
// страницу вместо перестановки.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { holdSelection } from '../motion'
import { haptic } from '../telegram'

/** У края окна страница сама прокручивается под поднятым вопросом. */
const EDGE = 72
const EDGE_SPEED = 9
const LIFT = ' scale(1.02)'

type Item = { el: HTMLElement; top: number; h: number }

type Grab = {
  id: string
  el: HTMLElement
  pointerId: number
  y0: number
  scroll0: number
  lastY: number
  from: number
  to: number
  items: Item[]
  gap: number
  dy: number
  unhold: () => void
}

const itemsOf = (list: HTMLElement): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-reorder-id]'))

export function useListReorder(listRef: RefObject<HTMLElement | null>, ids: string[], onReorder: (next: string[]) => void): void {
  const live = useRef({ ids, onReorder })
  live.current = { ids, onReorder }
  // Отпущенный вопрос встаёт в новый слот из того места, где его оставил палец: после
  // перерисовки в новом порядке он сдвинут на разницу и доезжает до нуля.
  const landing = useRef<{ id: string; top: number } | null>(null)
  const order = ids.join(' ')

  useLayoutEffect(() => {
    const list = listRef.current
    const l = landing.current
    if (!list || !l) return
    landing.current = null
    list.classList.remove('reordering')
    const els = itemsOf(list)
    for (const el of els) {
      if (el.dataset.reorderId === l.id) continue
      el.style.transition = 'none'
      el.style.transform = ''
      void el.offsetWidth
      el.style.transition = ''
    }
    const el = els.find((x) => x.dataset.reorderId === l.id)
    if (!el) return
    el.style.transition = 'none'
    el.style.transform = ''
    drop(el, l.top - (el.getBoundingClientRect().top + window.scrollY))
  }, [order])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let g: Grab | null = null
    let raf = 0

    const place = (): void => {
      if (!g) return
      g.dy = g.lastY - g.y0 + (window.scrollY - g.scroll0)
      g.el.style.transform = `translate3d(0,${g.dy.toFixed(1)}px,0)${LIFT}`
      const self = g.items[g.from]!
      // Ведёт передний край: вверх верх вопроса, вниз низ. По середине высокий вопрос (выбор
      // с вариантами) пришлось бы утаскивать далеко за короткого соседа.
      const top = self.top + g.dy
      let to = g.from
      if (g.dy < 0) {
        for (let i = g.from - 1; i >= 0; i--) if (top < g.items[i]!.top + g.items[i]!.h / 2) to = i
      } else {
        for (let i = g.from + 1; i < g.items.length; i++) if (top + self.h > g.items[i]!.top + g.items[i]!.h / 2) to = i
      }
      if (to === g.to) return
      g.to = to
      haptic.tick()
      const step = self.h + g.gap
      g.items.forEach((it, i) => {
        if (i === g!.from) return
        const shift = g!.from < i && i <= to ? -step : to <= i && i < g!.from ? step : 0
        it.el.style.transform = shift ? `translate3d(0,${shift}px,0)` : ''
      })
    }

    // Вопрос дотащили к краю окна: страница едет сама, и вопрос вместе с ней.
    const edgeScroll = (): void => {
      raf = 0
      if (!g) return
      const v = g.lastY < EDGE ? -EDGE_SPEED : g.lastY > window.innerHeight - EDGE ? EDGE_SPEED : 0
      if (v === 0) return
      const before = window.scrollY
      window.scrollBy(0, v)
      if (window.scrollY === before) return
      place()
      raf = requestAnimationFrame(edgeScroll)
    }

    const release = (cancelled: boolean): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const cur = g
      g = null
      if (!cur) return
      cur.unhold()
      if (cancelled || cur.to === cur.from) {
        list.classList.remove('reordering')
        for (const it of cur.items) if (it.el !== cur.el) it.el.style.transform = ''
        drop(cur.el, cur.dy)
        return
      }
      const next = live.current.ids.slice()
      const [moved] = next.splice(cur.from, 1)
      next.splice(cur.to, 0, moved!)
      landing.current = { id: cur.id, top: cur.items[cur.from]!.top + cur.dy }
      haptic.impact('soft')
      live.current.onReorder(next)
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || g || live.current.ids.length < 2) return
      const handle = (e.target as Element).closest('[data-reorder-handle]')
      const el = handle?.closest<HTMLElement>('[data-reorder-id]')
      if (!el || el.parentElement !== list) return
      e.preventDefault()
      const els = itemsOf(list)
      const items = els.map((x): Item => {
        const r = x.getBoundingClientRect()
        return { el: x, top: r.top + window.scrollY, h: r.height }
      })
      const a = items[0]!
      const b = items[1]!
      const from = els.indexOf(el)
      g = {
        id: el.dataset.reorderId!,
        el,
        pointerId: e.pointerId,
        y0: e.clientY,
        scroll0: window.scrollY,
        lastY: e.clientY,
        from,
        to: from,
        items,
        gap: b.top - (a.top + a.h),
        dy: 0,
        unhold: holdSelection(),
      }
      list.classList.add('reordering')
      // Вопрос подхватили, пока он ещё доезжал после прошлого раза.
      el.classList.remove('dropping')
      el.classList.add('lifted')
      el.style.transition = 'box-shadow 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
      el.style.transform = `translate3d(0,0,0)${LIFT}`
      haptic.impact('light')
      try {
        list.setPointerCapture(e.pointerId)
      } catch {
        /* указатель уже отпущен */
      }
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || e.pointerId !== g.pointerId) return
      g.lastY = e.clientY
      place()
      if (!raf) raf = requestAnimationFrame(edgeScroll)
    }
    const onUp = (e: PointerEvent): void => {
      if (g && e.pointerId === g.pointerId) release(e.type === 'pointercancel')
    }
    // Поднятый вопрос ведёт палец сам: прокрутка страницы ему не мешает.
    const onTouchMove = (e: TouchEvent): void => {
      if (g && e.cancelable) e.preventDefault()
    }
    const onContext = (e: Event): void => {
      if (g) e.preventDefault()
    }

    list.addEventListener('pointerdown', onDown)
    list.addEventListener('pointermove', onMove)
    list.addEventListener('pointerup', onUp)
    list.addEventListener('pointercancel', onUp)
    list.addEventListener('touchmove', onTouchMove, { passive: false })
    list.addEventListener('contextmenu', onContext)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      g?.unhold()
      list.removeEventListener('pointerdown', onDown)
      list.removeEventListener('pointermove', onMove)
      list.removeEventListener('pointerup', onUp)
      list.removeEventListener('pointercancel', onUp)
      list.removeEventListener('touchmove', onTouchMove)
      list.removeEventListener('contextmenu', onContext)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Вопрос опускается в свой слот из сдвига `dy`, тень гаснет вместе с ходом. */
function drop(el: HTMLElement, dy: number): void {
  el.style.transition = 'none'
  el.style.transform = `translate3d(0,${dy.toFixed(1)}px,0)${LIFT}`
  void el.offsetWidth
  el.style.transition = ''
  el.classList.remove('lifted')
  el.classList.add('dropping')
  el.style.transform = ''
  const done = (e?: TransitionEvent): void => {
    if (e && (e.target !== el || e.propertyName !== 'transform')) return
    el.removeEventListener('transitionend', done)
    el.classList.remove('dropping')
  }
  el.addEventListener('transitionend', done)
  setTimeout(done, 400)
}
