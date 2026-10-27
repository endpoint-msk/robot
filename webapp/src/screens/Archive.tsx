import { Fragment, useEffect, useState } from 'react'
import { api, prefetchOnTouch } from '../api'
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
  requestsWord,
  visitsWord,
  weekdayIdx,
  WEEKDAYS_SHORT,
  yearOf,
} from '../dates'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push, useStore } from '../store'
import type { ArchiveResponse, ArchiveWeekSummary, GuestSearchResponse, GuestSummary } from '../types'
import { BackRow, EmptyState, ErrorState, Found, Header, Sep, SectionTitle } from '../components/common'
import { Avatar } from '../components/people'
import { FloatingMonth } from '../components/FloatingMonth'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
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

/** Высота столбика самого людного дня в строке недели, px. */
const BAR_MAX = 26

/**
 * Неделя семью столбиками с понедельника: сколько гостей было в каждый день, по заявкам и
 * без. Шкала общая на весь архив, иначе тихая неделя выглядела бы такой же полной, как
 * людная. Столбики стоят без движения, как графики в статистике.
 */
function WeekBars({ days, max }: { days: number[]; max: number }) {
  const label = days.map((n, i) => `${WEEKDAYS_SHORT[i]} ${n}`).join(', ')
  return (
    <span className="week-bars" role="img" aria-label={`Гости по дням: ${label}`}>
      {days.map((n, i) => (
        <i key={i} className={n > 0 ? undefined : 'zero'} style={n > 0 ? { height: Math.max(5, Math.round((n / max) * BAR_MAX)) } : undefined} />
      ))}
    </span>
  )
}

function ArchiveList({ weeks }: { weeks: ArchiveWeekSummary[] }) {
  // Неделя листается к соседним по времени: старые слева, новые справа, как дни.
  const order = weeks.map((w) => w.weekStart).sort()
  const { data } = useStore()
  const max = Math.max(1, ...weeks.flatMap((w) => w.days))
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
      <FloatingMonth />
      {groups.map((g) => (
        <Fragment key={g.label}>
          <SectionTitle month={g.label}>{g.label}</SectionTitle>
          <div className="card" style={{ marginBottom: 22 }}>
            {g.weeks.map((week, i) => {
              const weekEnd = addDays(week.weekStart, 6)
              const visits = week.days.reduce((n, d) => n + d, 0)
              // Сумма столбиков - визиты недели. Неделя с одними заявками без хоста
              // пришедших не знает, тогда хотя бы сколько было заявок.
              const count = visits > 0 ? visitsWord(visits) : week.total > 0 ? requestsWord(week.total) : ''
              return (
                <Fragment key={week.weekStart}>
                  {i > 0 ? <Sep left={66} /> : null}
                  <button
                    type="button"
                    className="row tappable"
                    {...prefetchOnTouch('archive.week', { weekStart: week.weekStart })}
                    onClick={() => push('archiveWeek', { weekStart: week.weekStart, weeks: order })}
                  >
                    {/* Плитка-календарь: число старта + месяц. Диапазон целиком стоит
                        в заголовке справа, а «20 / –26» в две строки читалось как минус. */}
                    <div className="week-square">
                      <span className="ws-day">{String(dayNum(week.weekStart))}</span>
                      <span className="ws-month">{MONTHS_ABBR[monthIdx(week.weekStart)]}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="week-title">{fmtRange(week.weekStart, weekEnd)}</div>
                      <div className="week-sub">
                        {weeksAgoLabel(week.weekStart, data!.todayKey) + (count ? ` · ${count}` : '')}
                      </div>
                    </div>
                    <div className="row-right">
                      <WeekBars days={week.days} max={max} />
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
  match,
  guests,
  pending,
}: {
  query: string
  /** Запрос, по которому пришли строки (с задержкой набора), а не то, что в поле сейчас. */
  match: string
  guests: GuestSummary[] | null
  pending: boolean
}) {
  // Сервер отбрасывает «@» в начале и ищет по имени, нику и номеру аккаунта. Номер в строке
  // не показан, нашли по нему - строка без подсветки.
  const q = match.trim().replace(/^@/, '')
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
            {i > 0 ? <Sep left={64} /> : null}
            <button
              type="button"
              className="row tappable"
              {...prefetchOnTouch('guest.requests', { userId: g.user.userId })}
              onClick={() => push('guestVisits', { userId: g.user.userId, user: g.user })}
            >
              {/* Базовый .avatar размера не задаёт — без класса строка сплющивает его в полоску. */}
              <Avatar user={g.user} className="req-avatar" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="week-title">
                  <Found text={g.user.name} query={q} />
                </div>
                <div className="week-sub">
                  {g.user.username ? (
                    <>
                      @<Found text={g.user.username} query={q} />
                      {' · '}
                    </>
                  ) : null}
                  {/* Дата не рвётся: иначе число оставалось в конце строки, а месяц уезжал на следующую. */}
                  {`последняя ${fmtShortDate(g.lastDateKey).replace(/ /g, '\u00a0')}`}
                </div>
              </div>
              {/* Визиты из всех записей человека: «был 4 раза из 5 заявок». */}
              <div className="row-right">
                <div className="frac">
                  <span className="approved-count">
                    {icons.check(14, '#34c759')}
                    {String(g.visits)}
                  </span>
                  <span className="count-muted">{`/ ${g.total}`}</span>
                </div>
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
  else if (!weeks.data) body = null
  else if (weeks.data.length === 0)
    body = (
      <div className="card">
        <EmptyState title="Архив пуст" text="Здесь появятся недели с заявками." />
      </div>
    )
  else body = <ArchiveList weeks={weeks.data} />

  const search = found.error ? <ErrorState onRetry={found.reload} /> : <GuestSearch query={query} match={debounced} guests={found.data} pending={found.pending} />

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
      {searching ? (
        search
      ) : (
        // Каркас гаснет поверх пришедших недель, а не пропадает в том же кадре.
        <Swap loading={weeks.loading && !weeks.data} skeleton={weeks.pending ? <ArchiveSkeleton /> : null}>
          {body}
        </Swap>
      )}
    </Screen>
  )
}
