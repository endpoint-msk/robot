// Поле даты вместо <input type="date">: довод тот же, что у TimeField — нативный
// пикер рисуется локалью системы (порядок полей, первый день недели, названия
// месяцев), а задать ему это нечем. Тап по «таблетке» открывает шторку с сеткой
// месяца, неделя начинается с понедельника, как везде в миниаппе.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, dayNum, keyToDate, monthIdx, MONTHS_NOM, weekdayIdx, WEEKDAYS_SHORT, yearOf } from '../dates'
import { icons } from '../icons'
import { hapticTick } from '../telegram'

const monthStart = (key: string): string => key.slice(0, 8) + '01'

const addMonths = (key: string, n: number): string => {
  const d = keyToDate(monthStart(key))
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** Последний день месяца: первое число следующего минус сутки. */
const daysInMonth = (key: string): number => dayNum(addDays(addMonths(key, 1), -1))

/** «Ср, 15 октября», с годом — только когда он не тот, в котором сейчас живём. */
const label = (key: string, today: string): string => {
  const base = `${WEEKDAYS_SHORT[weekdayIdx(key)]}, ${dayNum(key)} ${MONTHS_NOM[monthIdx(key)]!.toLowerCase()}`
  return yearOf(key) === yearOf(today) ? base : `${base} ${yearOf(key)}`
}

function DateSheet({
  initial,
  min,
  max,
  onClose,
}: {
  initial: string
  min: string
  max: string
  onClose: (value: string | null) => void
}) {
  const [shown, setShown] = useState(false)
  const done = useRef(false)
  const [month, setMonth] = useState(monthStart(initial))
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (next: string | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    setTimeout(() => onClose(next), 220)
  }

  const first = monthStart(month)
  // Ведущие пустые ячейки: сколько дней прошлого месяца попадает в первую строку.
  const lead = weekdayIdx(first)
  const total = daysInMonth(first)
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => addDays(first, i)),
  ]

  const shift = (n: number): void => {
    const next = addMonths(month, n)
    if (next < monthStart(min) || next > monthStart(max)) return
    hapticTick()
    setMonth(next)
  }

  return createPortal(
    <div
      className={'tp-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="tp-sheet">
        <div className="tp-bar">
          <button className="tp-bar-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <span className="tp-bar-title">Дата</span>
          <button className="tp-bar-btn primary" onClick={() => close(value)}>
            Готово
          </button>
        </div>
        <div className="dp-head">
          <button
            className="dp-nav"
            aria-label="Предыдущий месяц"
            disabled={addMonths(month, -1) < monthStart(min)}
            onClick={() => shift(-1)}
          >
            <span className="dp-nav-back">{icons.chevron('#007aff')}</span>
          </button>
          <span className="dp-month">{`${MONTHS_NOM[monthIdx(first)]} ${yearOf(first)}`}</span>
          <button
            className="dp-nav"
            aria-label="Следующий месяц"
            disabled={addMonths(month, 1) > monthStart(max)}
            onClick={() => shift(1)}
          >
            {icons.chevron('#007aff')}
          </button>
        </div>
        <div className="dp-grid">
          {WEEKDAYS_SHORT.map((d) => (
            <span className="dp-dow" key={d}>
              {d}
            </span>
          ))}
          {cells.map((key, i) =>
            key === null ? (
              <span className="dp-cell empty" key={`empty-${i}`} />
            ) : (
              <button
                key={key}
                className={'dp-cell' + (key === value ? ' selected' : '')}
                disabled={key < min || key > max}
                onClick={() => {
                  hapticTick()
                  setValue(key)
                }}
              >
                {dayNum(key)}
              </button>
            ),
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function DateField({
  value,
  onChange,
  min,
  max,
}: {
  value: string
  onChange: (value: string) => void
  /** Нижняя граница — обычно «сегодня» в поясе спейса. */
  min: string
  /** Верхняя граница: у ивентов это год вперёд (EVENT_DAYS_AHEAD). */
  max: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="time-input time-field dp-field"
        aria-label={'Дата: ' + label(value, min)}
        onClick={() => setOpen(true)}
      >
        {label(value, min)}
      </button>
      {open ? (
        <DateSheet
          initial={value}
          min={min}
          max={max}
          onClose={(next) => {
            setOpen(false)
            if (next) onChange(next)
          }}
        />
      ) : null}
    </>
  )
}
