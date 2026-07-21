import { Fragment } from 'react'
import { fmtDayMonth, peopleWord, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { sec } from '../theme'
import type { Day } from '../types'
import { BackRow, Footnote, Header, Sep } from '../components/common'
import { AvatarStack } from '../components/people'
import { Screen } from '../components/Screen'

function PeekDayRow({ day }: { day: Day }) {
  const { data } = useStore()
  const isToday = day.dateKey === data!.todayKey
  const att = day.attendees || []
  const empty = att.length === 0
  const cls = 'row' + (!empty ? ' tappable' : '') + (isToday ? ' today' : '') + (empty ? ' day-empty' : '')
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
        <span className="day-none">Пока никого</span>
      </div>
    )
  }
  return (
    <div className={cls} onClick={() => push('peekDay', { dateKey: day.dateKey })}>
      {dayCol}
      <AvatarStack users={att.map((a) => ({ userId: a.userId, name: a.name, username: a.username }))} />
      <span className="day-count">{peopleWord(att.length)}</span>
      <div className="row-right">{icons.chevron(isToday ? sec(0.4) : undefined)}</div>
    </div>
  )
}

export function Peek() {
  const { data } = useStore()
  const days = data!.days
  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title="Кто придёт" subtitle="Подтверждённые гости и резиденты" />
      <div className="card">
        {days.map((day, i) => (
          <Fragment key={day.dateKey}>
            {i > 0 ? <Sep left={86} /> : null}
            <PeekDayRow day={day} />
          </Fragment>
        ))}
      </div>
      <Footnote>
        Показаны те, кого уже подтвердили, и резиденты, отметившие «я приду». Гости, пришедшие анонимно, в списке не
        видны. Цель визита не показывается.
      </Footnote>
    </Screen>
  )
}
