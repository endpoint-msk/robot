import { useEffect } from 'react'
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
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'

/** Сколько минут прошло с ISO-метки. Считаем по абсолютному времени - пояс не нужен. */
function minutesSince(iso: string): number {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - at) / 60_000)
}

/** 'HH:MM' → минуты от полуночи. -1, если строка не разбирается. */
function minuteOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
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
  const sinceArrival = r.arrivedAt ? minutesSince(r.arrivedAt) : null
  // Пока не прошёл антиспам, вместо кнопки - подтверждение: жать второй раз бесполезно.
  const justArrived = sinceArrival !== null && sinceArrival < 5

  const arrivalCard = !arrivalOpen ? null : justArrived ? (
    <div className="arrival-card done">
      <div className="arrival-icon done">{icons.check(17, '#34c759', 2.2)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="arrival-title">{sinceArrival === 0 ? 'Сообщил только что' : `Сообщил ${sinceArrival} мин назад`}</div>
        <div className="arrival-sub">Открывают. Если долго нет - нажмите ещё раз через пару минут</div>
      </div>
    </div>
  ) : (
    <div className="arrival-card">
      <div className="arrival-head">
        <div className="arrival-icon">{icons.pin(19, '#34c759')}</div>
        <div style={{ minWidth: 0 }}>
          <div className="arrival-title">Уже у двери?</div>
          <div className="arrival-sub">Скажу тем, кто сейчас в спейсе</div>
        </div>
      </div>
      <button
        className="arrival-btn"
        onClick={async () => {
          const done = await action('arrived', { id: r.id })
          if (done) haptic('success')
        }}
      >
        {sinceArrival === null ? 'Я на месте' : 'Сообщить ещё раз'}
      </button>
    </div>
  )

  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title={WEEKDAYS_FULL[weekdayIdx(r.dateKey)]} subtitle={`${fmtDayMonth(r.dateKey)} · к ${r.time}`} />
      {arrivalCard}
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
          const ok = await confirmDialog('Отменить заявку на визит?', { confirmLabel: 'Отменить', destructive: true })
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
