// Статистика присутствия: сколько спейс работал, когда здесь людно, кто его держит
// открытым. Раздел резидентский целиком — сервер проверяет это на каждой ручке.

import { Fragment, useState } from 'react'
import { api } from '../api'
import { plural, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push, useStore } from '../store'
import {
  gradientFor,
  heatCell,
  heatLevel,
  heatSlot,
  heatValue,
  hoursNum,
  hoursNumWord,
  hoursWord,
  initialOf,
} from '../stats'
import type { StatsOverview, StatsPeriod } from '../types'
import { BackRow, EmptyState, ErrorState, Header, SectionTitle, Sep } from '../components/common'
import { Screen } from '../components/Screen'
import { SkBars, SkBlock, SkCard, SkFigure, SkGrid } from '../components/skeleton'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: '3 месяца' },
  { key: 'all', label: 'Всё время' },
]

/** Колонок в тепловой карте: сутки двухчасовыми интервалами. */
const BUCKETS = 12

/** Подписи под колонками карты: каждая вторая, иначе цифры сливаются. */
const HOUR_LABELS = Array.from({ length: BUCKETS }, (_, i) => (i % 2 === 0 ? String(i * 2).padStart(2, '0') : ''))

/** Столбиков в скелете графика месяцев — столько же, сколько отдаёт ручка. */
const SK_BARS = 9

const TOP_PREVIEW = 5

function HeatCard({ data }: { data: StatsOverview }) {
  const [picked, setPicked] = useState<string | null>(null)

  // Значение ячейки читается строкой под картой: hover в вебвью нет, а нативный
  // title на тап не открывается — цвет оставался единственным каналом.
  const readout = (): string | null => {
    if (!picked) return null
    const [dow, bucket] = picked.split('-').map(Number)
    const cell = data.heat.rows.find((r) => r.dow === dow)?.cells[bucket!]
    if (!cell) return null
    const when = `${WEEKDAYS_SHORT[dow!]}, ${heatSlot(bucket!)}`
    if (cell.noData) return `${when} — данных нет, роутер не отвечал`
    if (cell.v <= 0) return `${when} — никого не было`
    return `${when} — в среднем ${heatValue(cell.v)}`
  }

  return (
    <div className="card stats-card">
      <div className="stats-card-title">Когда здесь людно</div>
      <div className="heat">
        {data.heat.rows.map((row) => (
          <div className="heat-row" key={row.dow}>
            <div className="heat-dow">{WEEKDAYS_SHORT[row.dow]}</div>
            {row.cells.map((cell, i) => {
              const key = `${row.dow}-${i}`
              const { className, style } = heatCell(heatLevel(cell.v, data.heat.max), cell.noData)
              return (
                <button
                  key={i}
                  type="button"
                  className={className + (picked === key ? ' picked' : '')}
                  style={style}
                  aria-label={`${WEEKDAYS_SHORT[row.dow]} ${heatSlot(i)}`}
                  onClick={() => setPicked((cur) => (cur === key ? null : key))}
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
      <div className="heat-readout">{readout() ?? 'Нажмите на клетку, чтобы увидеть значение'}</div>
      <div className="heat-legend">
        <span>Среднее число людей внутри</span>
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

function MonthBars({ data }: { data: StatsOverview }) {
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
                onClick={() => setPicked(m.key)}
              >
                <div className="bar-track">
                  {/* Подпись висит над своим столбиком, а не на общей высоте: иначе
                      у низкого месяца между цифрой и столбиком провал в полкарточки. */}
                  {labelled ? (
                    <div className="bar-val" style={{ bottom: `calc(${height}% + 5px)` }}>
                      {hoursNum(m.minutes)}
                    </div>
                  ) : null}
                  {/* Ступени шкалы, а не тон акцента с альфой: у прежней заливки было
                      1.41:1 к карточке, и невыбранные месяцы читались как призраки. */}
                  <i style={{ height: `${height}%`, background: active ? 'var(--heat-5)' : 'var(--heat-3)' }} />
                </div>
                <div className={'bar-label' + (active ? ' on' : '')}>{m.label}</div>
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
        <SkBlock h={6} style={{ display: 'block', marginTop: 18 }} />
        <SkBlock w="70%" style={{ display: 'block', marginTop: 16 }} />
      </div>
      <SkCard title="Когда здесь людно">
        <SkGrid rows={7} cols={BUCKETS} gutter />
      </SkCard>
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
  const { data, error, loading, reload } = useRemote(
    () => api<StatsOverview>('stats.overview', { period }),
    [period],
  )

  // Бегунок едет отдельным слоем: анимировать фон у трёх независимых кнопок
  // нечем — переключение читалось бы как мгновенная перекраска.
  const segmented = (
    <div className="segmented">
      <i className="seg-thumb" style={{ transform: `translateX(${PERIODS.findIndex((p) => p.key === period) * 100}%)` }} />
      {PERIODS.map((p) => (
        <button
          type="button"
          key={p.key}
          className={'seg' + (p.key === period ? ' on' : '')}
          aria-pressed={p.key === period}
          onClick={() => {
            if (p.key !== period) setPeriod(p.key)
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

  if (error) {
    return (
      <Screen>
        {chrome('Журнал присутствия')}
        <ErrorState onRetry={reload} />
      </Screen>
    )
  }

  if (loading && !data) {
    return (
      <Screen>
        {chrome('Журнал присутствия')}
        <StatsSkeleton />
      </Screen>
    )
  }

  if (!data || !data.hasData) {
    return (
      <Screen>
        {chrome('Журнал присутствия')}
        <div className="card">
          <EmptyState
            title="Пока нечего показать"
            text="Журнал наполняется, когда резиденты отмечаются в спейсе. За выбранный период отметок не было."
          />
        </div>
      </Screen>
    )
  }

  const prev = data.prevOpenMinutes
  const compareMax = prev !== null ? Math.max(prev, data.openMinutes, 1) : 0
  const deltaMinutes = prev !== null ? data.openMinutes - prev : 0
  const top = data.top.slice(0, TOP_PREVIEW)
  const rest = data.top.slice(TOP_PREVIEW)
  const topMax = data.top[0]?.minutes ?? 1

  const avgShown = String(data.avgInside).replace('.', ',')
  const avgWord = Number.isInteger(data.avgInside)
    ? plural(data.avgInside, 'человек', 'человека', 'человек')
    : 'человека'

  const personRow = (p: StatsOverview['top'][number], i: number, max: number) => (
    <Fragment key={p.userId}>
      {i > 0 ? <Sep left={60} /> : null}
      <button
        type="button"
        className="row tappable"
        onClick={() => push('statsPerson', { userId: p.userId, backLabel: 'Статистика' })}
      >
        <div className="avatar-ini" style={{ background: gradientFor(p.userId) }}>
          {initialOf(p.label)}
        </div>
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

  return (
    <Screen>
      {chrome(`${data.periodLabel} · журнал присутствия`)}

      {/* key по периоду: смена окна меняет все цифры разом, и без ремаунта с
          проявлением экран просто дёргается новыми числами. */}
      <div className="stats-body" key={data.period}>
      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main">{hoursNum(data.openMinutes)}</span>
          <span className="sf-of">{`${hoursNumWord(data.openMinutes)} спейс был открыт`}</span>
        </div>
        {prev !== null ? (
          <>
            {/* Прошлый период — только строкой текста. Второй полосой он читался
                как самостоятельная метрика, хотя это всего лишь «было столько». */}
            <div className="compare-bar">
              <i style={{ width: `${(data.openMinutes / compareMax) * 100}%` }} />
            </div>
            <div className="stats-note">
              {Math.abs(deltaMinutes) < 30
                ? 'Столько же, сколько периодом раньше'
                : `На ${hoursWord(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? 'больше' : 'меньше'}, чем периодом раньше`}
            </div>
          </>
        ) : null}
        <Sep />
        <div className="stats-note">
          {`Человекочасов ${hoursNum(data.manMinutes)}, в среднем ${avgShown} ${avgWord} внутри`}
        </div>
      </div>

      <HeatCard data={data} />
      <MonthBars data={data} />

      <SectionTitle>Кто держит спейс открытым</SectionTitle>
      <div className="card">
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
                {`Показать всех (${data.top.length})`}
              </span>
              <div className="row-right">{icons.chevron()}</div>
            </button>
          </>
        ) : null}
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <button type="button" className="row tappable" onClick={() => push('statsDays')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.calendar(16, '#fff')}
          </div>
          <span className="row-label">История по дням</span>
          <div className="row-right">
            <span className="dues-amount" style={{ color: 'var(--text-3)' }}>
              {data.daysCount}
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
            <span className="dues-amount" style={{ color: 'var(--text-3)' }}>
              {data.myMinutes > 0 ? `${hoursNum(data.myMinutes)} ч` : ''}
            </span>
            {icons.chevron()}
          </div>
        </button>
      </div>
      </div>
    </Screen>
  )
}
