// Строка дня в обзоре недели (резидент) и в неделе архива.

import { fmtDayMonth, requestsWord, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { useStore } from '../store'
import { sec } from '../theme'
import type { HostingRequest } from '../types'
import { AvatarStack } from './people'

type DayRowData = {
  dateKey: string
  total: number
  approved: number
  requests?: HostingRequest[]
}

export function DayRow({
  day,
  tappable = false,
  onOpen,
  alwaysApproved = false,
}: {
  day: DayRowData
  tappable?: boolean
  onOpen?: () => void
  alwaysApproved?: boolean
}) {
  const { data } = useStore()
  const isToday = day.dateKey === data!.todayKey
  const empty = day.total === 0
  const cls =
    'row' + (tappable && !empty ? ' tappable' : '') + (isToday ? ' today' : '') + (empty ? ' day-empty' : '')

  const dayCol = (
    <div className="day-col">
      <div className="dow">{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]}</div>
      <div className="date">{isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)}</div>
    </div>
  )

  if (empty) {
    return (
      <div className={cls}>
        {dayCol}
        <span className="day-none">Нет заявок</span>
      </div>
    )
  }

  const guests = (day.requests || []).map((r) => r.guest)
  return (
    <div className={cls} onClick={tappable ? onOpen : undefined}>
      {dayCol}
      {guests.length > 0 ? <AvatarStack users={guests} /> : null}
      <span className="day-count">{requestsWord(day.total)}</span>
      <div className="row-right">
        {day.approved > 0 || alwaysApproved ? (
          <div className="approved-count">
            {icons.check(14, '#34c759')}
            {String(day.approved)}
          </div>
        ) : null}
        {tappable ? icons.chevron(isToday ? sec(0.4) : undefined) : null}
      </div>
    </div>
  )
}
