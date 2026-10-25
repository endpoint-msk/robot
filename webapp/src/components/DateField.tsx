// Поле даты вместо <input type="date">: довод тот же, что у TimeField — нативный
// пикер рисуется локалью системы (порядок полей, первый день недели, названия
// месяцев), а задать ему это нечем. Тап по «таблетке» открывает шторку с сеткой
// месяца, неделя начинается с понедельника, как везде в миниаппе. Месяцы листаются
// пальцем, мышью и трекпадом, стрелки в шапке тоже.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, dayNum, fmtDayMonth, keyToDate, monthIdx, MONTHS_NOM, weekdayIdx, WEEKDAYS_SHORT, yearOf } from '../dates'
import { icons } from '../icons'
import { clamp, holdSelection, landing, PAGE_SPRING, pageTarget, reducedMotion, rubber, springAt, tracker } from '../motion'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'
import { useSheetDrag } from './useSheetDrag'

const monthStart = (key: string): string => key.slice(0, 8) + '01'

const addMonths = (key: string, n: number): string => {
  const d = keyToDate(monthStart(key))
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** Последний день месяца: первое число следующего минус сутки. */
const daysInMonth = (key: string): number => dayNum(addDays(addMonths(key, 1), -1))

/** «Ср, 15 октября», с годом — только когда он не тот, в котором сейчас живём. */
const label = (key: string, today: string): string => {
  const base = `${WEEKDAYS_SHORT[weekdayIdx(key)]}, ${fmtDayMonth(key)}`
  return yearOf(key) === yearOf(today) ? base : `${base} ${yearOf(key)}`
}

/** «Октябрь 2026»: подпись над сеткой. */
const monthTitle = (key: string): string => `${MONTHS_NOM[monthIdx(key)]} ${yearOf(key)}`

function MonthGrid({
  month,
  value,
  min,
  max,
  onPick,
}: {
  month: string
  value: string
  min: string
  max: string
  onPick: (key: string) => void
}) {
  const first = monthStart(month)
  // Ведущие пустые ячейки: сколько дней прошлого месяца попадает в первую строку.
  const lead = weekdayIdx(first)
  const total = daysInMonth(first)
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => addDays(first, i)),
  ]
  return (
    <div className="dp-grid">
      {cells.map((key, i) =>
        key === null ? (
          <span className="dp-cell empty" key={`empty-${i}`} />
        ) : (
          <button
            key={key}
            className={'dp-cell' + (key === value ? ' selected' : '')}
            disabled={key < min || key > max}
            onClick={() => onPick(key)}
          >
            {dayNum(key)}
          </button>
        ),
      )}
    </div>
  )
}

type Drag = { x0: number; y0: number; p0: number; id: number; dir: 0 | 1; mouse: boolean }

function DateSheet({
  initial,
  min,
  max,
  onClose,
}: {
  initial: string
  min: string
  max: string
  onClose: (value: string | null) => void
}) {
  const [shown, setShown] = useState(false)
  const done = useRef(false)
  const [month, setMonth] = useState(monthStart(initial))
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (next: string | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    setTimeout(() => onClose(next), 220)
  }
  // Системная «Назад» закрывает шторку, а не уводит из редактора под ней.
  useEffect(() => pushOverlay(() => close(null)), [])
  const overlayRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Смахивается за шапку: по сетке палец листает месяцы.
  useSheetDrag(sheetRef, overlayRef, () => close(null), '.tp-bar, .dp-head')

  // Месяцы листаются, как дни (screens/Day.tsx): дробная позиция p от открытого месяца,
  // пружина без перелёта, ось по первым 8 px, щелчок в момент решения. Смонтированы
  // открытый месяц и по соседу с каждой стороны, поэтому брошенный можно подхватить на лету.
  const pagerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const live = useRef({ month, min, max })
  live.current = { month, min, max }
  const S = useRef({
    p: 0,
    anim: null as { to: number; x0: number; v0: number; t0: number } | null,
    drag: null as Drag | null,
    width: 360,
    draggedAt: 0,
    raf: 0,
    // Стрелку нажали, пока месяц ещё ехал: он встаёт сразу, а следующий едет за ним.
    queued: 0,
  }).current
  const shift = useRef<(n: number) => void>(() => {})
  const settle = useRef<() => void>(() => {})

  const has = (k: number): boolean => {
    const next = addMonths(month, k)
    return next >= monthStart(min) && next <= monthStart(max)
  }

  useLayoutEffect(() => {
    const root = pagerRef.current!
    const near = (k: number): boolean => {
      const { month: m, min: lo, max: hi } = live.current
      const next = addMonths(m, k)
      return next >= monthStart(lo) && next <= monthStart(hi)
    }

    const render = (): void => {
      pageEls.current.forEach((el, i) => {
        if (!el) return
        const d = i - 1 - S.p
        el.style.visibility = Math.abs(d) >= 1 ? 'hidden' : ''
        el.style.transform = `translate3d(${(d * S.width).toFixed(2)}px,0,0)`
      })
      // Подпись показывает месяц, который ближе под пальцем, а не тот, с которого начали.
      const t = titleRef.current
      if (t) t.textContent = monthTitle(addMonths(live.current.month, clamp(Math.round(S.p), -1, 1)))
    }

    const commit = (to: number): void => {
      if (to !== 0) {
        setMonth(addMonths(live.current.month, to))
        return
      }
      const n = S.queued
      S.queued = 0
      if (n) goTo(n)
    }

    const frame = (now: number): void => {
      S.raf = 0
      const a = S.anim
      if (a) {
        const sp = springAt(a.x0, a.v0, PAGE_SPRING, Math.max(0, now - a.t0) / 1000)
        S.p = a.to + sp.x
        if (Math.abs(sp.x) < 0.001 && Math.abs(sp.v) < 0.01) {
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

    /** `v0` в месяцах в секунду: брошенный месяц едет дальше со скоростью пальца. */
    const goTo = (target: number, v0 = 0): void => {
      const to = clamp(Math.round(target), near(-1) ? -1 : 0, near(1) ? 1 : 0)
      if (to !== 0) haptic.tick()
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
    shift.current = (n) => {
      const a = S.anim
      if (a && a.to !== 0) {
        S.anim = null
        S.queued = n
        commit(a.to)
        return
      }
      goTo(n)
    }
    settle.current = () => {
      S.width = root.clientWidth || 360
      if (!S.drag) {
        S.anim = null
        S.p = 0
      }
      render()
      const n = S.queued
      S.queued = 0
      if (n) goTo(n)
    }

    // За краем диапазона резинка UIScrollView, как у листалки дней.
    const edge = (raw: number): number => {
      const w = S.width
      const lo = near(-1) ? -1 : 0
      const hi = near(1) ? 1 : 0
      if (raw < lo) return lo - rubber((lo - raw) * w, w) / w
      if (raw > hi) return hi + rubber((raw - hi) * w, w) / w
      return raw
    }

    // Ось пальца решается по touchmove: решили «вбок», и прокрутка гаснет до конца жеста.
    let touch: { x: number; y: number; axis: 0 | 1 | 2 } | null = null
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, axis: 0 } : null
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

    const vt = tracker()
    let unselect: (() => void) | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || S.drag) return
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
        if (touch ? touch.axis === 2 : Math.abs(dy) >= Math.abs(dx)) {
          S.drag = null
          return
        }
        d.dir = 1
        S.width = root.clientWidth || 360
        // Доводку поймали на лету: месяц едет дальше с того места, где его взяли.
        S.anim = null
        S.queued = 0
        d.p0 = S.p + dx / S.width
        if (d.mouse) unselect = holdSelection()
        try {
          root.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
      S.p = edge(d.p0 - dx / S.width)
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
      const v = -vt.release(e.timeStamp) / S.width
      goTo(pageTarget(S.p, v, S.width), v)
    }
    // Отпущенный после свайпа палец не должен выбрать день, над которым оказался.
    const onClickCapture = (e: MouseEvent): void => {
      if (performance.now() - S.draggedAt < 300) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    // Трекпад: два пальца приходят колесом с deltaX. Месяц доезжает, когда сдвиг больше
    // четверти ширины, а остаток инерции до паузы в событиях глотается.
    let wheel: { dx: number; done: boolean } | null = null
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wt = tracker()
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      if (S.drag) return
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(() => {
        const g = wheel
        wheel = null
        if (g && !g.done) goTo(S.p)
      }, 110)
      if (!wheel) {
        S.anim = null
        S.queued = 0
        S.width = root.clientWidth || 360
        wheel = { dx: 0, done: false }
        wt.start(0, e.timeStamp)
      }
      if (wheel.done) return
      const w = S.width
      wheel.dx += e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1)
      wt.move(wheel.dx, e.timeStamp)
      S.p = edge(wheel.dx / w)
      const to = Math.sign(wheel.dx)
      if (Math.abs(wheel.dx) > w * 0.25 && near(to)) {
        wheel.done = true
        goTo(to, wt.release(e.timeStamp) / w)
        return
      }
      kick()
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('click', onClickCapture, true)
    // Нативно и не пассивно: React вешает wheel пассивно, а без preventDefault macOS
    // уводит горизонтальный жест в навигацию «назад».
    root.addEventListener('wheel', onWheel, { passive: false })
    S.width = root.clientWidth || 360
    render()

    return () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      S.raf = 0
      unselect?.()
      clearTimeout(wheelIdle)
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('click', onClickCapture, true)
      root.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Месяц встал: соседи пересобраны вокруг него, страницы возвращаются на места до кадра.
  useLayoutEffect(() => settle.current(), [month])

  const pick = (key: string): void => {
    haptic.tick()
    setValue(key)
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={'tp-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="tp-sheet" ref={sheetRef}>
        <div className="tp-bar">
          <button className="tp-bar-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <span className="tp-bar-title">Дата</span>
          <button className="tp-bar-btn primary" onClick={() => close(value)}>
            Готово
          </button>
        </div>
        <div className="dp-head">
          <button className="dp-nav" aria-label="Предыдущий месяц" disabled={!has(-1)} onClick={() => shift.current(-1)}>
            <span className="dp-nav-back">{icons.chevron('#007aff')}</span>
          </button>
          <span className="dp-month" ref={titleRef}>
            {monthTitle(month)}
          </span>
          <button className="dp-nav" aria-label="Следующий месяц" disabled={!has(1)} onClick={() => shift.current(1)}>
            {icons.chevron('#007aff')}
          </button>
        </div>
        <div className="dp-dows">
          {WEEKDAYS_SHORT.map((d) => (
            <span className="dp-dow" key={d}>
              {d}
            </span>
          ))}
        </div>
        <div className="dp-pager" ref={pagerRef}>
          {[-1, 0, 1].map((k) => (
            <div
              key={has(k) ? addMonths(month, k) : `none${k}`}
              className="dp-page"
              ref={(el) => {
                pageEls.current[k + 1] = el
              }}
              inert={k !== 0}
            >
              {has(k) ? <MonthGrid month={addMonths(month, k)} value={value} min={min} max={max} onPick={pick} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function DateField({
  value,
  onChange,
  min,
  max,
}: {
  value: string
  onChange: (value: string) => void
  /** Нижняя граница — обычно «сегодня» в поясе спейса. */
  min: string
  /** Верхняя граница: у ивентов это год вперёд (EVENT_DAYS_AHEAD). */
  max: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="time-input time-field dp-field"
        aria-label={'Дата: ' + label(value, min)}
        onClick={() => setOpen(true)}
      >
        {label(value, min)}
      </button>
      {open ? (
        <DateSheet
          initial={value}
          min={min}
          max={max}
          onClose={(next) => {
            setOpen(false)
            if (next) onChange(next)
          }}
        />
      ) : null}
    </>
  )
}
