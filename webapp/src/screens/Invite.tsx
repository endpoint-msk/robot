// «Позвать в спейс»: резидент выбирает человека (резидента или гостя из заявок),
// боту уходит зов в личку. Список живой (резиденты — из админов чатов), поэтому
// грузим его при входе, а не из bootstrap.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { useParams } from '../store'
import { haptic } from '../telegram'
import type { InviteCandidate, InviteListResponse } from '../types'
import { BackRow, EmptyState, Header, Sep, SectionTitle, SpinnerCenter } from '../components/common'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; people: InviteCandidate[] }
  | { status: 'error'; message: string }

function PersonRow({
  person,
  invited,
  busy,
  onInvite,
}: {
  person: InviteCandidate
  invited: boolean
  busy: boolean
  onInvite: () => void
}) {
  let right
  if (person.attending) right = <span className="waiting-label">Придёт</span>
  else if (invited) {
    right = (
      <span className="waiting-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icons.check(13, '#34c759', 2.4)}
        Позвал
      </span>
    )
  } else {
    right = (
      <button className="host-btn" disabled={busy} onClick={onInvite}>
        Позвать
      </button>
    )
  }
  return (
    <div className="row">
      <Avatar user={person} className="req-avatar" profile />
      <div className="req-main">
        <Profile user={person} className="req-name">
          {person.name}
        </Profile>
        {person.username ? <div className="req-sub">{'@' + person.username}</div> : null}
      </div>
      <div className="row-right">{right}</div>
    </div>
  )
}

function Group({
  title,
  people,
  invited,
  busyId,
  onInvite,
}: {
  title: string
  people: InviteCandidate[]
  invited: Set<number>
  busyId: number | null
  onInvite: (p: InviteCandidate) => void
}) {
  if (people.length === 0) return null
  return (
    <>
      <SectionTitle>{`${title} · ${people.length}`}</SectionTitle>
      <div className="card">
        {people.map((p, i) => (
          <Fragment key={p.userId}>
            {i > 0 ? <Sep left={66} /> : null}
            <PersonRow
              person={p}
              invited={invited.has(p.userId)}
              busy={busyId !== null}
              onInvite={() => onInvite(p)}
            />
          </Fragment>
        ))}
      </div>
    </>
  )
}

export function Invite() {
  const { dateKey } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [invited, setInvited] = useState<Set<number>>(new Set())
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api<InviteListResponse>('invite.list', { dateKey })
      .then(({ people }) => {
        if (!cancelled) setState({ status: 'ok', people })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [dateKey])

  const invite = async (p: InviteCandidate): Promise<void> => {
    setBusyId(p.userId)
    try {
      await api('invite', { dateKey, userId: p.userId })
      setInvited((prev) => new Set(prev).add(p.userId))
      haptic('success')
    } catch (err) {
      showAlert((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  let body
  if (state.status === 'loading') body = <SpinnerCenter />
  else if (state.status === 'error') {
    body = (
      <div className="card">
        <EmptyState title="Не получилось загрузить" text={state.message} />
      </div>
    )
  } else {
    const q = query.trim().toLowerCase()
    const match = (p: InviteCandidate): boolean =>
      !q || p.name.toLowerCase().includes(q) || (p.username ?? '').toLowerCase().includes(q)
    const residents = state.people.filter((p) => p.resident && match(p))
    const guests = state.people.filter((p) => !p.resident && match(p))
    body =
      residents.length === 0 && guests.length === 0 ? (
        <div className="card">
          <EmptyState
            title={q ? 'Никого не нашлось' : 'Некого звать'}
            text={q ? 'Попробуй другое имя или ник.' : 'Бот знает только резидентов и гостей, которые оставляли заявки.'}
          />
        </div>
      ) : (
        <>
          <Group title="Резиденты" people={residents} invited={invited} busyId={busyId} onInvite={invite} />
          <Group title="Гости" people={guests} invited={invited} busyId={busyId} onInvite={invite} />
        </>
      )
  }

  return (
    <Screen>
      <BackRow label="День" />
      <Header title="Позвать в спейс" subtitle={fmtShortDate(dateKey)} />
      <div className="card">
        <div className="row">
          <input
            className="text-input"
            type="text"
            value={query}
            placeholder="Поиск по имени или нику"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {body}
    </Screen>
  )
}
