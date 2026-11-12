import { useContext, useEffect, useRef, useState } from 'react'
import { action, mutate } from '../api'
import { fmtDayMonth, fmtShortDate, visitDayWord } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { showAlert } from '../modals'
import { getDataAt, pop, push, setData, setTopParams, useParams, useStore } from '../store'
import { bringBack, dustRow, offerUndo, removeRow, screenSettled, topScreen, type Undoable } from '../undo'
import { sec } from '../theme'
import { useIcsLink } from '../links'
import { haptic } from '../telegram'
import type { HostingRequest } from '../types'
import { ActionButton, BackRow, Header, Sep, SectionTitle, SwitchRow } from '../components/common'
import { Collapse } from '../components/Collapse'
import { XText } from '../components/Flip'
import { markOwnTap } from '../motion'
import { DayChips, isPastForToday, reminderFor } from '../components/forms'
import { focusInPlace, InPlaceField } from '../components/InPlaceField'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'
import { TimeWheels, Unfold } from '../components/TimeField'
import { usePullDismiss } from '../components/usePullDismiss'
import { heroRunning } from '../hero'
import { UnderContext } from '../screenContext'
import { useRemind } from './NewRequest'
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
 * Отдельный компонент из-за секундного таймера - он нужен только пока кнопка на
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

function ArrivalButton({ id, arrivedAt }: { id: string; arrivedAt?: string | null }) {
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

  // Капсула без плашки: пока идёт антиспам, она серая и считает до следующего раза, как
  // «Отправить код ещё раз» в Telegram, а прятать её значило бы оставить гостя без кнопки.
  // Единственная кнопка, которую гость жмёт у двери, нервничая: удар сразу, ждёт она
  // сама, а не весь экран. Ушло сообщение, и галочка встаёт с успехом.
  return (
    <ActionButton
      className={'arrival-btn' + (waiting ? ' sent' : '')}
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
      <span className={'arrival-ic' + (pop ? ' pop' : '')}>{sent ? icons.check(18, 'currentColor', 2.2) : icons.pin(18, 'currentColor')}</span>
      {/* Отсчёт не в XText: после своего тапа тот перетекал бы на каждой секунде. */}
      <span>
        <XText text={waiting ? 'Сообщили · ещё раз через' : sent ? 'Сообщить ещё раз' : 'Я на месте'} />
        {waiting ? `\u00a0${countdown(left)}` : null}
      </span>
    </ActionButton>
  )
}

/** Полный набор полей `edit`: сервер переписывает заявку целиком, а не по одному полю. */
const editBody = (r: HostingRequest, patch: { dateKey?: string; time?: string; purpose?: string; anon?: boolean }) => {
  const dateKey = patch.dateKey ?? r.dateKey
  const time = patch.time ?? r.time
  return {
    id: r.id,
    dateKey,
    time,
    purpose: patch.purpose ?? r.purpose,
    anon: patch.anon ?? r.anon,
    remind: reminderFor(dateKey, time, r.remind?.choice ?? null),
  }
}

/**
 * Цель визита правится на месте, как тема дня: касание ставит курсор в текст, «Готово»
 * сохраняет, уход из поля отменяет. Набранное держится до ответа сервера.
 */
function VisitPurpose({ r, editable }: { r: HostingRequest; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const shown = pending ?? r.purpose
  if (!editable && !shown) return null
  const start = (): void => focusInPlace(() => setEditing(true), () => field.current)
  const done = async (text: string): Promise<void> => {
    setEditing(false)
    if (text === r.purpose) return
    markOwnTap()
    setPending(text)
    await action('edit', editBody(r, { purpose: text }), { quiet: true })
    setPending(null)
  }
  return (
    <>
      <Sep inset="text" />
      {editing ? (
        <div className="kv-block">
          <div className="kv-cap">Цель визита</div>
          <InPlaceField
            initial={shown}
            maxLength={300}
            placeholder="Зачем придёте"
            label="Цель визита"
            className="kv-text kv-in"
            fieldRef={(el) => {
              field.current = el
            }}
            onDone={(v) => void done(v)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : editable ? (
        <button type="button" className="kv-block kv-tap" onClick={start}>
          <div className="kv-cap">Цель визита</div>
          <div className={'kv-text' + (shown ? '' : ' kv-empty')}>{shown || 'Добавить'}</div>
        </button>
      ) : (
        <div className="kv-block">
          <div className="kv-cap">Цель визита</div>
          <div className="kv-text">{linkedText(shown)}</div>
        </div>
      )}
    </>
  )
}

type Slot = { day: string; time: string }

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
  // Строка «Когда» раскрывает дни и колесо прямо в визите. Черновик слота живёт здесь:
  // шапка и строка показывают его, пока он отличается от заявки, а уходит он капсулой.
  const [whenOpen, setWhenOpen] = useState(false)
  const [draft, setDraft] = useState<Slot | null>(null)
  // Колесо берёт значение только при монтировании: каждое раскрытие - новое колесо.
  const [wheelKey, setWheelKey] = useState(0)
  const remindUi = useRemind(
    r?.dateKey ?? data!.todayKey,
    r?.time ?? '12:00',
    r?.remind?.choice ?? null,
    (choice) => {
      if (!r) return
      haptic.tick()
      void action('remind.set', { id: r.id, choice: choice ?? 'off' }, { quiet: true })
    },
    Boolean(r?.remind?.sentAt),
    true,
  )
  if (!r) return <Screen />

  const approved = r.status === 'approved' && !!r.approvedBy
  const p = r.proposal
  // Ждущая правится (`edit`), подтверждённая и любая с висящим переносом только просит:
  // `edit` снял бы переговоры и написал бы их автору.
  const proposing = approved || Boolean(p)
  // От чего считается правка: своё висящее предложение, иначе слот заявки.
  const base: Slot = p && p.by === 'guest' ? { day: p.dateKey, time: p.time } : { day: r.dateKey, time: r.time }
  const changed =
    whenOpen &&
    draft !== null &&
    (draft.day !== base.day || draft.time !== base.time) &&
    !(proposing && draft.day === r.dateKey && draft.time === r.time)
  const shown: Slot = changed ? draft! : { day: r.dateKey, time: r.time }
  const openWhen = (slot?: Slot): void => {
    markOwnTap()
    setDraft(slot ?? base)
    setWheelKey((k) => k + 1)
    setWhenOpen(true)
  }
  const sendSlot = async (): Promise<void> => {
    if (!draft) return
    if (isPastForToday(draft.day, draft.time)) {
      showAlert('Это время уже прошло, выберите время позже текущего.')
      return
    }
    haptic.impact('medium')
    markOwnTap()
    const done = proposing
      ? await action('propose', { id: r.id, dateKey: draft.day, time: draft.time }, { quiet: true })
      : await action('edit', editBody(r, { dateKey: draft.day, time: draft.time }), { quiet: true })
    if (done) {
      haptic.notify('success')
      setWhenOpen(false)
    }
  }
  const slotText = (s: Slot): string => nb(`${fmtShortDate(s.day)} · ${s.time}`)
  const sendLabel = !proposing ? `Перенести на ${slotText(draft ?? base)}` : `Попросить ${slotText(draft ?? base)}`
  // Слот с днём, если предложенный день отличается от текущего дня заявки; иначе только время.
  const slotLabel = (dateKey: string, time: string): string =>
    p && p.dateKey !== r.dateKey ? `${fmtShortDate(dateKey)} · ${time}` : time

  // Карточка статуса и карточка предложения независимы: у подтверждённого визита
  // тоже может висеть перенос, и тогда показываем обе.
  let statusCard = null
  let proposalCard = null
  if (approved) {
    // Белая карточка хоста, статус капсулой, как у всех статусов: зелёной плашкой визит
    // был единственным местом приложения, где статус говорила заливка.
    statusCard = (
      <div className="status-card approved">
        <div className="status-card-body">
          <Avatar user={r.approvedBy!} className="host-avatar" profile />
          <div className="host-main">
            <div className="host-kicker">Вас хостит</div>
            <Profile user={r.approvedBy!} className="host-name">
              {r.approvedBy!.name}
            </Profile>
            <div className="host-sub">
              {(r.approvedBy!.username ? '@' + r.approvedBy!.username + ' · ' : '') + 'резидент'}
            </div>
          </div>
          <span className="ob-tag green">подтверждён</span>
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
          <button className="chip-btn" onClick={() => openWhen({ day: p.dateKey, time: p.time })}>
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
          <button className="chip-btn" onClick={() => openWhen()}>
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
          <XText text={visitDayWord(shown.day, data!.todayKey)} />
        }
        subtitle={
          <>
            <XText text={nb(`${fmtDayMonth(shown.day)} · к ${shown.time}`)} delay={120} />
            {/* Минута меняется без движения: это часы, а не ответ на тап. */}
            {left > 0 ? nb(` · через ${untilText(left)}`) : null}
          </>
        }
      />
      {arrivalOpen ? <ArrivalButton id={r.id} arrivedAt={r.arrivedAt} /> : null}
      {isPast ? null : statusCard}
      <Collapse open={!isPast && Boolean(proposalCard)}>{proposalCard}</Collapse>
      <SectionTitle>Детали</SectionTitle>
      <div className="nt-host" ref={remindUi.hostRef}>
      <div className="card">
        {isPast ? (
          <div className="row">
            <span className="kv-key">Когда</span>
            <span className="kv-val">{`${fmtShortDate(r.dateKey)} · ${r.time}`}</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="row tappable"
              aria-expanded={whenOpen}
              onClick={() => (whenOpen ? setWhenOpen(false) : openWhen())}
            >
              <span className="kv-key">Когда</span>
              <div className="row-right">
                <span className="kv-val" style={{ marginLeft: 0 }}>
                  <XText text={slotText(shown)} delay={120} />
                </span>
                <span className={'evv-when-chev' + (whenOpen ? ' open' : '')}>{icons.chevron()}</span>
              </div>
            </button>
            <Unfold open={whenOpen}>
              {draft ? (
                <div className="visit-when">
                  <DayChips
                    days={data!.days}
                    selected={draft.day}
                    onSelect={(k) => {
                      if (k !== draft.day) haptic.tick()
                      markOwnTap()
                      setDraft({ ...draft, day: k })
                    }}
                  />
                  <TimeWheels
                    key={wheelKey}
                    value={draft.time}
                    min={draft.day === data!.todayKey ? data!.nowTime || '00:00' : undefined}
                    onChange={(time) => setDraft((d) => (d ? { ...d, time } : d))}
                  />
                  <Collapse open={changed}>
                    <div className="visit-when-send">
                      <ActionButton className="host-btn armed" onClick={sendSlot}>
                        {sendLabel}
                      </ActionButton>
                    </div>
                  </Collapse>
                </div>
              ) : null}
            </Unfold>
          </>
        )}
        <Sep inset="text" />
        {!isPast && !proposing ? (
          <SwitchRow
            on={r.anon}
            onToggle={() => action('edit', editBody(r, { anon: !r.anon }), { quiet: true })}
            label="Не показывать другим гостям"
          />
        ) : (
          <div className="row">
            <span className="kv-key">Видимость</span>
            <span className="kv-val">{r.anon ? 'Анонимно' : 'Обычная'}</span>
          </div>
        )}
        {/* Напоминание правится и у подтверждённого визита, где сама заявка уже не правится. */}
        {isPast ? null : (
          <>
            <Sep inset="text" />
            {remindUi.row}
          </>
        )}
        {/* Куда идти — тот же вопрос, что «когда»: у двери карточка визита это
            первое, что открывают, а адрес до сих пор жил только в «Моих визитах». */}
        {!isPast ? (
          <>
            <Sep inset="text" />
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
        <VisitPurpose r={r} editable={!isPast && !proposing} />
      </div>
      {isPast ? null : remindUi.items}
      </div>
      {/* Календарь и отмена строками одной карточки, а не карточками по кнопке: экран
          визита кончается одним блоком действий, как в настройках iOS. */}
      {isPast ? null : (
        <div className="card visit-acts">
          {/* .ics отдаёт сервер (см. /visit.ics): разовая ссылка, которую открывает
              системный браузер, а оттуда файл уходит в календарь. */}
          <button type="button" className="row tappable" onClick={() => void openIcs()}>
            <span className="act-ico">{icons.calendarPlus(19, 'currentColor')}</span>
            <span className="add-row-label">Добавить в календарь</span>
          </button>
          {/* Отмеченный резидентом визит - уже история: сервер отмену не примет. */}
          {r.visit?.source === 'mark' ? null : (
            <>
              <Sep inset={22} />
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
