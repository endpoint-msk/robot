import { Fragment } from 'react'
import { api } from '../api'
import { addDays, fmtRange, requestsWord } from '../dates'
import { useRemote } from '../remote'
import { push, useParams } from '../store'
import type { ArchiveWeekResponse } from '../types'
import { BackRow, EmptyState, ErrorState, ReadonlyBadge, Sep } from '../components/common'
import { DayRow } from '../components/DayRow'
import { Screen } from '../components/Screen'
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

export function ArchiveWeek() {
  const params = useParams()
  const weekStart = params.weekStart as string
  const weekEnd = addDays(weekStart, 6)
  const { data, error, pending, reload } = useRemote(
    async () => (await api<ArchiveWeekResponse>('archive.week', { weekStart })).days,
    [weekStart],
  )

  let sub = '…'
  let body
  if (error) {
    body = <ErrorState onRetry={reload} />
  } else if (!data) {
    body = pending ? <WeekSkeleton /> : null
  } else {
    const all = data.flatMap((d) => d.requests)
    const approvedCount = all.filter((r) => r.status === 'approved').length
    sub = `${requestsWord(all.length)} · ${approvedCount} одобрено`
    const nonEmpty = data.filter((d) => d.requests.length > 0)
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
              {i > 0 ? <Sep left={86} /> : null}
              <DayRow
                day={{
                  dateKey: d.dateKey,
                  total: d.requests.length,
                  approved: d.requests.filter((r) => r.status === 'approved').length,
                  requests: d.requests,
                }}
                tappable
                alwaysApproved
                onOpen={() => push('day', { dateKey: d.dateKey, archive: true, requests: d.requests })}
              />
            </Fragment>
          ))}
        </div>
      )
    }
  }

  return (
    <Screen>
      <BackRow label="Архив" />
      <div className="header">
        <div className="title">{fmtRange(weekStart, weekEnd)}</div>
        <div className="subtitle">{sub}</div>
      </div>
      <ReadonlyBadge />
      {body}
    </Screen>
  )
}
