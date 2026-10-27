// Экран дня. Живые дни листаются, как шаги знакомства: свайп по экрану открывает
// соседний день, шапка в тон его состояния, точки показывают, какой из семи открыт.
// «Я приду» живёт в шапке и отвечает на месте. Прошедший день открывается из архива
// экраном «Кто пришёл» (screens/Visits.tsx).

import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { action } from '../api'
import { nb } from '../format'
import { afterHero } from '../hero'
import { UnderContext } from '../screenContext'
import { fmtDayMonth, plural, requestsWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { NEW_EVENT_DRAFT, readDraft, useDrafts, type EventDraft } from '../drafts'
import { icons } from '../icons'
import { confirmDialog, numberPrompt, textPrompt } from '../modals'
import {
  animate,
  arrowStep,
  clamp,
  E,
  EDGE_ZONE,
  holdSelection,
  landing,
  markOwnTap,
  mix,
  mixc,
  ownTapRecent,
  PAGE_SPRING,
  pageTarget,
  palette,
  pr,
  pulse,
  reducedMotion,
  rubber,
  springAt,
  stageTint,
  toHex,
  tracker,
  type Tone,
} from '../motion'
import { getState, pop, push, setTopParams, useParams, useStore, type NavParams } from '../store'
import { haptic, setHeaderColor } from '../telegram'
import { accentTriple, applyTheme, sec } from '../theme'
import type { Attendee, Day as DayData, DayAgenda, DayLock, HostingRequest, User } from '../types'
import { BackRow, EmptyState, Header, SectionTitle, Sep, SwitchRow } from '../components/common'
import { AgendaBanner } from '../components/AgendaBanner'
import { AttendeeRow } from '../components/attendees'
import { CapBar } from '../components/CapBar'
import { Collapse } from '../components/Collapse'
import { EventRow } from '../components/EventRow'
import { Flip, XText } from '../components/Flip'
import { Avatar, userLabel } from '../components/people'
import { RequestRow } from '../components/RequestRow'
import { Screen } from '../components/Screen'
import { defaultTimeFor } from '../components/forms'
import { TimeField } from '../components/TimeField'
import { usePullDismiss } from '../components/usePullDismiss'
import { growIn } from '../dust'
import { canSwipeBack, registerPagerStart, swipingBack } from '../components/useSwipeBack'

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
    hint: 'Тему дня увидят и гости.',
    maxLength: 200,
    confirmLabel: 'Сохранить',
  })
  if (text === null || text === current) return
  markOwnTap()
  await action('day.agenda', { dateKey, text }, { quiet: true })
}

/**
 * Вход в редактор ивента. Недописанный ивент стоит в нём красным «Черновик:», как
 * недописанное сообщение в списке чатов Telegram: черновик один и открывается с любого дня.
 */
function NewEventLabel({ more }: { more: boolean }) {
  useDrafts()
  const d = readDraft<EventDraft>(NEW_EVENT_DRAFT)
  const text = d ? d.title.trim() || d.description.trim().split('\n')[0]! : ''
  if (!text) return <span className="row-label">{more ? 'Ещё ивент' : 'Создать ивент'}</span>
  return (
    <span className="row-label">
      <span className="draft-mark">Черновик:</span> {text}
    </span>
  )
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
  const roll = useContext(LockRollContext)
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
      markOwnTap()
      const settle = roll?.(dateKey, false)
      settle?.(Boolean(await action('day.lock', { dateKey, locked: false }, { quiet: true })))
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
    markOwnTap()
    const settle = roll?.(dateKey, true)
    settle?.(Boolean(await action('day.lock', { dateKey, locked: true, reason }, { quiet: true })))
  }

  const editReason = async (): Promise<void> => {
    const reason = await askReason(lock?.reason ?? '')
    if (reason === null) return
    await action('day.lock', { dateKey, locked: true, reason }, { quiet: true })
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
      wheel: {
        unit: (n) => plural(n, 'человек', 'человека', 'человек'),
        bar: { occupied: capacity.occupied, pending: capacity.pending },
      },
      confirmLabel: 'Сохранить',
    })
    if (value === null || value === capacity.cap) return
    markOwnTap()
    await action('day.cap', { dateKey, cap: value }, { quiet: true })
  }
  const resetCap = async (): Promise<void> => {
    markOwnTap()
    await action('day.cap', { dateKey, cap: null }, { quiet: true })
  }

  const toggleSub = async (): Promise<void> => {
    await action('day.subscribe', { dateKey, on: !day.subscribed }, { quiet: true })
  }

  const over = capacity ? capacity.occupied > capacity.cap : false
  const full = capacity ? !over && capacity.occupied >= capacity.cap : false

  return (
    <>
      <SectionTitle>День</SectionTitle>
      <div className="card ctl-card">
        <button type="button" className="row tappable" onClick={() => editAgenda(dateKey, day.agenda)}>
          <span className="row-label">Тема дня</span>
          <div className="row-right">
            <span className="lock-reason">{day.agenda ? day.agenda.text : 'Добавить'}</span>
            {icons.chevron()}
          </div>
        </button>
        {data!.me.isResident ? (
          <>
            <Sep inset="text" />
            <SwitchRow on={Boolean(day.subscribed)} onToggle={toggleSub} label="Уведомления о дне" />
          </>
        ) : null}
        <Sep inset="text" />
        <SwitchRow on={Boolean(lock)} onToggle={toggleLock} label="Закрыт для гостей" />
        {lock ? (
          <>
            <Sep inset="text" />
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
            <Sep inset="text" />
            <button type="button" className="row tappable cap-row" onClick={editCap}>
              <span className="row-label">
                Вместимость
                {/* Последнюю заявку без хоста убрали своим тапом: строка сворачивается, а не
                    пропадает рывком, который у низа страницы дёргал прокрутку. */}
                <Collapse open={capacity.pending > 0} as="span">
                  <span className="row-sublabel">{nb(`ещё ${requestsWord(capacity.pending)} без хоста`)}</span>
                </Collapse>
              </span>
              <div className="row-right">
                <span className={'cap-value' + (over ? ' over' : full ? ' full' : '')}>
                  <Flip value={capacity.occupied} />
                  {`\u00a0из\u00a0${capacity.cap}`}
                </span>
                {icons.chevron()}
              </div>
              <CapBar occupied={capacity.occupied} pending={capacity.pending} cap={capacity.cap} />
            </button>
            {capacity.custom ? (
              <>
                <Sep inset="text" />
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

/** «Вы, @lena_k и ещё 2»: кто придёт, вы первыми. Варианты от длинного к короткому. */
const comingVariants = (names: string[]): string[] => {
  const [a, b] = names
  const more = (n: number): string => `и\u00a0ещё\u00a0${n}`
  const list =
    names.length === 0
      ? ['Пока никого']
      : names.length === 1
        ? [a!]
        : names.length === 2
          ? [`${a} и ${b}`, `${a} ${more(1)}`]
          : [`${a}, ${b} ${more(names.length - 2)}`, `${a} ${more(names.length - 1)}`]
  return list.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
}

let measureCtx: CanvasRenderingContext2D | null = null
const textWidth = (text: string, font: string): number => {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/**
 * Подпись под «Придут»: самый длинный вариант, который влезает в строку целиком.
 * Многоточие посреди ника читается хуже, чем «Вы и ещё 2». Ширина считается шрифтом
 * самой подписи и пересчитывается на смене ширины и после загрузки шрифтов.
 */
export function ComingNames({ names, flow = false }: { names: string[]; flow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ room: 0, font: '' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => {
      const cs = getComputedStyle(el)
      setBox({ room: el.getBoundingClientRect().width, font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` })
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) read()
    })
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [])
  const variants = comingVariants(names)
  const text = box.room > 0 ? (variants.find((v) => textWidth(v, box.font) <= box.room) ?? variants[variants.length - 1]!) : variants[0]!
  return (
    <div className="dpg-coming-s" ref={ref}>
      {flow ? <XText text={text} delay={80} /> : text}
    </div>
  )
}

/**
 * Лицо проявляется, как содержимое пилла хоста после «Захостить»: из лёгкого размытия и
 * чуть меньше своего размера, без перелёта. Конец — пустой style: дальше лицом владеет CSS.
 */
const faceIn = (el: HTMLElement, p: number): void => {
  el.style.opacity = p < 1 ? p.toFixed(3) : ''
  el.style.filter = p < 1 ? `blur(${(4 * (1 - p)).toFixed(2)}px)` : ''
  el.style.transform = p < 1 ? `scale(${(0.88 + 0.12 * p).toFixed(4)})` : ''
}

/**
 * Аватарка, которая после своего тапа встаёт в ряд. Чужое появление ставит её сразу.
 * `z` - место в стопке: каждый следующий в ряду лежит под предыдущим.
 */
function FaceIn({ a, fly, z }: { a: Attendee; fly: boolean; z: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const av = el?.firstElementChild as HTMLElement | null
    if (!fly || !el || !av || !ownTapRecent()) return
    return animate(
      460,
      (t) => faceIn(av, pr(t, 120, 340, E.crisp)),
      () => faceIn(av, 1),
    )
  }, [])
  return (
    <span className="dpg-face" ref={ref} style={{ zIndex: z }}>
      <Avatar user={a} />
    </span>
  )
}

/**
 * Своё «Я приду» на день: отметка ставится сразу, не дожидаясь ответа, и шапка со
 * списком показывают её вместе. Запрос идёт без оверлея, отказ возвращает как было.
 * Тот же переключатель стоит под афишей ивента. Без дня (ивент дальше обзора) отметки нет.
 */
export function useAttend(day: DayData | null): { coming: boolean; toggle: () => Promise<void> } {
  const me = useStore().data!.me
  const onServer = Boolean(day?.attendees.some((a) => a.resident && a.userId === me.id))
  const [mine, setMine] = useState<boolean | null>(null)
  useEffect(() => setMine(null), [onServer])
  const coming = mine ?? onServer
  const toggle = async (): Promise<void> => {
    if (!day) return
    const next = !coming
    haptic.impact(next ? 'light' : 'soft')
    markOwnTap()
    setMine(next)
    const done = await action('attend', { dateKey: day.dateKey, coming: next }, { quiet: true })
    if (!done) setMine(null)
  }
  return { coming, toggle }
}

/**
 * Кто придёт и своё «Я приду» в шапке дня. Первое место в ряду всегда ваше: пунктир,
 * пока вы не собираетесь, и ваша аватарка, когда собрались, поэтому соседи не
 * сдвигаются. После тапа такты идут волной: подпись кнопки, аватарка с перелётом,
 * строка с именами, счётчик. В ряду и гости: захостили своим тапом, и гость встаёт
 * на своё место в ряду тем же перелётом.
 */
export function ComingRow({
  attendees,
  coming,
  onToggle,
  className,
}: {
  attendees: Attendee[]
  coming: boolean
  onToggle: () => void
  className?: string
}) {
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
      faceIn(el, 1)
      slot.style.opacity = ''
      if (!coming) setShowMe(false)
      return
    }
    if (coming) {
      return animate(
        400,
        (t) => {
          faceIn(el, pr(t, 60, 340, E.crisp))
          slot.style.opacity = String(1 - pr(t, 60, 200))
        },
        () => {
          faceIn(el, 1)
          slot.style.opacity = ''
        },
      )
    }
    return animate(
      240,
      (t) => {
        faceIn(el, 1 - pr(t, 0, 200, E.out))
        slot.style.opacity = String(pr(t, 100, 140))
      },
      () => setShowMe(false),
    )
  }, [coming, showMe])

  const names = [...(coming ? ['вы'] : []), ...others.map((a) => userLabel(a))]
  const faces = others.slice(0, 3)

  // Новое лицо в ряду сдвигает подпись на свою ширину. После своего тапа она доезжает
  // за ним кривой эталона, а не прыгает в том же кадре, пока лицо ещё не проявилось.
  // Переходом CSS: в WebView iOS он идёт на 120 Гц, JS-кадры на 60.
  const textRef = useRef<HTMLDivElement>(null)
  const textX = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const x = el.offsetLeft
    const prev = textX.current
    textX.current = x
    if (prev === null || prev === x || !ownTapRecent() || reducedMotion()) return
    el.style.transition = 'none'
    el.style.transform = `translateX(${prev - x}px)`
    void el.offsetWidth
    el.style.transition = 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)'
    el.style.transform = ''
    const done = (): void => {
      el.style.transition = ''
    }
    el.addEventListener('transitionend', done, { once: true })
    return () => el.removeEventListener('transitionend', done)
  }, [faces.length])
  return (
    <div className={'dpg-coming' + (className ? ' ' + className : '')}>
      <div className="dpg-faces" aria-hidden="true">
        {/* Ваше место - первое и, когда вы собрались, верхнее в стопке. Пунктир пустого
            места лежит под соседом: это ещё не человек. */}
        <span className={'dpg-myslot' + (coming ? ' on' : '')} style={{ zIndex: coming ? faces.length + 1 : 0 }}>
          <span className="dpg-slot" ref={slotRef} />
          {showMe ? (
            <div className="dpg-me" ref={meRef}>
              <Avatar
                user={{ userId: me.id, name: me.name, username: me.username }}
              />
            </div>
          ) : null}
        </span>
        {faces.map((a, i) => (
          <FaceIn key={a.userId} a={a} fly={seen.fresh.includes(a.userId)} z={faces.length - i} />
        ))}
      </div>
      <div className="dpg-coming-text" ref={textRef}>
        <div className="dpg-coming-k">
          {'Придут · '}
          <Flip value={count} delay={140} />
        </div>
        <ComingNames names={names} flow />
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
  capacity,
  dim = false,
}: {
  title: string
  list: HostingRequest[]
  count: number
  onHost: (r: HostingRequest) => void
  flash: string[]
  capacity?: DayData['capacity']
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
            {i > 0 ? <Sep inset="avatar" /> : null}
            <div className={flash.includes(r.id) ? 'row-flash' : undefined} data-req={r.id} data-dust={'req-' + r.id}>
              <RequestRow r={r} onHost={onHost} capacity={capacity} />
            </div>
          </Fragment>
        ))}
      </div>
    </>
  )
}

/** Страница листалки: по `headRef` она меряет полосу под шапкой, по `pageRef` двигает страницу. */
export type DayPageProps = {
  day: DayData
  active: boolean
  headRef: (el: HTMLDivElement | null) => void
  pageRef: (el: HTMLDivElement | null) => void
}

function DayPage({ day, active, headRef, pageRef }: DayPageProps) {
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
  // Подтверждение уже было: «Захостить» хостит только вторым тапом (см. RequestRow).
  const host = async (r: HostingRequest): Promise<void> => {
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
  const cameToday = (day.requests ?? []).filter((r) => r.visit?.status === 'came').length + (day.walkIns ?? []).length

  const myMark = day.attendees.find((a) => a.resident && a.userId === me.id) ?? null
  const { coming, toggle } = useAttend(day)
  // Время прихода - необязательная часть отметки: его ставят уже после «Я приду», в
  // своей строке списка, и видят его гости и доска. Ставится сразу, как и сама отметка.
  const serverTime = myMark?.time ?? null
  const [timeEdit, setTimeEdit] = useState<string | null | undefined>(undefined)
  useEffect(() => setTimeEdit(undefined), [serverTime])
  const myTime = timeEdit !== undefined ? timeEdit : serverTime
  const setMyTime = async (next: string | null): Promise<void> => {
    haptic.impact(next ? 'light' : 'soft')
    markOwnTap()
    setTimeEdit(next)
    const done = await action('attend', { dateKey: day.dateKey, coming: true, time: next }, { quiet: true })
    if (!done) setTimeEdit(undefined)
  }
  const timeChip = (
    <TimeField
      className="attend-time"
      value={myTime ?? ''}
      placeholder="Ко скольки?"
      prefix="к"
      fallback={defaultTimeFor(day.dateKey)}
      min={isToday ? data!.nowTime : undefined}
      onChange={(v) => void setMyTime(v)}
      onClear={() => void setMyTime(null)}
    />
  )
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
        {/* Закрыли день или поставили повестку своим тапом: плашка вырастает на месте, а
            не вставляется рывком, сдвигая всё, на что смотрят. */}
        <Collapse open={Boolean(day.lock)}>{day.lock ? <LockBanner lock={day.lock} /> : null}</Collapse>
        <Collapse open={Boolean(day.agenda)}>
          {day.agenda ? <AgendaBanner agenda={day.agenda} onEdit={() => editAgenda(day.dateKey, day.agenda)} /> : null}
        </Collapse>
        {/* Ивентов на день может быть сколько угодно, поэтому вход в редактор нужен и
            тогда, когда список уже не пуст. */}
        {events.length > 0 ? (
          <div className="card dpg-events">
            {events.map((ev, i) => (
              <Fragment key={ev.id}>
                {i > 0 ? <Sep inset="icon" /> : null}
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
          <Sep inset="icon" />
          <button type="button" className="row tappable" onClick={() => push('event', { dateKey: day.dateKey })}>
            <div className="row-icon" style={{ background: 'var(--purple)' }}>
              {icons.calendar(17, '#fff')}
            </div>
            <NewEventLabel more={events.length > 0} />
            <div className="row-right">{icons.chevron()}</div>
          </button>
          {/* Отмечать, кто пришёл, можно только в день визита: будущего ещё не было, а
              прошедший день - уже история. Вчерашний вечер до утра отмечают из архива. */}
          {isToday ? (
            <>
              <Sep inset="icon" />
              <button type="button" className="row tappable" onClick={() => push('visits', { dateKey: day.dateKey })}>
                <div className="row-icon" style={{ background: 'var(--green)' }}>
                  {icons.check(17, '#fff', 2.4)}
                </div>
                <span className="row-label">Кто пришёл</span>
                <div className="row-right">
                  {cameToday > 0 ? <span className="count-muted">{String(cameToday)}</span> : null}
                  {icons.chevron()}
                </div>
              </button>
            </>
          ) : null}
        </div>
        {requests.length === 0 && events.length === 0 ? (
          <div className="card" ref={growIn} data-dust-empty="">
            <EmptyState title="Нет заявок гостей" text="На этот день пока никто не оставил заявку." />
          </div>
        ) : null}
        <RequestSection
          title="Одобрены"
          list={approved}
          count={approved.length}
          onHost={(r) => void host(r)}
          flash={flash}
          capacity={dayView.capacity}
        />
        {/* Последнюю ждущую захостили: строки остаются на месте, а заголовок «Ждут ответа»
            гаснет, иначе под ним стояли бы уже одобренные. */}
        <RequestSection
          title={waiting > 0 || approved.length > 0 ? 'Ждут ответа' : 'Одобрены'}
          list={pending}
          count={waiting > 0 || approved.length > 0 ? waiting : pending.length}
          onHost={(r) => void host(r)}
          flash={flash}
          capacity={dayView.capacity}
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
                <AttendeeRow a={meRow} right={timeChip} />
                <Sep inset="avatar" />
              </Collapse>
            ) : coming ? (
              <AttendeeRow a={meRow} right={timeChip} />
            ) : null}
            {others.map((a, i) => (
              <Fragment key={a.userId}>
                {i > 0 ? <Sep inset="avatar" /> : null}
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
export const toneOf = (d: DayData, todayKey: string, locked = Boolean(d.lock)): Tone =>
  locked ? 'orange' : d.dateKey === todayKey ? 'blue' : d.events.length > 0 ? 'purple' : 'gray'

/**
 * Закрытие дня своим тапом: штриховка накатывает на полосу шапки со стороны тумблера и
 * уезжает туда же при открытии. Зовут сразу после подтверждения, не дожидаясь сервера;
 * вернувшаяся функция получает ответ, и отказ откатывает полосу.
 */
type LockRoll = (dateKey: string, on: boolean) => (ok: boolean) => void
const LockRollContext = createContext<LockRoll | null>(null)
const ROLL_MS = 680
// Край штриховки идёт наискось, как сами полосы.
const ROLL_SLANT = 48

type Drag = { x0: number; y0: number; p0: number; id: number; dir: 0 | 1; mouse: boolean }

/**
 * Заявка, на которую пришли кнопкой бота: строка один раз вспыхивает синим, как отметка
 * в «Кто пришёл» своим тоном. Красится сама строка, а не обёртка: фон слоя свайпа
 * непрозрачный и закрыл бы её.
 */
const flashRow = (row: HTMLElement): (() => void) => {
  const clear = (): void => {
    row.style.backgroundColor = ''
  }
  const stop = animate(
    1100,
    (t) => {
      row.style.backgroundColor = `rgba(${accentTriple()}, ${(0.16 * pulse(t, 120, 900)).toFixed(3)})`
    },
    clear,
  )
  return () => {
    stop()
    clear()
  }
}

/**
 * Листалка дней. Всё, что меняется между днями (цвет и высота полосы под шапкой,
 * сдвиг страниц, точки), считается от одной дробной позиции p, как в знакомстве, и
 * рисуется правками style. React отвечает за содержимое страниц: у резидента это день с
 * заявками, у гостя (PeekDay.tsx) только то, что ему положено видеть.
 */
export function DayPager({
  days,
  index,
  Page = DayPage,
  backLabel = 'Ближайшие дни',
}: {
  days: DayData[]
  index: number
  Page?: ComponentType<DayPageProps>
  backLabel?: string
}) {
  const params = useParams()
  const { data, theme } = useStore()
  const todayKey = data!.todayKey
  const rootRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const hatchRef = useRef<HTMLDivElement>(null)
  const rollRef = useRef<HTMLDivElement>(null)
  // Своё закрытие или открытие, пока полоса катится и пока сервер не подтвердил: полоса
  // рисуется по нему, а не по данным, иначе быстрый ответ перекрасил бы её раньше штриховки.
  const lockView = useRef<Record<string, boolean>>({})
  const rolling = useRef<{ key: string; stop: () => void } | null>(null)
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
      const locked = (d: DayData): boolean => lockView.current[d.dateKey] ?? Boolean(d.lock)
      const tA = toneOf(A, today, locked(A))
      const tB = toneOf(B, today, locked(B))
      const stage = mixc(stageTint(tA, C), stageTint(tB, C), f)
      band.style.background = stage
      band.style.height = `${(mix(S.heads[i0] ?? 0, S.heads[i1] ?? 0, f) - S.bandTop).toFixed(1)}px`
      hatch.style.opacity = mix(locked(A) ? 1 : 0, locked(B) ? 1 : 0, f).toFixed(3)
      // Катящаяся штриховка принадлежит своему дню: перелистнули — её не видно.
      const roller = rollRef.current
      if (roller) roller.style.visibility = rolling.current && rolling.current.key === list[Math.round(pp)]?.dateKey ? '' : 'hidden'
      root.style.setProperty('--dpg-ring', stage)
      pageEls.current.forEach((el, i) => {
        if (!el) return
        const d = i - S.p
        if (Math.abs(d) >= 1) {
          el.style.visibility = 'hidden'
          return
        }
        el.style.visibility = ''
        el.style.transform = `translate3d(${(d * S.width).toFixed(2)}px,0,0)`
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

    // Пока страницы едут, дорожка держит высоту большей из видимых, иначе соседний день
    // обрезался бы по высоте открытого. До конца жеста высота только растёт: иначе
    // страница под пальцем прыгала бы.
    const holdHeight = (from: number, to: number): void => {
      let h = parseFloat(track.style.minHeight) || 0
      for (let i = Math.floor(Math.min(from, to)); i <= Math.ceil(Math.max(from, to)); i++) {
        h = Math.max(h, pageEls.current[i]?.offsetHeight ?? 0)
      }
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
        const s = springAt(a.x0, a.v0, PAGE_SPRING, Math.max(0, now - a.t0) / 1000)
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
      holdHeight(S.p, to)
      if (reducedMotion()) {
        S.anim = null
        S.p = to
        render()
        commit(to)
        return
      }
      S.anim = { to, x0: S.p - to, v0: landing(S.p - to, v0, PAGE_SPRING), t0: performance.now() }
      kick()
    }
    go.current = goTo
    sync.current = () => {
      // Сервер догнал своё закрытие или открытие: полоса снова рисуется по данным.
      for (const d of live.current.days) {
        const want = lockView.current[d.dateKey]
        if (want !== undefined && want === Boolean(d.lock) && rolling.current?.key !== d.dateKey) delete lockView.current[d.dateKey]
      }
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
      touch = e.touches.length === 1 && t && isOwn(e.target) && t.clientX >= EDGE_ZONE ? { x: t.clientX, y: t.clientY, axis: 0 } : null
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
    // принадлежит строке. Касания у левого края не берём, там жест перехода Telegram iOS.
    // Направление решается по первым 8px, вертикаль отдаётся прокрутке. Правее первого дня
    // ничего нет: туда тот же свайп уводит назад к списку (useSwipeBack).
    const atStart = (): boolean => S.p <= 0.001
    const vt = tracker()
    let unselect: (() => void) | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || S.drag || swipingBack()) return
      if ((e.target as Element).closest('.swipe-row, input, textarea')) return
      if (e.clientX < EDGE_ZONE) return
      S.drag = { x0: e.clientX, y0: e.clientY, p0: S.p, id: e.pointerId, dir: 0, mouse: e.pointerType === 'mouse' }
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
        if (dx > 0 && atStart() && canSwipeBack()) {
          S.drag = null
          return
        }
        d.dir = 1
        measure()
        // Доводку поймали на лету: день едет дальше с того места, где его взяли.
        S.anim = null
        d.p0 = S.p + dx / (S.width || 393)
        if (d.mouse) unselect = holdSelection()
        try {
          root.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
      const w = S.width || 393
      S.p = edge(d.p0 - dx / w, w)
      holdHeight(S.p, S.p)
      kick()
    }
    const onUp = (e: PointerEvent): void => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      S.drag = null
      unselect?.()
      unselect = null
      if (d.dir !== 1) return
      S.draggedAt = performance.now()
      const w = S.width || 393
      const v = -vt.release(e.timeStamp) / w
      goTo(pageTarget(S.p, v, w), v)
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
      if (swipingBack() || (!wheel && e.deltaX < 0 && atStart() && canSwipeBack())) return
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
        holdHeight(Math.max(0, Math.floor(S.p) - 1), Math.min(last, Math.ceil(S.p) + 1))
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
    // Стрелки листают дни в Telegram Desktop, как знакомство и итоги месяца. Копия дня
    // под верхним экраном (жест «вниз») на них не отвечает.
    const onKey = (e: KeyboardEvent): void => {
      const step = arrowStep(e)
      if (step === 0 || S.drag || root.closest('.screen-under')) return
      e.preventDefault()
      goTo((S.anim ? S.anim.to : Math.round(S.p)) + step)
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
    window.addEventListener('keydown', onKey)
    const unregister = registerPagerStart(root, atStart)
    ro.observe(root)
    measure()
    render()

    return () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      S.raf = 0
      unselect?.()
      unregister()
      ro.disconnect()
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('click', onClickCapture, true)
      root.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      clearTimeout(wheelIdle)
    }
  }, [])

  // Перелистнули или пришли новые данные: страницы встают на свои места, полоса меряется
  // заново по шапке открытого дня.
  useLayoutEffect(() => sync.current(), [index, days, theme])

  // Пришли кнопкой бота на заявку: её строка встаёт к середине экрана и один раз
  // вспыхивает. Параметр снимается сразу, иначе вспышку повторил бы возврат на день.
  // Обычный эффект, а не layout: App в своём layout-эффекте ставит прокрутку экрана в начало.
  const flashId = typeof params.flash === 'string' ? params.flash : null
  const flashStop = useRef<(() => void) | null>(null)
  useEffect(() => () => flashStop.current?.(), [])
  useEffect(() => {
    if (!flashId) return
    const { flash: _flash, ...rest } = params
    setTopParams(rest)
    const row = rootRef.current?.querySelector<HTMLElement>(`.dpg-page.active [data-req="${CSS.escape(flashId)}"] .req-row`)
    if (!row) return
    const box = row.getBoundingClientRect()
    const gap = Math.max(16, (window.innerHeight - box.height) / 2)
    window.scrollTo(0, Math.max(0, window.scrollY + box.top - gap))
    flashStop.current = flashRow(row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId])

  // Шапку Telegram красим в тон дня, когда он встал: плавно вместе со свайпом она
  // перекрашивается только в полноэкранном режиме. Под верхним экраном (жест «вниз»)
  // день только картинка, и шапка остаётся за верхним.
  const under = useContext(UnderContext)
  usePullDismiss(rootRef, { enabled: !under })
  useEffect(() => {
    const d = days[index]
    if (d && !under) afterHero(() => setHeaderColor(toHex(stageTint(toneOf(d, todayKey)))))
  }, [index, days, todayKey, theme, under])
  useEffect(() => () => {
    if (!under) afterHero(() => applyTheme(getState().theme))
  }, [under])

  const roll: LockRoll = (dateKey, on) => {
    const el = rollRef.current
    if (!el || reducedMotion()) return () => {}
    rolling.current?.stop()
    el.style.backgroundColor = stageTint('orange')
    const clip = (c: number): void => {
      const w = el.offsetWidth
      const x = (w + ROLL_SLANT) * (1 - c) - ROLL_SLANT
      el.style.clipPath = `polygon(${(x + ROLL_SLANT).toFixed(1)}px 0, 100% 0, 100% 100%, ${x.toFixed(1)}px 100%)`
    }
    // Полоса под штриховкой — открытый день: закрытие накрывает его, открытие открывает.
    lockView.current[dateKey] = false
    let cur = on ? 0 : 1
    const run = (to: number, done: () => void): void => {
      const from = cur
      const stop = animate(
        ROLL_MS * Math.abs(to - from),
        (t) => {
          cur = mix(from, to, pr(t, 0, ROLL_MS * Math.abs(to - from), E.inOut))
          clip(cur)
        },
        () => {
          rolling.current = null
          done()
          sync.current()
        },
      )
      rolling.current = { key: dateKey, stop }
      sync.current()
    }
    clip(cur)
    run(on ? 1 : 0, () => {
      if (on) lockView.current[dateKey] = true
    })
    return (ok) => {
      if (ok) return
      // Сервер отказал: штриховка уезжает туда, откуда пришла, полоса снова по данным.
      rolling.current?.stop()
      run(on ? 0 : 1, () => {
        delete lockView.current[dateKey]
      })
    }
  }

  return (
    <Screen>
      <div className="dpg" ref={rootRef}>
        <div className="dpg-band" ref={bandRef} aria-hidden="true">
          <div className="dpg-hatch" ref={hatchRef} />
          <div className="dpg-lockroll" ref={rollRef} style={{ visibility: 'hidden' }} />
        </div>
        <BackRow label={backLabel} />
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
          <LockRollContext.Provider value={roll}>
            {days.map((d, i) => (
              <Page
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
          </LockRollContext.Provider>
        </div>
      </div>
    </Screen>
  )
}

/** День выпал из окна обзора, пока экран был открыт (прежде всего — через полночь). */
export function DroppedDay({
  dateKey,
  backLabel = 'Ближайшие дни',
  backText = 'К ближайшим дням',
}: {
  dateKey: string
  backLabel?: string
  backText?: string
}) {
  return (
    <Screen>
      <BackRow label={backLabel} />
      <Header title={WEEKDAYS_FULL[weekdayIdx(dateKey)]} subtitle={fmtDayMonth(dateKey)} />
      <div className="card">
        <EmptyState
          icon={icons.calendar(26, sec(0.3))}
          title="Этот день больше не в обзоре"
          text={`Обзор показывает ближайшие семь дней, и ${fmtDayMonth(dateKey)} из них вышло.`}
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 20px 22px' }}>
          <button type="button" className="retry-btn" style={{ marginTop: 0 }} onClick={pop}>
            {backText}
          </button>
        </div>
      </div>
    </Screen>
  )
}

export function Day() {
  const params = useParams()
  const { data } = useStore()
  const index = data!.days.findIndex((d) => d.dateKey === params.dateKey)
  if (index < 0) return <DroppedDay dateKey={String(params.dateKey)} />
  return <DayPager days={data!.days} index={index} />
}
