// Карточка человека в журнале: сколько бывает, когда приходит, последние визиты.
// Открывается и на себя (строка «Мои визиты»), и на любого резидента из топа.

import { Fragment } from 'react'
import { action, api } from '../api'
import {
  addDays,
  dayNum,
  fmtDayMonth,
  keyToDate,
  MONTHS_ABBR,
  MONTHS_NOM,
  monthIdx,
  plural,
  WEEKDAYS_SHORT,
  yearOf,
} from '../dates'
import { icons } from '../icons'
import { datePrompt } from '../modals'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { fmtDuration, heatLevel, hoursNum, hoursNumWord, statsAvatarUser } from '../stats'
import { haptic } from '../telegram'
import type { StatsPersonView } from '../types'
import { BackRow, ErrorState, Footnote } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { SkBlock, SkCard, SkGrid, SkQuad, SkRows } from '../components/skeleton'

const DOT_WEEKS = 12

/** Маркер «резидент с самого начала» вместо ключа дня (см. RESIDENT_SINCE_ORIGIN на бэке). */
const ORIGIN = 'origin'

/** Скелет карточки: шапка, четыре показателя, сетка визитов и список последних. */
function PersonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем карточку резидента">
      <div className="person-head">
        <SkBlock w={54} h={54} style={{ borderRadius: '50%' }} />
        <div className="person-head-text">
          <SkBlock w={172} h={26} />
          <SkBlock w={136} h={14} style={{ display: 'block', marginTop: 8 }} />
        </div>
      </div>
      <SkQuad />
      <SkCard title="Когда приходит">
        <SkGrid rows={7} cols={DOT_WEEKS} />
      </SkCard>
      <div className="section-title">Последние визиты</div>
      <SkRows count={4} avatar />
    </div>
  )
}

/**
 * «Резидент с 12 марта». Источников три, в порядке убывания доверия: ручная дата
 * (`manualSince`, её ставит dev), вступление в чат резидентов (`joinedSince` —
 * точный ответ, но Telegram не отдаёт его для создателя чата) и первый визит в
 * журнале — он моложе спейса и у старожилов врёт. У основателей даты нет вовсе —
 * для них `ORIGIN`.
 */
const since = (sinceKey: string): string => {
  if (sinceKey === ORIGIN) return 'Резидент с самого начала'
  if (!sinceKey) return 'Визитов в журнале пока нет'
  const year = yearOf(sinceKey)
  const now = new Date().getUTCFullYear()
  return `Резидент с ${fmtDayMonth(sinceKey)}${year === now ? '' : ` ${year}`}`
}

export function StatsPerson() {
  const { userId, backLabel } = useParams() as { userId: number; backLabel?: string }
  const { data: boot } = useStore()
  const { data, error, pending, reload } = useRemote(
    () => api<StatsPersonView>('stats.person', { userId, period: 'quarter' }),
    [userId],
  )

  const back = <BackRow label={backLabel ?? 'Статистика'} />
  if (error) {
    return (
      <Screen>
        {back}
        <ErrorState onRetry={reload} />
      </Screen>
    )
  }
  // Данных нет только пока идёт первый запрос: `reload` из «Резидент с» держит
  // прошлый ответ на экране, чтобы карточка не мигала спиннером после правки.
  if (!data) {
    return (
      <Screen>
        {back}
        {pending ? <PersonSkeleton /> : null}
      </Screen>
    )
  }

  const isMe = boot!.me.id === userId
  const sinceKey = data.manualSince || data.joinedSince || data.firstDateKey
  const sinceSource = data.manualSince
    ? 'выставлено вручную'
    : data.joinedSince
      ? 'вступление в чат резидентов'
      : 'первый визит в журнале'

  const setSince = async (dateKey: string | null) => {
    const done = await action('stats.residentSince', { userId, dateKey: dateKey ?? '' })
    if (done) {
      haptic('success')
      reload()
    }
  }

  const askSince = async () => {
    const picked = await datePrompt({
      text: 'Резидент с',
      initial: (sinceKey === ORIGIN ? data.joinedSince || data.firstDateKey : sinceKey) || boot!.todayKey,
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
        <Avatar user={statsAvatarUser(data.user)} className="stat-avatar big" profile />
        <div className="person-head-text">
          <div className="title">{isMe ? 'Мои визиты' : data.user.label}</div>
          <div className="subtitle">{since(sinceKey)}</div>
        </div>
      </div>

      <div className="card stats-quad">
        <div className="sq-row">
          <div className="sq-cell">
            <div className="sq-num">{data.visits}</div>
            <div className="sq-label">{`${plural(data.visits, 'визит', 'визита', 'визитов')} за 3 месяца`}</div>
          </div>
          <div className="sq-vsep" />
          <div className="sq-cell">
            <div className="sq-num">{hoursNum(data.minutes)}</div>
            <div className="sq-label">{`${hoursNumWord(data.minutes)} внутри`}</div>
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
                <button
                  type="button"
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
                </button>
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
            <button type="button" className="row tappable" onClick={() => void askSince()}>
              <span className="row-label">
                Дата
                <span className="row-sublabel">{sinceSource}</span>
              </span>
              <div className="row-right">
                <span className={'row-value' + (sinceKey ? '' : ' muted')}>
                  {sinceKey === ORIGIN
                    ? 'с самого начала'
                    : sinceKey
                      ? `${fmtDayMonth(sinceKey)} ${yearOf(sinceKey)}`
                      : '—'}
                </span>
                {icons.chevron()}
              </div>
            </button>
            {data.manualSince === ORIGIN ? null : (
              <>
                <div className="sep" style={{ marginLeft: 14 }} />
                <button type="button" className="row tappable" onClick={() => void setSince(ORIGIN)}>
                  <span className="row-label" style={{ color: 'var(--blue)' }}>
                    С самого начала
                  </span>
                </button>
              </>
            )}
            {data.manualSince ? (
              <>
                <div className="sep" style={{ marginLeft: 14 }} />
                <button type="button" className="row tappable" onClick={() => void setSince(null)}>
                  <span className="row-label" style={{ color: 'var(--blue)' }}>
                    Считать автоматически
                  </span>
                </button>
              </>
            ) : null}
          </div>
          <Footnote>
            По умолчанию берётся вступление в чат резидентов, а если Telegram даты не отдал — первый визит в журнале.
            Ручная дата нужна тем, кто пришёл в спейс раньше и того и другого, а «с самого начала» — тем, с кого спейс
            начинался.
          </Footnote>
        </>
      ) : null}
    </Screen>
  )
}
