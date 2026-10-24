import { Fragment } from 'react'
import { api } from '../api'
import { addDays, fmtRange, requestsWord } from '../dates'
import { useRemote } from '../remote'
import { stageTint } from '../motion'
import { push, setTopParams, useParams, useStore } from '../store'
import type { ArchiveWeekResponse } from '../types'
import { BackRow, EmptyState, ErrorState, ReadonlyBadge, Sep } from '../components/common'
import { DayRow } from '../components/DayRow'
import { Pager } from '../components/Pager'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkBlock } from '../components/skeleton'

/** Дней с заявками в неделе обычно меньше семи: рисуем типичную, а не полную неделю. */
const SK_DAYS = 5

/**
 * Каркас недели: строка дня — колонка даты слева, лица и счётчик посередине.
 * Собран из SkBlock, потому что готовой строки с датой вместо аватара в наборе нет.
 */
function WeekSkeleton() {
  return (
    <div className="card sk-list" aria-busy="true" aria-label="Загружаем неделю">
      {Array.from({ length: SK_DAYS }, (_, i) => (
        <div className="sk-row" key={i} style={{ animationDelay: `${i * 90}ms` }}>
          <div className="day-col">
            <SkBlock w={30} h={18} />
            <SkBlock w={46} h={13} style={{ display: 'block', marginTop: 4 }} />
          </div>
          <div className="day-people">
            <div className="avatar-stack">
              <SkBlock w={26} h={26} style={{ borderRadius: '50%' }} />
              <SkBlock w={26} h={26} style={{ borderRadius: '50%', marginLeft: -8, boxShadow: '0 0 0 2px var(--card)' }} />
            </div>
            <SkBlock w={88} h={13} />
          </div>
          <SkBlock w={26} h={13} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

/**
 * Недели листаются той же листалкой, что дни, если их открыли из архива (`weeks` в
 * параметрах): соседняя неделя справа, как следующий день у листалки дня. Тон нейтральный.
 */
export function ArchiveWeek() {
  const params = useParams()
  const weekStart = params.weekStart as string
  const weeks = (params.weeks as string[] | undefined) ?? null
  const index = weeks ? weeks.indexOf(weekStart) : -1
  if (!weeks || index < 0 || weeks.length < 2) {
    return (
      <Screen>
        <BackRow label="Архив" />
        <WeekPage weekStart={weekStart} />
      </Screen>
    )
  }
  return (
    <Screen>
      <Pager
        items={weeks}
        index={index}
        keyOf={(w) => w}
        onCommit={(i) => setTopParams({ ...params, weekStart: weeks[i]! })}
        tone={() => stageTint('gray')}
        top={<BackRow label="Архив" />}
        renderPage={(w) => <WeekPage weekStart={w} />}
      />
    </Screen>
  )
}

function WeekPage({ weekStart }: { weekStart: string }) {
  const weekEnd = addDays(weekStart, 6)
  const boot = useStore().data!
  // Вчерашний вечер до утра отмечают отсюда, в том числе гостей без заявки в день, на
  // который заявок не было: такой день стоит в списке и пустым. Неделя с ним или с
  // сегодняшним днём правится, и «только просмотр» над ней был бы неправдой.
  const grace = boot.visitGraceDay ?? null
  const live = [boot.todayKey, grace].some((k) => k !== null && k >= weekStart && k <= weekEnd)
  const { data, error, pending, reload } = useRemote(
    async () => (await api<ArchiveWeekResponse>('archive.week', { weekStart })).days,
    [weekStart],
  )

  let sub = '…'
  let body
  if (error) {
    body = <ErrorState onRetry={reload} />
  } else if (!data) {
    body = null
  } else {
    const all = data.flatMap((d) => d.requests)
    const approvedCount = all.filter((r) => r.status === 'approved').length
    const came = all.filter((r) => r.visit?.status === 'came').length + data.reduce((n, d) => n + d.walkIns.length, 0)
    sub = `${requestsWord(all.length)} · ${approvedCount} одобрено · пришли ${came}`
    // День с одними гостями без заявки - тоже день архива: в спейсе кто-то был.
    const nonEmpty = data.filter((d) => d.requests.length > 0 || d.walkIns.length > 0 || d.dateKey === grace)
    if (nonEmpty.length === 0) {
      body = (
        <div className="card">
          <EmptyState title="Заявок не было" text="На этой неделе никто не оставлял заявки." />
        </div>
      )
    } else {
      body = (
        <div className="card">
          {nonEmpty.map((d, i) => (
            <Fragment key={d.dateKey}>
              {i > 0 ? <Sep left={96} /> : null}
              <DayRow
                day={{
                  dateKey: d.dateKey,
                  total: d.requests.length,
                  approved: d.requests.filter((r) => r.status === 'approved').length,
                  requests: d.requests,
                  // Пришедшие без заявки - лицами в строке, как отметки «я приду» в обзоре.
                  attendees: d.walkIns.map((w) => ({ ...w.guest, resident: false, time: null })),
                }}
                tappable
                alwaysApproved
                onOpen={() => push('visits', { dateKey: d.dateKey, preset: d })}
              />
            </Fragment>
          ))}
        </div>
      )
    }
  }

  return (
    <>
      <div className="header" data-pager-head>
        <div className="title">{fmtRange(weekStart, weekEnd)}</div>
        <div className="subtitle">{sub}</div>
      </div>
      {live ? null : <ReadonlyBadge />}
      <Swap loading={!data && !error} skeleton={pending ? <WeekSkeleton /> : null}>
        {body}
      </Swap>
    </>
  )
}
