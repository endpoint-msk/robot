// Экран дня. Живые дни листаются, как шаги знакомства: свайп по экрану открывает
// соседний день, шапка в тон его состояния, точки показывают, какой из семи открыт.
// «Я приду» живёт в шапке и отвечает на месте. Архивный день остаётся прежним списком.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { action } from '../api'
import { fmtDayMonth, requestsWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { confirmDialog, numberPrompt, textPrompt } from '../modals'
import {
  animate,
  clamp,
  E,
  markOwnTap,
  mix,
  mixc,
  ownTapRecent,
  palette,
  pr,
  project,
  reducedMotion,
  rubber,
  springAt,
  stageTint,
  toHex,
  tracker,
  type SpringOpts,
  type Tone,
} from '../motion'
import { getState, pop, push, setTopParams, useParams, useStore, type NavParams } from '../store'
import { haptic, setHeaderColor } from '../telegram'
import { applyTheme, sec } from '../theme'
import type { Attendee, Day as DayData, DayAgenda, DayLock, HostingRequest, User } from '../types'
import { BackRow, EmptyState, Footnote, Header, ReadonlyBadge, SectionTitle, Sep, Switch } from '../components/common'
import { AgendaBanner } from '../components/AgendaBanner'
import { AttendeeRow } from '../components/attendees'
import { Collapse } from '../components/Collapse'
import { EventRow } from '../components/EventRow'
import { Flip, XText } from '../components/Flip'
import { Avatar, userLabel } from '../components/people'
import { confirmOverCapacity, RequestRow, RequestsCard } from '../components/RequestRow'
import { Screen } from '../components/Screen'

/** Причина закрытия: её вводят один раз при закрытии и правят строкой в карточке. */
const askReason = (initial: string): Promise<string | null> =>
  textPrompt({
    text: 'Почему спейс закрыт?',
    initial,
    placeholder: 'Например: уборка',
    hint: 'Причину увидят гости. Можно оставить пустой.',
    maxLength: 120,
    confirmLabel: 'Готово',
  })

/** Повестку правят с плашки под шапкой и строкой в карточке «День»; пустой текст её снимает. */
const editAgenda = async (dateKey: string, agenda: DayAgenda | null): Promise<void> => {
  const current = agenda?.text ?? ''
  const text = await textPrompt({
    text: 'Что в этот день в спейсе?',
    initial: current,
    placeholder: 'Например: убираемся и сортируем вещи',
    hint: 'Повестку увидят и гости.',
    maxLength: 200,
    confirmLabel: 'Сохранить',
  })
  if (text === null || text === current) return
  await action('day.agenda', { dateKey, text })
}

/** Плашка «день закрыт» под шапкой — отдельно от переключателя в карточке «День». */
function LockBanner({ lock }: { lock: DayLock }) {
  const who = lock.by ? (lock.by.username ? '@' + lock.by.username : lock.by.name) : ''
  return (
    <div className="lock-banner">
      <div className="lb-icon">{icons.lockFilled()}</div>
      <div className="lb-text">
        <div className="lb-title">Спейс закрыт для гостей</div>
        <div className="lb-sub">
          {[lock.reason, who ? `закрыл ${who}` : ''].filter(Boolean).join(' · ') || 'Новые заявки не принимаются'}
        </div>
      </div>
    </div>
  )
}

/**
 * Всё про день одной карточкой: повестка, уведомления, закрытие для гостей и
 * вместимость. Пояснений под строками нет: тумблер их обрезал, а сами строки и так
 * говорят, что делают.
 */
function DayCard({ day }: { day: DayData }) {
  const { data } = useStore()
  const { dateKey } = day
  const lock = day.lock
  const capacity = day.capacity ?? null
  const requests = (day.requests ?? []).length

  // Уже поданные заявки закрытие не трогает: отменить чужой согласованный визит одним
  // тумблером нельзя, для этого есть «Закрыть заявку» с уведомлением гостя, поэтому
  // на непустом дне сначала спрашиваем. Открытие тоже подтверждается: день закрывает
  // любой резидент, и снять чужой замок промахом по тумблеру значит впустить гостей в
  // день, про который договорились иначе.
  const toggleLock = async (): Promise<void> => {
    if (lock) {
      const who = lock.by ? (lock.by.username ? '@' + lock.by.username : lock.by.name) : ''
      const ok = await confirmDialog(
        [
          who ? `День закрыл ${who}.` : 'День закрыт.',
          lock.reason ? `Причина: ${lock.reason}.` : '',
          'Откроем — гости снова смогут оставлять заявки, и день вернётся на доску.',
        ]
          .filter(Boolean)
          .join(' '),
        { confirmLabel: 'Открыть день' },
      )
      if (!ok) return
      await action('day.lock', { dateKey, locked: false })
      return
    }
    if (requests > 0) {
      const ok = await confirmDialog(
        `На этот день уже есть ${requestsWord(requests)}. Закрытие их не отменяет — гости просто не смогут оставить новые.`,
        { confirmLabel: 'Всё равно закрыть' },
      )
      if (!ok) return
    }
    const reason = await askReason('')
    if (reason === null) return
    await action('day.lock', { dateKey, locked: true, reason })
  }

  const editReason = async (): Promise<void> => {
    const reason = await askReason(lock?.reason ?? '')
    if (reason === null) return
    await action('day.lock', { dateKey, locked: true, reason })
  }

  // Вместимость — мягкий лимит: при «Захостить» сверх него приходит предупреждение с
  // числами, а решает резидент, который видит день целиком. Заявки без хоста в
  // «занято» не входят: подтвердится из них не всё.
  const editCap = async (): Promise<void> => {
    if (!capacity) return
    const value = await numberPrompt({
      text: 'Сколько человек помещается в этот день?',
      initial: capacity.cap,
      hint: `Рекомендуем ${capacity.defaultCap}: это комфортное количество человек в подвале. Захостить сверх лимита можно, бот предупредит об этом.`,
      min: 1,
      max: 200,
      confirmLabel: 'Сохранить',
    })
    if (value === null || value === capacity.cap) return
    await action('day.cap', { dateKey, cap: value })
  }
  const resetCap = async (): Promise<void> => {
    await action('day.cap', { dateKey, cap: null })
  }

  const toggleSub = async (): Promise<void> => {
    await action('day.subscribe', { dateKey, on: !day.subscribed }, { quiet: true })
  }

  const over = capacity ? capacity.occupied > capacity.cap : false
  const full = capacity ? !over && capacity.occupied >= capacity.cap : false

  return (
    <>
      <SectionTitle>День</SectionTitle>
      <div className="card">
        <button type="button" className="row tappable" onClick={() => editAgenda(dateKey, day.agenda)}>
          <span className="row-label">Повестка</span>
          <div className="row-right">
            <span className="lock-reason">{day.agenda ? day.agenda.text : 'Добавить'}</span>
            {icons.chevron()}
          </div>
        </button>
        {data!.me.isResident ? (
          <>
            <Sep left={14} />
            <div className="row">
              <span className="row-label">Уведомления о дне</span>
              <Switch on={Boolean(day.subscribed)} onToggle={toggleSub} label="Уведомления о дне" />
            </div>
          </>
        ) : null}
        <Sep left={14} />
        <div className="row">
          <span className="row-label">Закрыт для гостей</span>
          <Switch on={Boolean(lock)} onToggle={toggleLock} label="Закрыт для гостей" />
        </div>
        {lock ? (
          <>
            <Sep left={14} />
            <button type="button" className="row tappable" onClick={editReason}>
              <span className="row-label">Причина</span>
              <div className="row-right">
                <span className="lock-reason">{lock.reason || 'Добавить'}</span>
                {icons.chevron()}
              </div>
            </button>
          </>
        ) : null}
        {capacity ? (
          <>
            <Sep left={14} />
            <button type="button" className="row tappable" onClick={editCap}>
              <span className="row-label">
                Вместимость
                {capacity.pending > 0 ? (
                  <span className="row-sublabel">{`ещё ${requestsWord(capacity.pending)} без хоста`}</span>
                ) : null}
              </span>
              <div className="row-right">
                <span className={'cap-value' + (over ? ' over' : full ? ' full' : '')}>
                  <Flip value={capacity.occupied} />
                  {` / ${capacity.cap}`}
                </span>
                {icons.chevron()}
              </div>
            </button>
            {capacity.custom ? (
              <>
                <Sep left={14} />
                <button type="button" className="row tappable" onClick={resetCap}>
                  <span className="row-label">Вернуть общую</span>
                  <div className="row-right">
                    <span className="lock-reason">{String(capacity.defaultCap)}</span>
                  </div>
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  )
}

/** «вы, @lena_k и ещё 2»: кто придёт, коротко, вы первыми. */
const comingNames = (names: string[]): string => {
  if (names.length === 0) return 'Пока никто не собирается'
  const text = names.length <= 2 ? names.join(' и ') : `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Аватарка, которая после своего тапа встаёт в ряд с перелётом. Чужое появление ставит её сразу. */
function FaceIn({ a, fly }: { a: Attendee; fly: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const av = el?.firstElementChild as HTMLElement | null
    if (!fly || !el || !av || !ownTapRecent()) return
    return animate(
      680,
      (t) => {
        av.style.transform = `scale(${Math.max(0, pr(t, 120, 560, E.back)).toFixed(4)})`
      },
      () => {
        av.style.transform = ''
      },
    )
  }, [])
  return (
    <span className="dpg-face" ref={ref}>
      <Avatar user={a} />
    </span>
  )
}

/**
 * Кто придёт и своё «Я приду» в шапке дня. Первое место в ряду всегда ваше: пунктир,
 * пока вы не собираетесь, и ваша аватарка, когда собрались, поэтому соседи не
 * сдвигаются. После тапа такты идут волной: подпись кнопки, аватарка с перелётом,
 * строка с именами, счётчик. В ряду и гости: захостили своим тапом, и гость встаёт
 * на своё место в ряду тем же перелётом.
 */
function ComingRow({ attendees, coming, onToggle }: { attendees: Attendee[]; coming: boolean; onToggle: () => void }) {
  const { data } = useStore()
  const me = data!.me
  const present = attendees.filter((a) => a.userId !== me.id)
  const sig = present.map((a) => a.userId).join(',')
  const [seen, setSeen] = useState(() => ({ sig, fresh: [] as number[] }))
  if (seen.sig !== sig) {
    const before = new Set(seen.sig ? seen.sig.split(',').map(Number) : [])
    const added = ownTapRecent() ? present.filter((a) => !before.has(a.userId)).map((a) => a.userId) : []
    setSeen({ sig, fresh: [...added, ...seen.fresh.filter((id) => present.some((a) => a.userId === id))] })
  }
  const others = present
  const count = others.length + (coming ? 1 : 0)
  const [showMe, setShowMe] = useState(coming)
  if (coming && !showMe) setShowMe(true)
  const meRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  const was = useRef(coming)

  useLayoutEffect(() => {
    const el = meRef.current
    const slot = slotRef.current
    const prev = was.current
    was.current = coming
    if (prev === coming || !el || !slot) return
    if (!ownTapRecent()) {
      el.style.transform = ''
      slot.style.opacity = ''
      if (!coming) setShowMe(false)
      return
    }
    if (coming) {
      return animate(
        620,
        (t) => {
          el.style.transform = `scale(${Math.max(0, pr(t, 60, 560, E.back)).toFixed(4)})`
          slot.style.opacity = String(1 - pr(t, 60, 200))
        },
        () => {
          el.style.transform = ''
          slot.style.opacity = ''
        },
      )
    }
    return animate(
      300,
      (t) => {
        el.style.transform = `scale(${(1 - pr(t, 0, 260, E.inOut)).toFixed(4)})`
        slot.style.opacity = String(pr(t, 140, 160))
      },
      () => setShowMe(false),
    )
  }, [coming, showMe])

  const names = [...(coming ? ['вы'] : []), ...others.map((a) => userLabel(a))]
  return (
    <div className="dpg-coming">
      <div className="dpg-faces" aria-hidden="true">
        <span className={'dpg-myslot' + (coming ? ' on' : '')}>
          <span className="dpg-slot" ref={slotRef} />
          {showMe ? (
            <div className="dpg-me" ref={meRef}>
              <Avatar user={{ userId: me.id, name: me.name, username: me.username }} />
            </div>
          ) : null}
        </span>
        {others.slice(0, 3).map((a) => (
          <FaceIn key={a.userId} a={a} fly={seen.fresh.includes(a.userId)} />
        ))}
      </div>
      <div className="dpg-coming-text">
        <div className="dpg-coming-k">
          {'Придут · '}
          <Flip value={count} delay={140} />
        </div>
        <div className="dpg-coming-s">
          <XText text={comingNames(names)} delay={80} />
        </div>
      </div>
      <button
        type="button"
        className={'dpg-pill' + (coming ? ' on' : '')}
        aria-pressed={coming}
        aria-label={coming ? 'Вы придёте' : 'Я приду'}
        onClick={onToggle}
      >
        <span className="dpg-pill-l dpg-pill-off" aria-hidden="true">
          Я приду
        </span>
        <span className="dpg-pill-l dpg-pill-on" aria-hidden="true">
          {icons.check(14, '#fff', 2.6)}
          Вы придёте
        </span>
      </button>
    </div>
  )
}

/**
 * Секция заявок дня. Захостили своим тапом, и строка остаётся на месте до ухода с дня:
 * кнопка в ней становится пиллом «одобрил», строка коротко подсвечивается. Переезд в
 * другой список сдвигал бы всё, на что человек смотрит.
 */
function RequestSection({
  title,
  list,
  onHost,
  flash,
  count,
  dim = false,
}: {
  title: string
  list: HostingRequest[]
  count: number
  onHost: (r: HostingRequest) => void
  flash: string[]
  /** Заголовок гаснет, но держит место: строки под ним не должны сдвигаться. */
  dim?: boolean
}) {
  if (list.length === 0) return null
  return (
    <>
      <div className={'section-title' + (dim ? ' sec-dim' : '')}>
        {title + ' · '}
        <Flip value={count} />
      </div>
      <div className="card">
        {list.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 ? <Sep left={66} /> : null}
            <div className={flash.includes(r.id) ? 'row-flash' : undefined}>
              <RequestRow r={r} onHost={onHost} justHosted={flash.includes(r.id)} />
            </div>
          </Fragment>
        ))}
      </div>
    </>
  )
}

function DayPage({
  day,
  active,
  headRef,
  pageRef,
}: {
  day: DayData
  active: boolean
  headRef: (el: HTMLDivElement | null) => void
  pageRef: (el: HTMLDivElement | null) => void
}) {
  const { data } = useStore()
  const me = data!.me
  const meUser: User = { userId: me.id, name: me.name, username: me.username }

  // «Захостить» после подтверждения: заявка одобрена сразу, гость встаёт в «Придут», а
  // сервер догоняет. Проиграли гонку другому резиденту: отметка снимается, и строка показывает
  // того, кто успел. Захостенные отсюда строки стоят в своём списке, пока день открыт.
  const [hosted, setHosted] = useState<string[]>([])
  const [stay, setStay] = useState<string[]>([])
  const [flash, setFlash] = useState<string[]>([])
  useEffect(() => {
    if (flash.length === 0) return
    const timer = setTimeout(() => setFlash([]), 1300)
    return () => clearTimeout(timer)
  }, [flash])
  useEffect(() => {
    setHosted((h) => {
      const next = h.filter((id) => (day.requests ?? []).some((r) => r.id === id && r.status !== 'approved'))
      return next.length === h.length ? h : next
    })
  }, [day.requests])
  const optimistic = (day.requests ?? []).filter((r) => hosted.includes(r.id) && r.status !== 'approved')
  const requests = (day.requests ?? []).map((r) =>
    optimistic.includes(r) ? { ...r, status: 'approved' as const, approvedBy: meUser, proposal: null } : r,
  )
  const host = async (r: HostingRequest): Promise<void> => {
    const ok = await confirmOverCapacity(r, dayView.capacity ?? undefined)
    if (!ok) return
    haptic.impact('medium')
    markOwnTap()
    setHosted((h) => [...h, r.id])
    setStay((x) => [...x, r.id])
    setFlash([r.id])
    const done = await action('approve', { id: r.id }, { quiet: true })
    if (!done) setHosted((h) => h.filter((id) => id !== r.id))
  }
  const attendees = [
    ...day.attendees,
    ...optimistic
      .filter((r) => !r.anon && !day.attendees.some((a) => a.userId === r.guest.userId))
      .map((r): Attendee => ({ userId: r.guest.userId, name: r.guest.name, username: r.guest.username, resident: false, time: r.time })),
  ]
  const dayView: DayData =
    optimistic.length > 0 && day.capacity
      ? {
          ...day,
          capacity: {
            ...day.capacity,
            occupied: day.capacity.occupied + optimistic.length,
            pending: Math.max(0, day.capacity.pending - optimistic.length),
          },
        }
      : day
  const approved = requests.filter((r) => r.status === 'approved' && !stay.includes(r.id))
  const pending = requests.filter((r) => r.status !== 'approved' || stay.includes(r.id))
  const waiting = pending.filter((r) => r.status !== 'approved').length
  const events = day.events
  const isToday = day.dateKey === data!.todayKey

  // Отметка ставится сразу, не дожидаясь ответа: шапка и список ниже показывают её
  // вместе. Запрос идёт без оверлея, отказ возвращает как было.
  const onServer = day.attendees.some((a) => a.resident && a.userId === me.id)
  const [mine, setMine] = useState<boolean | null>(null)
  useEffect(() => setMine(null), [onServer])
  const coming = mine ?? onServer
  const toggle = async (): Promise<void> => {
    const next = !coming
    haptic.impact(next ? 'light' : 'soft')
    markOwnTap()
    setMine(next)
    const done = await action('attend', { dateKey: day.dateKey, coming: next }, { quiet: true })
    if (!done) setMine(null)
  }
  const others = day.attendees.filter((a) => a.resident && a.userId !== me.id)
  const meRow: Attendee = { userId: me.id, name: me.name, username: me.username, resident: true, time: null }
  const residents = others.length + (coming ? 1 : 0)

  return (
    <div className={'dpg-page' + (active ? ' active' : '')} ref={pageRef} inert={!active}>
      <div className="dpg-head" ref={headRef}>
        <Header
          title={WEEKDAYS_FULL[weekdayIdx(day.dateKey)]}
          subtitle={`${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(day.dateKey)} · ${requestsWord(requests.length)}`}
        />
        <ComingRow attendees={attendees} coming={coming} onToggle={() => void toggle()} />
      </div>
      <div className="dpg-body">
        {day.lock ? <LockBanner lock={day.lock} /> : null}
        {day.agenda ? <AgendaBanner agenda={day.agenda} onEdit={() => editAgenda(day.dateKey, day.agenda)} /> : null}
        {/* Ивентов на день может быть сколько угодно, поэтому вход в редактор нужен и
            тогда, когда список уже не пуст. */}
        {events.length > 0 ? (
          <div className="card dpg-events">
            {events.map((ev, i) => (
              <Fragment key={ev.id}>
                {i > 0 ? <Sep left={62} /> : null}
                <EventRow event={ev} />
              </Fragment>
            ))}
          </div>
        ) : null}
        <div className="card dpg-acts">
          <button type="button" className="row tappable" onClick={() => push('invite', { dateKey: day.dateKey })}>
            <div className="row-icon" style={{ background: 'var(--blue)' }}>
              {icons.personPlus('#fff')}
            </div>
            <span className="row-label">Позвать в спейс</span>
            <div className="row-right">{icons.chevron()}</div>
          </button>
          <Sep left={54} />
          <button type="button" className="row tappable" onClick={() => push('event', { dateKey: day.dateKey })}>
            <div className="row-icon" style={{ background: 'var(--purple)' }}>
              {icons.calendar(17, '#fff')}
            </div>
            <span className="row-label">{events.length > 0 ? 'Ещё ивент' : 'Создать ивент'}</span>
            <div className="row-right">{icons.chevron()}</div>
          </button>
        </div>
        {requests.length === 0 && events.length === 0 ? (
          <div className="card">
            <EmptyState title="Нет заявок гостей" text="На этот день пока никто не оставил заявку." />
          </div>
        ) : null}
        <RequestSection title="Одобрены" list={approved} count={approved.length} onHost={(r) => void host(r)} flash={flash} />
        {/* Последнюю ждущую захостили: строки остаются на месте, а заголовок «Ждут ответа»
            гаснет, иначе под ним стояли бы уже одобренные. */}
        <RequestSection
          title={waiting > 0 || approved.length > 0 ? 'Ждут ответа' : 'Одобрены'}
          list={pending}
          count={waiting > 0 || approved.length > 0 ? waiting : pending.length}
          onHost={(r) => void host(r)}
          flash={flash}
          dim={waiting === 0 && approved.length > 0}
        />
        {/* Под заявками, а не над ними: первая отметка «я приду» не должна сдвигать
            строки, на которые человек смотрит. Своя строка вырастает следом за шапкой. */}
        <Collapse open={residents > 0} delay={200}>
          <SectionTitle>
            {'Придут резиденты · '}
            <Flip value={residents} delay={200} />
          </SectionTitle>
          <div className="card">
            {others.length > 0 ? (
              <Collapse open={coming} delay={200}>
                <AttendeeRow a={meRow} />
                <Sep left={66} />
              </Collapse>
            ) : coming ? (
              <AttendeeRow a={meRow} />
            ) : null}
            {others.map((a, i) => (
              <Fragment key={a.userId}>
                {i > 0 ? <Sep left={66} /> : null}
                <AttendeeRow a={a} />
              </Fragment>
            ))}
          </div>
        </Collapse>
        <DayCard day={dayView} />
      </div>
    </div>
  )
}

/** Тон шапки дня: закрытый оранжевый со штриховкой, сегодня синий, с ивентом фиолетовый. */
const toneOf = (d: DayData, todayKey: string): Tone =>
  d.lock ? 'orange' : d.dateKey === todayKey ? 'blue' : d.events.length > 0 ? 'purple' : 'gray'

type Drag = { x0: number; y0: number; p0: number; start: number; id: number; dir: 0 | 1 }

// Без перелёта: соседний день не должен проскакивать и возвращаться.
const PAGE_SPRING: SpringOpts = { response: 0.38, damping: 1 }

/**
 * Листалка дней. Всё, что меняется между днями (цвет и высота полосы под шапкой,
 * сдвиг страниц, точки), считается от одной дробной позиции p, как в знакомстве, и
 * рисуется правками style. React отвечает за содержимое страниц.
 */
function DayPager({ days, index }: { days: DayData[]; index: number }) {
  const params = useParams()
  const { data, theme } = useStore()
  const todayKey = data!.todayKey
  const rootRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const hatchRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  const headEls = useRef<(HTMLDivElement | null)[]>([])
  const live = useRef<{ days: DayData[]; index: number; todayKey: string; params: NavParams }>({ days, index, todayKey, params })
  live.current = { days, index, todayKey, params }
  const S = useRef({
    p: index,
    anim: null as { to: number; x0: number; v0: number; t0: number } | null,
    drag: null as Drag | null,
    width: 393,
    bandTop: 0,
    heads: [] as number[],
    draggedAt: 0,
    raf: 0,
  }).current
  const go = useRef<(i: number) => void>(() => {})
  const sync = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const root = rootRef.current!
    const band = bandRef.current!
    const hatch = hatchRef.current!
    const track = trackRef.current!
    const dots = dotsRef.current!

    const measure = (): void => {
      S.width = track.clientWidth || 393
      const top = root.getBoundingClientRect().top
      S.bandTop = band.getBoundingClientRect().top - top
      S.heads = headEls.current.map((el) => (el ? el.getBoundingClientRect().bottom - top : 0))
    }

    const render = (): void => {
      const { days: list, todayKey: today } = live.current
      const C = palette()
      const last = list.length - 1
      const pp = clamp(S.p, 0, last)
      const i0 = Math.floor(pp)
      const i1 = Math.min(last, i0 + 1)
      const f = pp - i0
      const A = list[i0]!
      const B = list[i1]!
      const tA = toneOf(A, today)
      const tB = toneOf(B, today)
      const stage = mixc(stageTint(tA, C), stageTint(tB, C), f)
      band.style.background = stage
      band.style.height = `${(mix(S.heads[i0] ?? 0, S.heads[i1] ?? 0, f) - S.bandTop).toFixed(1)}px`
      hatch.style.opacity = mix(A.lock ? 1 : 0, B.lock ? 1 : 0, f).toFixed(3)
      root.style.setProperty('--dpg-ring', stage)
      pageEls.current.forEach((el, i) => {
        if (!el) return
        const d = i - S.p
        const ad = Math.abs(d)
        if (ad >= 1) {
          el.style.visibility = 'hidden'
          return
        }
        el.style.visibility = ''
        el.style.transform = `translate3d(${(d * S.width).toFixed(2)}px,0,0)`
        el.style.opacity = (1 - 0.35 * ad).toFixed(3)
      })
      const tone = mixc(C.tones[tA], C.tones[tB], f)
      Array.from(dots.children).forEach((el, k) => {
        const dot = el.firstElementChild as HTMLElement | null
        if (!dot) return
        const pj = clamp(1 - Math.abs(pp - k), 0, 1)
        dot.style.width = `${(6 + 12 * pj).toFixed(2)}px`
        dot.style.background = mixc(C.dotOff, tone, pj)
      })
    }

    // Пока страницы едут, дорожка держит высоту большей из них, иначе соседний день
    // обрезался бы по высоте открытого.
    const holdHeight = (from: number, to: number): void => {
      let h = 0
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) h = Math.max(h, pageEls.current[i]?.offsetHeight ?? 0)
      track.style.minHeight = h ? `${h}px` : ''
    }

    const commit = (i: number): void => {
      const { days: list, index: cur, params: p } = live.current
      track.style.minHeight = ''
      if (i === cur) return
      setTopParams({ ...p, dateKey: list[i]!.dateKey })
    }

    const frame = (now: number): void => {
      S.raf = 0
      const a = S.anim
      if (a) {
        const s = springAt(a.x0, a.v0, PAGE_SPRING, (now - a.t0) / 1000)
        S.p = a.to + s.x
        if (Math.abs(s.x) < 0.001 && Math.abs(s.v) < 0.01) {
          S.p = a.to
          S.anim = null
          commit(a.to)
        }
      }
      render()
      if (S.anim) S.raf = requestAnimationFrame(frame)
    }
    const kick = (): void => {
      if (!S.raf) S.raf = requestAnimationFrame(frame)
    }

    /** `v0` в днях в секунду: брошенный день едет дальше со скоростью пальца. */
    const goTo = (target: number, v0 = 0): void => {
      const { days: list, index: cur } = live.current
      const to = clamp(Math.round(target), 0, list.length - 1)
      // Щелчок на решении, а не в конце доводки: палец уже знает, куда поедет день.
      if (to !== cur) haptic.tick()
      holdHeight(cur, to)
      if (reducedMotion()) {
        S.anim = null
        S.p = to
        render()
        commit(to)
        return
      }
      S.anim = { to, x0: S.p - to, v0, t0: performance.now() }
      kick()
    }
    go.current = goTo
    sync.current = () => {
      if (!S.drag && !S.anim) S.p = live.current.index
      measure()
      render()
    }

    // За краем недели резинка UIScrollView: в первые пиксели отзывчивая, дальше упирается.
    const edge = (raw: number, w: number): number => {
      const last = live.current.days.length - 1
      if (raw < 0) return -rubber(-raw * w, w) / w
      if (raw > last) return last + rubber((raw - last) * w, w) / w
      return raw
    }

    // Ось жеста пальцем решается по touchmove, а не по pointer: при `touch-action: pan-y`
    // браузер сам ведёт вертикальную составляющую, и наискось экран листался бы и
    // прокручивался разом. Решили «вбок» — гасим прокрутку до конца жеста.
    const isOwn = (t: EventTarget | null): boolean => !(t as Element).closest('.swipe-row, input, textarea')
    let touch: { x: number; y: number; axis: 0 | 1 | 2 } | null = null
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      touch = e.touches.length === 1 && t && isOwn(e.target) && t.clientX >= 20 ? { x: t.clientX, y: t.clientY, axis: 0 } : null
    }
    const onTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!touch || !t) return
      if (touch.axis === 0) {
        const dx = Math.abs(t.clientX - touch.x)
        const dy = Math.abs(t.clientY - touch.y)
        if (dx < 6 && dy < 6) return
        touch.axis = dx > dy ? 1 : 2
      }
      if (touch.axis === 1 && e.cancelable) e.preventDefault()
    }

    // Листает весь экран, кроме строк заявок: у них свой свайп с действиями, и жест
    // принадлежит строке. Касания у левого края не берём, там системный «назад» в iOS.
    // Направление решается по первым 8px, вертикаль отдаётся прокрутке.
    const vt = tracker()
    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || S.drag) return
      if ((e.target as Element).closest('.swipe-row, input, textarea')) return
      if (e.clientX < 20) return
      S.drag = { x0: e.clientX, y0: e.clientY, p0: S.p, start: live.current.index, id: e.pointerId, dir: 0 }
      vt.start(e.clientX, e.timeStamp)
    }
    const onMove = (e: PointerEvent): void => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      vt.move(e.clientX, e.timeStamp)
      const dx = e.clientX - d.x0
      const dy = e.clientY - d.y0
      if (d.dir === 0) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (touch ? touch.axis === 2 : Math.abs(dy) >= Math.abs(dx)) {
          S.drag = null
          return
        }
        d.dir = 1
        measure()
        // Доводку поймали на лету: день едет дальше с того места, где его взяли, и бросок
        // считается от ближайшего к нему дня.
        S.anim = null
        d.p0 = S.p + dx / (S.width || 393)
        d.start = Math.round(S.p)
        const cur = live.current.index
        holdHeight(cur - 1 < 0 ? cur : cur - 1, Math.min(live.current.days.length - 1, cur + 1))
        try {
          root.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
      const w = S.width || 393
      S.p = edge(d.p0 - dx / w, w)
      kick()
    }
    const onUp = (e: PointerEvent): void => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      S.drag = null
      if (d.dir !== 1) return
      S.draggedAt = performance.now()
      const w = S.width || 393
      const last = live.current.days.length - 1
      const v = -vt.release(e.timeStamp) / w
      let to = Math.round(S.p + project(v, 0.99))
      // Короткий, но быстрый бросок в ту же сторону всё равно листает.
      if (to === d.start && Math.abs(v * w) > 500 && Math.sign(v) === Math.sign(S.p - d.start || v)) to = d.start + Math.sign(v)
      goTo(clamp(to, Math.max(0, d.start - 1), Math.min(last, d.start + 1)), v)
    }
    // Отпущенный после свайпа палец не должен нажать кнопку, над которой оказался.
    const onClickCapture = (e: MouseEvent): void => {
      if (performance.now() - S.draggedAt < 300) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    // Трекпад: два пальца приходят колесом с deltaX, pointer-событий у него нет
    // вовсе. День едет за пальцами, а когда намерение ясно (четверть ширины), он
    // доезжает сам. Остаток инерции macOS до паузы в событиях глотаем, иначе он
    // перелистнул бы ещё дни: аналога pointerup у колеса нет, конец жеста только тишина.
    let wheel: { p0: number; dx: number; done: boolean } | null = null
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wt = tracker()
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      if ((e.target as Element).closest('.swipe-row, input, textarea')) return
      e.preventDefault()
      if (S.drag) return
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(() => {
        const g = wheel
        wheel = null
        if (g && !g.done) goTo(S.p)
      }, 110)
      const w = S.width || 393
      const last = live.current.days.length - 1
      if (!wheel) {
        S.anim = null
        measure()
        const cur = live.current.index
        holdHeight(cur > 0 ? cur - 1 : cur, Math.min(last, cur + 1))
        wheel = { p0: S.p, dx: 0, done: false }
        wt.start(0, e.timeStamp)
      }
      if (wheel.done) return
      wheel.dx += e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1)
      wt.move(wheel.dx, e.timeStamp)
      S.p = edge(wheel.p0 + wheel.dx / w, w)
      const to = Math.round(wheel.p0) + Math.sign(wheel.dx)
      if (Math.abs(wheel.dx) > w * 0.25 && to >= 0 && to <= last) {
        wheel.done = true
        goTo(to, wt.release(e.timeStamp) / w)
        return
      }
      kick()
    }
    const ro = new ResizeObserver(() => {
      measure()
      render()
    })

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('click', onClickCapture, true)
    // Нативно и не пассивно: React вешает wheel пассивно, а без preventDefault macOS
    // уводит горизонтальный жест в навигацию «назад».
    root.addEventListener('wheel', onWheel, { passive: false })
    ro.observe(root)
    measure()
    render()

    return () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      S.raf = 0
      ro.disconnect()
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('click', onClickCapture, true)
      root.removeEventListener('wheel', onWheel)
      clearTimeout(wheelIdle)
    }
  }, [])

  // Перелистнули или пришли новые данные: страницы встают на свои места, полоса меряется
  // заново по шапке открытого дня.
  useLayoutEffect(() => sync.current(), [index, days, theme])

  // Шапку Telegram красим в тон дня, когда он встал: плавно вместе со свайпом она
  // перекрашивается только в полноэкранном режиме.
  useEffect(() => {
    const d = days[index]
    if (d) setHeaderColor(toHex(stageTint(toneOf(d, todayKey))))
  }, [index, days, todayKey, theme])
  useEffect(() => () => applyTheme(getState().theme), [])

  return (
    <Screen>
      <div className="dpg" ref={rootRef}>
        <div className="dpg-band" ref={bandRef} aria-hidden="true">
          <div className="dpg-hatch" ref={hatchRef} />
        </div>
        <BackRow label="Ближайшие дни" />
        <div className="dpg-dots" ref={dotsRef}>
          {days.map((d, k) => (
            <button
              key={d.dateKey}
              type="button"
              className="dpg-dot"
              aria-label={`${WEEKDAYS_FULL[weekdayIdx(d.dateKey)]}, ${fmtDayMonth(d.dateKey)}`}
              aria-current={k === index ? 'date' : undefined}
              onClick={() => go.current(k)}
            >
              <i />
            </button>
          ))}
        </div>
        <div className="dpg-track" ref={trackRef}>
          {days.map((d, i) => (
            <DayPage
              key={d.dateKey}
              day={d}
              active={i === index}
              headRef={(el) => {
                headEls.current[i] = el
              }}
              pageRef={(el) => {
                pageEls.current[i] = el
              }}
            />
          ))}
        </div>
      </div>
    </Screen>
  )
}

/** День выпал из окна обзора, пока экран был открыт (прежде всего — через полночь). */
function DroppedDay({ dateKey }: { dateKey: string }) {
  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
      <Header title={WEEKDAYS_FULL[weekdayIdx(dateKey)]} subtitle={fmtDayMonth(dateKey)} />
      <div className="card">
        <EmptyState
          icon={icons.calendar(26, sec(0.3))}
          title="Этот день больше не в обзоре"
          text={`Обзор показывает ближайшие семь дней, и ${fmtDayMonth(dateKey)} из них вышло.`}
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 20px 22px' }}>
          <button type="button" className="retry-btn" style={{ marginTop: 0 }} onClick={pop}>
            К ближайшим дням
          </button>
        </div>
      </div>
    </Screen>
  )
}

/** День из архива недели: только чтение, заявки приезжают в параметрах экрана. */
function ArchiveDay() {
  const params = useParams()
  const requests = (params.requests as HostingRequest[]) || []
  const approved = requests.filter((r) => r.status === 'approved')
  const pending = requests.filter((r) => r.status !== 'approved')
  return (
    <Screen>
      <BackRow label="Неделя" />
      <Header
        title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]}
        subtitle={`${fmtDayMonth(params.dateKey)} · ${requestsWord(requests.length)}`}
      />
      <ReadonlyBadge />
      {requests.length === 0 ? (
        <div className="card">
          <EmptyState title="Заявок не было" text="В этот день никто не собирался прийти." />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>{`Одобрены · ${approved.length}`}</SectionTitle>
          <RequestsCard list={approved} archive />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>{`Ждут ответа · ${pending.length}`}</SectionTitle>
          <RequestsCard list={pending} archive />
        </>
      ) : null}
      {requests.length > 0 ? <Footnote>Свайп по строке влево — заметка о госте.</Footnote> : null}
    </Screen>
  )
}

export function Day() {
  const params = useParams()
  const { data } = useStore()
  if (params.archive) return <ArchiveDay />
  const index = data!.days.findIndex((d) => d.dateKey === params.dateKey)
  if (index < 0) return <DroppedDay dateKey={String(params.dateKey)} />
  return <DayPager days={data!.days} index={index} />
}
