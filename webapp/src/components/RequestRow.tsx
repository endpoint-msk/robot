// Строка заявки в деталях дня (резидент): гость, время, цель; справа — одобривший
// или «Захостить». Плюс блок переноса времени под строкой.

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { action } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { confirmDialog, timePrompt } from '../modals'
import { useStore } from '../store'
import { sec } from '../theme'
import { haptic } from '../telegram'
import type { HostingRequest } from '../types'
import { Avatar, Profile, userLabel } from './people'
import { Sep } from './common'

/** Цель визита: одна строка с многоточием; если текст не влез — кнопка «ещё». */
function PurposeBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)
  // Обрезан ли текст, видно только после layout — отсюда useLayoutEffect.
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && el.scrollWidth > el.clientWidth) setTruncated(true)
  }, [])
  return (
    <div className={'req-purpose-wrap' + (expanded ? ' expanded' : '')}>
      <div className="req-purpose" ref={textRef}>
        {linkedText(text)}
      </div>
      {truncated ? (
        <button
          className="purpose-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? 'свернуть' : 'ещё'}
        </button>
      ) : null}
    </div>
  )
}

/** Предложить гостю перенос времени (резидент): модалка с вводом → API `propose`. */
async function proposeTimeFor(r: HostingRequest): Promise<void> {
  const time = await timePrompt({
    text: `Предложить ${r.guest.name} другое время визита ${fmtShortDate(r.dateKey)}?`,
    initial: (r.timeProposal && r.timeProposal.time) || r.time,
  })
  // Согласованное время не изменилось — предлагать нечего (сервер тоже это гасит).
  if (!time || time === r.time) return
  const done = await action('propose', { id: r.id, time })
  if (done) haptic('success')
}

export function RequestRow({ r, archive = false }: { r: HostingRequest; archive?: boolean }) {
  const me = useStore().data!.me
  const sub = (r.guest.username ? '@' + r.guest.username + ' · ' : '') + 'к ' + r.time + (r.anon ? ' · инкогнито' : '')
  const p = r.timeProposal

  // Действия переноса (принять/предложить) — отдельной строкой под текстом.
  const proposalActions = (): ReactNode => (
    <div className="req-proposal-actions">
      {p && p.by === 'guest' ? (
        <button
          className="accept-btn"
          onClick={async () => {
            const done = await action('proposal.accept', { id: r.id })
            if (done) haptic('success')
          }}
        >
          {icons.check(14, '#34c759', 2.4)}
          Принять {p.time}
        </button>
      ) : null}
      <button className="link-btn" onClick={() => void proposeTimeFor(r)}>
        {p ? 'Другое время' : 'Перенести'}
      </button>
    </div>
  )

  let proposalRow: ReactNode = null
  let right: ReactNode
  if (r.status === 'approved' && r.approvedBy) {
    const mine = !archive && r.approvedBy.userId === me.id
    const pill = mine ? (
      <div
        className="pill mine"
        onClick={async () => {
          const ok = await confirmDialog(`Отменить хостинг? Заявка ${r.guest.name} снова будет ждать ответа.`)
          if (!ok) return
          const done = await action('unapprove', { id: r.id })
          if (done) haptic('warning')
        }}
      >
        <Avatar user={r.approvedBy} />
        <span className="pill-name">{userLabel(r.approvedBy)}</span>
        <span className="pill-x">✕</span>
      </div>
    ) : (
      // Свой пилл занят отменой хостинга — в профиль ведут только чужие.
      <Profile user={r.approvedBy} className="pill">
        <Avatar user={r.approvedBy} />
        <span className="pill-name">{userLabel(r.approvedBy)}</span>
      </Profile>
    )
    right = (
      <div className="approver">
        <span className="approver-label">одобрил</span>
        {pill}
      </div>
    )
    // Подтверждённый визит тоже можно подвинуть по времени — но только своему хосту.
    if (mine) proposalRow = proposalActions()
  } else if (archive) {
    right = <span className="waiting-label">Без ответа</span>
  } else {
    right = (
      <button
        className="host-btn"
        onClick={async () => {
          const ok = await confirmDialog(
            `Захостить: ${r.guest.name}${r.guest.username ? ' (@' + r.guest.username + ')' : ''}, ${fmtShortDate(r.dateKey)} к ${r.time}?`,
          )
          if (!ok) return
          const done = await action('approve', { id: r.id })
          if (done) haptic('success')
        }}
      >
        Захостить
      </button>
    )
    proposalRow = proposalActions()
  }

  const top = (
    <div className="req-top">
      <Avatar user={r.guest} className="req-avatar" profile />
      <div className="req-main">
        <Profile user={r.guest} className="req-name">
          {r.guest.name}
        </Profile>
        <div className="req-sub">{sub}</div>
        {r.purpose ? <PurposeBlock text={r.purpose} /> : null}
      </div>
      {right}
    </div>
  )

  // Плашка активного предложения переноса — во всю ширину под полосой.
  const note =
    !archive && p ? (
      <div className={'proposal-note' + (p.by === 'resident' ? ' mine' : '')}>
        {icons.clock(14, sec(0.5))}
        {p.by === 'guest' ? (
          <span>
            гость предлагает <span className="pn-time">{p.time}</span>
          </span>
        ) : (
          <span>
            вы предложили <span className="pn-time">{p.time}</span> · ждём гостя
          </span>
        )}
      </div>
    ) : null

  const hasExtra = Boolean(note) || Boolean(proposalRow)
  return (
    <div className="row req-row">
      {top}
      {hasExtra ? (
        <div className="req-extra">
          {note}
          {proposalRow}
        </div>
      ) : null}
    </div>
  )
}

/** Карточка со строками заявок и разделителями. */
export function RequestsCard({ list, archive = false }: { list: HostingRequest[]; archive?: boolean }) {
  return (
    <div className="card">
      {list.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 ? <Sep left={66} /> : null}
          <RequestRow r={r} archive={archive} />
        </Fragment>
      ))}
    </div>
  )
}
