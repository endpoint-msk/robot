// Перестановка афиш в ленте редактора ивента (screens/Event.tsx). Плитку берут пальцем
// или мышью, соседи расступаются, отпущенная встаёт на освободившееся место. Порядок в
// ленте и есть порядок показа, первая афиша обложка: превью и цвет ивента меняются сразу.
//
// Мышь берёт плитку с порога в несколько пикселей. Палец только удержанием: лента
// прокручивается вбок, и сдвиг пальца без паузы это прокрутка, а не перестановка.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { clamp } from '../motion'
import { haptic } from '../telegram'

/** Сколько держать палец на плитке, чтобы она поднялась. */
const HOLD_MS = 260
/** Сдвиг, после которого удержание уже прокрутка, а мышь уже тянет. */
const TOUCH_SLOP = 8
const MOUSE_SLOP = 5
/** У края ленты она сама прокручивается под поднятой плиткой. */
const EDGE = 36
const EDGE_SPEED = 7
const LIFT = ' scale(1.06)'

type Grab = {
  id: string
  el: HTMLElement
  pointerId: number
  mouse: boolean
  x0: number
  y0: number
  scroll0: number
  from: number
  to: number
  step: number
  tiles: HTMLElement[]
  lifted: boolean
  dx: number
  lastX: number
}

export function useReorder(
  stripRef: RefObject<HTMLElement | null>,
  ids: string[],
  onReorder: (next: string[]) => void,
): void {
  const live = useRef({ ids, onReorder })
  live.current = { ids, onReorder }
  // Отпущенная плитка после перестановки встаёт в новый слот не рывком, а доезжает из того
  // места, где её оставил палец: остаток сдвига до слота.
  const landing = useRef<{ id: string; dx: number } | null>(null)

  useLayoutEffect(() => {
    const strip = stripRef.current
    const l = landing.current
    if (!strip || !l) return
    landing.current = null
    strip.classList.remove('reordering')
    const tiles = Array.from(strip.querySelectorAll<HTMLElement>('[data-photo]'))
    for (const t of tiles) if (t.dataset.photo !== l.id) t.style.transform = ''
    const el = tiles.find((t) => t.dataset.photo === l.id)
    if (el) drop(el, l.dx)
  }, [ids])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    let g: Grab | null = null
    let hold: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    let droppedAt = 0

    const tilesOf = (): HTMLElement[] => Array.from(strip.querySelectorAll<HTMLElement>('[data-photo]'))

    const place = (): void => {
      if (!g) return
      g.dx = g.lastX - g.x0 + (strip.scrollLeft - g.scroll0)
      g.el.style.transform = `translate3d(${g.dx.toFixed(1)}px,0,0)${LIFT}`
      const to = clamp(g.from + Math.round(g.dx / g.step), 0, g.tiles.length - 1)
      if (to === g.to) return
      g.to = to
      haptic.tick()
      g.tiles.forEach((t, i) => {
        if (i === g!.from) return
        const shift = g!.from < i && i <= to ? -g!.step : to <= i && i < g!.from ? g!.step : 0
        t.style.transform = shift ? `translate3d(${shift}px,0,0)` : ''
      })
    }

    // Плитку дотащили к краю видимой ленты: лента едет сама, и плитка вместе с ней.
    const edgeScroll = (): void => {
      raf = 0
      if (!g?.lifted) return
      const box = strip.getBoundingClientRect()
      const v = g.lastX < box.left + EDGE ? -EDGE_SPEED : g.lastX > box.right - EDGE ? EDGE_SPEED : 0
      if (v === 0) return
      const before = strip.scrollLeft
      strip.scrollLeft = before + v
      if (strip.scrollLeft === before) return
      place()
      raf = requestAnimationFrame(edgeScroll)
    }

    const lift = (): void => {
      if (!g) return
      g.lifted = true
      g.tiles = tilesOf()
      g.from = g.tiles.indexOf(g.el)
      g.to = g.from
      const a = g.tiles[0]?.getBoundingClientRect()
      const b = g.tiles[1]?.getBoundingClientRect()
      g.step = a && b ? b.left - a.left : (a?.width ?? 74) + 8
      strip.classList.add('reordering')
      // Плитку подхватили, пока она ещё доезжала после прошлого раза.
      g.el.classList.remove('dropping')
      g.el.classList.add('lifted')
      g.el.style.transition = 'none'
      g.el.style.transform = `translate3d(0,0,0)${LIFT}`
      haptic.impact('light')
      try {
        strip.setPointerCapture(g.pointerId)
      } catch {
        /* указатель уже отпущен */
      }
      place()
    }

    const release = (cancelled: boolean): void => {
      clearTimeout(hold)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const cur = g
      g = null
      if (!cur?.lifted) return
      droppedAt = performance.now()
      const { ids: list } = live.current
      if (cancelled || cur.to === cur.from || cur.from < 0) {
        strip.classList.remove('reordering')
        for (const t of cur.tiles) if (t !== cur.el) t.style.transform = ''
        drop(cur.el, cur.dx)
        return
      }
      const next = list.slice()
      const [moved] = next.splice(cur.from, 1)
      next.splice(cur.to, 0, moved!)
      landing.current = { id: cur.id, dx: cur.dx - (cur.to - cur.from) * cur.step }
      haptic.impact('soft')
      live.current.onReorder(next)
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || g || live.current.ids.length < 2) return
      const t = e.target as Element
      if (t.closest('button, label')) return
      const el = t.closest<HTMLElement>('[data-photo]')
      if (!el) return
      g = {
        id: el.dataset.photo!,
        el,
        pointerId: e.pointerId,
        mouse: e.pointerType === 'mouse',
        x0: e.clientX,
        y0: e.clientY,
        scroll0: strip.scrollLeft,
        from: -1,
        to: -1,
        step: 82,
        tiles: [],
        lifted: false,
        dx: 0,
        lastX: e.clientX,
      }
      if (!g.mouse) hold = setTimeout(lift, HOLD_MS)
    }
    const onMove = (e: PointerEvent): void => {
      if (!g || e.pointerId !== g.pointerId) return
      g.lastX = e.clientX
      if (!g.lifted) {
        const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0)
        if (g.mouse) {
          if (moved >= MOUSE_SLOP) lift()
        } else if (moved > TOUCH_SLOP) {
          clearTimeout(hold)
          g = null
        }
        return
      }
      place()
      if (!raf) raf = requestAnimationFrame(edgeScroll)
    }
    const onUp = (e: PointerEvent): void => {
      if (g && e.pointerId === g.pointerId) release(e.type === 'pointercancel')
    }
    // Поднятая плитка ведёт палец сама: прокрутка ленты и страницы ей не мешает.
    const onTouchMove = (e: TouchEvent): void => {
      if (g?.lifted && e.cancelable) e.preventDefault()
    }
    // Отпущенная плитка не открывает просмотр, а картинка не уезжает нативным drag-and-drop.
    const onClick = (e: MouseEvent): void => {
      if (performance.now() - droppedAt < 300) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    const onDragStart = (e: DragEvent): void => e.preventDefault()
    const onContext = (e: Event): void => {
      if (g) e.preventDefault()
    }

    strip.addEventListener('pointerdown', onDown)
    strip.addEventListener('pointermove', onMove)
    strip.addEventListener('pointerup', onUp)
    strip.addEventListener('pointercancel', onUp)
    strip.addEventListener('touchmove', onTouchMove, { passive: false })
    strip.addEventListener('click', onClick, true)
    strip.addEventListener('dragstart', onDragStart)
    strip.addEventListener('contextmenu', onContext)
    return () => {
      clearTimeout(hold)
      if (raf) cancelAnimationFrame(raf)
      strip.removeEventListener('pointerdown', onDown)
      strip.removeEventListener('pointermove', onMove)
      strip.removeEventListener('pointerup', onUp)
      strip.removeEventListener('pointercancel', onUp)
      strip.removeEventListener('touchmove', onTouchMove)
      strip.removeEventListener('click', onClick, true)
      strip.removeEventListener('dragstart', onDragStart)
      strip.removeEventListener('contextmenu', onContext)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Плитка опускается в свой слот из сдвига `dx`: подъём снимается, когда она встала. */
function drop(el: HTMLElement, dx: number): void {
  el.style.transition = 'none'
  el.style.transform = `translate3d(${dx.toFixed(1)}px,0,0)${LIFT}`
  void el.offsetWidth
  el.style.transition = ''
  el.classList.add('dropping')
  el.style.transform = ''
  const done = (e?: TransitionEvent): void => {
    if (e && (e.target !== el || e.propertyName !== 'transform')) return
    el.removeEventListener('transitionend', done)
    // Её уже подняли снова: подъём снимает следующее падение.
    if (!el.classList.contains('dropping')) return
    el.classList.remove('lifted', 'dropping')
  }
  el.addEventListener('transitionend', done)
  setTimeout(done, 400)
}
