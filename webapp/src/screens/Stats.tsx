// Статистика присутствия: сколько спейс работал, когда здесь людно, кто его держит
// открытым. Раздел резидентский целиком — сервер проверяет это на каждой ручке.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { gradientFor, heatBg, HEAT_NO_DATA, hoursNum, hoursWord, initialOf } from '../stats'
import type { StatsOverview, StatsPeriod } from '../types'
import { BackRow, EmptyState, Header, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: '3 месяца' },
  { key: 'all', label: 'Всё время' },
]

/** Подписи под колонками карты: каждая вторая, иначе цифры сливаются. */
const HOUR_LABELS = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? String(i * 2).padStart(2, '0') : ''))

const TOP_PREVIEW = 5

function HeatCard({ data }: { data: StatsOverview }) {
  return (
    <div className="card stats-card">
      <div className="stats-card-title">Когда здесь людно</div>
      <div className="heat">
        {data.heat.rows.map((row) => (
          <div className="heat-row" key={row.dow}>
            <div className="heat-dow">{WEEKDAYS_SHORT[row.dow]}</div>
            {row.cells.map((cell, i) => (
              <div
                key={i}
                className="heat-cell"
                style={{ background: heatBg(cell.v, data.heat.max, cell.noData) }}
                title={cell.noData ? 'Данных нет' : `${WEEKDAYS_SHORT[row.dow]} ${String(i * 2).padStart(2, '0')}:00 — ${cell.v}`}
              />
            ))}
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
        <span>Среднее число людей внутри</span>
        <div className="heat-scale">
          <span>меньше</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((k) => (
            <i key={k} style={{ background: heatBg(k * data.heat.max, data.heat.max) }} />
          ))}
          <span>больше</span>
        </div>
      </div>
      <div className="heat-legend">
        <i className="heat-swatch" style={{ background: HEAT_NO_DATA }} />
        <span>роутер был недоступен</span>
      </div>
    </div>
  )
}

function MonthBars({ data }: { data: StatsOverview }) {
  const [picked, setPicked] = useState<string | null>(null)
  const max = Math.max(...data.months.map((m) => m.minutes), 1)
  const current = data.months[data.months.length - 1]?.key
  return (
    <div className="card stats-card">
      <div className="stats-card-title">Часы по месяцам</div>
      <div className="bars">
        {data.months.map((m) => {
          const active = picked ? picked === m.key : m.key === current
          const height = Math.max(m.minutes > 0 ? 3 : 0, (m.minutes / max) * 100)
          return (
            <div className="bar-col" key={m.key} onClick={() => setPicked(m.key)}>
              <div className="bar-track">
                {/* Подпись висит над своим столбиком, а не на общей высоте: иначе
                    у низкого месяца между цифрой и столбиком провал в полкарточки. */}
                {active && m.minutes > 0 ? (
                  <div className="bar-val" style={{ bottom: `calc(${height}% + 5px)` }}>
                    {hoursNum(m.minutes)}
                  </div>
                ) : null}
                <i
                  style={{
                    height: `${height}%`,
                    background: active ? 'var(--blue)' : 'rgba(10, 132, 255, 0.28)',
                  }}
                />
              </div>
              <div className={'bar-label' + (active ? ' on' : '')}>{m.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Stats() {
  const { data: boot } = useStore()
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const [data, setData] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [allPeople, setAllPeople] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const overview = await api<StatsOverview>('stats.overview', { period })
        if (alive) setData(overview)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [period])

  // Бегунок едет отдельным слоем: анимировать фон у трёх независимых кнопок
  // нечем — переключение читалось бы как мгновенная перекраска.
  const segmented = (
    <div className="segmented">
      <i className="seg-thumb" style={{ transform: `translateX(${PERIODS.findIndex((p) => p.key === period) * 100}%)` }} />
      {PERIODS.map((p) => (
        <div
          key={p.key}
          className={'seg' + (p.key === period ? ' on' : '')}
          onClick={() => {
            if (p.key !== period) setPeriod(p.key)
          }}
        >
          {p.label}
        </div>
      ))}
    </div>
  )

  if (loading && !data) {
    return (
      <Screen>
        <BackRow label="Ближайшие дни" />
        <Header title="Статистика" />
        {segmented}
        <SpinnerCenter />
      </Screen>
    )
  }

  if (!data || !data.hasData) {
    return (
      <Screen>
        <BackRow label="Ближайшие дни" />
        <Header title="Статистика" subtitle="Журнал присутствия" />
        {segmented}
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

  const personRow = (p: StatsOverview['top'][number], i: number, max: number) => (
    <Fragment key={p.userId}>
      {i > 0 ? <Sep left={60} /> : null}
      <div className="row tappable" onClick={() => push('statsPerson', { userId: p.userId, backLabel: 'Статистика' })}>
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
      </div>
    </Fragment>
  )

  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
      <Header title="Статистика" subtitle={`${data.periodLabel} · журнал присутствия`} />
      {segmented}

      {/* key по периоду: смена окна меняет все цифры разом, и без ремаунта с
          проявлением экран просто дёргается новыми числами. */}
      <div className="stats-body" key={data.period}>
      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main">{hoursNum(data.openMinutes)}</span>
          <span className="sf-of">часов спейс был открыт</span>
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
                : `${deltaMinutes > 0 ? 'На' : 'На'} ${hoursWord(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? 'больше' : 'меньше'}, чем периодом раньше`}
            </div>
          </>
        ) : null}
        <Sep />
        <div className="stats-note">
          {`Человекочасов ${hoursNum(data.manMinutes)}, в среднем ${String(data.avgInside).replace('.', ',')} человека внутри`}
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
            <div className="row tappable" onClick={() => setAllPeople(true)}>
              <span className="row-label" style={{ color: 'var(--blue)' }}>
                {`Показать всех (${data.top.length})`}
              </span>
              <div className="row-right">{icons.chevron()}</div>
            </div>
          </>
        ) : null}
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <div className="row tappable" onClick={() => push('statsDays')}>
          <div className="row-icon" style={{ background: '#5856d6' }}>
            {icons.calendar(16, '#fff')}
          </div>
          <span className="row-label">История по дням</span>
          <div className="row-right">
            <span className="dues-amount" style={{ color: 'var(--text-3)' }}>
              {data.daysCount}
            </span>
            {icons.chevron()}
          </div>
        </div>
        <Sep left={54} />
        <div
          className="row tappable"
          onClick={() => push('statsPerson', { userId: boot!.me.id, backLabel: 'Статистика' })}
        >
          <div className="row-icon" style={{ background: '#007aff' }}>
            {icons.people()}
          </div>
          <span className="row-label">Мои визиты</span>
          <div className="row-right">
            <span className="dues-amount" style={{ color: 'var(--text-3)' }}>
              {data.myMinutes > 0 ? `${hoursNum(data.myMinutes)} ч` : ''}
            </span>
            {icons.chevron()}
          </div>
        </div>
      </div>
      </div>
    </Screen>
  )
}
