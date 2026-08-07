// Карточка человека в журнале: сколько бывает, когда приходит, последние визиты.
// Открывается и на себя (строка «Мои визиты»), и на любого резидента из топа.

import { Fragment, useEffect, useState } from 'react'
import { action, api } from '../api'
import {
  addDays,
  dayNum,
  fmtDayMonth,
  keyToDate,
  MONTHS_ABBR,
  MONTHS_NOM,
  monthIdx,
  WEEKDAYS_SHORT,
  yearOf,
} from '../dates'
import { icons } from '../icons'
import { datePrompt } from '../modals'
import { push, useParams, useStore } from '../store'
import { fmtDuration, gradientFor, heatLevel, hoursNum, initialOf } from '../stats'
import { haptic } from '../telegram'
import type { StatsPersonView } from '../types'
import { BackRow, EmptyState, Footnote, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

const DOT_WEEKS = 12

/**
 * «Резидент с 12 марта» — дата первого визита в журнале, а не вступления в чат:
 * даты вступления Telegram для обычных участников не отдаёт вовсе. Тех, кто пришёл
 * в спейс раньше журнала, дата врёт — поэтому dev может выставить её руками
 * (`manualSince`), и тогда она перебивает расчёт.
 */
const since = (sinceKey: string): string => {
  if (!sinceKey) return 'Визитов в журнале пока нет'
  const year = yearOf(sinceKey)
  const now = new Date().getUTCFullYear()
  return `Резидент с ${fmtDayMonth(sinceKey)}${year === now ? '' : ` ${year}`}`
}

export function StatsPerson() {
  const { userId, backLabel } = useParams() as { userId: number; backLabel?: string }
  const { data: boot } = useStore()
  const [data, setData] = useState<StatsPersonView | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

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
  }, [userId, tick])

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
  const sinceKey = data.manualSince || data.firstDateKey

  const setSince = async (dateKey: string | null) => {
    const done = await action('stats.residentSince', { userId, dateKey: dateKey ?? '' })
    if (done) {
      haptic('success')
      setTick((n) => n + 1)
    }
  }

  const askSince = async () => {
    const picked = await datePrompt({
      text: 'Резидент с',
      initial: sinceKey || boot!.todayKey,
      max: boot!.todayKey,
    })
    if (picked) await setSince(picked)
  }

  const dotMax = Math.max(...data.dots, 1)
  // Столбец — неделя, строка — день недели: как в сетке дизайна (grid-auto-flow: column).
  const dotCells = Array.from({ length: DOT_WEEKS * 7 }, (_, i) => data.dots[i] ?? 0)
  // Дни после сегодняшнего в сетку не попадают: «ещё не наступило» и «не приходил» —
  // разные вещи, а рисовались они одинаково пустой клеткой.
  const todayIndex = Math.round((keyToDate(boot!.todayKey).getTime() - keyToDate(data.dotsFrom).getTime()) / 86_400_000)
  // Подпись месяца над колонкой, в которой он начинается: без неё сетка показывает
  // ритм, но не отвечает, когда это было. Берём середину недели — месяц, которому
  // принадлежит большая её часть.
  const monthLabels = (() => {
    const seen = new Set<number>()
    return Array.from({ length: DOT_WEEKS }, (_, w) => {
      const month = monthIdx(addDays(data.dotsFrom, w * 7 + 3))
      if (seen.has(month)) return ''
      seen.add(month)
      // Именительный падеж: MONTHS_ABBR держит «мая» под плитку «5 мая», а на оси
      // нужен «май».
      return MONTHS_NOM[month]?.slice(0, 3).toLowerCase() ?? ''
    })
  })()

  return (
    <Screen>
      {back}
      <div className="person-head">
        <div className="avatar-ini big" style={{ background: gradientFor(userId) }}>
          {initialOf(data.user.label)}
        </div>
        <div className="person-head-text">
          <div className="title">{isMe ? 'Мои визиты' : data.user.label}</div>
          <div className="subtitle">{since(sinceKey)}</div>
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
        <div className="dots-months">
          {monthLabels.map((label, i) => (
            <div key={i}>{label}</div>
          ))}
        </div>
        <div className="dots">
          <div className="dots-labels">
            {WEEKDAYS_SHORT.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="dots-grid">
            {dotCells.map((v, i) => {
              if (i > todayIndex) return <div key={i} className="dot future" />
              const level = heatLevel(v, dotMax)
              return (
                <div
                  key={i}
                  className={'dot' + (level === 0 ? ' zero' : '')}
                  style={level > 0 ? { background: `var(--heat-${level})` } : undefined}
                />
              )
            })}
          </div>
        </div>
        <div className="heat-legend">
          <span>Последние 12 недель</span>
          <div className="heat-scale">
            <span>меньше</span>
            {[1, 2, 3, 4, 5].map((level) => (
              <i key={level} style={{ background: `var(--heat-${level})` }} />
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

      {boot!.me.isDev ? (
        <>
          <div className="section-title">Резидент с</div>
          <div className="card">
            <div className="row tappable" onClick={() => void askSince()}>
              <span className="row-label">
                Дата
                <span className="row-sublabel">
                  {data.manualSince ? 'выставлено вручную' : 'первый визит в журнале'}
                </span>
              </span>
              <div className="row-right">
                <span className={'row-value' + (sinceKey ? '' : ' muted')}>
                  {sinceKey ? `${fmtDayMonth(sinceKey)} ${yearOf(sinceKey)}` : '—'}
                </span>
                {icons.chevron()}
              </div>
            </div>
            {data.manualSince ? (
              <>
                <div className="sep" style={{ marginLeft: 14 }} />
                <div className="row tappable" onClick={() => void setSince(null)}>
                  <span className="row-label" style={{ color: 'var(--blue)' }}>
                    Считать по журналу
                  </span>
                </div>
              </>
            ) : null}
          </div>
          <Footnote>
            По умолчанию берётся первый визит в журнале. Ручная дата нужна тем, кто пришёл в спейс раньше, чем появился
            журнал.
          </Footnote>
        </>
      ) : null}
    </Screen>
  )
}
