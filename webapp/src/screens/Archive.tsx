import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import {
  addDays,
  dayNum,
  fmtRange,
  fmtShortDate,
  keyToDate,
  monthIdx,
  MONTHS_ABBR,
  MONTHS_NOM,
  plural,
  weekdayIdx,
  yearOf,
} from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import type { ArchiveResponse, ArchiveWeekSummary, GuestSearchResponse, GuestSummary } from '../types'
import { BackRow, EmptyState, Header, Sep, SectionTitle, SpinnerCenter } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'

function weeksAgoLabel(weekStart: string, todayKey: string): string {
  const currentMonday = addDays(todayKey, -weekdayIdx(todayKey))
  const diffWeeks = Math.round(
    (keyToDate(currentMonday).getTime() - keyToDate(weekStart).getTime()) / (7 * 24 * 3600 * 1000),
  )
  if (diffWeeks <= 0) return 'Текущая неделя'
  if (diffWeeks === 1) return 'Прошлая неделя'
  return `${diffWeeks} ${plural(diffWeeks, 'неделю', 'недели', 'недель')} назад`
}

function ArchiveList({ weeks }: { weeks: ArchiveWeekSummary[] }) {
  const { data } = useStore()
  // Группируем недели по месяцу понедельника: «Июль 2026».
  const groups: { label: string; weeks: ArchiveWeekSummary[] }[] = []
  for (const week of weeks) {
    const label = `${MONTHS_NOM[monthIdx(week.weekStart)]} ${yearOf(week.weekStart)}`
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.weeks.push(week)
    else groups.push({ label, weeks: [week] })
  }
  return (
    <>
      {groups.map((g) => (
        <Fragment key={g.label}>
          <SectionTitle>{g.label}</SectionTitle>
          <div className="card" style={{ marginBottom: 22 }}>
            {g.weeks.map((week, i) => {
              const weekEnd = addDays(week.weekStart, 6)
              return (
                <Fragment key={week.weekStart}>
                  {i > 0 ? <Sep left={70} /> : null}
                  <div className="row tappable" onClick={() => push('archiveWeek', { weekStart: week.weekStart })}>
                    {/* Плитка-календарь: число старта + месяц. Диапазон целиком стоит
                        в заголовке справа, а «20 / –26» в две строки читалось как минус. */}
                    <div className="week-square">
                      <span className="ws-day">{String(dayNum(week.weekStart))}</span>
                      <span className="ws-month">{MONTHS_ABBR[monthIdx(week.weekStart)]}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="week-title">{fmtRange(week.weekStart, weekEnd)}</div>
                      <div className="week-sub">{weeksAgoLabel(week.weekStart, data!.todayKey)}</div>
                    </div>
                    <div className="row-right">
                      <div className="approved-count" style={{ fontSize: 14 }}>
                        {icons.check(14, '#34c759')}
                        {String(week.approved)}
                      </div>
                      <span className="count-muted">{`/ ${week.total}`}</span>
                      {icons.chevron()}
                    </div>
                  </div>
                </Fragment>
              )
            })}
          </div>
        </Fragment>
      ))}
    </>
  )
}

/**
 * Поиск по людям поверх архива: недели отвечают на «что было в тот вторник», а этот
 * вход — на «кто такой N и сколько раз он у нас был». Пустой запрос отдаёт всех, кто
 * когда-либо оставлял заявку, от свежих визитов к старым.
 */
function GuestSearch({ query, guests }: { query: string; guests: GuestSummary[] | null }) {
  if (guests === null) return <SpinnerCenter />
  if (guests.length === 0)
    return (
      <div className="card">
        <EmptyState title="Никого не нашли" text={`По запросу «${query}» заявок нет.`} />
      </div>
    )
  return (
    <>
      <SectionTitle>{`Люди · ${guests.length}`}</SectionTitle>
      <div className="card">
        {guests.map((g, i) => (
          <Fragment key={g.user.userId}>
            {i > 0 ? <Sep left={66} /> : null}
            <div
              className="row tappable"
              onClick={() => push('guestVisits', { userId: g.user.userId, user: g.user })}
            >
              {/* Базовый .avatar размера не задаёт — без класса строка сплющивает его в полоску. */}
              <Avatar user={g.user} className="req-avatar" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="week-title">{g.user.name}</div>
                <div className="week-sub">
                  {g.user.username ? `@${g.user.username} · ` : ''}
                  {`последняя ${fmtShortDate(g.lastDateKey)}`}
                </div>
              </div>
              <div className="row-right">
                <div className="approved-count" style={{ fontSize: 14 }}>
                  {icons.check(14, '#34c759')}
                  {String(g.approved)}
                </div>
                <span className="count-muted">{`/ ${g.total}`}</span>
                {icons.chevron()}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; weeks: ArchiveWeekSummary[] }
  | { status: 'error'; message: string }

export function Archive() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [guests, setGuests] = useState<GuestSummary[] | null>(null)
  const searching = query.trim().length > 0

  useEffect(() => {
    let cancelled = false
    api<ArchiveResponse>('archive')
      .then(({ weeks }) => {
        if (!cancelled) setState({ status: 'ok', weeks })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Запрос уходит с задержкой: иначе каждый набранный символ — отдельный round-trip.
  useEffect(() => {
    if (!searching) {
      setGuests(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const data = await api<GuestSearchResponse>('guests.search', { query })
        if (!cancelled) setGuests(data.guests)
      } catch {
        if (!cancelled) setGuests([])
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, searching])

  let body
  if (state.status === 'loading') body = <SpinnerCenter />
  else if (state.status === 'error')
    body = (
      <div className="card">
        <EmptyState title="Не получилось загрузить" text={state.message} />
      </div>
    )
  else if (state.weeks.length === 0)
    body = (
      <div className="card">
        <EmptyState title="Архив пуст" text="Здесь появятся недели с заявками." />
      </div>
    )
  else body = <ArchiveList weeks={state.weeks} />

  return (
    <Screen>
      <BackRow label="Обзор" />
      <Header title="Архив" />
      <div className="search-field">
        {icons.search()}
        <input
          type="search"
          value={query}
          placeholder="Поиск по гостям: имя или @ник"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button className="search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
            {icons.xmark(11, '#fff')}
          </button>
        ) : null}
      </div>
      {searching ? <GuestSearch query={query} guests={guests} /> : body}
    </Screen>
  )
}
