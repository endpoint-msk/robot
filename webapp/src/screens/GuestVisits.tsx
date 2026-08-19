// Карточка человека из поиска по архиву: все его заявки — от свежих к старым.
// Архив по неделям отвечает на «что было в тот вторник», этот экран — на «кто такой
// N и сколько раз он у нас был».
//
// Строки свои, а не RequestsCard: там главное — гость и время внутри одного дня, а
// здесь гость один на весь экран и главное — дата.

import { Fragment } from 'react'
import { api } from '../api'
import { dayNum, fmtShortDate, MONTHS_ABBR, monthIdx, plural, requestsWord } from '../dates'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { sec } from '../theme'
import type { GuestRequestsResponse, HostingRequest, User } from '../types'
import { BackRow, EmptyState, ErrorState, Header, ReadonlyBadge, Sep, SectionTitle } from '../components/common'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

function VisitRow({ r }: { r: HostingRequest }) {
  const approved = r.status === 'approved'
  return (
    <div className="row">
      <div className="week-square">
        <span className="ws-day">{String(dayNum(r.dateKey))}</span>
        <span className="ws-month">{MONTHS_ABBR[monthIdx(r.dateKey)]}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="week-title">{`${fmtShortDate(r.dateKey)} · к ${r.time}`}</div>
        <div className="week-sub">
          {approved && r.approvedBy ? `хостил ${r.approvedBy.name}` : 'без ответа'}
          {r.anon ? ' · инкогнито' : ''}
        </div>
        {r.purpose ? <div className="week-sub guest-purpose">{r.purpose}</div> : null}
      </div>
      {approved ? <div className="row-right">{icons.check(15, '#34c759')}</div> : null}
    </div>
  )
}

export function GuestVisits() {
  const params = useParams()
  const { data } = useStore()
  const userId = params.userId as number
  // Пока грузятся заявки, шапку рисуем по данным из строки поиска — экран не мигает пустым.
  const preset = params.user as User | undefined
  const guest = useRemote(() => api<GuestRequestsResponse>('guest.requests', { userId }), [userId])

  const user = guest.data ? guest.data.user : preset
  const note = (data!.notes || []).find((n) => n.userId === userId) || null
  let sub = '…'
  let body

  if (guest.error) {
    body = <ErrorState onRetry={guest.reload} />
  } else if (!guest.data) {
    body = null
  } else if (guest.data.requests.length === 0) {
    body = (
      <div className="card">
        <EmptyState title="Заявок нет" text="Все заявки этого человека уже удалены." />
      </div>
    )
  } else {
    const requests = guest.data.requests
    const approved = requests.filter((r) => r.status === 'approved').length
    sub = `${requestsWord(requests.length)} · ${approved} ${plural(approved, 'состоялась', 'состоялись', 'состоялось')}`
    body = (
      <div className="card">
        {requests.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 ? <Sep left={70} /> : null}
            <VisitRow r={r} />
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <Screen>
      <BackRow label="Архив" />
      <Header title={user ? user.name : 'Гость'} subtitle={user?.username ? `@${user.username} · ${sub}` : sub} />
      <ReadonlyBadge />
      {/* Заметка — общая память резидентов о человеке, здесь ей самое место. */}
      {user ? (
        <>
          <SectionTitle>Заметка</SectionTitle>
          <div className="card">
            <button
              type="button"
              className="row tappable"
              onClick={() => push('guestNote', { guest: user, backLabel: 'Гость' })}
            >
              <div className="row-icon" style={{ background: 'rgba(var(--sec), 0.12)' }}>
                {icons.note(17, sec(0.6))}
              </div>
              <span className="row-label">{note ? note.text : 'Заметки пока нет'}</span>
              <div className="row-right">{icons.chevron()}</div>
            </button>
          </div>
        </>
      ) : null}
      <SectionTitle>Заявки</SectionTitle>
      {/* Шапка и заметка уже настоящие — подменяется только список заявок. */}
      <Swap
        loading={!guest.data && !guest.error}
        skeleton={
          guest.pending ? (
            <div aria-busy="true" aria-label="Загружаем заявки гостя">
              <SkRows count={4} avatar />
            </div>
          ) : null
        }
      >
        {body}
      </Swap>
    </Screen>
  )
}
