// Строка заявки в деталях дня (резидент): гость, время, цель; справа — одобривший
// или «Захостить». Перенос и блокировка гостя — свайпом влево (см. SwipeRow),
// передача визита другому резиденту — тапом по своему пиллу хоста.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { action } from '../api'
import { fmtShortDate, plural } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { choiceDialog, confirmDialog, reschedulePrompt, showAlert, textPrompt, type SheetSubject } from '../modals'
import { push, useStore } from '../store'
import { sec } from '../theme'
import { haptic } from '../telegram'
import type { DayCapacity, HostingRequest, RescheduleProposal } from '../types'
import { Avatar, Profile, userLabel } from './people'
import { ActionButton, Sep } from './common'
import { Collapse } from './Collapse'
import { XText } from './Flip'
import { markOwnTap } from '../motion'
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

/**
 * Шапка листа для вопросов о заявке: гость, слот и кто он резиденту, как в самой строке.
 * Имя стоит над вопросом, и вопрос обходится без него: склонять имя гостя не получается.
 */
function sheetSubject(r: HostingRequest, status: string): SheetSubject {
  return { user: r.guest, line: `${fmtShortDate(r.dateKey)} к\u00a0${r.time}` + (status ? ` · ${status}` : '') }
}

/** Предложить гостю перенос дня/времени (резидент): лист с выбором → API `propose`. */
async function proposeRescheduleFor(r: HostingRequest, subject: SheetSubject): Promise<void> {
  const p = r.proposal
  const slot = await reschedulePrompt({
    text: 'Предложить перенести визит на другой день или время?',
    initialDay: (p && p.dateKey) || r.dateKey,
    initialTime: (p && p.time) || r.time,
    subject,
  })
  // Согласованный слот не изменился — предлагать нечего (сервер тоже это гасит).
  if (!slot || (slot.dateKey === r.dateKey && slot.time === r.time)) return
  markOwnTap()
  const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time }, { quiet: true })
  if (done) haptic.notify('success')
}

/**
 * Закрыть заявку со стороны спейса: визит не состоится. Заявка удаляется, гостю уходит
 * DM с предложением выбрать другой день — он не остаётся ждать ответа, которого не будет.
 *
 * Подтверждение и комментарий гостю - один лист: комментарий необязательный, и
 * второй шаг ради него удлинял бы каждое закрытие.
 */
async function closeRequest(r: HostingRequest, subject: SheetSubject): Promise<void> {
  const comment = await textPrompt({
    text:
      r.status === 'approved'
        ? 'Подтверждённый визит отменится. Гостю придёт сообщение, и он сможет выбрать другой день.'
        : 'Гостю придёт сообщение, и он сможет выбрать другой день.',
    placeholder: 'Комментарий гостю, по желанию',
    maxLength: 500,
    multiline: true,
    destructive: true,
    confirmLabel: 'Закрыть заявку',
    cancelLabel: 'Оставить',
    subject,
  })
  if (comment === null) return
  const res = await action('close', { id: r.id, comment }, { quiet: true })
  // Без комментария молчать можно: заявка у гостя и так пропадёт. С ним резидент
  // ждёт, что его прочитают, и должен знать, что письмо не ушло.
  if (res && comment && res.delivered === false) {
    showAlert(`Заявку закрыли, но комментарий не дошёл: ${r.guest.name} не открывал чат с ботом.`)
  }
}

/** Заблокировать гостя (любой резидент): бан во всех чатах + чистка заявок + отказ в миниаппе. */
async function blockGuest(r: HostingRequest, subject: SheetSubject): Promise<void> {
  const ok = await confirmDialog(
    'Бот забанит гостя во всех чатах, удалит его заявки и закроет ему миниапп. Снять блокировку сможет только дев.',
    { confirmLabel: 'Заблокировать', cancelLabel: 'Оставить доступ', destructive: true, subject },
  )
  if (!ok) return
  await action('block', { id: r.id })
}

/**
 * Меню своего пилла хоста: передать визит другому резиденту или снять хостинг с себя.
 *
 * Передача живёт здесь, а не в свайпе: у хоста там уже четыре действия (заметка,
 * перенос, закрыть, блокировка), а пятая иконка занимает почти всю ширину строки.
 * Да и пилл — это и есть «кто хостит», передача меняет ровно его.
 */
async function hostMenu(r: HostingRequest, subject: SheetSubject): Promise<void> {
  // Пока висит своя просьба, второго адресата назначить нельзя (сервер ответит busy),
  // поэтому в меню на этом месте её отзыв.
  const pending = r.transfer ?? null
  const choice = await choiceDialog(
    pending ? `Передаёте визит ${userLabel(pending.to)}, ждём ответа.` : '',
    [
      pending
        ? { key: 'withdraw', label: 'Отозвать передачу' }
        : { key: 'transfer', label: 'Передать другому резиденту' },
      { key: 'unapprove', label: 'Отменить хостинг', destructive: true },
    ],
    { subject },
  )
  if (choice === 'transfer') {
    push('invite', { dateKey: r.dateKey, transferId: r.id, transferGuest: r.guest.name })
    return
  }
  if (choice === 'withdraw') {
    haptic.impact('light')
    markOwnTap()
    await action('transfer.decline', { id: r.id }, { quiet: true })
    return
  }
  if (choice !== 'unapprove') return
  // Подтверждение встаёт в тот же лист под той же шапкой, и действие в нём красное, как
  // строка меню, которая к нему привела.
  const ok = await confirmDialog('Заявка снова будет ждать ответа, гостю придёт сообщение.', {
    confirmLabel: 'Отменить хостинг',
    cancelLabel: 'Оставить',
    destructive: true,
    subject,
  })
  if (!ok) return
  markOwnTap()
  await action('unapprove', { id: r.id }, { quiet: true })
}

/**
 * Слово подписи «Захостить», разложенное на буквы: при смене слова буквы старого тают
 * волной, а нового на том же месте проявляются следом (см. .hb-ch). Морф идёт по
 * буквам, а не словом целиком: слово, сменившееся разом, читалось как мигание.
 */
export function MorphWord({ text, on }: { text: string; on: boolean }) {
  return (
    <span className={'hb-l' + (on ? ' on' : '')}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="hb-ch" style={{ '--i': i } as CSSProperties}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  )
}

/**
 * Сколько держится взведённая «Захостить» без второго тапа: кнопку, про которую
 * забыли, потом нажали бы случайно.
 */
const HOST_ARM_MS = 5000

export function RequestRow({
  r,
  archive = false,
  onHost,
  capacity,
}: {
  r: HostingRequest
  archive?: boolean
  /** Свой «Захостить»: после подтверждения экран дня ставит одобрение сразу, строка остаётся на месте. */
  onHost?: (r: HostingRequest) => void
  /** Вместимость дня. Экран дня знает её точнее bootstrap: в ней уже свои только что захостенные. */
  capacity?: DayCapacity
}) {
  const data = useStore().data!
  const me = data.me

  // «Захостить» в два тапа: первый взводит кнопку, второй хостит. Тап мимо неё и пауза
  // HOST_ARM_MS возвращают её назад.
  const [armed, setArmed] = useState(false)
  const hostRef = useRef<HTMLButtonElement>(null)
  const dayCapacity = capacity ?? data.days.find((d) => d.dateKey === r.dateKey)?.capacity
  // Лимит мягкий: он не запрещает хостить, а называет число до второго тапа. Заявки без
  // хоста места не занимают (см. dayOccupancy), поэтому предупреждаем ровно тогда, когда
  // место действительно занимают.
  const over = Boolean(dayCapacity && dayCapacity.occupied + 1 > dayCapacity.cap)
  useEffect(() => {
    if (!armed) return
    const onDown = (e: PointerEvent): void => {
      if (!hostRef.current?.contains(e.target as Node)) setArmed(false)
    }
    const timer = window.setTimeout(() => setArmed(false), HOST_ARM_MS)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.clearTimeout(timer)
    }
  }, [armed])

  // Второй тап: кнопка не исчезает, а становится пиллом хоста. Та же капсула вспыхивает
  // зелёным с галочкой, слово растворяется по буквам, капсула сжимается до размера пилла,
  // и в ней проявляются аватарка и ник (см. .pill-morphing). Размер кнопки снимается в
  // момент тапа: к следующему кадру её уже нет.
  const [morph, setMorph] = useState<{ w: number; h: number; bg: string; label: string } | null>(null)
  const approverRef = useRef<HTMLDivElement>(null)
  const hostedByMe = r.status === 'approved' && r.approvedBy?.userId === me.id
  const hostedByOther = r.status === 'approved' && !hostedByMe
  useLayoutEffect(() => {
    if (!morph) return
    // Гонку выиграл другой резидент: его пилл встаёт без морфа, наш нечего показывать.
    if (hostedByOther) {
      setMorph(null)
      return
    }
    const pill = approverRef.current?.querySelector<HTMLElement>('.pill')
    if (!hostedByMe || !pill) return
    // Конечный размер - тот, что пилл занял сам: класс морфа ставится уже после замера.
    const to = pill.getBoundingClientRect()
    const vars: [string, string][] = [
      ['--from-w', `${morph.w}px`],
      ['--from-h', `${morph.h}px`],
      ['--from-bg', morph.bg],
      ['--to-w', `${to.width}px`],
      ['--to-h', `${to.height}px`],
    ]
    for (const [k, v] of vars) pill.style.setProperty(k, v)
    pill.classList.add('pill-morphing')
    const done = (): void => setMorph(null)
    const onEnd = (e: AnimationEvent): void => {
      if (e.target === pill && e.animationName === 'pill-morph') done()
    }
    pill.addEventListener('animationend', onEnd)
    // animationend не придёт, если вкладку свернули посреди морфа.
    const timer = window.setTimeout(done, 1500)
    return () => {
      pill.removeEventListener('animationend', onEnd)
      window.clearTimeout(timer)
      pill.classList.remove('pill-morphing')
      for (const [k] of vars) pill.style.removeProperty(k)
    }
  }, [morph, hostedByMe, hostedByOther])
  const p = r.proposal
  // Заметки приходят только резидентам (см. bootstrap) — гостю тут всегда пусто.
  const guestNote = (data.notes || []).find((n) => n.userId === r.guest.userId) || null
  // Строка заявки живёт только на экране дня (живого или архивного) — туда и возвращаемся.
  const openNote = (): void => push('guestNote', { guest: r.guest, backLabel: 'День' })
  // «Впервые» в шапке листа по тому же счёту, что и значок у имени гостя ниже.
  const firstVisit = me.isResident && !archive && (data.guestStats?.[String(r.guest.userId)]?.past ?? 0) === 0
  const subject = sheetSubject(r, hostedByMe ? 'хостите вы' : firstVisit ? 'впервые' : '')

  // Переговоры о переносе адресные: пока висит предложение, работать с ним вправе
  // только его автор и адресат (тот же гейт стоит на сервере, см. proposalSides).
  // У записей без `to` (заведены до появления поля) остаётся прежнее «любой резидент».
  const iAmParty = !p || p.user.userId === me.id || (p.to ? p.to.userId === me.id : true)

  // Перенос и блокировка живут в свайпе (см. SwipeRow), в строке их кнопок нет.
  let canReschedule = false
  let right: ReactNode
  if (r.status === 'approved' && r.approvedBy) {
    const mine = !archive && r.approvedBy.userId === me.id
    // «Одобрил» - галочкой на аватарке хоста, а не подписью над пиллом: подпись была
    // отдельной строкой и раздувала строку заявки, а под заголовком «Одобрены» она ещё и
    // повторяла его. Словами остаётся в aria-label.
    const host = (
      <span className="pill-host">
        <Avatar user={r.approvedBy} />
        <span className="pill-ok" role="img" aria-label="хостит">
          {icons.check(8, '#fff', 3.2)}
        </span>
      </span>
    )
    const pill = mine ? (
      // Многоточие, а не крестик: за пиллом теперь два действия — передать и снять с себя.
      <button type="button" className="pill mine" aria-label="Вы хостите. Действия с хостингом" onClick={() => hostMenu(r, subject)}>
        {host}
        <span className="pill-name">{userLabel(r.approvedBy)}</span>
        <span className="pill-x">···</span>
        {morph ? (
          <span className="pill-fx" aria-hidden="true">
            <span className="pill-fx-word">
              {Array.from(morph.label).map((ch, i) => (
                <span key={i} className="pill-fx-ch" style={{ '--i': i } as CSSProperties}>
                  {ch === ' ' ? ' ' : ch}
                </span>
              ))}
            </span>
            <span className="pill-fx-check">{icons.check(16, '#fff', 2.6)}</span>
          </span>
        ) : null}
      </button>
    ) : (
      // Свой пилл занят меню хостинга — в профиль ведут только чужие.
      <Profile user={r.approvedBy} className="pill">
        {host}
        <span className="pill-name">{userLabel(r.approvedBy)}</span>
      </Profile>
    )
    right = (
      <div className="approver" ref={approverRef}>
        {pill}
      </div>
    )
    // Подтверждённый визит двигает только его хост.
    canReschedule = mine && iAmParty
  } else if (archive) {
    right = <span className="waiting-label">Без ответа</span>
  } else {
    right = (
      // Подтверждение - сама кнопка, а не диалог: диалог закрывал строку, ради которой
      // его открыли, и переспрашивал то, что в ней и так написано (гость, день, время).
      // Все три подписи лежат слоями, и ширину держит самая длинная: кнопка не меняет
      // размер ни при взводе, ни на переполненном дне, меняются только заливка и слово.
      <button
        ref={hostRef}
        type="button"
        className={'host-btn' + (armed ? ' armed' : '') + (armed && over ? ' over' : '')}
        aria-label={armed ? (over ? 'Захостить сверх вместимости' : 'Подтвердить хостинг') : 'Захостить'}
        onClick={async () => {
          if (!armed) {
            markOwnTap()
            if (over) haptic.notify('warning')
            else haptic.impact('light')
            setArmed(true)
            return
          }
          const el = hostRef.current
          if (el) {
            const box = el.getBoundingClientRect()
            setMorph({ w: box.width, h: box.height, bg: getComputedStyle(el).backgroundColor, label: over ? 'Всё равно' : 'Подтвердить' })
          }
          setArmed(false)
          if (onHost) return onHost(r)
          haptic.impact('medium')
          if (!(await action('approve', { id: r.id }))) setMorph(null)
        }}
      >
        <span className="hb-labels" aria-hidden="true">
          <MorphWord text="Захостить" on={!armed} />
          <MorphWord text="Подтвердить" on={armed && !over} />
          <MorphWord text="Всё равно" on={armed && over} />
        </span>
      </button>
    )
    canReschedule = iAmParty
  }

  // «Принять {слот}» остаётся в самой строке: это ответ на живое предложение гостя,
  // его нельзя прятать за жест — иначе предложение просто не заметят.
  const proposalRow: ReactNode =
    canReschedule && p && p.by === 'guest' ? (
      <div className="req-proposal-actions">
        <ActionButton
          className="accept-btn"
          onClick={async () => {
            haptic.impact('medium')
            markOwnTap()
            await action('proposal.accept', { id: r.id }, { quiet: true })
          }}
        >
          {icons.check(14, '#34c759', 2.4)}
          Принять {proposalSlot(r, p)}
        </ActionButton>
        {/* Отказ — половина переговоров, и сервер его разрешает (proposalSides:
            снять вправе адресат). Без него предложение можно было только принять. */}
        <ActionButton
          className="link-btn"
          onClick={async () => {
            haptic.impact('light')
            markOwnTap()
            await action('proposal.decline', { id: r.id }, { quiet: true })
          }}
        >
          Оставить {r.time}
        </ActionButton>
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
        <ActionButton
          className="accept-btn"
          onClick={async () => {
            haptic.impact('medium')
            markOwnTap()
            await action('transfer.accept', { id: r.id }, { quiet: true })
          }}
        >
          {icons.check(14, '#34c759', 2.4)}
          Взять визит
        </ActionButton>
        <ActionButton
          className="link-btn"
          onClick={async () => {
            haptic.impact('light')
            markOwnTap()
            await action('transfer.decline', { id: r.id }, { quiet: true })
          }}
        >
          Не смогу
        </ActionButton>
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
          <ActionButton
            className="link-btn pn-undo"
            onClick={async () => {
              haptic.impact('light')
              markOwnTap()
              await action('transfer.decline', { id: r.id }, { quiet: true })
            }}
          >
            Отозвать
          </ActionButton>
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
      onSelect: () => proposeRescheduleFor(r, subject),
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
      onSelect: () => closeRequest(r, subject),
    })
  }
  // Блокировать гостя вправе любой резидент, но не в архиве (там только чтение).
  if (me.isResident && !archive) {
    swipeActions.push({ key: 'block', label: 'Заблокировать', icon: icons.ban(21, '#fff'), tone: 'red', onSelect: () => blockGuest(r, subject) })
  }

  // Кто перед резидентом: новичок (встретить, объяснить про дверь), завсегдатай или
  // тот, кто уже не приходил. Числа - значками, а не пилюлями «5-й» и «2 неявки»: те
  // съедали имя до «Илья С…». Завсегдатай - дверь с числом прошлых визитов, неявки -
  // оранжевый кружок с крестиком, как ✗ в «Кто пришёл» (голый «×1» читался как «один
  // раз»). Новичок - словом «впервые»: это единственный статус, ради которого резидент
  // меняет поведение, а значок человечка с плюсом в приложении уже значит «позвать» и
  // читался как кнопка. Числа считаются по дням ДО сегодня (см. guestVisitStats). В
  // архиве значков нет: счёт ведётся на сегодня, и у прошлогодней строки он показал бы
  // не то, что было тогда.
  const stats = data.guestStats ? data.guestStats[String(r.guest.userId)] : undefined
  const past = stats?.past ?? 0
  const missed = stats?.missed ?? 0
  const openGuest = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation()
    push('guestVisits', { userId: r.guest.userId, user: r.guest })
  }
  const statsLabel = [
    past === 0 ? 'впервые' : `${past} ${plural(past, 'визит', 'визита', 'визитов')}`,
    missed > 0 ? `${missed} ${plural(missed, 'неявка', 'неявки', 'неявок')}` : '',
  ]
    .filter(Boolean)
    .join(', ')
  const visitStats = me.isResident && !archive ? (
    <button type="button" className="visit-stats" onClick={openGuest} aria-label={`Профиль гостя: ${statsLabel}`} title={statsLabel}>
      {past === 0 ? (
        <span className="visit-chip first">впервые</span>
      ) : (
        <span className="vs-item">
          {icons.door(13, sec(0.45))}
          {past}
        </span>
      )}
      {missed > 0 ? (
        <span className="vs-item vs-missed">
          <span className="vs-x">{icons.xmark(10, '#fff', 3.4)}</span>
          {missed}
        </span>
      ) : null}
    </button>
  ) : null

  const top = (
    <div className="req-top">
      <Avatar user={r.guest} className="req-avatar" profile />
      <div className="req-main">
        {/* Флажок «о госте есть заметка» — единственный её след в списке; тап ведёт в неё. */}
        <div className="req-name-line">
          {/* Имя ведёт в профиль гостя у нас, аватарка - в Telegram: резиденту
              история человека нужнее его страницы, а написать ему - на шаг дальше. */}
          {me.isResident ? (
            <button type="button" className="req-name req-name-btn" onClick={openGuest}>
              {r.guest.name}
            </button>
          ) : (
            <Profile user={r.guest} className="req-name">
              {r.guest.name}
            </Profile>
          )}
          {visitStats}
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
            {r.guest.username ? ' · ' : ''}
            <XText text={'к ' + r.time} />
            {r.anon ? ' · анонимно' : ''}
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
              <ActionButton
                className="link-btn pn-undo"
                onClick={async () => {
                  haptic.impact('light')
                  markOwnTap()
                  await action('proposal.decline', { id: r.id }, { quiet: true })
                }}
              >
                Отозвать
              </ActionButton>
            ) : null}
          </span>
        )}
      </div>
    ) : null

  // Сверх вместимости второй тап должен быть осознанным: пока кнопка взведена, под
  // строкой стоит, сколько уже занято.
  const capNote: ReactNode =
    armed && over && dayCapacity ? (
      <div className="proposal-note cap-note">
        {icons.warnTriangle(14, '#ff9500')}
        <span>
          в этот день уже <span className="pn-time">{`${dayCapacity.occupied} из ${dayCapacity.cap}`}</span>, визит сверх
          вместимости
        </span>
      </div>
    ) : null

  const hasExtra = Boolean(capNote) || Boolean(note) || Boolean(proposalRow) || Boolean(transferNote) || Boolean(transferRow)
  return (
    <SwipeRow actions={swipeActions}>
      <div className="row req-row">
        {top}
        <Collapse open={hasExtra}>
          <div className="req-extra">
            {capNote}
            {note}
            {proposalRow}
            {transferNote}
            {transferRow}
          </div>
        </Collapse>
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
