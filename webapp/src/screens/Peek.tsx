import { Fragment } from 'react'
import { fmtDayMonth, peopleWord, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { sec } from '../theme'
import type { Day } from '../types'
import { BackRow, Header, Sep } from '../components/common'
import { LaterEvents } from '../components/EventRow'
import { AvatarStack } from '../components/people'
import { Screen } from '../components/Screen'

function PeekDayRow({ day }: { day: Day }) {
  const { data } = useStore()
  const isToday = day.dateKey === data!.todayKey
  const att = day.attendees || []
  const events = day.events || []
  const lock = day.lock || null
  const first = events[0]
  // Повестка встаёт на место метки ивента, когда его нет. У закрытого дня без людей
  // строка остаётся за причиной закрытия (см. DayRow).
  const agendaText = !first && day.agenda && (att.length > 0 || !lock) ? day.agenda.text : null
  // День с ивентом или повесткой «не пустой», даже если никто ещё не отметился: это и
  // есть повод прийти, а прочитать повестку целиком гость может только внутри дня.
  const empty = att.length === 0 && !first && !agendaText
  const cls =
    'row' +
    (!empty ? ' tappable' : '') +
    (isToday ? ' today' : '') +
    (empty ? ' day-empty' : '') +
    (lock ? ' day-locked' : '')
  const dayCol = (
    <div className="day-col">
      <div className="dow">{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]}</div>
      <div className="date">{isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)}</div>
    </div>
  )
  if (empty) {
    return (
      <div className={cls} title={lock ? 'Закрыт для заявок' : undefined}>
        {dayCol}
        <span className="day-none">{lock ? lock.reason || 'Спейс закрыт' : 'Пока никого'}</span>
      </div>
    )
  }
  return (
    // day-stack — только когда строк внутри две: у неё своя вертикальная подложка,
    // чтобы зазоры над надписью, между ней и аватарками и под ними были равны.
    <button
      type="button"
      className={cls + ((first || agendaText) && att.length > 0 ? ' day-stack' : '')}
      title={lock ? 'Закрыт для заявок' : undefined}
      onClick={() => push('peekDay', { dateKey: day.dateKey })}
    >
      {dayCol}
      {/* Ивент и люди — двумя строками, как в макете: ивент это повод прийти, но кто
          уже собрался, гостю важно не меньше, а в одну строку метка и список не влезают. */}
      <div className="day-main">
        {first ? (
          <div className="ev-day-label">
            {icons.calendar(13, '#bf5af2')}
            <span>{`${first.title} · ${first.time}`}</span>
          </div>
        ) : agendaText ? (
          <div className="agenda-day-label">
            {icons.agenda(13, sec(0.45))}
            <span>{agendaText}</span>
          </div>
        ) : null}
        {att.length > 0 ? (
          <div className="day-people">
            <AvatarStack users={att.map((a) => ({ userId: a.userId, name: a.name, username: a.username }))} />
            <span className="day-count">{peopleWord(att.length)}</span>
          </div>
        ) : null}
      </div>
      <div className="row-right">{icons.chevron(isToday ? sec(0.4) : undefined)}</div>
    </button>
  )
}

export function Peek() {
  const { data } = useStore()
  const days = data!.days
  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title="Активность" subtitle="Ивенты и кто придёт" />
      <div className="card">
        {days.map((day, i) => (
          <Fragment key={day.dateKey}>
            {i > 0 ? <Sep left={86} /> : null}
            <PeekDayRow day={day} />
          </Fragment>
        ))}
      </div>
      <LaterEvents backLabel="Активность" />
    </Screen>
  )
}
