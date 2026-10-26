import { useContext, useEffect, useRef, useState } from 'react'
import { action, mutate } from '../api'
import { fmtDayMonth, fmtShortDate, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { reschedulePrompt } from '../modals'
import { getDataAt, pop, push, setData, setTopParams, useParams, useStore } from '../store'
import { bringBack, dustRow, offerUndo, removeRow, screenSettled, topScreen, type Undoable } from '../undo'
import { sec } from '../theme'
import { useIcsLink } from '../links'
import { haptic } from '../telegram'
import { ActionButton, BackRow, Header, Sep, SectionTitle } from '../components/common'
import { Collapse } from '../components/Collapse'
import { XText } from '../components/Flip'
import { markOwnTap } from '../motion'
import { RemindCard } from '../components/forms'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'
import { usePullDismiss } from '../components/usePullDismiss'
import { heroRunning } from '../hero'
import { UnderContext } from '../screenContext'
import { ADDRESS, ENTRANCE } from './Route'

/** 'HH:MM' → минуты от полуночи. -1, если строка не разбирается. */
export function minuteOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}

/** «1 ч 40 мин», «25 мин»: сколько осталось до визита. */
const untilText = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}\u00a0мин`
  return m > 0 ? `${h}\u00a0ч ${m}\u00a0мин` : `${h}\u00a0ч`
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
/** Живая минута в поясе спейса: снимок из bootstrap плюс время, прошедшее с загрузки. */
export function useNowMin(): number {
  const { data } = useStore()
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return minuteOfDay(data!.nowTime) + Math.floor((Date.now() - getDataAt()) / 60_000)
}

function ArrivalCard({ id, arrivedAt }: { id: string; arrivedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Галочка встаёт с перелётом, только когда сообщили своим тапом сейчас.
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!pop) return
    const timer = window.setTimeout(() => setPop(false), 600)
    return () => window.clearTimeout(timer)
  }, [pop])

  const at = arrivedAt ? Date.parse(arrivedAt) : NaN
  const sent = Number.isFinite(at)
  const left = sent ? at + ARRIVAL_COOLDOWN_MS - now : 0
  const waiting = left > 0
  const mins = sent ? Math.max(0, Math.floor((now - at) / 60_000)) : 0

  return (
    <div className="arrival-card">
      <div className="arrival-head">
        <div className={'arrival-icon' + (pop ? ' pop' : '')}>{sent ? icons.check(19, '#34c759', 2.2) : icons.pin(19, '#34c759')}</div>
        <div style={{ minWidth: 0 }}>
          <div className="arrival-title">
            <XText text={!sent ? 'Уже у двери?' : mins === 0 ? 'Сообщили только что' : `Сообщили ${mins} мин назад`} />
          </div>
          <div className="arrival-sub">
            <XText text={sent ? 'Открывают. Если никто не вышел, сообщите ещё раз' : 'Скажу тем, кто сейчас в спейсе'} delay={60} />
          </div>
        </div>
      </div>
      {/* Единственная кнопка, которую гость жмёт у двери, нервничая: удар сразу, ждёт она
          сама, а не весь экран. Ушло сообщение, и галочка встаёт с успехом. */}
      <ActionButton
        className="arrival-btn"
        disabled={waiting}
        onClick={async () => {
          haptic.impact('medium')
          markOwnTap()
          const done = await action('arrived', { id }, { quiet: true })
          if (done) {
            haptic.notify('success')
            setPop(true)
          }
        }}
      >
        {waiting ? `Сообщить ещё раз можно через ${countdown(left)}` : sent ? 'Сообщить ещё раз' : 'Я на месте'}
      </ActionButton>
    </div>
  )
}

export function Visit() {
  const params = useParams()
  const { data, stack } = useStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const under = useContext(UnderContext)
  usePullDismiss(rootRef, { enabled: !under && stack.length > 1 })
  const past = data!.myPast ?? []
  // Прошедший визит открывается из «Были раньше» - тот же экран, только читать.
  const found = data!.myRequests.find((x) => x.id === params.id) ?? past.find((x) => x.id === params.id)
  // Отменённая заявка пропадает из данных раньше, чем экран: «назад» идёт переходом, и до
  // его конца экран показывает визит, каким он был, а не пустоту.
  const kept = useRef(found)
  if (found) kept.current = found
  const r = found ?? kept.current
  const isPast = Boolean(r && past.some((x) => x.id === r.id))
  // Заявку отменили или закрыли не отсюда — возвращаемся к списку. Своя отмена уже уводит
  // с экрана переходом, второй pop снял бы ещё один экран.
  useEffect(() => {
    if (!found && !heroRunning()) pop()
  }, [found])
  const openIcs = useIcsLink('visit', r?.id ?? '', !!found && !isPast)
  const nowMin = useNowMin()
  // Поднимается один раз: вернулись на визит позже, и он просто стоит. Если форма перешла в
  // визит переходом (кнопка выросла в карточку статуса), подниматься ему уже незачем.
  const fresh = params.fresh === 1
  const [rise] = useState(() => fresh && !heroRunning())
  useEffect(() => {
    if (!fresh) return
    const timer = window.setTimeout(() => setTopParams({ ...params, fresh: undefined }), 1200)
    return () => window.clearTimeout(timer)
  }, [fresh])
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
          <div className="status-card-icon">{icons.clock(15, sec(0.55), p.time)}</div>
          <span className="status-card-title">
            {p.dateKey !== r.dateKey ? 'Резидент предлагает другой день' : 'Резидент предлагает другое время'}
          </span>
        </div>
        <div className="propose-time-big">
          <span className="ptb-new">{slotLabel(p.dateKey, p.time)}</span>
          <span className="ptb-old">{slotLabel(r.dateKey, r.time)}</span>
        </div>
        <div className="propose-actions">
          <ActionButton
            className="primary-btn"
            onClick={async () => {
              haptic.impact('medium')
              markOwnTap()
              await action('proposal.accept', { id: r.id }, { quiet: true })
            }}
          >
            Принять
          </ActionButton>
          <button
            className="chip-btn"
            onClick={async () => {
              const slot = await reschedulePrompt({
                text: 'Предложить свой день или время визита?',
                initialDay: p.dateKey,
                initialTime: p.time,
              })
              if (!slot) return
              markOwnTap()
              const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time }, { quiet: true })
              if (done) haptic.notify('success')
            }}
          >
            Своё
          </button>
        </div>
        <ActionButton
          className="link-btn ptb-keep"
          onClick={async () => {
            haptic.impact('light')
            markOwnTap()
            await action('proposal.decline', { id: r.id }, { quiet: true })
          }}
        >
          Оставить как есть ({slotLabel(r.dateKey, r.time)})
        </ActionButton>
      </div>
    )
  } else if (p && p.by === 'guest') {
    // Гость предложил свой слот — ждём резидента; можно изменить или отозвать.
    proposalCard = (
      <div className="status-card proposal">
        <div className="status-card-head">
          <div className="status-card-icon">{icons.clock(15, sec(0.55), p.time)}</div>
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
              markOwnTap()
              const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time }, { quiet: true })
              if (done) haptic.notify('success')
            }}
          >
            Изменить
          </button>
          <ActionButton
            className="chip-btn"
            onClick={async () => {
              haptic.impact('light')
              markOwnTap()
              await action('proposal.decline', { id: r.id }, { quiet: true })
            }}
          >
            Отозвать
          </ActionButton>
        </div>
      </div>
    )
  } else if (!approved) {
    // Только что отправленная заявка: в эту карточку вырастает кнопка «Отправить заявку».
    statusCard = (
      <div className="status-card pending" data-hero-screen="cta" data-hero-part="cta">
        {/* Содержимое проявляется, когда кнопка отправки уже выросла в карточку. */}
        <div data-hero-part="cta-body">
          <div className="status-card-head">
            <div className="status-card-icon">{icons.clock(15, sec(0.55), r.time)}</div>
            <span className="status-card-title">Заявка ждёт ответа</span>
          </div>
          <div className="status-card-note">
            Резиденты видят вашу заявку.
            <br />
            <span className="note-warn">
              {icons.warning()}
              Одобрение заявки обязательно для посещения.
            </span>
          </div>
        </div>
      </div>
    )
  }

  // «Я на месте»: окно - за полчаса до слота и час после (сервер проверяет то же).
  // Считаем в поясе спейса: `todayKey`/`nowTime` приходят из bootstrap, локальные часы
  // устройства тут не при чём. Но саму минуту пересчитываем на ходу: приложение
  // открывают по дороге (адрес, «Как пройти»), и к двери человек приходит с уже
  // открытым экраном — на замороженном снимке карточка просто не появлялась.
  const slotMin = minuteOfDay(r.time)
  // В день визита подпись считает, сколько до него осталось.
  const left = !isPast && r.dateKey === data!.todayKey ? slotMin - nowMin : -1
  const arrivalOpen =
    approved && !isPast && r.dateKey === data!.todayKey && nowMin >= slotMin - 30 && nowMin <= slotMin + 60

  const askReschedule = async (): Promise<void> => {
    const slot = await reschedulePrompt({
      text: 'Попросить перенести визит на другой день или время?',
      initialDay: r.dateKey,
      initialTime: r.time,
      confirmLabel: 'Попросить',
    })
    // Оставили слот как есть: переносить нечего (сервер тоже это гасит).
    if (!slot || (slot.dateKey === r.dateKey && slot.time === r.time)) return
    markOwnTap()
    const done = await action('propose', { id: r.id, dateKey: slot.dateKey, time: slot.time }, { quiet: true })
    if (done) haptic.notify('success')
  }

  // Без вопроса: отмена обратима. Экран сразу уходит к визитам, и строка визита рассыпается
  // уже там, а внизу пять секунд висит «Вернуть». Хосту сервер пишет по концу отсчёта.
  const cancelVisit = async (): Promise<void> => {
    markOwnTap()
    haptic.impact('medium')
    const request = mutate<Undoable>('cancel', { id: r.id })
    const from = topScreen()
    pop()
    await screenSettled(from)
    const key = 'visit-' + r.id
    const res = await removeRow(dustRow(key), request)
    if (!res) return
    setData(res.data)
    offerUndo('Заявка отменена', res.data.undo, (data) => bringBack(key, res.dust, () => setData(data)))
  }

  return (
    <Screen>
      <BackRow label="Мои визиты" />
      {/* Только что отправленная заявка: форма погасла, и визит поднимается на её месте. */}
      <div className={rise ? 'visit-rise' : undefined} ref={rootRef}>
      <Header
        title={
          <XText text={WEEKDAYS_FULL[weekdayIdx(r.dateKey)]!} />
        }
        subtitle={
          <>
            <XText text={`${fmtDayMonth(r.dateKey)} · к ${r.time}`} delay={120} />
            {/* Минута меняется без движения: это часы, а не ответ на тап. */}
            {left > 0 ? ` · через ${untilText(left)}` : null}
          </>
        }
      />
      {arrivalOpen ? <ArrivalCard id={r.id} arrivedAt={r.arrivedAt} /> : null}
      {isPast ? null : statusCard}
      <Collapse open={!isPast && Boolean(proposalCard)}>{proposalCard}</Collapse>
      <SectionTitle>Детали</SectionTitle>
      <div className="card">
        <div className="row">
          <span className="kv-key">Когда</span>
          <span className="kv-val">
            <XText text={`${fmtShortDate(r.dateKey)} · ${r.time}`} delay={120} />
          </span>
        </div>
        <Sep left={14} />
        <div className="row">
          <span className="kv-key">Видимость</span>
          <span className="kv-val">{r.anon ? 'Анонимно' : 'Обычная'}</span>
        </div>
        {/* Куда идти — тот же вопрос, что «когда»: у двери карточка визита это
            первое, что открывают, а адрес до сих пор жил только в «Моих визитах». */}
        {!isPast ? (
          <>
            <Sep left={14} />
            <button type="button" className="row tappable" onClick={() => push('route')}>
              <span className="kv-key">Где</span>
              <div className="row-right">
                <span className="kv-val" style={{ marginLeft: 0 }}>
                  {ADDRESS}
                  <span className="kv-sub">{ENTRANCE}</span>
                </span>
                {icons.chevron()}
              </div>
            </button>
          </>
        ) : null}
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
              // Чип отвечает щелчком; у тумблера свой удар, и щелчок рядом с ним гасится.
              haptic.tick()
              await action('remind.set', { id: r.id, choice: choice ?? 'off' }, { quiet: true })
            }}
          />
        </div>
      )}
      {/* Перенос, календарь и отмена строками одной карточки, а не тремя карточками
          по кнопке: экран визита кончается одним блоком действий, как в настройках iOS. */}
      {isPast ? null : (
        <div className="card visit-acts">
          {/* Правка доступна, пока визит не одобрен: сервер тоже это проверяет. У
              подтверждённого вместо неё просьба перенести день или время. */}
          {!approved ? (
            <button type="button" className="row tappable" onClick={() => push('editRequest', { id: r.id })}>
              <span className="act-ico">{icons.pencil()}</span>
              <span className="add-row-label">Изменить день или время</span>
            </button>
          ) : !p ? (
            <button type="button" className="row tappable" onClick={() => void askReschedule()}>
              <span className="act-ico">{icons.clock(18, 'currentColor')}</span>
              <span className="add-row-label">Попросить перенести</span>
            </button>
          ) : null}
          {!approved || !p ? <Sep left={46} /> : null}
          {/* .ics отдаёт сервер (см. /visit.ics): разовая ссылка, которую открывает
              системный браузер, а оттуда файл уходит в календарь. */}
          <button type="button" className="row tappable" onClick={() => void openIcs()}>
            <span className="act-ico">{icons.calendarPlus(19, 'currentColor')}</span>
            <span className="add-row-label">Добавить в календарь</span>
          </button>
          {/* Отмеченный резидентом визит - уже история: сервер отмену не примет. */}
          {r.visit?.source === 'mark' ? null : (
            <>
              <Sep left={46} />
              <button type="button" className="row tappable" onClick={() => void cancelVisit()}>
                <span className="act-ico danger">{icons.xmark(19, 'currentColor')}</span>
                <span className="add-row-label danger">Отменить заявку</span>
              </button>
            </>
          )}
        </div>
      )}
      </div>
    </Screen>
  )
}
