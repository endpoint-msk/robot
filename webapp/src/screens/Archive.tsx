import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { addDays, dayNum, fmtRange, keyToDate, monthIdx, MONTHS_NOM, plural, weekdayIdx, yearOf } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import type { ArchiveResponse, ArchiveWeekSummary } from '../types'
import { BackRow, EmptyState, Header, Sep, SectionTitle, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

function weeksAgoLabel(weekStart: string, todayKey: string): string {
  const currentMonday = addDays(todayKey, -weekdayIdx(todayKey))
  const diffWeeks = Math.round(
    (keyToDate(currentMonday).getTime() - keyToDate(weekStart).getTime()) / (7 * 24 * 3600 * 1000),
  )
  if (diffWeeks <= 1) return 'Прошлая неделя'
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
                    <div className="week-square">
                      <span className="ws-from">{String(dayNum(week.weekStart))}</span>
                      <span className="ws-to">{'–' + dayNum(weekEnd)}</span>
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

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; weeks: ArchiveWeekSummary[] }
  | { status: 'error'; message: string }

export function Archive() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
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
        <EmptyState title="Архив пуст" text="Здесь появятся прошедшие недели с заявками." />
      </div>
    )
  else body = <ArchiveList weeks={state.weeks} />

  return (
    <Screen>
      <BackRow label="Обзор" />
      <Header title="Архив" />
      {body}
    </Screen>
  )
}
