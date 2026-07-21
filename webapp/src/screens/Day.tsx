import { action } from '../api'
import { fmtDayMonth, requestsWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { haptic } from '../telegram'
import { useParams, useStore } from '../store'
import type { HostingRequest } from '../types'
import { BackRow, EmptyState, Header, ReadonlyBadge, SectionTitle } from '../components/common'
import { AttendeesCard } from '../components/attendees'
import { RequestsCard } from '../components/RequestRow'
import { Screen } from '../components/Screen'

export function Day() {
  const params = useParams()
  const { data } = useStore()
  const archive = Boolean(params.archive)

  let requests: HostingRequest[]
  if (archive) {
    requests = (params.requests as HostingRequest[]) || []
  } else {
    const day = data!.days.find((d) => d.dateKey === params.dateKey)
    requests = (day && day.requests) || []
  }
  const approved = requests.filter((r) => r.status === 'approved')
  const pending = requests.filter((r) => r.status !== 'approved')
  const isToday = !archive && params.dateKey === data!.todayKey

  // Резиденты «я приду» + переключатель для себя (только в живом дне).
  const dayObj = !archive ? data!.days.find((d) => d.dateKey === params.dateKey) : undefined
  const residentsComing = !archive ? ((dayObj && dayObj.attendees) || []).filter((a) => a.resident) : []
  const iAmComing = residentsComing.some((a) => a.userId === data!.me.id)

  return (
    <Screen>
      <BackRow label={archive ? 'Неделя' : 'Обзор'} />
      <Header
        title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]}
        subtitle={`${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${requestsWord(requests.length)}`}
      />
      {archive ? <ReadonlyBadge /> : null}
      {!archive ? (
        <button
          className={'attend-btn' + (iAmComing ? ' on' : '')}
          onClick={async () => {
            const done = await action('attend', { dateKey: params.dateKey, coming: !iAmComing })
            if (done) haptic(iAmComing ? 'warning' : 'success')
          }}
        >
          {iAmComing ? icons.check(15, '#fff', 2.6) : null}
          {iAmComing ? 'Вы придёте в этот день' : 'Я приду'}
        </button>
      ) : null}
      {!archive && residentsComing.length > 0 ? (
        <>
          <SectionTitle>{`Придут резиденты · ${residentsComing.length}`}</SectionTitle>
          <AttendeesCard list={residentsComing} />
        </>
      ) : null}
      {requests.length === 0 && (archive || residentsComing.length === 0) ? (
        <div className="card">
          <EmptyState
            title={archive ? 'Заявок не было' : 'Нет заявок гостей'}
            text={archive ? 'В этот день никто не собирался прийти.' : 'На этот день пока никто не оставил заявку.'}
          />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>{`Одобрены · ${approved.length}`}</SectionTitle>
          <RequestsCard list={approved} archive={archive} />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>{`Ждут ответа · ${pending.length}`}</SectionTitle>
          <RequestsCard list={pending} archive={archive} />
        </>
      ) : null}
    </Screen>
  )
}
