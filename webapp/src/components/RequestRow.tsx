// Строка заявки в деталях дня (резидент): гость, время, цель; справа — одобривший
// или «Захостить». Плюс блок переноса времени под строкой.

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { action } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { confirmDialog, reschedulePrompt } from '../modals'
import { useStore } from '../store'
import { sec } from '../theme'
import { haptic } from '../telegram'
import type { HostingRequest, RescheduleProposal } from '../types'
import { Avatar, Profile, userLabel } from './people'
import { Sep } from './common'

/** Слот предложения: «Пт, 17 июля · 15:00», если день отличается от текущего дня заявки; иначе только время. */
function proposalSlot(r: HostingRequest, p: RescheduleProposal): string {
  return p.dateKey !== r.dateKey ? `${fmtShortDate(p.dateKey)} · ${p.time}` : p.time
}

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

/** Предложить гостю перенос дня/времени (резидент): модалка с выбором → API `propose`. */
async function proposeRescheduleFor(r: HostingRequest): Promise<void> {
  const p = r.proposal
  const slot = await reschedulePrompt({
    text: `Предложить ${r.guest.name} перенести визит на другой день или время?`,
    initialDay: (p && p.dateKey) || r.dateKey,
    initialTime: (p && p.time) || r.time,
  })
  // Согласованный слот не изменился — предлагать нечего (сервер тоже это гасит).
  if (!slot || (slot.dateKey === r.dateKey && slot.time === r.time)) return
  const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time })
  if (done) haptic('success')
}

/** Заблокировать гостя (любой резидент): бан во всех чатах + чистка заявок + отказ в миниаппе. */
async function blockGuest(r: HostingRequest): Promise<void> {
  const ok = await confirmDialog(
    `Заблокировать ${r.guest.name}? Бот забанит его во всех чатах, удалит его заявки и закроет ему миниапп.`,
    { confirmLabel: 'Заблокировать', destructive: true },
  )
  if (!ok) return
  const done = await action('block', { id: r.id })
  if (done) haptic('warning')
}

export function RequestRow({ r, archive = false }: { r: HostingRequest; archive?: boolean }) {
  const me = useStore().data!.me
  const sub = (r.guest.username ? '@' + r.guest.username + ' · ' : '') + 'к ' + r.time + (r.anon ? ' · инкогнито' : '')
  const p = r.proposal

  // Действия под строкой: перенос (принять/предложить) + блокировка гостя (резиденту).
  const rowActions = (canReschedule: boolean): ReactNode => (
    <div className="req-proposal-actions">
      {canReschedule && p && p.by === 'guest' ? (
        <button
          className="accept-btn"
          onClick={async () => {
            const done = await action('proposal.accept', { id: r.id })
            if (done) haptic('success')
          }}
        >
          {icons.check(14, '#34c759', 2.4)}
          Принять {proposalSlot(r, p)}
        </button>
      ) : null}
      {canReschedule ? (
        <button className="link-btn" onClick={() => void proposeRescheduleFor(r)}>
          {p ? 'Другой слот' : 'Перенести'}
        </button>
      ) : null}
      {me.isResident && !archive ? (
        <button className="link-btn danger" onClick={() => void blockGuest(r)}>
          Заблокировать
        </button>
      ) : null}
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
    // Подтверждённый визит двигает только его хост; блокировка гостя доступна любому резиденту.
    proposalRow = archive ? null : rowActions(mine)
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
    proposalRow = rowActions(true)
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
            гость предлагает <span className="pn-time">{proposalSlot(r, p)}</span>
          </span>
        ) : (
          <span>
            вы предложили <span className="pn-time">{proposalSlot(r, p)}</span> · ждём гостя
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
