// Статистика присутствия: сколько спейс работал, когда здесь людно, кто его держит
// открытым. Раздел резидентский целиком — сервер проверяет это на каждой ручке.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { plural, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { markOwnTap, spring } from '../motion'
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
} from '../stats'
import { haptic } from '../telegram'
import type { StatsOverview, StatsPeriod } from '../types'
import { BackRow, EmptyState, ErrorState, Header, SectionTitle, Sep } from '../components/common'
import { Collapse } from '../components/Collapse'
import { Crossfade } from '../components/Crossfade'
import { Flip, XText } from '../components/Flip'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkBars, SkBlock, SkCard, SkFigure, SkGrid } from '../components/skeleton'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: '3 месяца' },
  { key: 'all', label: 'Всё время' },
]

/** Почти без перелёта: бегунок должен доехать, а не подпрыгнуть. */
const THUMB_SPRING = { response: 0.3, damping: 0.86 }

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

/** Столбиков в скелете графика месяцев — столько же, сколько отдаёт ручка. */
const SK_BARS = 9

const TOP_PREVIEW = 5

function HeatCard({ data }: { data: StatsOverview }) {
  const [picked, setPicked] = useState<{ dow: number; bucket: number } | null>(null)

  const pick = (dow: number, bucket: number): void => {
    setPicked((cur) => (cur && cur.dow === dow && cur.bucket === bucket ? null : { dow, bucket }))
    haptic.tick()
  }

  // Значение ячейки читается строкой над картой: hover в вебвью нет, нативный title
  // на тап не открывается, а строку под картой закрывала бы рука. Пока ничего не
  // выбрано, строка подписывает саму шкалу.
  const readout = (): ReactNode => {
    const cell = picked ? data.heat.rows.find((r) => r.dow === picked.dow)?.cells[picked.bucket] : undefined
    if (!picked || !cell) return 'Среднее число людей внутри'
    const value = cell.noData
      ? 'данных нет, роутер не отвечал'
      : cell.v <= 0
        ? 'никого не было'
        : `в среднем ${heatValue(cell.v)}`
    return (
      <>
        <b>{`${WEEKDAYS_SHORT[picked.dow]}, ${heatSlot(picked.bucket)}`}</b>
        {` · ${value}`}
      </>
    )
  }

  return (
    <div className="card stats-card">
      <div className="heat-head">
        <div className="stats-card-title">Когда здесь людно</div>
        <div className="heat-readout">{readout()}</div>
      </div>
      <div className="heat">
        {data.heat.rows.map((row) => (
          <div className="heat-row" key={row.dow}>
            <div className="heat-dow">{WEEKDAYS_SHORT[row.dow]}</div>
            {row.cells.map((cell, i) => {
              const on = picked !== null && picked.dow === row.dow && picked.bucket === i
              const { className, style } = heatCell(heatLevel(cell.v, data.heat.max), cell.noData)
              return (
                <button
                  key={i}
                  type="button"
                  className={className + (on ? ' picked' : '')}
                  style={style}
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

function MonthBars({ data, nowKey }: { data: StatsOverview; nowKey: string }) {
  const [picked, setPicked] = useState<string | null>(null)
  const peak = data.months.reduce((a, m) => (m.minutes > a.minutes ? m : a), data.months[0]!)
  const { top, ticks } = axisOf(Math.max(...data.months.map((m) => m.minutes)) / 60)

  return (
    <div className="card stats-card">
      <div className="stats-card-title">Часы по месяцам</div>
      <div className="bars-plot">
        <div className="bars-grid">
          {ticks.map((t) => (
            <Fragment key={t}>
              <div className={t === 0 ? 'bar-base' : 'bar-grid'} style={{ top: `${100 - (t / top) * 100}%` }} />
              <div className="bar-ytick" style={{ top: `${100 - (t / top) * 100}%` }}>
                {t}
              </div>
            </Fragment>
          ))}
        </div>
        <div className="bars">
          {data.months.map((m) => {
            // Ничего не выбрано, пока не тапнули: подсвеченный по умолчанию месяц
            // читается как выбор, которого пользователь не делал.
            const active = picked === m.key
            const height = Math.max(m.minutes > 0 ? 2 : 0, (m.minutes / 60 / top) * 100)
            // Подпись всегда одна: пик — пока выбора нет, дальше только выбранный.
            const labelled = active || (!picked && m.key === peak.key && m.minutes > 0)
            return (
              <button
                type="button"
                className="bar-col"
                key={m.key}
                aria-pressed={active}
                onClick={() => {
                  if (active) return
                  setPicked(m.key)
                  haptic.tick()
                }}
              >
                <div className="bar-track">
                  {/* Подпись висит над своим столбиком, а не на общей высоте: иначе
                      у низкого месяца между цифрой и столбиком провал в полкарточки. */}
                  {labelled ? (
                    <div className={'bar-val' + (active ? ' on' : '')} style={{ bottom: `calc(${height}% + 5px)` }}>
                      {hoursNum(m.minutes)}
                    </div>
                  ) : null}
                  {/* Ступени шкалы, а не тон акцента с альфой: у прежней заливки было
                      1.41:1 к карточке, и невыбранные месяцы читались как призраки. */}
                  <i style={{ height: `${height}%`, background: active ? 'var(--heat-5)' : 'var(--heat-3)' }} />
                </div>
                <div className={'bar-label' + (m.key === nowKey ? ' now' : '') + (active ? ' on' : '')}>
                  {m.label}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Скелет экрана: сводка, карта и график месяцев — тот же каркас, что у данных.
 * Волна по диагонали карты и по столбикам заодно показывает, что запрос ещё жив.
 */
function StatsSkeleton() {
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
      <SkCard title="Часы по месяцам">
        <SkBars count={SK_BARS} />
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
      {segmented}
    </>
  )

  // Меняется только тело — его и подменяет Swap: каркас гаснет поверх проявляющихся
  // данных. Раньше он пропадал в том же кадре, и переход читался как рывок.
  const frame = (subtitle: string, body: ReactNode) => (
    <Screen>
      {chrome(subtitle)}
      <Swap loading={loading && !shown} skeleton={pending ? <StatsSkeleton /> : null}>
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

  const personRow = (p: StatsOverview['top'][number], i: number, max: number) => (
    <Fragment key={p.userId}>
      {i > 0 ? <Sep left={60} /> : null}
      <button
        type="button"
        className="row tappable"
        onClick={() => push('statsPerson', { userId: p.userId, backLabel: 'Статистика' })}
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
    // перещёлкиваются, клетки карты перекрашиваются, список людей перетекает.
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
                  : `На ${hoursWord(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? 'больше' : 'меньше'}, чем периодом раньше`
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
      <MonthBars data={shown} nowKey={boot!.todayKey.slice(0, 7)} />

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
              <Sep left={14} />
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
        <Sep left={54} />
        <button
          type="button"
          className="row tappable"
          onClick={() => push('statsPerson', { userId: boot!.me.id, backLabel: 'Статистика' })}
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
      </div>
    </div>,
  )
}
