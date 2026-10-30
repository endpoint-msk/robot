// Поля форм новой заявки / правки: чипы дней, выбор дня+времени, цель, анонимность,
// напоминание о визите.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, dayNum, fmtShortDate, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { clamp, E, growField, spring } from '../motion'
import { getState } from '../store'
import { sec } from '../theme'
import type { Attendee, Day, ReminderChoice } from '../types'
import { Collapse } from './Collapse'
import { Sep, SwitchRow } from './common'
import { AvatarStack, userLabel } from './people'

/** Гость приходит через полчаса после резидента: «к 19:00» у резидента приблизительное. */
const GUEST_LAG_MIN = 30
/** Позже якорь не берём: с полчаса сверху время ушло бы за полночь. */
const LAST_ANCHOR = '23:29'

const plusMinutes = (t: string, m: number): string => {
  const total = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + m
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Время дня, к которому никто не привязан: 15:00, а сегодня ближайший целый час. */
const plainTime = (today: boolean, now: string): string => {
  if (!today) return '15:00'
  // Ближайший целый час в поясе спейса (nowTime с сервера), но не позже 23:00.
  const next = Math.min(Number(now.slice(0, 2)) + 1, 23)
  return String(next).padStart(2, '0') + ':00'
}

const dayContext = (dateKey: string) => {
  const d = getState().data!
  const today = dateKey === d.todayKey
  const now = d.nowTime || '00:00'
  // Сегодня прошедшее время не предлагаем.
  const fits = (t: string | null | undefined): t is string => Boolean(t) && (!today || t! >= now)
  const others = (d.days.find((x) => x.dateKey === dateKey)?.attendees ?? []).filter((a) => a.userId !== d.me.id)
  return { d, today, now, fits, others }
}

/**
 * Время, на которое открывается форма заявки гостя: через полчаса после первого
 * резидента, который в этот день указал время, чтобы гость не ждал у двери, если тот
 * задержится. Гости в расчёт не идут: хост может прийти позже своего гостя. Никто из
 * резидентов не указал время - время прошлого визита гостя, у постоянных оно своё.
 */
export function defaultTimeFor(dateKey: string): string {
  const { d, today, now, fits, others } = dayContext(dateKey)
  const first = others
    .filter((a) => a.resident && a.time && a.time <= LAST_ANCHOR)
    .map((a) => plusMinutes(a.time!, GUEST_LAG_MIN))
    .filter(fits)
    .sort()[0]
  if (first) return first
  const last = (d.myPast ?? []).find((r) => r.status === 'approved')?.time
  if (fits(last)) return last
  return plainTime(today, now)
}

/**
 * «Ко скольки?» резидента открывается на времени первого, кто придёт в этот день, себя
 * не считая: чаще всего это гость, которого встречать.
 */
export function attendTimeFor(dateKey: string): string {
  const { today, now, fits, others } = dayContext(dateKey)
  return others.map((a) => a.time).filter(fits).sort()[0] ?? plainTime(today, now)
}

/** Слот «на сегодня» уже прошёл (сравнение в поясе спейса — nowTime с сервера). */
export const isPastForToday = (dateKey: string, time: string): boolean => {
  const d = getState().data!
  return dateKey === d.todayKey && time < (d.nowTime || '00:00')
}

/**
 * Состояние выбора дня + времени. `timeTouched` — чтобы не перетирать вручную
 * выставленное время при смене дня; `min` на инпуте для «сегодня» подсказывает
 * прошедшие часы. `auto`: время последний раз поставила смена дня, а не колесо, и
 * подписи вокруг него могут перетечь.
 */
export function useDayTime(initialDay: string, initialTime: string | null) {
  const [day, setDay] = useState(initialDay)
  const [time, setTime] = useState(initialTime || defaultTimeFor(initialDay))
  const [auto, setAuto] = useState(false)
  const timeTouched = useRef(Boolean(initialTime))
  const d = getState().data!
  const min = day === d.todayKey ? d.nowTime || '00:00' : undefined

  const selectDay = (next: string): void => {
    setDay(next)
    if (timeTouched.current) return
    setTime(defaultTimeFor(next))
    setAuto(true)
  }
  const onTimeChange = (v: string): void => {
    timeTouched.current = true
    setAuto(false)
    setTime(v)
  }
  return { day, time, min, auto, selectDay, onTimeChange }
}

/** Первый день, на который вообще можно проситься: закрытые пропускаем. */
export const firstOpenDay = (days: Day[]): string => (days.find((d) => !d.lock) ?? days[0]!).dateKey

/** Передний край заливки резче заднего: на ходу она вытягивается и догоняет сама себя. */
const FILL_LEAD = { response: 0.3, damping: 0.8 }
const FILL_TRAIL = { response: 0.46, damping: 0.88 }

/** Смена дня позже этого срока после тапа пришла не от пальца, а с данными (сдвинулась неделя). */
const DAY_TAP_MS = 600

const CLIP_NONE = 'inset(0 0 0 100%)'

/** Края заливки в номерах чипов: левый у левого края чипа `l`, правый у правого края чипа `r`. */
type FillEdges = { l: number; r: number }

/** Скругление чипа ряда: читается один раз, на кадрах пересчёт стилей не нужен. */
const chipRound = new WeakMap<HTMLElement, string>()

/**
 * Ставит заливку по краям и проявляет белые цифры ровно под ней. Пиксели считаются на
 * каждом кадре заново, а не один раз на тап: поворот экрана посреди переезда иначе
 * сдвинул бы заливку с чипов.
 */
function paintDayFill(row: HTMLElement, fill: HTMLElement, at: FillEdges | null): void {
  const chips = Array.from(row.querySelectorAll<HTMLElement>(':scope > .day-chip'))
  const inkOf = (chip: HTMLElement) => chip.querySelector<HTMLElement>(':scope > .dc-ink')
  const first = chips[0]
  const second = chips[1]
  if (!at || !first) {
    fill.style.clipPath = CLIP_NONE
    for (const chip of chips) {
      const ink = inkOf(chip)
      if (ink) ink.style.clipPath = CLIP_NONE
    }
    return
  }
  const w = first.offsetWidth
  const step = second ? second.offsetLeft - first.offsetLeft : w
  const left = first.offsetLeft + at.l * step
  const right = first.offsetLeft + at.r * step + w
  let round = chipRound.get(row)
  if (!round) {
    round = getComputedStyle(first).borderTopLeftRadius
    chipRound.set(row, round)
  }
  fill.style.clipPath = `inset(0 ${(row.clientWidth - right).toFixed(2)}px 0 ${left.toFixed(2)}px round ${round})`
  for (const chip of chips) {
    const ink = inkOf(chip)
    if (!ink) continue
    const a = clamp(left - chip.offsetLeft, 0, w)
    const b = clamp(chip.offsetLeft + w - right, 0, w)
    ink.style.clipPath = a + b >= w - 0.5 ? CLIP_NONE : `inset(0 ${b.toFixed(2)}px 0 ${a.toFixed(2)}px round ${round})`
  }
}

/**
 * Ряд дней. Синяя заливка одна на весь ряд и переезжает на выбранный день пружиной,
 * как бегунок периода в статистике. Цифры белеют там, куда она наехала: белая копия
 * лежит в каждом чипе отдельным слоем и открывается по положению заливки.
 */
export function DayChips({
  days,
  selected,
  onSelect,
  showCounts = true,
}: {
  days: Day[]
  selected: string
  onSelect: (dateKey: string) => void
  showCounts?: boolean
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLElement>(null)
  const at = useRef<FillEdges | null>(null)
  const runs = useRef<{ l: ReturnType<typeof spring> | null; r: ReturnType<typeof spring> | null }>({ l: null, r: null })
  const tapAt = useRef(-Infinity)
  const index = days.findIndex((d) => d.dateKey === selected)

  const paint = (): void => {
    if (rowRef.current && fillRef.current) paintDayFill(rowRef.current, fillRef.current, at.current)
  }

  // Заливка встаёт на выбранный день до первой отрисовки. Переезжает она только после
  // своего тапа и подхватывает скорость, если по дням стучат подряд.
  useLayoutEffect(() => {
    const own = performance.now() - tapAt.current < DAY_TAP_MS
    tapAt.current = -Infinity
    const from = at.current
    const vl = runs.current.l?.velocity() ?? 0
    const vr = runs.current.r?.velocity() ?? 0
    runs.current.l?.stop()
    runs.current.r?.stop()
    runs.current = { l: null, r: null }
    if (index < 0 || !from || !own) {
      at.current = index < 0 ? null : { l: index, r: index }
      paint()
      return
    }
    paint()
    const ahead = index > (from.l + from.r) / 2
    runs.current.l = spring(
      from.l,
      index,
      vl,
      ahead ? FILL_TRAIL : FILL_LEAD,
      (x) => {
        at.current = { l: x, r: at.current?.r ?? x }
        paint()
      },
      () => {
        runs.current.l = null
      },
      0.002,
    )
    runs.current.r = spring(
      from.r,
      index,
      vr,
      ahead ? FILL_LEAD : FILL_TRAIL,
      (x) => {
        at.current = { l: at.current?.l ?? x, r: x }
        paint()
      },
      () => {
        runs.current.r = null
      },
      0.002,
    )
  }, [index, days.length])

  useEffect(() => {
    const row = rowRef.current
    const ro = row && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paint()) : null
    if (row) ro?.observe(row)
    return () => {
      ro?.disconnect()
      runs.current.l?.stop()
      runs.current.r?.stop()
    }
  }, [])

  return (
    <div className="day-chips dc-track" ref={rowRef}>
      <i className="dc-fill" ref={fillRef} aria-hidden="true" />
      {days.map((d) => {
        // Закрытый день не выбирается вовсе: сервер такую заявку всё равно отобьёт, а
        // штриховка объясняет отказ до тапа, а не алертом после.
        const locked = Boolean(d.lock)
        const face = (ink: boolean) => (
          <>
            <span className="dc-dow">{WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]}</span>
            <span className="dc-num">{String(dayNum(d.dateKey))}</span>
            {/* Ивент дня — точкой в углу. Гостю сюда приезжают только открытые
                ивенты (сервер фильтрует residentsOnly), так что метка честная. */}
            {d.events.length > 0 ? (
              <i className="dc-event" title={ink ? undefined : d.events.map((e) => e.title).join(', ')} />
            ) : null}
            {/* Сколько человек придёт, а не сколько заявок одобрено: тот же публичный «кто
                придёт», что в карточке под чипами. Закрытый день говорит о себе замком. */}
            {locked ? (
              <span className="dc-lock">{icons.lockFilled(10, 'currentColor')}</span>
            ) : showCounts ? (
              d.attendees.length > 0 ? (
                <span className="dc-people">
                  {icons.person(10)}
                  {String(d.attendees.length)}
                </span>
              ) : (
                <span className="dc-dash">—</span>
              )
            ) : null}
          </>
        )
        return (
          <button
            key={d.dateKey}
            className={'day-chip' + (locked ? ' locked' : '')}
            aria-pressed={d.dateKey === selected}
            disabled={locked}
            title={locked ? (d.lock!.reason ? `Закрыт: ${d.lock!.reason}` : 'День закрыт для заявок') : undefined}
            onClick={() => {
              if (d.dateKey !== selected) tapAt.current = performance.now()
              onSelect(d.dateKey)
            }}
          >
            {face(false)}
            <span className="dc-ink" aria-hidden="true">
              {face(true)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** «@max_k и @ilya3d к 19:00»: кто придёт, коротко, со временем прихода, если оно есть. */
const whoComes = (list: Attendee[]): string => {
  const me = getState().data!.me.id
  // Себя человек ищет в списке первым.
  const mineFirst = [...list.filter((a) => a.userId === me), ...list.filter((a) => a.userId !== me)]
  const names = mineFirst.map((a) => (a.userId === me ? 'вы' : userLabel(a)) + (a.time ? ` к ${a.time}` : ''))
  if (names.length <= 2) return names.join(' и ')
  return nb(`${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}`)
}

/**
 * Выбранный день целиком: повестка, ивенты и кто придёт. Гость выбирает день по людям,
 * а не по числу одобренных заявок, и прочитать это должен, не уходя в «Активность».
 */
export function SelectedDayInfo({ days, selected }: { days: Day[]; selected: string }) {
  const day = days.find((d) => d.dateKey === selected)
  if (!day) return null
  const att = day.attendees
  const lines = (day.agenda ? 1 : 0) + day.events.length
  return (
    <div className="card day-info">
      {day.agenda ? (
        <div className="di-row di-agenda">
          <span className="di-ico">{icons.agenda(15, sec(0.5))}</span>
          <span className="di-text">{day.agenda.text}</span>
        </div>
      ) : null}
      {day.events.map((e, i) => (
        <Fragment key={e.id}>
          {i > 0 || day.agenda ? <Sep inset="icon" /> : null}
          <div className="di-row">
            <span className="di-ico">{icons.calendar(15, '#bf5af2')}</span>
            <span className="di-title">{e.title}</span>
            <span className="di-time">{`в ${e.time}`}</span>
          </div>
        </Fragment>
      ))}
      {lines > 0 ? <Sep inset="icon" /> : null}
      <div className="di-row">
        {att.length > 0 ? <AvatarStack users={att} /> : <span className="di-slot" />}
        <span className="di-who">
          <b>{att.length > 0 ? `Придут ${att.length}` : 'Пока никого'}</b>
          {att.length > 0 ? <span>{whoComes(att)}</span> : null}
        </span>
      </div>
    </div>
  )
}

export function PurposeInput({
  value,
  onChange,
  placeholder = 'Цель визита (опционально)',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Растём только в ответ на ввод (как старый `input`-листенер): предзаполненная
  // заявка в правке стартует с rows=2 и скроллом — 1:1 со старым миниаппом.
  const grow = (): void => {
    const el = ref.current
    if (el) growField(el)
  }
  return (
    <textarea
      ref={ref}
      className="purpose-input"
      placeholder={placeholder}
      rows={2}
      maxLength={300}
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
        grow()
      }}
    />
  )
}

// --- Напоминание о визите ---------------------------------------------------
//
// Считаем всё в «пространстве» ключа дня и 'HH:MM' по поясу спейса: и слот заявки, и
// «сейчас» (todayKey/nowTime из bootstrap) приходят с сервера уже в нём, поэтому сдвиг
// пояса фронту знать не нужно, а локальные часы устройства тут вообще ни при чём.

export const REMINDER_LABELS: Record<ReminderChoice, string> = {
  m30: nb('за 30 мин'),
  h1: 'за час',
  h2: nb('за 2 часа'),
  morning: 'утром',
  evening: 'накануне вечером',
}

/** Порядок в карточке — от ближнего срока к дальнему, как в макете. */
export const REMINDER_ORDER: ReminderChoice[] = ['m30', 'h1', 'h2', 'morning', 'evening']

/** Что предлагаем при включении: за два часа, а если не успевает — ближайший подходящий. */
const REMINDER_PREFERENCE: ReminderChoice[] = ['h2', 'h1', 'm30', 'morning', 'evening']

const MORNING_TIME = '09:00'
const EVENING_TIME = '20:00'

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Сдвиг слота назад на N минут с переходом через полночь. */
function minusMinutes(dateKey: string, time: string, minutes: number): { dateKey: string; time: string } {
  const [h, m] = time.split(':').map(Number)
  let total = (h ?? 0) * 60 + (m ?? 0) - minutes
  let day = dateKey
  while (total < 0) {
    total += 24 * 60
    day = addDays(day, -1)
  }
  return { dateKey: day, time: `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}` }
}

/** Когда придёт напоминание: день + время в поясе спейса. */
export function reminderSlot(dateKey: string, time: string, choice: ReminderChoice): { dateKey: string; time: string } {
  switch (choice) {
    case 'm30':
      return minusMinutes(dateKey, time, 30)
    case 'h1':
      return minusMinutes(dateKey, time, 60)
    case 'h2':
      return minusMinutes(dateKey, time, 120)
    case 'morning':
      return { dateKey, time: MORNING_TIME }
    case 'evening':
      return { dateKey: addDays(dateKey, -1), time: EVENING_TIME }
  }
}

const slotBefore = (a: { dateKey: string; time: string }, b: { dateKey: string; time: string }): boolean =>
  a.dateKey < b.dateKey || (a.dateKey === b.dateKey && a.time < b.time)

/**
 * Срок применим к этому слоту: момент ещё не прошёл и он раньше самого визита.
 * Второе условие про «утром в день визита»: для слота в 08:00 оно наступает уже
 * после прихода гостя. Сервер проверяет то же самое (`reminderFits`).
 */
export function reminderAvailable(dateKey: string, time: string, choice: ReminderChoice): boolean {
  const d = getState().data!
  const at = reminderSlot(dateKey, time, choice)
  return slotBefore({ dateKey: d.todayKey, time: d.nowTime || '00:00' }, at) && !slotBefore({ dateKey, time }, at)
}

/** Срок, который реально уйдёт на сервер: неподходящий схлопываем в «не напоминать». */
export const reminderFor = (dateKey: string, time: string, choice: ReminderChoice | null): ReminderChoice | null =>
  choice && reminderAvailable(dateKey, time, choice) ? choice : null

/** «сегодня в 17:00» / «завтра в 17:00» / «в чт, 14 августа в 17:00». */
export function reminderWhen(dateKey: string, time: string, choice: ReminderChoice): string {
  const d = getState().data!
  const at = reminderSlot(dateKey, time, choice)
  if (at.dateKey === d.todayKey) return `сегодня в\u00a0${at.time}`
  if (at.dateKey === addDays(d.todayKey, 1)) return `завтра в\u00a0${at.time}`
  return `в\u00a0${fmtShortDate(at.dateKey)} в\u00a0${at.time}`
}

/**
 * Карточка «Напомнить о визите»: свитч + чипы сроков + подпись реальным временем.
 * Общая для формы заявки, её правки и экрана визита — в последнем `sentAt` уже
 * проставлен, и трогать настройку поздно.
 */
export function RemindCard({
  dateKey,
  time,
  choice,
  onChange,
  sentAt,
}: {
  dateKey: string
  time: string
  choice: ReminderChoice | null
  onChange: (choice: ReminderChoice | null) => void
  sentAt?: string | null
}) {
  const sent = Boolean(sentAt)
  const available = REMINDER_ORDER.filter((c) => reminderAvailable(dateKey, time, c))
  // Выбранный срок мог перестать подходить (гость сдвинул слот) — тогда карточка
  // выключена, а на сервер уедет null (см. reminderFor).
  const active = !sent && choice !== null && available.includes(choice)
  const locked = sent || available.length === 0

  const toggle = (): void => {
    if (locked) return
    onChange(active ? null : REMINDER_PREFERENCE.find((c) => available.includes(c)) ?? null)
  }

  const caption = sent
    ? 'Напоминание уже отправлено.'
    : available.length === 0
      ? 'До визита осталось слишком мало времени — напоминание не придёт.'
      : active
        ? `Напомним ${reminderWhen(dateKey, time, choice!)}.`
        : ''

  return (
    <div>
      <div className={'card' + (locked ? ' remind-locked' : '')}>
        {/* Когда напоминание включено, срок виден на чипах, а момент — в подписи
            под карточкой: третий раз повторять его в подзаголовке незачем. */}
        <SwitchRow
          on={active}
          onToggle={toggle}
          disabled={locked}
          label={
            <>
              Напомнить о визите
              <Collapse open={!active && !sent} as="span" ms={280} ease={E.crisp}>
                <span className="row-sublabel">Бот напишет в личку перед визитом</span>
              </Collapse>
            </>
          }
        />
        {/* Чипы и подпись раскрываются вместе с тумблером, а не встают за кадр: строки
            визита ниже уезжали на всю их высоту одним рывком. */}
        <Collapse open={active} ms={280} ease={E.crisp}>
          <Sep inset="text" />
          <div className="remind-chips">
            {REMINDER_ORDER.map((c) => {
              const off = !available.includes(c)
              return (
                <button
                  key={c}
                  className={'remind-chip' + (c === choice ? ' selected' : '') + (off ? ' off' : '')}
                  data-label={REMINDER_LABELS[c]}
                  disabled={off}
                  onClick={() => onChange(c)}
                >
                  {REMINDER_LABELS[c]}
                </button>
              )
            })}
          </div>
        </Collapse>
      </div>
      <Collapse open={Boolean(caption)} ms={280} ease={E.crisp}>
        <div className="remind-caption">{caption}</div>
      </Collapse>
    </div>
  )
}

/** Ряд «Прийти анонимно» — общий для новой заявки и правки. */
export function AnonRow({ anon, onChange }: { anon: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card">
      <SwitchRow on={anon} onToggle={() => onChange(!anon)} label="Прийти анонимно" sub="Другие гости не увидят вас в списке" />
    </div>
  )
}
