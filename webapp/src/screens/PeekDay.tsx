import { fmtDayMonth, peopleWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { useParams, useStore } from '../store'
import { BackRow, EmptyState, Header } from '../components/common'
import { AttendeesCard } from '../components/attendees'
import { Screen } from '../components/Screen'

export function PeekDay() {
  const params = useParams()
  const { data } = useStore()
  const day = data!.days.find((d) => d.dateKey === params.dateKey)
  const att = (day && day.attendees) || []
  const isToday = params.dateKey === data!.todayKey
  return (
    <Screen>
      <BackRow label="Кто придёт" />
      <Header
        title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]}
        subtitle={`${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${peopleWord(att.length)}`}
      />
      {att.length === 0 ? (
        <div className="card">
          <EmptyState title="Пока никого" text="На этот день ещё нет подтверждённых визитов." />
        </div>
      ) : (
        <AttendeesCard list={att} />
      )}
    </Screen>
  )
}
