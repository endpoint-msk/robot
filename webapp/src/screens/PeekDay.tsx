import { fmtDayMonth, peopleWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { useParams, useStore } from '../store'
import { BackRow, EmptyState, Header, SectionTitle } from '../components/common'
import { AttendeesCard } from '../components/attendees'
import { EventCard } from './Event'
import { Screen } from '../components/Screen'

export function PeekDay() {
  const params = useParams()
  const { data } = useStore()
  const day = data!.days.find((d) => d.dateKey === params.dateKey)
  const att = (day && day.attendees) || []
  const events = (day && day.events) || []
  const isToday = params.dateKey === data!.todayKey
  return (
    <Screen>
      <BackRow label="Кто придёт" />
      <Header
        title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]}
        subtitle={`${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${peopleWord(att.length)}`}
      />
      {/* Ивенты — над списком людей: это главное, что происходит в этот день. */}
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} />
      ))}
      {att.length > 0 ? <SectionTitle>Кто придёт</SectionTitle> : null}
      {att.length === 0 && events.length === 0 ? (
        <div className="card">
          <EmptyState title="Пока никого" text="На этот день ещё нет подтверждённых визитов." />
        </div>
      ) : null}
      {att.length > 0 ? <AttendeesCard list={att} /> : null}
    </Screen>
  )
}
