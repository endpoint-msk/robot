// Карточка человека в журнале: сколько бывает, когда приходит, последние визиты.
// Открывается и на себя (строка «Мои визиты»), и на любого резидента из топа.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { dayNum, fmtDayMonth, MONTHS_ABBR, monthIdx, WEEKDAYS_SHORT, yearOf } from '../dates'
import { icons } from '../icons'
import { push, useParams, useStore } from '../store'
import { fmtDuration, gradientFor, heatBg, hoursNum, initialOf } from '../stats'
import type { StatsPersonView } from '../types'
import { BackRow, EmptyState, Footnote, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

const DOT_WEEKS = 12

/**
 * «Резидент с 12 марта» — дата первого визита в журнале, а не вступления в чат:
 * даты вступления Telegram для обычных участников не отдаёт вовсе.
 */
const since = (firstDateKey: string): string => {
  if (!firstDateKey) return 'Визитов в журнале пока нет'
  const year = yearOf(firstDateKey)
  const now = new Date().getUTCFullYear()
  return `Резидент с ${fmtDayMonth(firstDateKey)}${year === now ? '' : ` ${year}`}`
}

export function StatsPerson() {
  const { userId, backLabel } = useParams() as { userId: number; backLabel?: string }
  const { data: boot } = useStore()
  const [data, setData] = useState<StatsPersonView | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const person = await api<StatsPersonView>('stats.person', { userId, period: 'quarter' })
        if (alive) setData(person)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [userId])

  const back = <BackRow label={backLabel ?? 'Статистика'} />
  if (loading) {
    return (
      <Screen>
        {back}
        <SpinnerCenter />
      </Screen>
    )
  }
  if (!data) {
    return (
      <Screen>
        {back}
        <div className="card">
          <EmptyState title="Не получилось загрузить" />
        </div>
      </Screen>
    )
  }

  const isMe = boot!.me.id === userId
  const dotMax = Math.max(...data.dots, 1)
  // Столбец — неделя, строка — день недели: как в сетке дизайна (grid-auto-flow: column).
  const dotCells = Array.from({ length: DOT_WEEKS * 7 }, (_, i) => data.dots[i] ?? 0)

  return (
    <Screen>
      {back}
      <div className="person-head">
        <div className="avatar-ini big" style={{ background: gradientFor(userId) }}>
          {initialOf(data.user.label)}
        </div>
        <div className="person-head-text">
          <div className="title">{isMe ? 'Мои визиты' : data.user.label}</div>
          <div className="subtitle">{since(data.firstDateKey)}</div>
        </div>
      </div>

      <div className="card stats-quad">
        <div className="sq-row">
          <div className="sq-cell">
            <div className="sq-num">{data.visits}</div>
            <div className="sq-label">визитов за 3 месяца</div>
          </div>
          <div className="sq-vsep" />
          <div className="sq-cell">
            <div className="sq-num">{hoursNum(data.minutes)}</div>
            <div className="sq-label">часов внутри</div>
          </div>
        </div>
        <div className="sep" style={{ margin: '0 16px' }} />
        <div className="sq-row">
          <div className="sq-cell">
            <div className="sq-num small">{data.avgMinutes > 0 ? fmtDuration(data.avgMinutes) : '—'}</div>
            <div className="sq-label">средний визит</div>
          </div>
          <div className="sq-vsep" />
          <div className="sq-cell">
            <div className="sq-num small">{data.favArrival || '—'}</div>
            <div className="sq-label">обычно приходит</div>
          </div>
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-title">Когда приходит</div>
        <div className="dots">
          <div className="dots-labels">
            {WEEKDAYS_SHORT.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="dots-grid">
            {dotCells.map((v, i) => (
              <div key={i} className="dot" style={{ background: heatBg(v, dotMax) }} />
            ))}
          </div>
        </div>
        <div className="heat-legend">
          <span>Последние 12 недель</span>
          <div className="heat-scale">
            <span>меньше</span>
            {[0.2, 0.4, 0.6, 0.8, 1].map((k) => (
              <i key={k} style={{ background: heatBg(k, 1) }} />
            ))}
            <span>больше</span>
          </div>
        </div>
      </div>

      {data.lastVisits.length > 0 ? (
        <>
          <div className="section-title">Последние визиты</div>
          <div className="card">
            {data.lastVisits.map((v, i) => (
              <Fragment key={`${v.dateKey}-${v.from}`}>
                {i > 0 ? <div className="sep" style={{ marginLeft: 68 }} /> : null}
                <div
                  className="row tappable"
                  onClick={() => push('statsDay', { dateKey: v.dateKey, backLabel: 'Назад' })}
                >
                  <div className="date-tile">
                    <span className="dt-num">{dayNum(v.dateKey)}</span>
                    <span className="dt-sub">{MONTHS_ABBR[monthIdx(v.dateKey)]}</span>
                  </div>
                  <span className="row-label">
                    {fmtDuration(v.minutes)}
                    <span className="row-sublabel">
                      {`${v.from} – ${v.to} · ${v.source === 'mac' ? 'по MAC' : 'отметился сам'}`}
                    </span>
                  </span>
                  <div className="row-right">{icons.chevron()}</div>
                </div>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}

      {isMe && boot!.settings && !boot!.settings.logVisits ? (
        <Footnote>Журнал ваших визитов выключен в настройках, поэтому новые визиты сюда не попадают.</Footnote>
      ) : null}
    </Screen>
  )
}
