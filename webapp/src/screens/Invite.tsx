// «Позвать в спейс»: резидент выбирает человека (резидента или гостя из заявок),
// боту уходит зов в личку. Список живой (резиденты — из админов чатов), поэтому
// грузим его при входе, а не из bootstrap.
//
// Второй режим того же экрана — «кому передать визит» (параметр `transferId`): список
// тот же, но без гостей и с другой кнопкой. Отдельный экран был бы копией этого:
// выбор человека на день — ровно та же задача, и «уже придёт» здесь даже полезнее,
// чем в зове (подхватить визит проще тому, кто и так будет в спейсе).

import { Fragment, useState } from 'react'
import { action, api } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { useRemote } from '../remote'
import { pop, useParams } from '../store'
import { haptic } from '../telegram'
import type { InviteCandidate, InviteListResponse } from '../types'
import { BackRow, EmptyState, ErrorState, Header, Sep, SectionTitle } from '../components/common'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

function PersonRow({
  person,
  invited,
  busy,
  transfer,
  onInvite,
}: {
  person: InviteCandidate
  invited: boolean
  busy: boolean
  transfer: boolean
  onInvite: () => void
}) {
  let right
  // В зове «уже придёт» заменяет кнопку: звать второй раз незачем. В передаче — наоборот,
  // это лучший кандидат, поэтому там метка уезжает под имя, а кнопка остаётся.
  if (person.attending && !transfer) right = <span className="waiting-label">Придёт</span>
  else if (invited) {
    right = (
      <span className="waiting-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icons.check(13, '#34c759', 2.4)}
        {transfer ? 'Предложил' : 'Позвал'}
      </span>
    )
  } else {
    right = (
      <button type="button" className="host-btn" disabled={busy} onClick={onInvite}>
        {transfer ? 'Передать' : 'Позвать'}
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
        <div className="req-sub">
          {[person.username ? '@' + person.username : '', transfer && person.attending ? 'уже придёт' : '']
            .filter(Boolean)
            .join(' · ')}
        </div>
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
  transfer = false,
  onInvite,
}: {
  title: string
  people: InviteCandidate[]
  invited: Set<number>
  busyId: number | null
  transfer?: boolean
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
              transfer={transfer}
              onInvite={() => onInvite(p)}
            />
          </Fragment>
        ))}
      </div>
    </>
  )
}

/** Скелет: те же две группы со строками людей и кнопкой «Позвать» справа.
    Заголовки без счётчика — число кандидатов и есть то, чего ещё ждём. */
function InviteSkeleton({ transfer }: { transfer: boolean }) {
  return (
    <div aria-busy="true" aria-label="Загружаем кандидатов">
      <SectionTitle>Резиденты</SectionTitle>
      <SkRows count={5} avatar tail />
      {transfer ? null : (
        <>
          <SectionTitle>Гости</SectionTitle>
          <SkRows count={3} avatar tail />
        </>
      )}
    </div>
  )
}

export function Invite() {
  const { dateKey, transferId, transferGuest } = useParams()
  // Передача визита — тот же выбор человека на день, только адресатом может быть
  // исключительно резидент: гость чужой визит не хостит.
  const transfer = typeof transferId === 'string' && transferId.length > 0
  const [query, setQuery] = useState('')
  const [invited, setInvited] = useState<Set<number>>(new Set())
  const [busyId, setBusyId] = useState<number | null>(null)
  const { data, error, loading, pending, reload } = useRemote(
    async () => (await api<InviteListResponse>('invite.list', { dateKey })).people,
    [dateKey],
  )

  const invite = async (p: InviteCandidate): Promise<void> => {
    setBusyId(p.userId)
    try {
      if (transfer) {
        // Ответ — свежий bootstrap, и строка заявки на экране дня уже покажет
        // «передаёте @x», поэтому возвращаемся туда сразу.
        const done = await action('transfer.offer', { id: transferId, userId: p.userId })
        if (done) {
          haptic('success')
          pop()
        }
        return
      }
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
  if (error) body = <ErrorState onRetry={reload} />
  else if (!data) body = null
  else {
    const q = query.trim().toLowerCase()
    const match = (p: InviteCandidate): boolean =>
      !q || p.name.toLowerCase().includes(q) || (p.username ?? '').toLowerCase().includes(q)
    const residents = data.filter((p) => p.resident && match(p))
    const guests = transfer ? [] : data.filter((p) => !p.resident && match(p))
    body =
      residents.length === 0 && guests.length === 0 ? (
        <div className="card">
          <EmptyState
            title={q ? 'Никого не нашлось' : transfer ? 'Некому передать' : 'Некого звать'}
            text={
              q
                ? 'Попробуйте другое имя или ник.'
                : transfer
                  ? 'Кроме вас, резидентов бот не знает.'
                  : 'Бот знает только резидентов и гостей, которые оставляли заявки.'
            }
          />
        </div>
      ) : (
        <>
          <Group title="Резиденты" people={residents} invited={invited} busyId={busyId} transfer={transfer} onInvite={invite} />
          <Group title="Гости" people={guests} invited={invited} busyId={busyId} onInvite={invite} />
        </>
      )
  }

  return (
    <Screen>
      <BackRow />
      <Header
        title={transfer ? 'Кому передать' : 'Позвать в спейс'}
        subtitle={
          // Имя гостя впереди дня: «визит Настя» спотыкается о падеж, а склонять чужое
          // имя нечем — в заголовке экрана и так понятно, о чьём визите речь.
          transfer && typeof transferGuest === 'string'
            ? `${transferGuest} · ${fmtShortDate(dateKey)}`
            : fmtShortDate(dateKey)
        }
      />
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
      <Swap loading={loading && !data} skeleton={pending ? <InviteSkeleton transfer={transfer} /> : null}>
        {body}
      </Swap>
    </Screen>
  )
}
