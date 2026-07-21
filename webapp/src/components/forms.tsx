// Поля форм новой заявки / правки: чипы дней, выбор дня+времени, цель, анонимность.

import { useRef, useState } from 'react'
import { dayNum, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { getState } from '../store'
import type { Day } from '../types'
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

/** Ряд «Прийти анонимно» — общий для новой заявки и правки. */
export function AnonRow({ anon, onChange }: { anon: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card">
      <div className="row">
        <span className="row-label">
          Прийти анонимно
          <span className="row-sublabel">Другие гости не увидят вас в списке</span>
        </span>
        <Switch on={anon} onToggle={() => onChange(!anon)} />
      </div>
    </div>
  )
}
