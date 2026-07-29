// Строка дня в обзоре недели (резидент) и в неделе архива.

import { fmtDayMonth, peopleWord, requestsWord, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { useStore } from '../store'
import { sec } from '../theme'
import type { Attendee, HostingRequest, SpaceEvent } from '../types'
import { AvatarStack } from './people'

type DayRowData = {
  dateKey: string
  total: number
  approved: number
  requests?: HostingRequest[]
  /** Публичный «кто придёт»: в обзоре есть всегда, в архиве не приходит вовсе. */
  attendees?: Attendee[]
  /** Ивенты дня: в архиве их нет. */
  events?: SpaceEvent[]
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
  const att = day.attendees ?? []
  // «Пусто» — только про внешний вид строки. Открываться она должна всё равно: экран дня
  // это единственное место, где резидент отмечается «я приду», и в тихий день (заявок нет,
  // никто ещё не отметился) без этого туда было не попасть — то есть первым отметиться
  // было нельзя в принципе.
  const empty = day.total === 0 && att.length === 0
  const cls =
    'row' + (tappable ? ' tappable' : '') + (isToday ? ' today' : '') + (empty ? ' day-empty' : '')

  // Точка у дня недели — «в этот день есть ивент». Занимать ею место в строке нельзя:
  // там уже аватарки и счётчики, а сам ивент виден на экране дня.
  const hasEvent = (day.events ?? []).length > 0
  const dayCol = (
    <div className="day-col">
      <div className="dow-line">
        <div className="dow">{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]}</div>
        {hasEvent ? <span className="ev-dot" title="В этот день есть ивент" /> : null}
      </div>
      <div className="date">{isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)}</div>
    </div>
  )

  // Заявок нет, но кто-то придёт — показываем людей, а не «нет заявок»: иначе день
  // с одними отметками резидентов выглядит пустым.
  const guests = (day.requests || []).map((r) => r.guest)
  const faces = guests.length > 0 ? guests : att
  const label = day.total > 0 ? requestsWord(day.total) : peopleWord(att.length)

  return (
    <div className={cls} onClick={tappable ? onOpen : undefined}>
      {dayCol}
      {empty ? (
        <span className="day-none">Нет заявок</span>
      ) : (
        <>
          {faces.length > 0 ? <AvatarStack users={faces} /> : null}
          <span className="day-count">{label}</span>
        </>
      )}
      <div className="row-right">
        {!empty && (day.approved > 0 || alwaysApproved) ? (
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
