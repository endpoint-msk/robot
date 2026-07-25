// Строка заявки в деталях дня (резидент): гость, время, цель; справа — одобривший
// или «Захостить». Перенос и блокировка гостя — свайпом влево (см. SwipeRow).

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
import { SwipeRow, type SwipeAction } from './SwipeRow'

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
  const p = r.proposal

  // Перенос и блокировка живут в свайпе (см. SwipeRow), в строке их кнопок нет.
  let canReschedule = false
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
    // Подтверждённый визит двигает только его хост.
    canReschedule = mine
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
    canReschedule = true
  }

  // «Принять {слот}» остаётся в самой строке: это ответ на живое предложение гостя,
  // его нельзя прятать за жест — иначе предложение просто не заметят.
  const proposalRow: ReactNode =
    canReschedule && p && p.by === 'guest' ? (
      <div className="req-proposal-actions">
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
      </div>
    ) : null

  const swipeActions: SwipeAction[] = []
  if (canReschedule) {
    swipeActions.push({ key: 'reschedule', label: 'Перенести', onSelect: () => proposeRescheduleFor(r) })
  }
  // Блокировать гостя вправе любой резидент, но не в архиве (там только чтение).
  if (me.isResident && !archive) {
    swipeActions.push({ key: 'block', label: 'Заблокировать', tone: 'red', onSelect: () => blockGuest(r) })
  }

  const top = (
    <div className="req-top">
      <Avatar user={r.guest} className="req-avatar" profile />
      <div className="req-main">
        <Profile user={r.guest} className="req-name">
          {r.guest.name}
        </Profile>
        {/* Ник режем многоточием, время и метки — нет: время тут главное. */}
        <div className="req-sub split">
          {r.guest.username ? <span className="req-sub-nick">@{r.guest.username}</span> : null}
          <span className="req-sub-fixed">
            {(r.guest.username ? ' · ' : '') + 'к ' + r.time + (r.anon ? ' · инкогнито' : '')}
          </span>
        </div>
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
          // Предложить мог и другой резидент — «вы» только автору предложения.
          <span>
            {p.user.userId === me.id ? 'вы предложили' : 'предложено'}{' '}
            <span className="pn-time">{proposalSlot(r, p)}</span> · ждём гостя
          </span>
        )}
      </div>
    ) : null

  const hasExtra = Boolean(note) || Boolean(proposalRow)
  return (
    <SwipeRow actions={swipeActions}>
      <div className="row req-row">
        {top}
        {hasExtra ? (
          <div className="req-extra">
            {note}
            {proposalRow}
          </div>
        ) : null}
      </div>
    </SwipeRow>
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
