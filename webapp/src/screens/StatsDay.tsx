// Один день журнала: сколько спейс был открыт и кто когда внутри был.
// Таймлайн строится по сырым сессиям, поэтому доступен, пока живут месячные файлы.

import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtWeekdayDate } from '../dates'
import { push, useParams } from '../store'
import { fmtDuration, fmtMinutes, gradientFor, initialOf } from '../stats'
import type { StatsDayView } from '../types'
import { BackRow, EmptyState, Footnote, Header, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

/** Сколько делений подписываем на шкале: больше — цифры сливаются на 360px. */
const MAX_TICKS = 7

/** Окно таймлайна: от начала первого визита до конца последнего, по целым часам. */
const rangeOf = (data: StatsDayView): { start: number; end: number } => {
  if (data.rows.length === 0) return { start: 8 * 60, end: 24 * 60 }
  const min = Math.min(...data.rows.map((r) => r.fromMin))
  const max = Math.max(...data.rows.map((r) => r.toMin))
  let start = Math.max(0, Math.floor(min / 60) * 60)
  let end = Math.min(24 * 60, Math.ceil(max / 60) * 60)
  if (end - start < 180) {
    start = Math.max(0, start - 60)
    end = Math.min(24 * 60, end + 60)
  }
  return { start, end }
}

export function StatsDay() {
  const { dateKey, backLabel } = useParams() as { dateKey: string; backLabel?: string }
  const [data, setData] = useState<StatsDayView | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const day = await api<StatsDayView>('stats.day', { dateKey })
        if (alive) setData(day)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [dateKey])

  const back = <BackRow label={backLabel ?? 'История по дням'} />

  if (loading) {
    return (
      <Screen>
        {back}
        <SpinnerCenter />
      </Screen>
    )
  }
  if (!data || data.rows.length === 0) {
    return (
      <Screen>
        {back}
        <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />
        <div className="card">
          <EmptyState title="В этот день отметок не было" />
        </div>
      </Screen>
    )
  }

  const { start, end } = rangeOf(data)
  const span = Math.max(1, end - start)
  const step = Math.ceil(span / 60 / MAX_TICKS) * 60
  const ticks: number[] = []
  for (let t = start; t <= end; t += step) ticks.push(t)
  const pct = (minutes: number): number => ((minutes - start) / span) * 100

  return (
    <Screen>
      {back}
      <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />

      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main sf-mid">{fmtDuration(data.openMinutes)}</span>
        </div>
        <div className="stats-note">{`Открыт с ${data.from} до ${data.to}`}</div>
        <div className="sep" style={{ margin: '14px 0 12px' }} />
        <div className="stats-pair">
          <div>
            <div className="sp-num">{data.people}</div>
            <div className="sp-label">человек за день</div>
          </div>
          <div>
            <div className="sp-num">{data.peak}</div>
            <div className="sp-label">пик одновременно</div>
          </div>
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-title">Кто когда был</div>
        <div className="tl-ticks">
          <div className="tl-name" />
          <div className="tl-track">
            {ticks.map((t) => (
              <span key={t} style={{ left: `${pct(t)}%` }}>
                {fmtMinutes(t)}
              </span>
            ))}
          </div>
        </div>
        {data.rows.map((r, i) => (
          <div
            className="tl-row"
            key={`${r.userId}-${i}`}
            onClick={() => push('statsPerson', { userId: r.userId, backLabel: 'Назад' })}
          >
            <div className="tl-name">
              <div className="avatar-ini small" style={{ background: gradientFor(r.userId) }}>
                {initialOf(r.label)}
              </div>
              <span>{r.label}</span>
            </div>
            <div className="tl-track">
              {ticks.slice(1, -1).map((t) => (
                <i className="tl-grid" key={t} style={{ left: `${pct(t)}%` }} />
              ))}
              <i
                className={'tl-bar' + (r.source === 'mac' ? ' mac' : '')}
                style={{ left: `${pct(r.fromMin)}%`, width: `${Math.max(1.5, pct(r.toMin) - pct(r.fromMin))}%` }}
                title={`${fmtMinutes(r.fromMin)} – ${fmtMinutes(r.toMin)}`}
              />
            </div>
          </div>
        ))}
        <div className="tl-legend">
          <span>
            <i className="tl-swatch" />
            отметился сам
          </span>
          <span>
            <i className="tl-swatch mac" />
            по MAC
          </span>
        </div>
      </div>

      {data.gaps.length > 0 ? (
        <Footnote>
          {`Часть дня данных не было: роутер не отвечал (${data.gaps
            .map((b) => `${String(b * 2).padStart(2, '0')}:00`)
            .join(', ')}). Отметок в это время могло быть больше.`}
        </Footnote>
      ) : null}
    </Screen>
  )
}
