// Модалки в дизайн-системе миниаппа. Свои, а не tg.showAlert/window.alert:
// нативные попапы выпадают из оформления, а в браузере (вне Telegram) это и вовсе
// системная всплывашка. Императивный API (showAlert/confirmDialog/timePrompt)
// возвращает Promise — как в старом миниаппе; ModalHost рендерит очередь в портал.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { DayChips, isPastForToday, useDayTime } from './components/forms'
import { icons } from './icons'
import { getState } from './store'

type ConfirmInput = {
  kind: 'confirm'
  text: string
  confirmLabel: string
  cancelLabel: string | null
  destructive: boolean
}
type TimeInput = {
  kind: 'time'
  text?: string
  initial?: string
  confirmLabel: string
}
type RescheduleInput = {
  kind: 'reschedule'
  text?: string
  initialDay: string
  initialTime: string
  confirmLabel: string
}
type NumberInput = {
  kind: 'number'
  text: string
  initial: number
  /** Подпись под полем: единицы, диапазон, что будет дальше. */
  hint?: string
  min: number
  max: number
  confirmLabel: string
}
type DateInput = {
  kind: 'date'
  text: string
  initial: string
  /** Потолок выбора ('YYYY-MM-DD'). Пусто — без ограничения. */
  max?: string
  confirmLabel: string
}
type ImageInput = {
  kind: 'image'
  src: string
  alt: string
}
type ModalInput = ConfirmInput | TimeInput | RescheduleInput | NumberInput | DateInput | ImageInput
type Modal = ModalInput & { id: number; resolve: (value: any) => void }

let modals: Modal[] = []
let nextId = 1
const listeners = new Set<() => void>()
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const getSnapshot = (): Modal[] => modals
const emit = (): void => listeners.forEach((l) => l())

function open<T>(input: ModalInput): Promise<T> {
  return new Promise<T>((resolve) => {
    modals = [...modals, { ...input, id: nextId++, resolve }]
    emit()
  })
}
function remove(id: number): void {
  modals = modals.filter((m) => m.id !== id)
  emit()
}

function ModalCard({ modal }: { modal: Modal & { kind: 'confirm' | 'time' } }) {
  const [shown, setShown] = useState(false)
  const [time, setTime] = useState(modal.kind === 'time' ? modal.initial || '15:00' : '')
  const done = useRef(false)

  // Класс .shown — следующим кадром, иначе transition не запустится.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (value: any): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    // Резолвим сразу (как в старом миниаппе), чтобы вызывающий не ждал 180 мс лишних;
    // fade-out доигрывает, и только потом убираем узел.
    modal.resolve(value)
    setTimeout(() => remove(modal.id), 180)
  }

  if (modal.kind === 'time') {
    return (
      <div
        className={'modal-overlay' + (shown ? ' shown' : '')}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(null)
        }}
      >
        <div className="modal-card">
          {modal.text ? <div className="modal-text">{modal.text}</div> : null}
          <div className="modal-time-wrap">
            <input
              className="time-input modal-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button className="modal-btn" onClick={() => close(null)}>
              Отмена
            </button>
            <button className="modal-btn primary" onClick={() => close(time || null)}>
              {modal.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={'modal-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        // Тап по затемнению = отмена, но только если есть что отменять.
        if (e.target === e.currentTarget && modal.cancelLabel) close(false)
      }}
    >
      <div className="modal-card">
        <div className="modal-text">{modal.text}</div>
        <div className="modal-actions">
          {modal.cancelLabel ? (
            <button className="modal-btn" onClick={() => close(false)}>
              {modal.cancelLabel}
            </button>
          ) : null}
          <button
            className={'modal-btn primary' + (modal.destructive ? ' destructive' : '')}
            onClick={() => close(true)}
          >
            {modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Модалка переноса: выбор дня (чипы) + времени. Отдельный компонент — свои хуки (useDayTime). */
function RescheduleCard({ modal }: { modal: Modal & { kind: 'reschedule' } }) {
  const [shown, setShown] = useState(false)
  const done = useRef(false)
  const days = getState().data!.days
  const { day, time, min, selectDay, onTimeChange } = useDayTime(modal.initialDay, modal.initialTime)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (value: { dateKey: string; time: string } | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    modal.resolve(value)
    setTimeout(() => remove(modal.id), 180)
  }

  const confirm = (): void => {
    if (!time) return
    // Прошедший слот «на сегодня» — оставляем модалку открытой, поверх кладём alert.
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выбери время позже текущего.')
      return
    }
    close({ dateKey: day, time })
  }

  return (
    <div
      className={'modal-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="modal-card">
        {modal.text ? <div className="modal-text">{modal.text}</div> : null}
        <div className="modal-resched-day">
          <DayChips days={days} selected={day} onSelect={selectDay} showCounts={false} />
        </div>
        <div className="modal-time-wrap">
          <input
            className="time-input modal-time"
            type="time"
            value={time}
            min={min}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="modal-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <button className="modal-btn primary" onClick={confirm}>
            {modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Ввод числа: ставка взноса, день сбора. Своя модалка, а не `window.prompt`:
 * нативный промпт в Telegram Desktop работает, а в клиенте на macOS не открывается
 * вовсе, и действие молча проваливается. Плюс отмена нативного промпта в вебвью
 * возвращает пустую строку вместо null, из-за чего «Отмена» ставила ноль.
 */
function NumberCard({ modal }: { modal: Modal & { kind: 'number' } }) {
  const [shown, setShown] = useState(false)
  const [value, setValue] = useState(String(modal.initial))
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setShown(true)
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (result: number | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    modal.resolve(result)
    setTimeout(() => remove(modal.id), 180)
  }

  const parsed = Number(value.replace(',', '.').trim())
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= modal.min && parsed <= modal.max

  return (
    <div
      className={'modal-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="modal-card">
        <div className="modal-text">{modal.text}</div>
        <div className="modal-num-wrap">
          <input
            ref={inputRef}
            className="text-input modal-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) close(Math.round(parsed))
            }}
          />
        </div>
        {modal.hint ? <div className="modal-num-hint">{modal.hint}</div> : null}
        <div className="modal-actions">
          <button className="modal-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <button
            className={'modal-btn primary' + (valid ? '' : ' disabled')}
            onClick={() => (valid ? close(Math.round(parsed)) : undefined)}
          >
            {modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Выбор даты: та же карточка, что у ввода числа, но с нативным date-инпутом. */
function DateCard({ modal }: { modal: Modal & { kind: 'date' } }) {
  const [shown, setShown] = useState(false)
  const [value, setValue] = useState(modal.initial)
  const done = useRef(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (result: string | null): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    modal.resolve(result)
    setTimeout(() => remove(modal.id), 180)
  }

  const valid = value !== '' && (!modal.max || value <= modal.max)

  return (
    <div
      className={'modal-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="modal-card">
        <div className="modal-text">{modal.text}</div>
        <div className="modal-time-wrap">
          <input
            className="time-input modal-time"
            type="date"
            value={value}
            max={modal.max}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="modal-btn" onClick={() => close(null)}>
            Отмена
          </button>
          <button
            className={'modal-btn primary' + (valid ? '' : ' disabled')}
            onClick={() => (valid ? close(value) : undefined)}
          >
            {modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Картинка на весь экран. Тап по любому месту закрывает: это просмотрщик, а не диалог,
 * и целиться в крестик на телефоне незачем — он тут только как подсказка, что выход есть.
 */
function ImageCard({ modal }: { modal: Modal & { kind: 'image' } }) {
  const [shown, setShown] = useState(false)
  const done = useRef(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (): void => {
    if (done.current) return
    done.current = true
    setShown(false)
    modal.resolve(true)
    setTimeout(() => remove(modal.id), 180)
  }

  return (
    <div className={'lightbox' + (shown ? ' shown' : '')} onClick={close}>
      <button className="lightbox-close" aria-label="Закрыть" onClick={close}>
        {icons.xmark(15, '#fff')}
      </button>
      <img src={modal.src} alt={modal.alt} />
    </div>
  )
}

export function ModalHost() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return createPortal(
    <>
      {list.map((m) =>
        m.kind === 'image' ? (
          <ImageCard key={m.id} modal={m} />
        ) : m.kind === 'reschedule' ? (
          <RescheduleCard key={m.id} modal={m} />
        ) : m.kind === 'number' ? (
          <NumberCard key={m.id} modal={m} />
        ) : m.kind === 'date' ? (
          <DateCard key={m.id} modal={m} />
        ) : (
          <ModalCard key={m.id} modal={m} />
        ),
      )}
    </>,
    document.body,
  )
}

/** Открыть картинку на весь экран. */
export const showImage = (src: string, alt = ''): void => {
  void open<boolean>({ kind: 'image', src, alt })
}

export const showAlert = (message: string): void => {
  void open<boolean>({ kind: 'confirm', text: message, confirmLabel: 'OK', cancelLabel: null, destructive: false })
}

export const confirmDialog = (
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean },
): Promise<boolean> =>
  open<boolean>({
    kind: 'confirm',
    text: message,
    confirmLabel: opts?.confirmLabel ?? 'Да',
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    destructive: opts?.destructive ?? false,
  })

export const timePrompt = (opts: { text?: string; initial?: string; confirmLabel?: string }): Promise<string | null> =>
  open<string | null>({
    kind: 'time',
    text: opts.text,
    initial: opts.initial,
    confirmLabel: opts.confirmLabel ?? 'Предложить',
  })

/** Выбор дня + времени для переноса визита. null — отмена. */
export const reschedulePrompt = (opts: {
  text?: string
  initialDay: string
  initialTime: string
  confirmLabel?: string
}): Promise<{ dateKey: string; time: string } | null> =>
  open<{ dateKey: string; time: string } | null>({
    kind: 'reschedule',
    text: opts.text,
    initialDay: opts.initialDay,
    initialTime: opts.initialTime,
    confirmLabel: opts.confirmLabel ?? 'Предложить',
  })

/**
 * Ввод числа. null — отмена (именно null, а не 0: разница между «оставить как было»
 * и «поставить ноль» здесь принципиальная, ноль это освобождение от взноса).
 */
export const numberPrompt = (opts: {
  text: string
  initial: number
  hint?: string
  min?: number
  max?: number
  confirmLabel?: string
}): Promise<number | null> =>
  open<number | null>({
    kind: 'number',
    text: opts.text,
    initial: opts.initial,
    hint: opts.hint,
    min: opts.min ?? 0,
    max: opts.max ?? 1_000_000,
    confirmLabel: opts.confirmLabel ?? 'Сохранить',
  })

/** Выбор даты ('YYYY-MM-DD'). null — отмена. */
export const datePrompt = (opts: {
  text: string
  initial: string
  max?: string
  confirmLabel?: string
}): Promise<string | null> =>
  open<string | null>({
    kind: 'date',
    text: opts.text,
    initial: opts.initial,
    max: opts.max,
    confirmLabel: opts.confirmLabel ?? 'Поставить',
  })
