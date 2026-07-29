// Карточка человека из поиска по архиву: все его заявки — от свежих к старым.
// Архив по неделям отвечает на «что было в тот вторник», этот экран — на «кто такой
// N и сколько раз он у нас был».
//
// Строки свои, а не RequestsCard: там главное — гость и время внутри одного дня, а
// здесь гость один на весь экран и главное — дата.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { dayNum, fmtShortDate, MONTHS_ABBR, monthIdx, requestsWord } from '../dates'
import { icons } from '../icons'
import { push, useParams, useStore } from '../store'
import { sec } from '../theme'
import type { GuestRequestsResponse, HostingRequest, User } from '../types'
import { BackRow, EmptyState, Header, ReadonlyBadge, Sep, SectionTitle, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

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

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; user: User; requests: HostingRequest[] }
  | { status: 'error'; message: string }

export function GuestVisits() {
  const params = useParams()
  const { data } = useStore()
  const userId = params.userId as number
  // Пока грузятся заявки, шапку рисуем по данным из строки поиска — экран не мигает пустым.
  const preset = params.user as User | undefined
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await api<GuestRequestsResponse>('guest.requests', { userId })
        if (!cancelled) setState({ status: 'ok', user: res.user, requests: res.requests })
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId])

  const user = state.status === 'ok' ? state.user : preset
  const note = (data!.notes || []).find((n) => n.userId === userId) || null
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
  } else if (state.requests.length === 0) {
    body = (
      <div className="card">
        <EmptyState title="Заявок нет" text="Все заявки этого человека уже удалены." />
      </div>
    )
  } else {
    const approved = state.requests.filter((r) => r.status === 'approved').length
    sub = `${requestsWord(state.requests.length)} · ${approved} состоялось`
    body = (
      <div className="card">
        {state.requests.map((r, i) => (
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
            <div className="row tappable" onClick={() => push('guestNote', { guest: user, backLabel: 'Гость' })}>
              <div className="row-icon" style={{ background: 'rgba(var(--sec), 0.12)' }}>
                {icons.note(17, sec(0.6))}
              </div>
              <span className="row-label">{note ? note.text : 'Заметки пока нет'}</span>
              <div className="row-right">{icons.chevron()}</div>
            </div>
          </div>
        </>
      ) : null}
      <SectionTitle>Заявки</SectionTitle>
      {body}
    </Screen>
  )
}
