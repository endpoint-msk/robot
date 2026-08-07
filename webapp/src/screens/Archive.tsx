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
import { useRemote } from '../remote'
import { push, useStore } from '../store'
import type { ArchiveResponse, ArchiveWeekSummary, GuestSearchResponse, GuestSummary } from '../types'
import { BackRow, EmptyState, ErrorState, Header, Sep, SectionTitle } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { SkBlock, SkRows } from '../components/skeleton'

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
                  <button
                    type="button"
                    className="row tappable"
                    onClick={() => push('archiveWeek', { weekStart: week.weekStart })}
                  >
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
                  </button>
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
 * Каркас списка недель: месяцы группами, в строке плитка-календарь и диапазон дат.
 * Плитка собрана из SkBlock, а не взята кружком из SkRows: людей в этом списке нет,
 * и круглый аватар обещал бы не тот экран.
 */
function ArchiveSkeleton() {
  const group = (key: string, count: number, from: number) => (
    <Fragment key={key}>
      <SectionTitle>
        <SkBlock w={92} h={11} />
      </SectionTitle>
      <div className="card sk-list" style={{ marginBottom: 22 }}>
        {Array.from({ length: count }, (_, i) => (
          <div className="sk-row" key={i} style={{ animationDelay: `${(from + i) * 90}ms` }}>
            <SkBlock w={42} h={42} style={{ borderRadius: 12, flexShrink: 0 }} />
            <div className="sk-lines">
              <SkBlock w={`${58 - (i % 3) * 8}%`} h={13} />
              <SkBlock w={`${38 - (i % 3) * 5}%`} h={11} />
            </div>
            <SkBlock w={44} h={13} style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </Fragment>
  )
  return (
    <div aria-busy="true" aria-label="Загружаем архив недель">
      {group('a', 4, 0)}
      {group('b', 3, 4)}
    </div>
  )
}

/**
 * Поиск по людям поверх архива: недели отвечают на «что было в тот вторник», а этот
 * вход — на «кто такой N и сколько раз он у нас был». Пустой запрос отдаёт всех, кто
 * когда-либо оставлял заявку, от свежих визитов к старым.
 */
function GuestSearch({
  query,
  guests,
  pending,
}: {
  query: string
  guests: GuestSummary[] | null
  pending: boolean
}) {
  // Скелет тут короткий: это блок результатов внутри экрана, а не сам экран, и
  // на весь его рост он читался бы как загрузка всего архива заново.
  if (guests === null) {
    if (!pending) return null
    return (
      <div aria-busy="true" aria-label="Ищем людей">
        <SectionTitle>
          <SkBlock w={72} h={11} />
        </SectionTitle>
        <SkRows count={3} avatar tail />
      </div>
    )
  }
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
            <button
              type="button"
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
            </button>
          </Fragment>
        ))}
      </div>
    </>
  )
}

export function Archive() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const searching = query.trim().length > 0
  const weeks = useRemote(async () => (await api<ArchiveResponse>('archive')).weeks, [])

  // Запрос уходит с задержкой: иначе каждый набранный символ — отдельный round-trip.
  useEffect(() => {
    if (!searching) {
      setDebounced('')
      return
    }
    const timer = window.setTimeout(() => setDebounced(query), 250)
    return () => window.clearTimeout(timer)
  }, [query, searching])

  const found = useRemote<GuestSummary[] | null>(
    async () => (debounced ? (await api<GuestSearchResponse>('guests.search', { query: debounced })).guests : null),
    [debounced],
  )

  let body
  if (weeks.error) body = <ErrorState onRetry={weeks.reload} />
  else if (!weeks.data) body = weeks.pending ? <ArchiveSkeleton /> : null
  else if (weeks.data.length === 0)
    body = (
      <div className="card">
        <EmptyState title="Архив пуст" text="Здесь появятся недели с заявками." />
      </div>
    )
  else body = <ArchiveList weeks={weeks.data} />

  const search = found.error ? <ErrorState onRetry={found.reload} /> : <GuestSearch query={query} guests={found.data} pending={found.pending} />

  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
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
          <button type="button" className="search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
            {icons.xmark(11, '#fff')}
          </button>
        ) : null}
      </div>
      {searching ? search : body}
    </Screen>
  )
}
