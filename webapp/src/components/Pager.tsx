// Листалка карточек одного списка: человек в статистике, неделя архива, человек во
// взносах. Движок тот же, что у листалки дня (screens/Day.tsx): дробная позиция p,
// пружина без перелёта, ось по первым 8 px, щелчок в момент решения. Всё между
// страницами (полоса в тоне страницы, сдвиг, точки) считается от p и рисуется правками
// style, React отвечает за содержимое.
//
// Смонтированы открытая страница и по две с каждой стороны: каждая грузит свои данные
// сама, соседи приходят, пока читают открытую, и брошенную карточку можно подхватить на
// лету и дотянуть до следующей. Порядок — тот список, из которого пришли: вызывающий
// кладёт его в параметры в момент открытия, и смена периода его под пальцем не тасует.

import { useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { afterHero } from '../hero'
import {
  arrowStep,
  clamp,
  EDGE_ZONE,
  holdSelection,
  landing,
  mix,
  mixc,
  PAGE_SPRING,
  pageTarget,
  palette,
  reducedMotion,
  rubber,
  springAt,
  toHex,
  tracker,
} from '../motion'
import { UnderContext } from '../screenContext'
import { scrubActive } from '../stats'
import { canSwipeBack, registerPagerStart, swipingBack } from './useSwipeBack'
import { getState, useStore } from '../store'
import { haptic, setHeaderColor } from '../telegram'
import { applyTheme } from '../theme'

/** Сколько страниц смонтировано с каждой стороны от открытой. */
const REACH = 2
/** Насколько полоса заходит под шапку; дальше до следующего блока — фон (CSS `.pgr-page [data-pager-head]`). */
const BAND_PAD = 16

type Drag = { x0: number; y0: number; p0: number; id: number; dir: 0 | 1; mouse: boolean }

export function Pager<T>({
  items,
  index,
  keyOf,
  onCommit,
  tone,
  top,
  renderPage,
}: {
  items: T[]
  index: number
  keyOf: (it: T) => string
  /** Карточка встала на место: вызывающий подменяет параметры экрана (setTopParams). */
  onCommit: (i: number) => void
  /** Цвет полосы под шапкой карточки; шапку карточка помечает data-pager-head. */
  tone: (it: T) => string
  /** То, что стоит над листалкой и не листается (строка «назад»). */
  top?: ReactNode
  renderPage: (it: T, active: boolean) => ReactNode
}) {
  const { theme } = useStore()
  const under = useContext(UnderContext)
  const rootRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const live = useRef({ items, index, onCommit, tone })
  live.current = { items, index, onCommit, tone }
  const S = useRef({
    p: index,
    anim: null as { to: number; x0: number; v0: number; t0: number } | null,
    drag: null as Drag | null,
    width: 393,
    bandTop: 0,
    heads: new Map<number, number>(),
    draggedAt: 0,
    raf: 0,
  }).current
  const sync = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const root = rootRef.current!
    const band = bandRef.current!
    const track = trackRef.current!

    const measure = (): void => {
      S.width = track.clientWidth || 393
      const rootTop = root.getBoundingClientRect().top
      S.bandTop = band.getBoundingClientRect().top - rootTop
      S.heads.clear()
      // Полоса заходит под шапку на BAND_PAD, а не обрывается по её низу (край лёг бы
      // впритык под подзаголовок) и не доходит до следующего блока (карточка прилипла бы
      // к краю): так же, как у листалки дня.
      pageEls.current.forEach((el, i) => {
        const head = el.querySelector('[data-pager-head]')
        if (head) S.heads.set(i, head.getBoundingClientRect().bottom + BAND_PAD - rootTop)
      })
    }

    const render = (): void => {
      const { items: list, index: cur, tone: toneOf } = live.current
      const C = palette()
      const last = list.length - 1
      const pp = clamp(S.p, 0, last)
      const i0 = Math.floor(pp)
      const i1 = Math.min(last, i0 + 1)
      const f = pp - i0
      const stage = mixc(toneOf(list[i0]!), toneOf(list[i1]!), f)
      band.style.background = stage
      const h0 = S.heads.get(i0) ?? S.heads.get(cur) ?? 0
      const h1 = S.heads.get(i1) ?? h0
      band.style.height = `${Math.max(0, mix(h0, h1, f) - S.bandTop).toFixed(1)}px`
      pageEls.current.forEach((el, i) => {
        const d = i - S.p
        if (Math.abs(d) >= 1) {
          el.style.visibility = 'hidden'
          return
        }
        el.style.visibility = ''
        el.style.transform = `translate3d(${(d * S.width).toFixed(2)}px,0,0)`
      })
      const dots = marksRef.current
      if (!dots) return
      Array.from(dots.children).forEach((el, k) => {
        const dot = el.firstElementChild as HTMLElement | null
        if (!dot) return
        const pj = clamp(1 - Math.abs(pp - k), 0, 1)
        dot.style.width = `${(6 + 12 * pj).toFixed(2)}px`
        dot.style.background = mixc(C.dotOff, C.tones.gray, pj)
      })
    }

    // Пока страницы едут, дорожка держит высоту самой высокой из видимых, иначе соседняя
    // обрезалась бы по высоте открытой. До конца жеста высота только растёт: иначе
    // страница под пальцем прыгала бы.
    const holdHeight = (from: number, to: number): void => {
      let h = parseFloat(track.style.minHeight) || 0
      for (let i = Math.floor(Math.min(from, to)); i <= Math.ceil(Math.max(from, to)); i++) {
        h = Math.max(h, pageEls.current.get(i)?.offsetHeight ?? 0)
      }
      track.style.minHeight = h ? `${h}px` : ''
    }

    const commit = (i: number): void => {
      track.style.minHeight = ''
      if (i !== live.current.index) live.current.onCommit(i)
    }

    const frame = (now: number): void => {
      S.raf = 0
      const a = S.anim
      if (a) {
        const s = springAt(a.x0, a.v0, PAGE_SPRING, Math.max(0, now - a.t0) / 1000)
        S.p = a.to + s.x
        if (Math.abs(s.x) < 0.001 && Math.abs(s.v) < 0.01) {
          S.p = a.to
          S.anim = null
          commit(a.to)
        }
      }
      render()
      if (S.anim) S.raf = requestAnimationFrame(frame)
    }
    const kick = (): void => {
      if (!S.raf) S.raf = requestAnimationFrame(frame)
    }

    /** `v0` в страницах в секунду: брошенная карточка едет дальше со скоростью пальца. */
    const goTo = (target: number, v0 = 0): void => {
      const { items: list, index: cur } = live.current
      const to = clamp(Math.round(target), 0, list.length - 1)
      // Щелчок на решении, а не в конце доводки: палец уже знает, куда поедет карточка.
      if (to !== cur) haptic.tick()
      holdHeight(S.p, to)
      if (reducedMotion()) {
        S.anim = null
        S.p = to
        render()
        commit(to)
        return
      }
      S.anim = { to, x0: S.p - to, v0: landing(S.p - to, v0, PAGE_SPRING), t0: performance.now() }
      kick()
    }
    sync.current = () => {
      if (!S.drag && !S.anim) S.p = live.current.index
      measure()
      render()
    }

    // За краем списка резинка UIScrollView: в первые пиксели отзывчивая, дальше упирается.
    // За смонтированными соседями тоже: там пусто.
    const edge = (raw: number, w: number): number => {
      const cur = live.current.index
      const lo = Math.max(0, cur - REACH)
      const hi = Math.min(live.current.items.length - 1, cur + REACH)
      if (raw < lo) return lo - rubber((lo - raw) * w, w) / w
      if (raw > hi) return hi + rubber((raw - hi) * w, w) / w
      return raw
    }

    // Чужие жесты: свайп строки, поля ввода и области, которые ведут пальцем сами
    // (графики). Решает первое касание. Сетка, которая ведёт только удержанием
    // (data-scrub="hold"), листанию не мешает: после удержания оно уступает (scrubActive).
    const FREE = '.swipe-row, input, textarea, [data-scrub=""]'
    let touch: { x: number; y: number; axis: 0 | 1 | 2 } | null = null
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      touch =
        e.touches.length === 1 && t && !(e.target as Element).closest(FREE) && t.clientX >= EDGE_ZONE
          ? { x: t.clientX, y: t.clientY, axis: 0 }
          : null
    }
    const onTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!touch || !t) return
      if (touch.axis === 0) {
        const dx = Math.abs(t.clientX - touch.x)
        const dy = Math.abs(t.clientY - touch.y)
        if (dx < 6 && dy < 6) return
        touch.axis = dx > dy ? 1 : 2
      }
      if (touch.axis === 1 && e.cancelable) e.preventDefault()
    }

    // С первой карточки вправо уводит свайп назад (useSwipeBack): левее неё ничего нет.
    const atStart = (): boolean => S.p <= 0.001
    const vt = tracker()
    let unselect: (() => void) | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || S.drag || live.current.items.length < 2 || swipingBack()) return
      if ((e.target as Element).closest(FREE) || e.clientX < EDGE_ZONE) return
      S.drag = { x0: e.clientX, y0: e.clientY, p0: S.p, id: e.pointerId, dir: 0, mouse: e.pointerType === 'mouse' }
      vt.start(e.clientX, e.timeStamp)
    }
    const onMove = (e: PointerEvent): void => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      vt.move(e.clientX, e.timeStamp)
      const dx = e.clientX - d.x0
      const dy = e.clientY - d.y0
      if (d.dir === 0) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (scrubActive() || (touch ? touch.axis === 2 : Math.abs(dy) >= Math.abs(dx))) {
          S.drag = null
          return
        }
        if (dx > 0 && atStart() && canSwipeBack()) {
          S.drag = null
          return
        }
        d.dir = 1
        measure()
        // Доводку поймали на лету: карточка едет дальше с того места, где её взяли.
        S.anim = null
        d.p0 = S.p + dx / (S.width || 393)
        if (d.mouse) unselect = holdSelection()
        try {
          root.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
      const w = S.width || 393
      S.p = edge(d.p0 - dx / w, w)
      holdHeight(S.p, S.p)
      kick()
    }
    const onUp = (e: PointerEvent): void => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      S.drag = null
      unselect?.()
      unselect = null
      if (d.dir !== 1) return
      S.draggedAt = performance.now()
      const w = S.width || 393
      const v = -vt.release(e.timeStamp) / w
      goTo(pageTarget(S.p, v, w), v)
    }
    // Отпущенный после свайпа палец не должен нажать кнопку, над которой оказался.
    const onClickCapture = (e: MouseEvent): void => {
      if (performance.now() - S.draggedAt < 300) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    // Трекпад: два пальца приходят колесом с deltaX, конец жеста только тишина в событиях.
    let wheel: { p0: number; dx: number; done: boolean } | null = null
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wt = tracker()
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || live.current.items.length < 2) return
      if ((e.target as Element).closest(FREE)) return
      if (swipingBack() || (!wheel && e.deltaX < 0 && atStart() && canSwipeBack())) return
      e.preventDefault()
      if (S.drag) return
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(() => {
        const g = wheel
        wheel = null
        if (g && !g.done) goTo(S.p)
      }, 110)
      const w = S.width || 393
      const last = live.current.items.length - 1
      if (!wheel) {
        S.anim = null
        measure()
        holdHeight(Math.max(0, Math.floor(S.p) - 1), Math.min(last, Math.ceil(S.p) + 1))
        wheel = { p0: S.p, dx: 0, done: false }
        wt.start(0, e.timeStamp)
      }
      if (wheel.done) return
      wheel.dx += e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1)
      wt.move(wheel.dx, e.timeStamp)
      S.p = edge(wheel.p0 + wheel.dx / w, w)
      const to = Math.round(wheel.p0) + Math.sign(wheel.dx)
      if (Math.abs(wheel.dx) > w * 0.25 && to >= 0 && to <= last) {
        wheel.done = true
        goTo(to, wt.release(e.timeStamp) / w)
        return
      }
      kick()
    }
    // Стрелки листают карточки в Telegram Desktop, как дни. Дальше смонтированных соседей
    // не уходят, а копия под верхним экраном (жест «вниз») на них не отвечает.
    const onKey = (e: KeyboardEvent): void => {
      const step = arrowStep(e)
      if (step === 0 || S.drag || live.current.items.length < 2 || root.closest('.screen-under')) return
      e.preventDefault()
      const cur = live.current.index
      goTo(clamp((S.anim ? S.anim.to : Math.round(S.p)) + step, cur - REACH, cur + REACH))
    }
    const ro = new ResizeObserver(() => {
      measure()
      render()
    })

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('click', onClickCapture, true)
    root.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    const unregister = registerPagerStart(root, atStart)
    ro.observe(root)
    measure()
    render()

    return () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      S.raf = 0
      unselect?.()
      unregister()
      ro.disconnect()
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('click', onClickCapture, true)
      root.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      clearTimeout(wheelIdle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Перелистнули, пришли данные или сменилась тема: страницы встают на места, полоса
  // меряется заново по шапке открытой карточки.
  useLayoutEffect(() => sync.current(), [index, items, theme])

  // Шапку Telegram красим в тон карточки, когда она встала (и после перехода из строки).
  useEffect(() => {
    const it = items[index]
    if (it && !under) afterHero(() => setHeaderColor(toHex(tone(it))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items, theme, under])
  useEffect(
    () => () => {
      if (!under) afterHero(() => applyTheme(getState().theme))
    },
    [under],
  )

  const lo = Math.max(0, index - REACH)
  const hi = Math.min(items.length - 1, index + REACH)
  const mounted: number[] = []
  for (let i = lo; i <= hi; i++) mounted.push(i)

  return (
    <div className="pgr" ref={rootRef}>
      <div className="pgr-band" ref={bandRef} aria-hidden="true" />
      {top}
      {items.length > 1 ? (
        <div className="pgr-dots" ref={marksRef} aria-hidden="true">
          {items.map((it) => (
            <span className="dpg-dot" key={keyOf(it)}>
              <i />
            </span>
          ))}
        </div>
      ) : null}
      <div className="pgr-track" ref={trackRef}>
        {mounted.map((i) => (
          <div
            key={keyOf(items[i]!)}
            className={'pgr-page' + (i === index ? ' active' : '')}
            ref={(el) => {
              if (el) pageEls.current.set(i, el)
              else pageEls.current.delete(i)
            }}
            inert={i !== index}
          >
            {renderPage(items[i]!, i === index)}
          </div>
        ))}
      </div>
    </div>
  )
}
