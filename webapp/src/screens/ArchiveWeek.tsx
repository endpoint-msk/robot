import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { addDays, fmtRange, requestsWord } from '../dates'
import { push, useParams } from '../store'
import type { ArchiveWeekDay, ArchiveWeekResponse } from '../types'
import { BackRow, EmptyState, ReadonlyBadge, Sep, SpinnerCenter } from '../components/common'
import { DayRow } from '../components/DayRow'
import { Screen } from '../components/Screen'

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; days: ArchiveWeekDay[] }
  | { status: 'error'; message: string }

export function ArchiveWeek() {
  const params = useParams()
  const weekStart = params.weekStart as string
  const weekEnd = addDays(weekStart, 6)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    api<ArchiveWeekResponse>('archive.week', { weekStart })
      .then(({ days }) => {
        if (!cancelled) setState({ status: 'ok', days })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [weekStart])

  let sub = '…'
  let body
  if (state.status === 'loading') {
    body = <SpinnerCenter />
  } else if (state.status === 'error') {
    body = (
      <div className="card">
        <EmptyState title="Не получилось загрузить" text={state.message} />
      </div>
    )
  } else {
    const all = state.days.flatMap((d) => d.requests)
    const approvedCount = all.filter((r) => r.status === 'approved').length
    sub = `${requestsWord(all.length)} · ${approvedCount} одобрено`
    const nonEmpty = state.days.filter((d) => d.requests.length > 0)
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
