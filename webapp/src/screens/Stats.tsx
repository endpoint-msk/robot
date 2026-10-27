// Статистика присутствия: сколько спейс работал, когда здесь людно, кто его держит
// открытым. Раздел резидентский целиком — сервер проверяет это на каждой ручке.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, prefetchOnTouch } from '../api'
import {
  dayNum,
  fmtDayMonth,
  fmtRange,
  monthIdx,
  MONTHS_NOM,
  plural,
  weekdayIdx,
  WEEKDAYS_SHORT,
  yearOf,
} from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { animate, clamp, markOwnTap, ownTapRecent, pr, reducedMotion, spring } from '../motion'
import { useRemote } from '../remote'
import { push, useStore } from '../store'
import {
  heatCell,
  heatLevel,
  heatSlot,
  heatValue,
  hoursNum,
  hoursNumWord,
  hoursWord,
  statsAvatarUser,
  useScrub,
} from '../stats'
import { haptic } from '../telegram'
import type { StatsBar, StatsChart, StatsHeatCell, StatsOverview, StatsPeriod } from '../types'
import { BackRow, EmptyState, ErrorState, Header, SectionTitle, Sep } from '../components/common'
import { Collapse } from '../components/Collapse'
import { Crossfade } from '../components/Crossfade'
import { Flip, XText } from '../components/Flip'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { useNowMin } from './Visit'
import { Swap } from '../components/Swap'
import { SkBars, SkBlock, SkCard, SkFigure, SkGrid } from '../components/skeleton'
import type { PersonRef } from './StatsPerson'
import { WrapRow } from './Wrap'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: nb('3 месяца') },
  { key: 'all', label: 'Всё время' },
]

/** Без перелёта: бегунок должен доехать, а не подпрыгнуть. */
const THUMB_SPRING = { response: 0.3, damping: 1 }

/**
 * Сколько прошлое окно держится на экране после переключения: тот же порог, после
 * которого экраны показывают каркас (SKELETON_DELAY_MS в remote.ts). Свой таймер, а
 * не `pending`: тот после быстрого ответа остаётся поднятым до следующего запроса и
 * на первом кадре переключения выдал бы каркас поверх старых чисел.
 */
const HOLD_MS = 320

/** Колонок в тепловой карте: сутки двухчасовыми интервалами. */
const BUCKETS = 12

/** Подписи под колонками карты: каждая вторая, иначе цифры сливаются. */
const HOUR_LABELS = Array.from({ length: BUCKETS }, (_, i) => (i % 2 === 0 ? String(i * 2).padStart(2, '0') : ''))

const TOP_PREVIEW = 5

/** Лупа стоит над пальцем: сам палец закрывает ту клетку, ради которой его поставили. */
const LOUPE_LIFT = 34
/** Сколько лупа гаснет после отпускания. */
const LOUPE_OUT_MS = 160

type HeatPick = { dow: number; bucket: number }

const samePick = (a: HeatPick | null, b: HeatPick | null): boolean =>
  a !== null && b !== null && a.dow === b.dow && a.bucket === b.bucket

/** Значение клетки словами: строка над картой и лупа говорят одно и то же. */
const heatText = (cell: StatsHeatCell): string =>
  cell.noData ? 'данных нет, роутер не отвечал' : cell.v <= 0 ? 'никого не было' : `в среднем ${heatValue(cell.v)}`

function HeatCard({ data }: { data: StatsOverview }) {
  const [picked, setPicked] = useState<HeatPick | null>(null)
  // Клетка, в которую попадает сейчас по часам спейса. Минута живая: экран могли открыть
  // в конце интервала.
  const { data: boot } = useStore()
  const nowMin = useNowMin()
  const now: HeatPick = {
    dow: (weekdayIdx(boot!.todayKey) + Math.floor(nowMin / 1440)) % 7,
    bucket: Math.floor((nowMin % 1440) / 120),
  }
  // Палец на карте: строка над ней погашена, день недели под пальцем подсвечен.
  const [scrub, setScrub] = useState(false)
  // Лупа живёт дольше пальца: после отпускания она ещё гаснет.
  const [loupe, setLoupe] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const loupeRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLElement>(null)
  const finger = useRef({ x: 0, y: 0 })
  const placed = useRef({ x: 0, y: 0 })
  const bounds = useRef({ left: 0, right: 0 })
  const cells = useRef<(HeatPick & { x: number; y: number })[]>([])
  const hovered = useRef<HeatPick | null>(null)
  const fading = useRef<(() => void) | null>(null)

  const cellOf = (p: HeatPick | null): StatsHeatCell | undefined =>
    p ? data.heat.rows.find((r) => r.dow === p.dow)?.cells[p.bucket] : undefined

  const pick = (dow: number, bucket: number): void => {
    setPicked((cur) => (cur && cur.dow === dow && cur.bucket === bucket ? null : { dow, bucket }))
    haptic.tick()
  }

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

  // С клеткой меняется подпись в лупе, а с ней ширина: лупу ставим заново, когда новая
  // подпись уже в DOM.
  useLayoutEffect(() => {
    if (scrub) place()
  }, [scrub, picked])

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
    if (!best || (!first && samePick(hovered.current, best))) return
    hovered.current = { dow: best.dow, bucket: best.bucket }
    haptic.tick()
    setPicked(hovered.current)
  }

  // Отпустили: лупа гаснет на месте, к своему хвостику, а строка над картой проявляется
  // уже с выбранной клеткой, как после тапа. Перелёт лупы к строке тянул глаз через всю
  // карту ради подписи, которая и так встаёт на своё место.
  const fadeOut = (): void => {
    const el = loupeRef.current
    const ro = readoutRef.current
    const done = (): void => {
      fading.current = null
      if (ro) ro.style.opacity = ''
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
        if (ro) ro.style.opacity = p.toFixed(3)
      },
      done,
    )
  }

  useScrub(gridRef, {
    start(x, y) {
      fading.current?.()
      fading.current = null
      const grid = gridRef.current
      if (!grid) return
      const card = (grid.closest('.stats-card') ?? grid).getBoundingClientRect()
      bounds.current = { left: Math.max(8, card.left - 6), right: Math.min(window.innerWidth - 8, card.right + 6) }
      cells.current = Array.from(grid.querySelectorAll<HTMLElement>('.heat-cell')).map((el) => {
        const b = el.getBoundingClientRect()
        return {
          dow: Number(el.dataset.dow),
          bucket: Number(el.dataset.bucket),
          x: b.left + b.width / 2,
          y: b.top + b.height / 2,
        }
      })
      if (readoutRef.current) readoutRef.current.style.opacity = '0'
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

  // Значение ячейки читается строкой над картой: hover в вебвью нет, нативный title
  // на тап не открывается, а строку под картой закрывала бы рука. Пока ничего не
  // выбрано, строка говорит про сейчас: ради этого карту и открывают - стоит ли идти.
  const readout = (): ReactNode => {
    const cell = cellOf(picked)
    if (picked && cell) {
      return (
        <>
          <b>{`${WEEKDAYS_SHORT[picked.dow]}, ${heatSlot(picked.bucket)}`}</b>
          {` · ${heatText(cell)}`}
        </>
      )
    }
    const cur = cellOf(now)
    if (!cur) return 'Среднее число людей внутри'
    return (
      <>
        <b>{`Сейчас, ${WEEKDAYS_SHORT[now.dow]!.toLowerCase()} ${heatSlot(now.bucket)}`}</b>
        {` · ${heatText(cur)}`}
      </>
    )
  }

  const lens = cellOf(picked)
  const lensCell = lens ? heatCell(heatLevel(lens.v, data.heat.max), lens.noData) : null

  return (
    <div className="card stats-card">
      <div className="heat-head">
        <div className="stats-card-title">Когда здесь людно</div>
        <div className="heat-readout" ref={readoutRef}>
          {readout()}
        </div>
      </div>
      <div className="heat" data-scrub="" ref={gridRef}>
        {data.heat.rows.map((row) => (
          <div className="heat-row" key={row.dow}>
            <div className={'heat-dow' + (scrub && picked?.dow === row.dow ? ' on' : '')}>
              {WEEKDAYS_SHORT[row.dow]}
            </div>
            {row.cells.map((cell, i) => {
              const on = picked !== null && picked.dow === row.dow && picked.bucket === i
              const isNow = now.dow === row.dow && now.bucket === i
              const { className, style } = heatCell(heatLevel(cell.v, data.heat.max), cell.noData)
              return (
                <button
                  key={i}
                  type="button"
                  className={className + (on ? ' picked' : '') + (isNow ? ' now' : '')}
                  style={style}
                  data-dow={row.dow}
                  data-bucket={i}
                  aria-label={`${WEEKDAYS_SHORT[row.dow]} ${heatSlot(i)}`}
                  aria-pressed={on}
                  onClick={() => pick(row.dow, i)}
                />
              )
            })}
          </div>
        ))}
        <div className="heat-row heat-hours">
          <div className="heat-dow" />
          {HOUR_LABELS.map((label, i) => (
            <div className="heat-hour" key={i}>
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <div className="heat-scale">
          <span>меньше</span>
          {[1, 2, 3, 4, 5].map((level) => (
            <i key={level} style={{ background: `var(--heat-${level})` }} />
          ))}
          <span>больше</span>
        </div>
      </div>
      <div className="heat-legend">
        <i className="heat-swatch zero" />
        <span>никого не было</span>
        <i className="heat-swatch nodata" style={{ marginLeft: 8 }} />
        <span>роутер был недоступен</span>
      </div>
      {loupe && picked && lens && lensCell
        ? createPortal(
            <div className="stats-loupe" ref={loupeRef} aria-hidden="true">
              <i className={lensCell.className} style={lensCell.style} />
              <div className="stats-loupe-text">
                <b>{`${WEEKDAYS_SHORT[picked.dow]}, ${heatSlot(picked.bucket)}`}</b>
                <span>{heatText(lens)}</span>
              </div>
              <i className="stats-tail" ref={tailRef} />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/** Деления оси часов: круглый шаг, не больше четырёх линий над базой. */
const axisOf = (maxHours: number): { top: number; ticks: number[] } => {
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => maxHours / s <= 4) ?? 2000
  const top = Math.max(step, Math.ceil(maxHours / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  return { top, ticks }
}

type Step = StatsChart['step']

const STEP_TITLE: Record<Step, string> = {
  day: 'Часы по дням',
  week: 'Часы по неделям',
  month: 'Часы по месяцам',
}

const PERIOD_STEP: Record<StatsPeriod, Step> = { month: 'day', quarter: 'week', all: 'month' }

/** Высота дорожки столбиков, px: та же, что у слоя сетки (.bars-grid в app.css). */
const PLOT_H = 92

/**
 * Мест под месяцы не меньше шести: у журнала, которому пара месяцев, столбики иначе
 * встали бы плитами во всю ширину. Короткий ряд прижат к сегодняшнему краю.
 */
const MIN_MONTH_SLOTS = 6

/**
 * Смена периода своим тапом: прежний график гаснет, новый вырастает от базы весь разом
 * (app.css, .bars-leave и .growing). Столько живёт прежний слой.
 */
const MORPH_MS = 420

type ChartModel = {
  step: Step
  bars: StatsBar[]
  slots: number
  /** Сдвиг первого столбика в местах: короткий ряд месяцев прижат вправо. */
  offset: number
  gap: number
  radius: number
  axis: { top: number; ticks: number[] }
  /** Высота столбика, px. */
  heights: number[]
  /** Самый высокий столбик; -1, если все пустые. */
  peak: number
  /** Последний столбик, который можно выбрать: будущие дни месяца пусты. */
  last: number
}

const chartModel = (chart: StatsChart, todayKey: string): ChartModel => {
  const { step, bars } = chart
  const slots = step === 'month' ? Math.max(bars.length, MIN_MONTH_SLOTS) : bars.length
  // Тридцать один день на ширину телефона это около 9 px на столбик: зазор и скругление
  // как у недель съели бы его целиком.
  const dense = slots > 16
  const axis = axisOf(Math.max(0, ...bars.map((b) => b.minutes)) / 60)
  const heights = bars.map((b) => (b.minutes > 0 ? Math.max(2, (b.minutes / 60 / axis.top) * PLOT_H) : 0))
  let peak = -1
  bars.forEach((b, i) => {
    if (b.minutes > 0 && (peak < 0 || b.minutes > (bars[peak]?.minutes ?? 0))) peak = i
  })
  let last = bars.length - 1
  if (step === 'day') while (last > 0 && (bars[last]?.from ?? '') > todayKey) last--
  return {
    step,
    bars,
    slots,
    offset: slots - bars.length,
    gap: dense ? 2 : 5,
    radius: dense ? 2.5 : 5,
    axis,
    heights,
    peak,
    last,
  }
}

const slotLeft = (m: ChartModel, i: number): string => `${((m.offset + i) * 100) / m.slots}%`
const slotWidth = (m: ChartModel): string => `${100 / m.slots}%`
const slotCenter = (m: ChartModel, i: number): string => `${((m.offset + i + 0.5) * 100) / m.slots}%`

/** «май», а не «мая»: MONTHS_ABBR в dates.ts держит родительный падеж под плитку даты. */
const monthAbbr = (key: string): string => (MONTHS_NOM[monthIdx(key)] ?? '').slice(0, 3).toLowerCase()

type BarLabel = { i: number; text: string; now: boolean }

/**
 * Подписи под столбиками. Дни через неделю и сегодняшний синим, недели месяцем там, где
 * он начинается, месяцы все, а на длинном журнале через один-два. Выбранный день или
 * месяц подписан всегда: после тапа видно, что выбрано, а соседние подписи уступают ему
 * место.
 */
const barLabels = (m: ChartModel, todayKey: string, picked: number | null): BarLabel[] => {
  const nowMonth = todayKey.slice(0, 7)
  let out: BarLabel[] = []
  let near = 0
  if (m.step === 'day') {
    near = 2
    m.bars.forEach((b, i) => {
      const d = dayNum(b.from)
      const now = b.from === todayKey
      if (now || (d - 1) % 7 === 0) out.push({ i, text: String(d), now })
    })
    const today = out.find((l) => l.now)
    if (today) out = out.filter((l) => l.now || Math.abs(l.i - today.i) > near)
  } else if (m.step === 'week') {
    m.bars.forEach((b, i) => {
      if (dayNum(b.from) <= 7) out.push({ i, text: monthAbbr(b.from), now: b.from.slice(0, 7) === nowMonth })
    })
  } else {
    const every = Math.ceil(m.bars.length / 12)
    near = every - 1
    m.bars.forEach((b, i) => {
      if ((m.bars.length - 1 - i) % every === 0) {
        out.push({ i, text: monthAbbr(b.from), now: b.from.slice(0, 7) === nowMonth })
      }
    })
  }
  const b = picked !== null && m.step !== 'week' ? m.bars[picked] : undefined
  if (b && picked !== null && !out.some((l) => l.i === picked)) {
    out = out.filter((l) => Math.abs(l.i - picked) > near)
    out.push({ i: picked, text: m.step === 'day' ? String(dayNum(b.from)) : monthAbbr(b.from), now: false })
  }
  return out
}

/** Пилюля над столбиком говорит языком шага: «пт, 23 октября», «неделя 12–18 октября», «сентябрь». */
const barTitle = (step: Step, b: StatsBar, todayKey: string): string => {
  if (step === 'day') return `${(WEEKDAYS_SHORT[weekdayIdx(b.from)] ?? '').toLowerCase()}, ${fmtDayMonth(b.from)}`
  if (step === 'week') return `неделя ${fmtRange(b.from, b.to)}`
  const month = (MONTHS_NOM[monthIdx(b.from)] ?? '').toLowerCase()
  return yearOf(b.from) === yearOf(todayKey) ? month : `${month} ${yearOf(b.from)}`
}

const hoursText = (minutes: number): string => `${hoursNum(minutes)} ч`

const axisMarks = (axis: { top: number; ticks: number[] }): ReactNode =>
  axis.ticks.map((t) => {
    const top = `${100 - (t / axis.top) * 100}%`
    return (
      <Fragment key={t}>
        <div className={t === 0 ? 'bar-base' : 'bar-grid'} style={{ top }} />
        <div className="bar-ytick" style={{ top }}>
          {t}
        </div>
      </Fragment>
    )
  })

const xMarks = (m: ChartModel, labels: BarLabel[], picked: number | null): ReactNode =>
  labels.map((l) => (
    <span
      key={l.i}
      className={'bar-label' + (l.now ? ' now' : '') + (l.i === picked ? ' on' : '')}
      style={{ left: slotCenter(m, l.i) }}
    >
      {l.text}
    </span>
  ))

type Morph = { from: ChartModel; labels: BarLabel[]; val: number }

function HoursChart({ chart, todayKey }: { chart: StatsChart; todayKey: string }) {
  const m = useMemo(() => chartModel(chart, todayKey), [chart, todayKey])
  // Выбор привязан к раскладке: при другом шаге тот же номер столбика значит другое.
  const layout = `${m.step}:${m.bars[0]?.from ?? ''}:${m.bars.length}`
  const [sel, setSel] = useState<{ layout: string; i: number } | null>(null)
  const picked = sel && sel.layout === layout ? sel.i : null
  const [scrub, setScrub] = useState(false)
  const [morph, setMorph] = useState<Morph | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLElement>(null)
  const shown = useRef<{ m: ChartModel; labels: BarLabel[]; val: number } | null>(null)
  const geo = useRef({ left: 0, slot: 1, bottom: 0, cardLeft: 0, cardTop: 0, cardWidth: 0 })
  const hovered = useRef(-1)
  const pillAt = useRef<{ x: number; y: number } | null>(null)

  const labels = barLabels(m, todayKey, scrub ? null : picked)
  // Подпись над столбиками одна: пока ничего не выбрано, у пика, дальше у выбранного.
  // Под пальцем её нет вовсе, там говорит пилюля.
  const val = scrub ? -1 : (picked ?? m.peak)

  // Шаг сменился своим тапом: прежний график гаснет, новый вырастает. Без своего тапа и
  // при «уменьшении движения» новая раскладка встаёт сразу. Столбики не перетекают друг в
  // друга: дней тридцать, недель тринадцать, и кусками, по которым дни складывались в
  // недели, график собирался дольше, чем его читают.
  useLayoutEffect(() => {
    const before = shown.current
    if (!before || before.m.step === m.step) return
    setSel(null)
    if (!ownTapRecent() || reducedMotion()) return
    setMorph({ from: before.m, labels: before.labels, val: before.val })
  }, [m, todayKey])
  useLayoutEffect(() => {
    shown.current = { m, labels, val }
  })
  useEffect(() => {
    if (!morph) return
    const timer = window.setTimeout(() => setMorph(null), MORPH_MS)
    return () => window.clearTimeout(timer)
  }, [morph])

  const select = (i: number): void => {
    const j = Math.min(i, m.last)
    if (picked === j) return
    setSel({ layout, i: j })
    haptic.tick()
  }

  const hoverAt = (x: number, first: boolean): void => {
    const g = geo.current
    const i = clamp(Math.floor((x - g.left) / g.slot) - m.offset, 0, Math.max(0, m.last))
    if (!first && i === hovered.current) return
    hovered.current = i
    haptic.tick()
    setSel({ layout, i })
  }

  // На шаге дней столбик около 9 px: тапом в него не попасть, поэтому выбор ведением.
  // Тап по графику всё равно выбирает: место столбика во всю высоту дорожки.
  useScrub(plotRef, {
    can: () => !morph && m.bars.length > 0,
    start(x) {
      const area = areaRef.current?.getBoundingClientRect()
      const card = cardRef.current?.getBoundingClientRect()
      if (area && card) {
        geo.current = {
          left: area.left,
          slot: area.width / Math.max(1, m.slots),
          bottom: area.bottom,
          cardLeft: card.left,
          cardTop: card.top,
          cardWidth: card.width,
        }
      }
      hovered.current = -1
      setScrub(true)
      hoverAt(x, true)
    },
    move(x) {
      hoverAt(x, false)
    },
    end() {
      setScrub(false)
    },
  })

  // Пилюля стоит над столбиком под пальцем и переезжает между столбиками переходом из
  // app.css. Первая постановка без переезда, иначе пилюля приехала бы с места прошлого
  // жеста. Отпустили: пилюля оседает и гаснет, а над столбиком встаёт его подпись.
  useLayoutEffect(() => {
    const pill = pillRef.current
    if (!pill) return
    if (!scrub || picked === null) {
      const at = pillAt.current
      pillAt.current = null
      if (at) pill.style.transform = `translate(${at.x.toFixed(1)}px, ${(at.y + 6).toFixed(1)}px)`
      return
    }
    const g = geo.current
    const w = pill.offsetWidth
    const h = pill.offsetHeight
    const cx = g.left + (m.offset + picked + 0.5) * g.slot - g.cardLeft
    const y = g.bottom - (m.heights[picked] ?? 0) - g.cardTop - 10 - h
    const x = clamp(cx - w / 2, 6, g.cardWidth - 6 - w)
    if (!pillAt.current) {
      pill.style.transitionProperty = 'opacity'
      pill.style.transform = `translate(${x.toFixed(1)}px, ${(y + 6).toFixed(1)}px)`
      void pill.offsetWidth
      pill.style.transitionProperty = ''
    }
    pillAt.current = { x, y }
    pill.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    if (tailRef.current) tailRef.current.style.left = `${clamp(cx - x, 14, w - 14).toFixed(1)}px`
  }, [scrub, picked, m])

  const pillBar = picked !== null ? m.bars[picked] : undefined
  const valBar = val >= 0 ? m.bars[val] : undefined
  const oldBar = morph && morph.val >= 0 ? morph.from.bars[morph.val] : undefined

  return (
    <div className="card stats-card chart-card" ref={cardRef}>
      <div className="stats-card-title">
        <XText text={STEP_TITLE[m.step]} />
      </div>
      <div className="bars-plot" data-scrub="" ref={plotRef}>
        {morph ? <div className="bars-grid bars-leave">{axisMarks(morph.from.axis)}</div> : null}
        <div className={'bars-grid' + (morph ? ' bars-enter' : '')}>{axisMarks(m.axis)}</div>
        <div className="bars-area" ref={areaRef}>
          {morph ? (
            <div className="bars-static bars-leave" aria-hidden="true">
              {morph.from.bars.map((b, i) => {
                const h = morph.from.heights[i] ?? 0
                return h > 0 ? (
                  <span key={b.from} className="bar-slot" style={{ left: slotLeft(morph.from, i), width: slotWidth(morph.from) }}>
                    <i
                      style={{
                        left: morph.from.gap / 2,
                        right: morph.from.gap / 2,
                        height: h,
                        borderRadius: `${morph.from.radius}px ${morph.from.radius}px 0 0`,
                      }}
                    />
                  </span>
                ) : null
              })}
            </div>
          ) : null}
          <div className={'bars-static' + (morph ? ' growing' : '')}>
            {m.bars.map((b, i) => {
              // Будущие дни месяца пусты и не выбираются: тап по ним выбирает сегодняшний.
              const future = i > m.last
              const active = picked === i
              const h = m.heights[i] ?? 0
              return (
                <button
                  type="button"
                  key={b.from}
                  className={'bar-slot' + (active ? ' on' : '')}
                  style={{ left: slotLeft(m, i), width: slotWidth(m) }}
                  aria-label={future ? undefined : `${barTitle(m.step, b, todayKey)}: ${hoursText(b.minutes)}`}
                  aria-pressed={future ? undefined : active}
                  aria-hidden={future ? true : undefined}
                  tabIndex={future ? -1 : undefined}
                  onClick={() => select(i)}
                >
                  {h > 0 ? (
                    <i
                      style={{
                        left: m.gap / 2,
                        right: m.gap / 2,
                        height: h,
                        borderRadius: `${m.radius}px ${m.radius}px 0 0`,
                      }}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
          {morph && oldBar ? (
            <div
              className="bar-val bars-leave"
              style={{
                left: slotCenter(morph.from, morph.val),
                bottom: `${(morph.from.heights[morph.val] ?? 0) + 5}px`,
              }}
            >
              {hoursNum(oldBar.minutes)}
            </div>
          ) : null}
          {/* Подпись висит над своим столбиком, а не на общей высоте: иначе у низкого
              столбика между цифрой и им провал в полкарточки. Ключ по выбору: подпись
              выбранного проявляется заново на каждом тапе. */}
          {valBar ? (
            <div
              key={val === picked ? `p${val}` : 'peak'}
              className={'bar-val' + (morph ? ' bars-late' : val === picked ? ' on' : '')}
              style={{ left: slotCenter(m, val), bottom: `${(m.heights[val] ?? 0) + 5}px` }}
            >
              {hoursNum(valBar.minutes)}
            </div>
          ) : null}
        </div>
        {morph ? <div className="bars-x leaving bars-leave">{xMarks(morph.from, morph.labels, null)}</div> : null}
        <div className={'bars-x' + (morph ? ' bars-enter' : '')}>{xMarks(m, labels, scrub ? null : picked)}</div>
      </div>
      <div className={'bars-pill' + (scrub ? ' on' : '')} ref={pillRef} aria-hidden="true">
        {pillBar ? (
          <>
            <span>{barTitle(m.step, pillBar, todayKey)}</span>
            <span>{' · '}</span>
            <b>{hoursText(pillBar.minutes)}</b>
          </>
        ) : null}
        <i className="stats-tail" ref={tailRef} />
      </div>
    </div>
  )
}

/** Столбиков в скелете графика: столько же, сколько придёт на шаге периода. */
const SK_BARS: Record<StatsPeriod, number> = { month: 31, quarter: 13, all: 12 }

/**
 * Скелет экрана: сводка, карта и график — тот же каркас, что у данных. Волна по
 * диагонали карты и по столбикам заодно показывает, что запрос ещё жив.
 */
function StatsSkeleton({ period }: { period: StatsPeriod }) {
  return (
    <div aria-busy="true" aria-label="Загружаем статистику">
      <div className="card stats-card">
        <SkFigure />
        <SkBlock h={6} style={{ display: 'block', marginTop: 16 }} />
        <SkBlock w="64%" style={{ display: 'block', marginTop: 12 }} />
        <div className="sep" />
        <div className="stats-pair">
          <div>
            <SkBlock w={44} h={22} />
            <SkBlock w={96} h={13} style={{ display: 'block', marginTop: 5 }} />
          </div>
          <div>
            <SkBlock w={36} h={22} />
            <SkBlock w={150} h={13} style={{ display: 'block', marginTop: 5 }} />
          </div>
        </div>
      </div>
      <div className="card stats-card">
        <div className="heat-head">
          <div className="stats-card-title">Когда здесь людно</div>
          <div className="heat-readout">
            <SkBlock w="56%" h={13} style={{ verticalAlign: 'middle' }} />
          </div>
        </div>
        <SkGrid rows={7} cols={BUCKETS} gutter />
      </div>
      <SkCard title={STEP_TITLE[PERIOD_STEP[period]]}>
        <SkBars count={SK_BARS[period]} />
      </SkCard>
    </div>
  )
}

export function Stats() {
  const { data: boot } = useStore()
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const [allPeople, setAllPeople] = useState(false)
  const { data, error, loading, pending, reload } = useRemote(
    () => api<StatsOverview>('stats.overview', { period }),
    [period],
  )

  // Ответ прошлого окна держим на экране, пока едет новый: иначе тело схлопывалось
  // до переключателя и вырастало обратно на каждом тапе. До ответа он приглушён, а
  // потом числа перещёлкиваются на месте. Затянулся запрос дольше порога каркаса,
  // и вместо старых чисел встаёт каркас, как при первой загрузке.
  const last = useRef<StatsOverview | null>(null)
  if (data) last.current = data
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    if (!holding) return
    const timer = window.setTimeout(() => setHolding(false), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [holding, period])
  const held = !data && loading && holding ? last.current : null
  const shown = data ?? held

  // Бегунок едет пружиной и подхватывает скорость, если по сегментам стучат подряд.
  // На открытии экрана он сразу стоит на своём месте.
  const index = PERIODS.findIndex((p) => p.key === period)
  const thumb = useRef<HTMLElement>(null)
  const thumbAt = useRef(index)
  const thumbRun = useRef<ReturnType<typeof spring> | null>(null)
  useLayoutEffect(() => {
    const el = thumb.current
    if (!el) return
    const place = (x: number): void => {
      thumbAt.current = x
      el.style.transform = `translateX(${(x * 100).toFixed(2)}%)`
    }
    const from = thumbAt.current
    const velocity = thumbRun.current?.velocity() ?? 0
    thumbRun.current?.stop()
    thumbRun.current = null
    place(from)
    if (from === index) return
    thumbRun.current = spring(from, index, velocity, THUMB_SPRING, place, () => {
      thumbRun.current = null
    }, 0.002)
  }, [index])
  useEffect(() => () => thumbRun.current?.stop(), [])

  // Переключатель прилипает к верху (app.css, .stats-seg-bar): период меняется там, где
  // смотрит глаз, и смену видно на графике сразу, а не после прокрутки к началу экрана.
  // Подложка проявляется за первые 14 px прокрутки под ним, как полоса навигации iOS.
  const barRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = barRef.current
    const mark = markRef.current
    if (!bar || !mark) return
    let raf = 0
    const paint = (): void => {
      raf = 0
      const stuck = clamp((bar.getBoundingClientRect().top - mark.getBoundingClientRect().top) / 14, 0, 1)
      bar.style.setProperty('--stuck', stuck.toFixed(3))
    }
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    paint()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // Бегунок едет отдельным слоем: анимировать фон у трёх независимых кнопок
  // нечем — переключение читалось бы как мгновенная перекраска.
  const segmented = (
    <div className="segmented stats-seg">
      <i className="seg-thumb" ref={thumb} />
      {PERIODS.map((p) => (
        <button
          type="button"
          key={p.key}
          className={'seg' + (p.key === period ? ' on' : '')}
          aria-pressed={p.key === period}
          onClick={() => {
            if (p.key === period) return
            haptic.tick()
            markOwnTap()
            setHolding(true)
            setPeriod(p.key)
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )

  // Переключатель периода остаётся на экране во всех состояниях: из упавшего
  // запроса иначе не выбраться, кроме как закрыв экран, а соседнее окно вполне
  // может прогрузиться.
  const chrome = (subtitle: string) => (
    <>
      <BackRow label="Ближайшие дни" />
      <Header title="Статистика" subtitle={subtitle} />
      <div className="stats-seg-mark" ref={markRef} />
      <div className="stats-seg-bar" ref={barRef}>
        {segmented}
      </div>
    </>
  )

  // Меняется только тело — его и подменяет Swap: каркас гаснет поверх проявляющихся
  // данных. Раньше он пропадал в том же кадре, и переход читался как рывок.
  const frame = (subtitle: string, body: ReactNode) => (
    <Screen>
      {chrome(subtitle)}
      <Swap loading={loading && !shown} skeleton={pending ? <StatsSkeleton period={period} /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  if (error) return frame('Журнал присутствия', <ErrorState onRetry={reload} />)
  if (!shown) return frame('Журнал присутствия', null)

  if (!shown.hasData) {
    return frame(
      'Журнал присутствия',
      <div className="card">
        <EmptyState
          title="Пока нечего показать"
          text="Журнал наполняется, когда резиденты отмечаются в спейсе. За выбранный период отметок не было."
        />
      </div>,
    )
  }

  const prev = shown.prevOpenMinutes
  const compareMax = prev !== null ? Math.max(prev, shown.openMinutes, 1) : 1
  const deltaMinutes = prev !== null ? shown.openMinutes - prev : 0
  const top = shown.top.slice(0, TOP_PREVIEW)
  const rest = shown.top.slice(TOP_PREVIEW)
  const topMax = shown.top[0]?.minutes ?? 1

  const avgShown = String(shown.avgInside).replace('.', ',')
  const avgWord = Number.isInteger(shown.avgInside)
    ? plural(shown.avgInside, 'человек', 'человека', 'человек')
    : 'человека'

  // Карточки листаются в порядке этого списка: он уезжает в параметры в момент открытия,
  // и смена периода его под пальцем не тасует.
  const people: PersonRef[] = shown.top.map((t) => ({ userId: t.userId, label: t.label, username: t.username }))
  const personRow = (p: StatsOverview['top'][number], i: number, max: number) => (
    <Fragment key={p.userId}>
      {i > 0 ? <Sep inset={34} /> : null}
      <button
        type="button"
        className="row tappable"
        {...prefetchOnTouch('stats.person', { userId: p.userId, period: 'quarter' })}
        onClick={() => push('statsPerson', { userId: p.userId, people, backLabel: 'Статистика' })}
      >
        <Avatar user={statsAvatarUser(p)} className="stat-avatar" />
        <div className="person-cell">
          <div className="person-top">
            <span className="person-name">{p.label}</span>
            <span className="person-hours">{hoursNum(p.minutes)} ч</span>
          </div>
          <div className="share-bar">
            <i style={{ width: `${(p.minutes / max) * 100}%` }} />
          </div>
        </div>
        {icons.chevron()}
      </button>
    </Fragment>
  )

  return frame(
    `${shown.periodLabel} · журнал присутствия`,
    // Тело не пересоздаётся при смене окна: карточки остаются на месте, числа
    // перещёлкиваются, клетки карты перекрашиваются, график складывается в новый шаг,
    // список людей перетекает.
    <div className={'stats-body' + (held ? ' stale' : '')} aria-busy={held ? true : undefined}>
      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main">
            <Flip value={hoursNum(shown.openMinutes)} />
          </span>
          <span className="sf-of">{`${hoursNumWord(shown.openMinutes)} спейс был открыт`}</span>
        </div>
        {/* У «всего времени» прошлого периода нет: сравнение сворачивается по высоте,
            а не пропадает вместе с половиной карточки в одном кадре. */}
        <Collapse open={prev !== null}>
          {/* Прошлый период — только строкой текста. Второй полосой он читался
              как самостоятельная метрика, хотя это всего лишь «было столько». */}
          <div className="compare-bar">
            <i style={{ width: `${(shown.openMinutes / compareMax) * 100}%` }} />
          </div>
          <div className="stats-note">
            <XText
              text={
                Math.abs(deltaMinutes) < 30
                  ? 'Столько же, сколько периодом раньше'
                  : nb(`На ${hoursWord(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? 'больше' : 'меньше'}, чем периодом раньше`)
              }
            />
          </div>
        </Collapse>
        <Sep />
        {/* Человекочасы отдельной цифрой со своей подписью, как пара на экране дня: их
            постоянно путают с часами работы спейса из крупной цифры выше. */}
        <div className="stats-pair">
          <div>
            <div className="sp-num">
              <Flip value={hoursNum(shown.manMinutes)} delay={60} />
            </div>
            <div className="sp-label">{`человеко${hoursNumWord(shown.manMinutes)}`}</div>
          </div>
          <div>
            <div className="sp-num">
              <Flip value={avgShown} delay={120} />
            </div>
            <div className="sp-label">{`${avgWord} в среднем внутри`}</div>
          </div>
        </div>
      </div>

      <HeatCard data={shown} />
      <HoursChart chart={shown.chart} todayKey={boot!.todayKey} />

      <SectionTitle>Кто держит спейс открытым</SectionTitle>
      <div className="card">
        <Crossfade id={shown.period}>
          {top.map((p, i) => personRow(p, i, topMax))}
          {/* Хвост списка раскрывается высотой, а не появляется рывком.
              grid-template-rows 0fr→1fr — единственный способ анимировать
              переход к height: auto без замеров в JS. */}
          <div className={'collapsible' + (allPeople ? ' open' : '')}>
            <div className="collapsible-inner">
              {rest.map((p, i) => personRow(p, i + TOP_PREVIEW, topMax))}
            </div>
          </div>
          {!allPeople && rest.length > 0 ? (
            <>
              <Sep inset="text" />
              <button type="button" className="row tappable" onClick={() => setAllPeople(true)}>
                <span className="row-label" style={{ color: 'var(--blue)' }}>
                  {`Показать всех (${shown.top.length})`}
                </span>
                <div className="row-right">{icons.chevron()}</div>
              </button>
            </>
          ) : null}
        </Crossfade>
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <button type="button" className="row tappable" onClick={() => push('statsDays')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.calendar(16, '#fff')}
          </div>
          <span className="row-label">История по дням</span>
          <div className="row-right">
            <span className="dues-amount stat-count" style={{ color: 'var(--text-3)' }}>
              <Flip value={shown.daysCount} />
            </span>
            {icons.chevron()}
          </div>
        </button>
        <Sep inset="icon" />
        <button
          type="button"
          className="row tappable"
          {...prefetchOnTouch('stats.person', { userId: boot!.me.id, period: 'quarter' })}
          onClick={() => {
            // Из «Моих визитов» вы первым, дальше тот же список.
            const me: PersonRef = { userId: boot!.me.id, label: boot!.me.username ? `@${boot!.me.username}` : boot!.me.name, username: boot!.me.username }
            push('statsPerson', { userId: me.userId, people: [me, ...people.filter((x) => x.userId !== me.userId)], backLabel: 'Статистика' })
          }}
        >
          <div className="row-icon" style={{ background: 'var(--blue)' }}>
            {icons.people()}
          </div>
          <span className="row-label">Мои визиты</span>
          <div className="row-right">
            <span className="dues-amount stat-count" style={{ color: 'var(--text-3)' }}>
              {shown.myMinutes > 0 ? (
                <>
                  <Flip value={hoursNum(shown.myMinutes)} /> ч
                </>
              ) : null}
            </span>
            {icons.chevron()}
          </div>
        </button>
        <WrapRow />
      </div>
    </div>,
  )
}
