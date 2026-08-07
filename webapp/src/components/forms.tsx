// Поля форм новой заявки / правки: чипы дней, выбор дня+времени, цель, анонимность,
// напоминание о визите.

import { useRef, useState } from 'react'
import { addDays, dayNum, fmtShortDate, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { getState } from '../store'
import type { Day, ReminderChoice } from '../types'
import { Switch } from './common'

export function defaultTimeFor(dateKey: string): string {
  const d = getState().data!
  if (dateKey !== d.todayKey) return '15:00'
  // Для «сегодня» — ближайший целый час в поясе спейса (nowTime с сервера), но не позже 23:00.
  const nowH = Number((d.nowTime || '00:00').slice(0, 2))
  const next = Math.min(nowH + 1, 23)
  return String(next).padStart(2, '0') + ':00'
}

/** Слот «на сегодня» уже прошёл (сравнение в поясе спейса — nowTime с сервера). */
export const isPastForToday = (dateKey: string, time: string): boolean => {
  const d = getState().data!
  return dateKey === d.todayKey && time < (d.nowTime || '00:00')
}

/**
 * Состояние выбора дня + времени. `timeTouched` — чтобы не перетирать вручную
 * выставленное время при смене дня; `min` на инпуте для «сегодня» подсказывает
 * прошедшие часы.
 */
export function useDayTime(initialDay: string, initialTime: string | null) {
  const [day, setDay] = useState(initialDay)
  const [time, setTime] = useState(initialTime || defaultTimeFor(initialDay))
  const timeTouched = useRef(Boolean(initialTime))
  const d = getState().data!
  const min = day === d.todayKey ? d.nowTime || '00:00' : undefined

  const selectDay = (next: string): void => {
    setDay(next)
    if (!timeTouched.current) setTime(defaultTimeFor(next))
  }
  const onTimeChange = (v: string): void => {
    timeTouched.current = true
    setTime(v)
  }
  return { day, time, min, selectDay, onTimeChange }
}

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
  return (
    <div className="day-chips">
      {days.map((d) => (
        <button
          key={d.dateKey}
          className={'day-chip' + (d.dateKey === selected ? ' selected' : '')}
          onClick={() => onSelect(d.dateKey)}
        >
          <span className="dc-dow">{WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]}</span>
          <span className="dc-num">{String(dayNum(d.dateKey))}</span>
          {/* Ивент дня — точкой в углу. Гостю сюда приезжают только открытые
              ивенты (сервер фильтрует residentsOnly), так что метка честная. */}
          {d.events.length > 0 ? (
            <i className="dc-event" title={d.events.map((e) => e.title).join(', ')} />
          ) : null}
          {showCounts ? (
            d.total > 0 ? (
              <div className="dc-counts">
                <span>{String(d.total)}</span>
                {icons.check(10, d.dateKey === selected ? '#fff' : '#34c759', 2.2)}
                <span className="dc-approved">{String(d.approved)}</span>
              </div>
            ) : (
              <span className="dc-dash">—</span>
            )
          ) : null}
        </button>
      ))}
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
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
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

const REMINDER_LABELS: Record<ReminderChoice, string> = {
  m30: 'за 30 мин',
  h1: 'за час',
  h2: 'за 2 часа',
  morning: 'утром',
  evening: 'накануне вечером',
}

/** Порядок в карточке — от ближнего срока к дальнему, как в макете. */
const REMINDER_ORDER: ReminderChoice[] = ['m30', 'h1', 'h2', 'morning', 'evening']

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
function reminderWhen(dateKey: string, time: string, choice: ReminderChoice): string {
  const d = getState().data!
  const at = reminderSlot(dateKey, time, choice)
  if (at.dateKey === d.todayKey) return `сегодня в ${at.time}`
  if (at.dateKey === addDays(d.todayKey, 1)) return `завтра в ${at.time}`
  return `в ${fmtShortDate(at.dateKey)} в ${at.time}`
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
        <div className="row">
          <span className="row-label">
            Напомнить о визите
            {/* Когда напоминание включено, срок виден на чипах, а момент — в подписи
                под карточкой: третий раз повторять его в подзаголовке незачем. */}
            {active || sent ? null : <span className="row-sublabel">Бот напишет в личку перед визитом</span>}
          </span>
          <Switch on={active} onToggle={toggle} label="Напомнить о визите" />
        </div>
        {active ? (
          <>
            <div className="sep" style={{ marginLeft: 14 }} />
            <div className="remind-chips">
              {REMINDER_ORDER.map((c) => {
                const off = !available.includes(c)
                return (
                  <button
                    key={c}
                    className={'remind-chip' + (c === choice ? ' selected' : '') + (off ? ' off' : '')}
                    disabled={off}
                    onClick={() => onChange(c)}
                  >
                    {REMINDER_LABELS[c]}
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
      </div>
      {caption ? <div className="remind-caption">{caption}</div> : null}
    </div>
  )
}

/** Ряд «Прийти анонимно» — общий для новой заявки и правки. */
export function AnonRow({ anon, onChange }: { anon: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card">
      <div className="row">
        <span className="row-label">
          Прийти анонимно
          <span className="row-sublabel">Другие гости не увидят вас в списке</span>
        </span>
        <Switch on={anon} onToggle={() => onChange(!anon)} label="Прийти анонимно" />
      </div>
    </div>
  )
}
