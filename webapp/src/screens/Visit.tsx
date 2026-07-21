import { useEffect } from 'react'
import { action, api } from '../api'
import { fmtDayMonth, fmtShortDate, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { confirmDialog, showAlert, timePrompt } from '../modals'
import { pop, push, setBusy, setData, useParams, useStore } from '../store'
import { sec } from '../theme'
import { haptic, initData, tg } from '../telegram'
import type { Bootstrap } from '../types'
import { BackRow, Header, Sep, SectionTitle } from '../components/common'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'

export function Visit() {
  const params = useParams()
  const { data } = useStore()
  const r = data!.myRequests.find((x) => x.id === params.id)
  // Заявку могли отменить/она протухла — возвращаемся к списку.
  useEffect(() => {
    if (!r) pop()
  }, [r])
  if (!r) return <Screen />

  const approved = r.status === 'approved' && !!r.approvedBy
  const p = r.timeProposal

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
    // Резидент предложил другое время — гость принимает или отвечает своим.
    proposalCard = (
      <div className="status-card proposal">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55))}</div>
          <span className="status-card-title">Резидент предлагает другое время</span>
        </div>
        <div className="propose-time-big">
          <span className="ptb-new">{p.time}</span>
          <span className="ptb-old">{r.time}</span>
        </div>
        <div className="propose-actions">
          <button
            className="primary-btn"
            onClick={async () => {
              const done = await action('proposal.accept', { id: r.id })
              if (done) haptic('success')
            }}
          >
            Принять {p.time}
          </button>
          <button
            className="chip-btn"
            onClick={async () => {
              const time = await timePrompt({ text: 'Предложить своё время визита?', initial: p.time, confirmLabel: 'Предложить' })
              if (!time) return
              const done = await action('propose', { id: r.id, time })
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
          Оставить как есть ({r.time})
        </button>
      </div>
    )
  } else if (p && p.by === 'guest') {
    // Гость предложил своё время — ждём резидента; можно изменить или отозвать.
    proposalCard = (
      <div className="status-card proposal">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55))}</div>
          <span className="status-card-title">Ждём ответа резидента</span>
        </div>
        <div className="propose-time-big">
          <span className="ptb-new">{p.time}</span>
          <span className="ptb-old">{r.time}</span>
        </div>
        <div className="status-card-note">Вы предложили это время. Резидент примет его или предложит другое.</div>
        <div className="propose-actions">
          <button
            className="chip-btn"
            onClick={async () => {
              const time = await timePrompt({ text: 'Изменить предложенное время?', initial: p.time, confirmLabel: 'Обновить' })
              if (!time) return
              const done = await action('propose', { id: r.id, time })
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

  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title={WEEKDAYS_FULL[weekdayIdx(r.dateKey)]} subtitle={`${fmtDayMonth(r.dateKey)} · к ${r.time}`} />
      {statusCard}
      {proposalCard}
      {/* Правка доступна, пока визит не одобрен: сервер тоже это проверяет. */}
      {!approved ? (
        <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => push('editRequest', { id: r.id })}>
          {icons.pencil()}
          Изменить день или время
        </button>
      ) : null}
      {/* У подтверждённого визита день уже не двигаем, а время можно попросить перенести. */}
      {approved && !p ? (
        <button
          className="secondary-btn"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const time = await timePrompt({
              text: 'Попросить перенести визит на другое время?',
              initial: r.time,
              confirmLabel: 'Попросить',
            })
            // Оставили время как есть — переносить нечего (сервер тоже это гасит).
            if (!time || time === r.time) return
            const done = await action('propose', { id: r.id, time })
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
      <div style={{ height: 22 }} />
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
    </Screen>
  )
}
