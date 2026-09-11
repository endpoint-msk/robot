// Строка заявки в деталях дня (резидент): гость, время, цель; справа — одобривший
// или «Захостить». Перенос и блокировка гостя — свайпом влево (см. SwipeRow),
// передача визита другому резиденту — тапом по своему пиллу хоста.

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { action } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { choiceDialog, confirmDialog, reschedulePrompt } from '../modals'
import { push, useStore } from '../store'
import { sec } from '../theme'
import { haptic } from '../telegram'
import type { DayCapacity, HostingRequest, RescheduleProposal } from '../types'
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

/**
 * Закрыть заявку со стороны спейса: визит не состоится. Заявка удаляется, гостю уходит
 * DM с предложением выбрать другой день — он не остаётся ждать ответа, которого не будет.
 */
async function closeRequest(r: HostingRequest): Promise<void> {
  const approved = r.status === 'approved'
  const ok = await confirmDialog(
    approved
      ? `Закрыть подтверждённый визит ${r.guest.name} ${fmtShortDate(r.dateKey)} к ${r.time}? Гость получит уведомление и сможет выбрать другой день.`
      : `Закрыть заявку ${r.guest.name} на ${fmtShortDate(r.dateKey)} к ${r.time}? Гость получит уведомление и сможет выбрать другой день.`,
    { confirmLabel: 'Закрыть заявку', cancelLabel: 'Оставить', destructive: true },
  )
  if (!ok) return
  const done = await action('close', { id: r.id })
  if (done) haptic('warning')
}

/** Заблокировать гостя (любой резидент): бан во всех чатах + чистка заявок + отказ в миниаппе. */
async function blockGuest(r: HostingRequest): Promise<void> {
  const ok = await confirmDialog(
    `Заблокировать ${r.guest.name}? Бот забанит его во всех чатах, удалит его заявки и закроет ему миниапп. Снять блокировку может только дев — сами вы её не откатите.`,
    { confirmLabel: 'Заблокировать', cancelLabel: 'Оставить доступ', destructive: true },
  )
  if (!ok) return
  const done = await action('block', { id: r.id })
  if (done) haptic('warning')
}

/**
 * Меню своего пилла хоста: передать визит другому резиденту или снять хостинг с себя.
 *
 * Передача живёт здесь, а не в свайпе: у хоста там уже четыре действия (заметка,
 * перенос, закрыть, блокировка), а пятая иконка занимает почти всю ширину строки.
 * Да и пилл — это и есть «кто хостит», передача меняет ровно его.
 */
async function hostMenu(r: HostingRequest): Promise<void> {
  // Пока висит своя просьба, второго адресата назначить нельзя (сервер ответит busy),
  // поэтому в меню на этом месте её отзыв.
  const pending = r.transfer ?? null
  const choice = await choiceDialog(
    pending
      ? `Ждём ответа ${userLabel(pending.to)} по визиту ${r.guest.name} ${fmtShortDate(r.dateKey)} к ${r.time}.`
      : `Визит ${r.guest.name} ${fmtShortDate(r.dateKey)} к ${r.time} на вас.`,
    [
      pending
        ? { key: 'withdraw', label: 'Отозвать передачу' }
        : { key: 'transfer', label: 'Передать другому резиденту' },
      { key: 'unapprove', label: 'Отменить хостинг', destructive: true },
    ],
  )
  if (choice === 'transfer') {
    push('invite', { dateKey: r.dateKey, transferId: r.id, transferGuest: r.guest.name })
    return
  }
  if (choice === 'withdraw') {
    const done = await action('transfer.decline', { id: r.id })
    if (done) haptic('warning')
    return
  }
  if (choice !== 'unapprove') return
  const ok = await confirmDialog(`Отменить хостинг? Заявка ${r.guest.name} снова будет ждать ответа.`, {
    confirmLabel: 'Отменить хостинг',
    cancelLabel: 'Оставить',
  })
  if (!ok) return
  const done = await action('unapprove', { id: r.id })
  if (done) haptic('warning')
}

/**
 * Предупреждение о перегрузе дня. Лимит мягкий: он не запрещает хостить, а называет
 * число — решение остаётся за резидентом, который видит день целиком. Заявки без хоста
 * места не занимают (см. dayOccupancy), поэтому предупреждаем ровно в тот момент, когда
 * место действительно занимают.
 */
async function confirmOverCapacity(r: HostingRequest, capacity: DayCapacity | undefined): Promise<boolean> {
  const guest = `${r.guest.name}${r.guest.username ? ' (@' + r.guest.username + ')' : ''}`
  const ask = `Захостить: ${guest}, ${fmtShortDate(r.dateKey)} к ${r.time}?`
  const over = capacity && capacity.occupied + 1 > capacity.cap
  if (!over) return confirmDialog(ask, { confirmLabel: 'Захостить', cancelLabel: 'Не сейчас' })
  return confirmDialog(`В этот день уже ${capacity.occupied} из ${capacity.cap} — этот визит сверх вместимости. ${ask}`, {
    confirmLabel: 'Всё равно захостить',
    cancelLabel: 'Не сейчас',
    destructive: true,
  })
}

export function RequestRow({ r, archive = false }: { r: HostingRequest; archive?: boolean }) {
  const data = useStore().data!
  const me = data.me
  const p = r.proposal
  // Заметки приходят только резидентам (см. bootstrap) — гостю тут всегда пусто.
  const guestNote = (data.notes || []).find((n) => n.userId === r.guest.userId) || null
  // Строка заявки живёт только на экране дня (живого или архивного) — туда и возвращаемся.
  const openNote = (): void => push('guestNote', { guest: r.guest, backLabel: 'День' })

  // Переговоры о переносе адресные: пока висит предложение, работать с ним вправе
  // только его автор и адресат (тот же гейт стоит на сервере, см. proposalSides).
  // У записей без `to` (заведены до появления поля) остаётся прежнее «любой резидент».
  const iAmParty = !p || p.user.userId === me.id || (p.to ? p.to.userId === me.id : true)

  // Перенос и блокировка живут в свайпе (см. SwipeRow), в строке их кнопок нет.
  let canReschedule = false
  let right: ReactNode
  if (r.status === 'approved' && r.approvedBy) {
    const mine = !archive && r.approvedBy.userId === me.id
    const pill = mine ? (
      // Многоточие, а не крестик: за пиллом теперь два действия — передать и снять с себя.
      <button type="button" className="pill mine" aria-label="Действия с хостингом" onClick={() => hostMenu(r)}>
        <Avatar user={r.approvedBy} />
        <span className="pill-name">{userLabel(r.approvedBy)}</span>
        <span className="pill-x">···</span>
      </button>
    ) : (
      // Свой пилл занят меню хостинга — в профиль ведут только чужие.
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
    canReschedule = mine && iAmParty
  } else if (archive) {
    right = <span className="waiting-label">Без ответа</span>
  } else {
    right = (
      <button
        className="host-btn"
        onClick={async () => {
          const ok = await confirmOverCapacity(r, data.days.find((d) => d.dateKey === r.dateKey)?.capacity)
          if (!ok) return
          const done = await action('approve', { id: r.id })
          if (done) haptic('success')
        }}
      >
        Захостить
      </button>
    )
    canReschedule = iAmParty
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
        {/* Отказ — половина переговоров, и сервер его разрешает (proposalSides:
            снять вправе адресат). Без него предложение можно было только принять. */}
        <button
          className="link-btn"
          onClick={async () => {
            const done = await action('proposal.decline', { id: r.id })
            if (done) haptic('warning')
          }}
        >
          Оставить {r.time}
        </button>
      </div>
    ) : null

  // Просьба подхватить визит. В архиве её не показываем: он только для чтения, а
  // отвечать на просьбу по прошедшему дню нечем.
  const t = !archive ? r.transfer ?? null : null
  const iAmTransferTo = Boolean(t && t.to.userId === me.id)
  const iAmTransferBy = Boolean(t && t.by.userId === me.id)

  // Ответ адресата — в самой строке, как «Принять {слот}» у переноса: за жестом такое
  // не прячут, иначе просьбу просто не заметят.
  const transferRow: ReactNode =
    t && iAmTransferTo ? (
      <div className="req-proposal-actions">
        <button
          className="accept-btn"
          onClick={async () => {
            const done = await action('transfer.accept', { id: r.id })
            if (done) haptic('success')
          }}
        >
          {icons.check(14, '#34c759', 2.4)}
          Взять визит
        </button>
        <button
          className="link-btn"
          onClick={async () => {
            const done = await action('transfer.decline', { id: r.id })
            if (done) haptic('warning')
          }}
        >
          Не смогу
        </button>
      </div>
    ) : null

  const transferNote: ReactNode = t ? (
    <div className={'proposal-note' + (iAmTransferBy ? ' mine' : '')}>
      {icons.handoff(14, sec(0.5))}
      {iAmTransferTo ? (
        <span>
          <span className="pn-time">{userLabel(t.by)}</span> просит подхватить визит
        </span>
      ) : iAmTransferBy ? (
        <span>
          передаёте <span className="pn-time">{userLabel(t.to)}</span> · ждём ответа
          <button
            className="link-btn pn-undo"
            onClick={async () => {
              const done = await action('transfer.decline', { id: r.id })
              if (done) haptic('warning')
            }}
          >
            Отозвать
          </button>
        </span>
      ) : (
        // Чужие переговоры: показываем, чтобы второй раз никого не звали на тот же визит.
        <span>
          {userLabel(t.by)} передаёт визит <span className="pn-time">{userLabel(t.to)}</span>
        </span>
      )}
    </div>
  ) : null

  // Действия свайпа — иконками: подписи втроём занимали почти всю ширину строки.
  const swipeActions: SwipeAction[] = []
  // Заметка о госте — общая память резидентов; в архиве тоже доступна: заметка живёт
  // отдельно от заявки, и дописать её после визита осмысленно.
  if (me.isResident) {
    swipeActions.push({ key: 'note', label: 'Заметка', icon: icons.note(21, '#fff'), tone: 'neutral', onSelect: openNote })
  }
  if (canReschedule) {
    swipeActions.push({
      key: 'reschedule',
      label: 'Перенести',
      icon: icons.clock(21, '#fff'),
      onSelect: () => proposeRescheduleFor(r),
    })
  }
  // Закрыть заявку: ничью — любой резидент, подтверждённый визит — только его хост
  // (тот же принцип, что у переноса; сервер проверяет это сам).
  if (me.isResident && !archive && (!r.approvedBy || r.approvedBy.userId === me.id)) {
    swipeActions.push({
      key: 'close',
      label: 'Закрыть заявку',
      icon: icons.xmark(21, '#fff'),
      tone: 'orange',
      onSelect: () => closeRequest(r),
    })
  }
  // Блокировать гостя вправе любой резидент, но не в архиве (там только чтение).
  if (me.isResident && !archive) {
    swipeActions.push({ key: 'block', label: 'Заблокировать', icon: icons.ban(21, '#fff'), tone: 'red', onSelect: () => blockGuest(r) })
  }

  // Какой это по счёту визит: резидент решает «брать ли», не зная, кто перед ним.
  // Новичка надо встретить и объяснить про дверь, завсегдатая - не переспрашивать.
  // Цифра считается по состоявшимся визитам ДО сегодня (см. guestVisitStats).
  // В архиве чипа нет: счёт ведётся на сегодня, и у прошлогодней строки он показал бы
  // не тот номер, каким визит был тогда.
  const stats = data.guestStats ? data.guestStats[String(r.guest.userId)] : undefined
  const visitChip = me.isResident && !archive ? (
    !stats || stats.past === 0 ? (
      <span className="visit-chip first">впервые</span>
    ) : (
      <span className="visit-chip">{stats.past + 1}-й</span>
    )
  ) : null

  const top = (
    <div className="req-top">
      <Avatar user={r.guest} className="req-avatar" profile />
      <div className="req-main">
        {/* Флажок «о госте есть заметка» — единственный её след в списке; тап ведёт в неё. */}
        <div className="req-name-line">
          <Profile user={r.guest} className="req-name">
            {r.guest.name}
          </Profile>
          {visitChip}
          {guestNote ? (
            <button
              className="note-flag"
              aria-label="Заметка о госте"
              onClick={(e) => {
                e.stopPropagation()
                openNote()
              }}
            >
              {icons.note(13, sec(0.45))}
            </button>
          ) : null}
        </div>
        {/* Ник режем многоточием, время и метки — нет: время тут главное. */}
        <div className="req-sub split">
          {r.guest.username ? <span className="req-sub-nick">@{r.guest.username}</span> : null}
          <span className="req-sub-fixed">
            {(r.guest.username ? ' · ' : '') + 'к ' + r.time + (r.anon ? ' · анонимно' : '')}
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
            {/* Отвечает адресат — иначе непонятно, почему кнопки «Принять» нет. */}
            {!iAmParty && p.to ? ` · ответит ${p.to.name}` : ''}
          </span>
        ) : (
          // Предложить мог и другой резидент — «вы» только автору предложения.
          <span>
            {p.user.userId === me.id ? 'вы предложили' : 'предложено'}{' '}
            <span className="pn-time">{proposalSlot(r, p)}</span> · ждём гостя
            {/* Своё предложение висело до ответа гостя, отозвать его было нечем. */}
            {p.user.userId === me.id && canReschedule ? (
              <button
                className="link-btn pn-undo"
                onClick={async () => {
                  const done = await action('proposal.decline', { id: r.id })
                  if (done) haptic('warning')
                }}
              >
                Отозвать
              </button>
            ) : null}
          </span>
        )}
      </div>
    ) : null

  const hasExtra = Boolean(note) || Boolean(proposalRow) || Boolean(transferNote) || Boolean(transferRow)
  return (
    <SwipeRow actions={swipeActions}>
      <div className="row req-row">
        {top}
        {hasExtra ? (
          <div className="req-extra">
            {note}
            {proposalRow}
            {transferNote}
            {transferRow}
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
