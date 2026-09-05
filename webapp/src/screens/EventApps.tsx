// Рецензент разбирает заявки на ивент: список с ответами, «Принять» / «Отклонить».
// Данные грузятся отдельной ручкой (event.apps) — ответы объёмные, в bootstrap им не место.

import { useState } from 'react'
import { action, api } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { confirmDialog, showAlert } from '../modals'
import { useRemote } from '../remote'
import { useParams } from '../store'
import { haptic } from '../telegram'
import type { EventAnswer, EventApplication, EventAppsResponse, SpaceEvent } from '../types'
import { BackRow, EmptyState, ErrorState, Header, SectionTitle } from '../components/common'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

function AnswerLine({ answer }: { answer: EventAnswer }) {
  const labels = answer.choiceLabels ?? []
  const empty = answer.type === 'text' ? !(answer.text ?? '').trim() : labels.length === 0 && !answer.writeIn
  return (
    <div className="ea-answer">
      <div className="ea-q">{answer.question}</div>
      {answer.type === 'text' ? (
        <div className="ea-a">{(answer.text ?? '').trim() || '—'}</div>
      ) : empty ? (
        <div className="ea-a ea-a-empty">—</div>
      ) : (
        <div className="ea-chips">
          {labels.map((l, i) => (
            <span className="ea-chip" key={i}>
              {l}
            </span>
          ))}
          {answer.writeIn ? <span className="ea-chip writein">{answer.writeIn}</span> : null}
        </div>
      )}
    </div>
  )
}

function AppCard({
  app,
  busy,
  onApprove,
  onDecline,
}: {
  app: EventApplication
  busy: boolean
  onApprove: () => void
  onDecline: () => void
}) {
  return (
    <div className="card ea-card">
      <div className="ea-head">
        <Avatar user={app.guest} className="req-avatar" profile />
        <div className="req-main">
          <Profile user={app.guest} className="req-name">
            {app.guest.name}
          </Profile>
          {app.guest.username ? <div className="req-sub">{'@' + app.guest.username}</div> : null}
        </div>
        {app.status === 'approved' ? (
          <span className="waiting-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {icons.check(13, '#34c759', 2.4)} Принят
          </span>
        ) : null}
      </div>
      {app.answers.length > 0 ? (
        <div className="ea-answers">
          {app.answers.map((a) => (
            <AnswerLine key={a.fieldId} answer={a} />
          ))}
        </div>
      ) : null}
      <div className="ea-actions">
        {app.status === 'pending' ? (
          <button type="button" className="host-btn" disabled={busy} onClick={onApprove}>
            Принять
          </button>
        ) : null}
        <button type="button" className="ea-decline" disabled={busy} onClick={onDecline}>
          Отклонить
        </button>
      </div>
    </div>
  )
}

export function EventApps() {
  const params = useParams()
  const event = params.event as SpaceEvent
  const [busy, setBusy] = useState(false)
  const { data, error, loading, pending, reload } = useRemote(
    async () => (await api<EventAppsResponse>('event.apps', { eventId: event.id })).applications,
    [event.id],
  )

  const decide = async (app: EventApplication, approve: boolean): Promise<void> => {
    if (!approve) {
      const ok = await confirmDialog(`Отклонить заявку ${app.guest.name}?`, {
        confirmLabel: 'Отклонить',
        cancelLabel: 'Оставить',
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      // action обновляет общий стор (счётчики на карточках), затем перечитываем список.
      await action(approve ? 'event.app.approve' : 'event.app.decline', { id: app.id })
      haptic(approve ? 'success' : 'warning')
      reload()
    } catch (err) {
      showAlert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  let body
  if (error) body = <ErrorState onRetry={reload} />
  else if (!data) body = null
  else if (data.length === 0) {
    body = (
      <div className="card">
        <EmptyState title="Заявок пока нет" text="Как только кто-то оставит заявку, она появится здесь." />
      </div>
    )
  } else {
    const pendingApps = data.filter((a) => a.status === 'pending')
    const approvedApps = data.filter((a) => a.status === 'approved')
    body = (
      <>
        {pendingApps.length > 0 ? (
          <>
            <SectionTitle>{`На рассмотрении · ${pendingApps.length}`}</SectionTitle>
            {pendingApps.map((a) => (
              <AppCard key={a.id} app={a} busy={busy} onApprove={() => decide(a, true)} onDecline={() => decide(a, false)} />
            ))}
          </>
        ) : null}
        {approvedApps.length > 0 ? (
          <>
            <SectionTitle>{`Приняты · ${approvedApps.length}`}</SectionTitle>
            {approvedApps.map((a) => (
              <AppCard key={a.id} app={a} busy={busy} onApprove={() => decide(a, true)} onDecline={() => decide(a, false)} />
            ))}
          </>
        ) : null}
      </>
    )
  }

  return (
    <Screen>
      <BackRow label={params.backLabel || 'Ивент'} />
      <Header title="Заявки на ивент" subtitle={`${event.title} · ${fmtShortDate(event.dateKey)} в ${event.time}`} />
      <Swap loading={loading && !data} skeleton={pending ? <SkRows count={3} avatar tail /> : null}>
        {body}
      </Swap>
    </Screen>
  )
}
