import { useEffect, useState } from 'react'
import { action, api } from '../api'
import { fmtDayMonth, fmtShortDate, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { confirmDialog, reschedulePrompt, showAlert } from '../modals'
import { pop, push, setBusy, setData, useParams, useStore } from '../store'
import { sec } from '../theme'
import { haptic, initData, tg } from '../telegram'
import type { Bootstrap } from '../types'
import { BackRow, Header, Sep, SectionTitle } from '../components/common'
import { RemindCard } from '../components/forms'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'

/** 'HH:MM' → минуты от полуночи. -1, если строка не разбирается. */
function minuteOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}

/** Антиспам повторного «Я на месте». Столько же держит сервер (ARRIVAL_COOLDOWN_MS). */
const ARRIVAL_COOLDOWN_MS = 5 * 60_000

/** 'M:SS' — обратный отсчёт до следующего нажатия. */
const countdown = (ms: number): string => {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * «Я на месте»: гость у двери жмёт кнопку, DM уходит хосту и тем, кто внутри.
 * Отдельный компонент из-за секундного таймера - он нужен только пока карточка на
 * экране, а отсчёт до следующего нажатия должен идти сам: bootstrap за это время не
 * перезапрашивается, и без тика кнопка так и осталась бы выключенной.
 */
function ArrivalCard({ id, arrivedAt }: { id: string; arrivedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const at = arrivedAt ? Date.parse(arrivedAt) : NaN
  const sent = Number.isFinite(at)
  const left = sent ? at + ARRIVAL_COOLDOWN_MS - now : 0
  const waiting = left > 0
  const mins = sent ? Math.max(0, Math.floor((now - at) / 60_000)) : 0

  return (
    <div className="arrival-card">
      <div className="arrival-head">
        <div className="arrival-icon">{sent ? icons.check(19, '#34c759', 2.2) : icons.pin(19, '#34c759')}</div>
        <div style={{ minWidth: 0 }}>
          <div className="arrival-title">
            {!sent ? 'Уже у двери?' : mins === 0 ? 'Сообщили только что' : `Сообщили ${mins} мин назад`}
          </div>
          <div className="arrival-sub">
            {sent ? 'Открывают. Если никто не вышел, сообщите ещё раз' : 'Скажу тем, кто сейчас в спейсе'}
          </div>
        </div>
      </div>
      <button
        className="arrival-btn"
        disabled={waiting}
        onClick={async () => {
          const done = await action('arrived', { id })
          if (done) haptic('success')
        }}
      >
        {waiting ? `Сообщить ещё раз можно через ${countdown(left)}` : sent ? 'Сообщить ещё раз' : 'Я на месте'}
      </button>
    </div>
  )
}

export function Visit() {
  const params = useParams()
  const { data } = useStore()
  const past = data!.myPast ?? []
  // Прошедший визит открывается из «Были раньше» - тот же экран, только читать.
  const r = data!.myRequests.find((x) => x.id === params.id) ?? past.find((x) => x.id === params.id)
  const isPast = Boolean(r && past.some((x) => x.id === r.id))
  // Заявку могли отменить/она протухла — возвращаемся к списку.
  useEffect(() => {
    if (!r) pop()
  }, [r])
  if (!r) return <Screen />

  const approved = r.status === 'approved' && !!r.approvedBy
  const p = r.proposal
  // Слот с днём, если предложенный день отличается от текущего дня заявки; иначе только время.
  const slotLabel = (dateKey: string, time: string): string =>
    p && p.dateKey !== r.dateKey ? `${fmtShortDate(dateKey)} · ${time}` : time

  // Карточка статуса и карточка предложения независимы: у подтверждённого визита
  // тоже может висеть перенос, и тогда показываем обе.
  let statusCard = null
  let proposalCard = null
  if (approved) {
    statusCard = (
      <div className="status-card approved">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.check(14, 'currentColor', 2)}</div>
          <span className="status-card-title">Ваш визит подтверждён</span>
        </div>
        <div className="status-card-body">
          <Avatar user={r.approvedBy!} className="host-avatar" profile />
          <div style={{ minWidth: 0 }}>
            <div className="host-kicker">Вас хостит</div>
            <Profile user={r.approvedBy!} className="host-name">
              {r.approvedBy!.name}
            </Profile>
            <div className="host-sub">
              {(r.approvedBy!.username ? '@' + r.approvedBy!.username + ' · ' : '') + 'резидент'}
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (p && p.by === 'resident') {
    // Резидент предложил другой слот — гость принимает или отвечает своим.
    proposalCard = (
      <div className="status-card proposal">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55))}</div>
          <span className="status-card-title">
            {p.dateKey !== r.dateKey ? 'Резидент предлагает другой день' : 'Резидент предлагает другое время'}
          </span>
        </div>
        <div className="propose-time-big">
          <span className="ptb-new">{slotLabel(p.dateKey, p.time)}</span>
          <span className="ptb-old">{slotLabel(r.dateKey, r.time)}</span>
        </div>
        <div className="propose-actions">
          <button
            className="primary-btn"
            onClick={async () => {
              const done = await action('proposal.accept', { id: r.id })
              if (done) haptic('success')
            }}
          >
            Принять
          </button>
          <button
            className="chip-btn"
            onClick={async () => {
              const slot = await reschedulePrompt({
                text: 'Предложить свой день или время визита?',
                initialDay: p.dateKey,
                initialTime: p.time,
              })
              if (!slot) return
              const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time })
              if (done) haptic('success')
            }}
          >
            Своё
          </button>
        </div>
        <button
          className="link-btn"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const done = await action('proposal.decline', { id: r.id })
            if (done) haptic('warning')
          }}
        >
          Оставить как есть ({slotLabel(r.dateKey, r.time)})
        </button>
      </div>
    )
  } else if (p && p.by === 'guest') {
    // Гость предложил свой слот — ждём резидента; можно изменить или отозвать.
    proposalCard = (
      <div className="status-card proposal">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55))}</div>
          <span className="status-card-title">Ждём ответа резидента</span>
        </div>
        <div className="propose-time-big">
          <span className="ptb-new">{slotLabel(p.dateKey, p.time)}</span>
          <span className="ptb-old">{slotLabel(r.dateKey, r.time)}</span>
        </div>
        <div className="status-card-note">Вы предложили этот вариант. Резидент примет его или предложит другой.</div>
        <div className="propose-actions">
          <button
            className="chip-btn"
            onClick={async () => {
              const slot = await reschedulePrompt({
                text: 'Изменить предложенный вариант?',
                initialDay: p.dateKey,
                initialTime: p.time,
                confirmLabel: 'Обновить',
              })
              if (!slot) return
              const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time })
              if (done) haptic('success')
            }}
          >
            Изменить
          </button>
          <button
            className="chip-btn"
            onClick={async () => {
              const done = await action('proposal.decline', { id: r.id })
              if (done) haptic('warning')
            }}
          >
            Отозвать
          </button>
        </div>
      </div>
    )
  } else if (!approved) {
    statusCard = (
      <div className="status-card pending">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55))}</div>
          <span className="status-card-title">Заявка ждёт ответа</span>
        </div>
        <div className="status-card-note">
          Резиденты видят вашу заявку. Как только кто-то возьмётся захостить - бот напишет вам в личку.
        </div>
      </div>
    )
  }

  // «Я на месте»: окно - за полчаса до слота и час после (сервер проверяет то же).
  // Считаем в поясе спейса: `todayKey`/`nowTime` приходят из bootstrap, локальные часы
  // устройства тут не при чём.
  const slotMin = minuteOfDay(r.time)
  const nowMin = minuteOfDay(data!.nowTime)
  const arrivalOpen =
    approved && !isPast && r.dateKey === data!.todayKey && nowMin >= slotMin - 30 && nowMin <= slotMin + 60

  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title={WEEKDAYS_FULL[weekdayIdx(r.dateKey)]} subtitle={`${fmtDayMonth(r.dateKey)} · к ${r.time}`} />
      {arrivalOpen ? <ArrivalCard id={r.id} arrivedAt={r.arrivedAt} /> : null}
      {isPast ? null : statusCard}
      {isPast ? null : proposalCard}
      {/* Правка доступна, пока визит не одобрен: сервер тоже это проверяет. */}
      {!approved && !isPast ? (
        <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => push('editRequest', { id: r.id })}>
          {icons.pencil()}
          Изменить день или время
        </button>
      ) : null}
      {/* У подтверждённого визита можно попросить перенести день или время. */}
      {approved && !p && !isPast ? (
        <button
          className="secondary-btn"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const slot = await reschedulePrompt({
              text: 'Попросить перенести визит на другой день или время?',
              initialDay: r.dateKey,
              initialTime: r.time,
              confirmLabel: 'Попросить',
            })
            // Оставили слот как есть — переносить нечего (сервер тоже это гасит).
            if (!slot || (slot.dateKey === r.dateKey && slot.time === r.time)) return
            const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time })
            if (done) haptic('success')
          }}
        >
          {icons.clock(17, '#007aff')}
          Попросить перенести
        </button>
      ) : null}
      <SectionTitle>Детали</SectionTitle>
      <div className="card">
        <div className="row">
          <span className="kv-key">Когда</span>
          <span className="kv-val">{`${fmtShortDate(r.dateKey)} · ${r.time}`}</span>
        </div>
        <Sep left={14} />
        <div className="row">
          <span className="kv-key">Видимость</span>
          <span className="kv-val">{r.anon ? 'Анонимно' : 'Обычная'}</span>
        </div>
        {r.purpose ? <Sep left={14} /> : null}
        {r.purpose ? (
          <div className="kv-block">
            <div className="kv-cap">Цель визита</div>
            <div className="kv-text">{linkedText(r.purpose)}</div>
          </div>
        ) : null}
      </div>
      {/* Напоминание правится и после создания заявки — в том числе у подтверждённого
          визита, где сама заявка уже не редактируется. */}
      {isPast ? null : (
        <div style={{ marginTop: 22 }}>
          <RemindCard
            dateKey={r.dateKey}
            time={r.time}
            choice={r.remind?.choice ?? null}
            sentAt={r.remind?.sentAt}
            onChange={async (choice) => {
              const done = await action('remind.set', { id: r.id, choice: choice ?? 'off' })
              if (done) haptic('success')
            }}
          />
        </div>
      )}
      {isPast ? null : (
      <button
        className="secondary-btn"
        onClick={() => {
          // .ics отдаёт сервер (см. /visit.ics): подписанная ссылка, которую открывает
          // системный браузер — оттуда файл уходит в календарь.
          const url =
            `${location.origin}/visit.ics?id=${encodeURIComponent(r.id)}` +
            `&initData=${encodeURIComponent(initData())}`
          try {
            tg!.openLink(url)
          } catch {
            window.open(url, '_blank')
          }
        }}
      >
        {icons.calendarPlus()}
        Добавить в календарь
      </button>
      )}
      <div style={{ height: 22 }} />
      {isPast ? null : (
      <button
        className="destructive-btn"
        onClick={async () => {
          const ok = await confirmDialog('Отменить заявку на визит?', {
            confirmLabel: 'Отменить заявку',
            cancelLabel: 'Оставить',
            destructive: true,
          })
          if (!ok) return
          setBusy(true)
          try {
            setData(await api<Bootstrap>('cancel', { id: r.id }))
            haptic('warning')
            pop()
          } catch (err) {
            showAlert((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Отменить заявку
      </button>
      )}
    </Screen>
  )
}
