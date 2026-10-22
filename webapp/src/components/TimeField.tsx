// Поле времени вместо <input type="time">. Нативный инпут рисует am/pm, когда
// локаль браузера/системы английская, а формат ему не задать ничем: он берётся
// из локали, а не из lang/атрибутов. Спейс живёт в 24-часовом времени, поэтому
// пикер свой: тап по «таблетке» открывает шторку с колесом часов и минут — то
// же движение, что у системного пикера iOS, но подписи наши и всегда 00–23.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'
import { useSheetDrag } from './useSheetDrag'

/** Высота строки колеса; должна совпадать с --tp-item-h в app.css. */
const ITEM_H = 40
/** Пауза без событий скролла = жест закончился (аналога scrollend в Safari нет). */
const SETTLE_MS = 90

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

const split = (value: string): [string, string] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  return m ? [m[1]!.padStart(2, '0'), m[2]!] : ['15', '00']
}

function Wheel({
  values,
  value,
  minIndex,
  label,
  onChange,
}: {
  values: string[]
  value: string
  /** Всё выше по списку недоступно (прошедший час/минута сегодня). */
  minIndex: number
  label: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  const index = Math.max(0, values.indexOf(value))
  const [active, setActive] = useState(index)

  // Позиция колеса — это scrollTop, а не разметка: держим её в согласии с value
  // (первый кадр — без анимации, дальше внешние правки доезжают плавно).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (Math.round(el.scrollTop / ITEM_H) === index) return
    el.scrollTo({ top: index * ITEM_H, behavior: mounted.current ? 'smooth' : 'auto' })
    setActive(index)
  }, [index])

  useEffect(() => {
    mounted.current = true
    return () => window.clearTimeout(timer.current)
  }, [])

  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
    if (i !== active) {
      setActive(i)
      haptic.tick()
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // Заехали в недоступную часть списка — откатываем к первому разрешённому.
      const j = Math.max(i, minIndex)
      if (j !== i) el.scrollTo({ top: j * ITEM_H, behavior: 'smooth' })
      const next = values[j]
      if (next && next !== value) onChange(next)
    }, SETTLE_MS)
  }

  return (
    <div className="tp-wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={label}>
      {values.map((v, i) => (
        <div
          key={v}
          role="option"
          aria-selected={i === active}
          className={'tp-item' + (i === active ? ' active' : '') + (i < minIndex ? ' disabled' : '')}
          onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })}
        >
          {v}
        </div>
      ))}
    </div>
  )
}

function TimeSheet({
  initial,
  min,
  onClose,
  onClear,
}: {
  initial: string
  min: string | undefined
  onClose: (value: string | null) => void
  onClear?: () => void
}) {
  const [shown, setShown] = useState(false)
  const done = useRef(false)
  // Сохранённое время могло уйти в прошлое, пока экран был открыт: колесо встаёт на
  // первое разрешённое, иначе «Готово» вернуло бы то, что сервер отобьёт.
  const [initialHour, initialMinute] = split(min && initial < min ? min : initial)
  const [hour, setHour] = useState(initialHour)
  const [minute, setMinute] = useState(initialMinute)
  const [minHour, minMinute] = min ? split(min) : [null, null]

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (value: string | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    setTimeout(() => onClose(value), 220)
  }

  // Системная «Назад» должна закрывать шторку, а не экран под ней. Регистрируем
  // после close: эффект зовёт именно его, со всей защитой от повторного закрытия.
  useEffect(() => pushOverlay(() => close(null)), [])
  const overlayRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useSheetDrag(sheetRef, overlayRef, () => close(null), '.tp-bar')

  const selectHour = (next: string): void => {
    setHour(next)
    // Приехали на граничный час — минуты могли остаться в прошлом.
    if (minHour !== null && next === minHour && minMinute !== null && minute < minMinute) setMinute(minMinute)
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={'tp-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="tp-sheet" ref={sheetRef}>
        <div className="tp-bar">
          <button className="tp-bar-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <span className="tp-bar-title">Время</span>
          <button className="tp-bar-btn primary" onClick={() => close(hour + ':' + minute)}>
            Готово
          </button>
        </div>
        <div className="tp-wheels">
          <div className="tp-band" />
          <Wheel
            values={HOURS}
            value={hour}
            minIndex={minHour !== null ? HOURS.indexOf(minHour) : 0}
            label="Часы"
            onChange={selectHour}
          />
          <span className="tp-colon">:</span>
          <Wheel
            values={MINUTES}
            value={minute}
            minIndex={minHour !== null && hour === minHour && minMinute !== null ? MINUTES.indexOf(minMinute) : 0}
            label="Минуты"
            onChange={setMinute}
          />
        </div>
        {onClear ? (
          <button
            type="button"
            className="tp-clear"
            onClick={() => {
              close(null)
              onClear()
            }}
          >
            Без времени
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function TimeField({
  value,
  onChange,
  min,
  className,
  placeholder,
  fallback,
  onClear,
  prefix,
}: {
  value: string
  onChange: (value: string) => void
  /** Нижняя граница `HH:MM` (слот «на сегодня» не должен быть в прошлом). */
  min?: string | undefined
  className?: string
  /** Подпись пустого поля. Без неё пустое значение рисуется как 15:00. */
  placeholder?: string
  /** На каком времени открыть колесо, когда значения нет. */
  fallback?: string
  /** «Без времени» в шторке: у необязательного поля значение надо уметь и снять. */
  onClear?: () => void
  /** Слово перед временем («к 18:00»), когда поле стоит в строке без подписи. */
  prefix?: string
}) {
  const [open, setOpen] = useState(false)
  const empty = value === '' && placeholder !== undefined
  const [hour, minute] = split(empty && fallback ? fallback : value)

  return (
    <>
      <button
        type="button"
        className={'time-input time-field' + (empty ? ' empty' : '') + (className ? ' ' + className : '')}
        aria-label={empty ? placeholder : 'Время: ' + hour + ':' + minute}
        onClick={() => setOpen(true)}
      >
        {empty ? placeholder : (prefix ? prefix + ' ' : '') + hour + ':' + minute}
      </button>
      {open ? (
        <TimeSheet
          initial={hour + ':' + minute}
          min={min}
          onClose={(next) => {
            setOpen(false)
            if (next) onChange(next)
          }}
          onClear={value !== '' ? onClear : undefined}
        />
      ) : null}
    </>
  )
}
