// Модалки в дизайн-системе миниаппа. Свои, а не tg.showAlert/window.alert:
// нативные попапы выпадают из оформления, а в браузере (вне Telegram) это и вовсе
// системная всплывашка. Императивный API (showAlert/confirmDialog/timePrompt)
// возвращает Promise — как в старом миниаппе; ModalHost рендерит очередь в портал.
//
// Все вопросы открываются одним листом снизу, как в iOS: кнопки у большого пальца, а не
// посреди экрана поверх списка, о котором спрашивают. Экран под листом отъезжает вглубь.
// Вопрос, заданный сразу после ответа на предыдущий (меню пилла хоста → подтверждение),
// появляется в том же листе: лист не закрывается и не открывается заново.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DayChips, isPastForToday, useDayTime } from './components/forms'
import { Avatar } from './components/people'
import { NumberWheel, TimeField } from './components/TimeField'
import { useSheetDrag } from './components/useSheetDrag'
import { icons } from './icons'
import { animate, clamp, E, mix, pr, reducedMotion } from './motion'
import { pushOverlay } from './overlays'
import { getState } from './store'
import { haptic } from './telegram'

/**
 * Кто и когда: шапка листа над вопросом про заявку или гостя. Имя стоит отдельно, и
 * вопрос обходится без него: склонять имя гостя в тексте не получается.
 */
export type SheetSubject = {
  user: { userId: number; name: string; username?: string | null }
  /** Строка под именем: слот визита, статус. */
  line?: string
}

type ConfirmInput = {
  kind: 'confirm'
  text: string
  confirmLabel: string
  cancelLabel: string | null
  destructive: boolean
  subject?: SheetSubject
}
type TimeInput = {
  kind: 'time'
  text?: string
  initial?: string
  confirmLabel: string
  subject?: SheetSubject
}
type RescheduleInput = {
  kind: 'reschedule'
  text?: string
  initialDay: string
  initialTime: string
  confirmLabel: string
  subject?: SheetSubject
}
type NumberInput = {
  kind: 'number'
  text: string
  initial: number
  /** Подпись под полем: единицы, диапазон, что будет дальше. */
  hint?: string
  min: number
  max: number
  /** Колесо вместо клавиатуры; `unit` подписывает число справа («15 человек»). */
  wheel?: { unit: (n: number) => string }
  confirmLabel: string
  subject?: SheetSubject
}
type TextInput = {
  kind: 'text'
  text: string
  initial: string
  placeholder?: string
  hint?: string
  maxLength: number
  confirmLabel: string
  cancelLabel: string
  /** Несколько строк: Enter переносит строку, а не подтверждает. */
  multiline: boolean
  /** Подтверждение необратимо (закрыть заявку): красная кнопка и жёсткий отклик. */
  destructive: boolean
  subject?: SheetSubject
}
type DateInput = {
  kind: 'date'
  text: string
  initial: string
  /** Потолок выбора ('YYYY-MM-DD'). Пусто — без ограничения. */
  max?: string
  confirmLabel: string
  subject?: SheetSubject
}
type ImageInput = {
  kind: 'image'
  src: string
  alt: string
}
/** Выбор одного действия из нескольких: строки столбиком, как в нативном action sheet. */
type ChoiceInput = {
  kind: 'choice'
  text: string
  options: { key: string; label: string; destructive?: boolean }[]
  cancelLabel: string
  subject?: SheetSubject
}
type ModalInput = ConfirmInput | TimeInput | RescheduleInput | NumberInput | TextInput | DateInput | ImageInput | ChoiceInput
/** `settled`: ответ уже отдан, а узел ещё нужен листу (гаснет, уезжает вниз). */
type Modal = ModalInput & { id: number; resolve: (value: any) => void; settled: boolean }
type SheetModal = Exclude<Modal, { kind: 'image' }>
type Of<K extends SheetModal['kind']> = Extract<SheetModal, { kind: K }>

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

/** Чем модалка отвечает, когда её закрыли «Назад»: это отмена, а не выбор. */
const cancelValue = (kind: ModalInput['kind']): unknown => (kind === 'confirm' ? false : null)

/** Снятие оверлея по id: модалка может закрыться и сама (кнопкой), и снаружи. */
const unregister = new Map<number, () => void>()

function open<T>(input: ModalInput): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = nextId++
    modals = [...modals, { ...input, id, resolve, settled: false }]
    // Системная «Назад» отвечает на верхнюю модалку отменой.
    unregister.set(id, pushOverlay(() => settle(id, cancelValue(input.kind))))
    emit()
  })
}

/**
 * Ответ на модалку. Резолвим сразу (как в старом миниаппе), чтобы вызывающий не ждал
 * анимации, а узел оставляем: лист следующим кадром решает, уехать ему или показать
 * вопрос, который вызывающий задал следом. Из реестра «Назад» модалка уходит тоже
 * сразу: иначе нажатие на время ухода попало бы в неё, а не в экран.
 */
function settle(id: number, value: unknown): void {
  const m = modals.find((x) => x.id === id)
  if (!m || m.settled) return
  unregister.get(id)?.()
  unregister.delete(id)
  modals = modals.map((x) => (x.id === id ? { ...x, settled: true } : x))
  m.resolve(value)
  emit()
}

/** Убирает отвеченные модалки, которые подошли под `pick`: их слой больше не виден. */
function purge(pick: (m: Modal) => boolean): void {
  const next = modals.filter((m) => !(m.settled && pick(m)))
  if (next.length === modals.length) return
  modals = next
  emit()
}

const isSheet = (m: Modal): m is SheetModal => m.kind !== 'image'

/** Вопрос, который сейчас ждёт ответа: последний открытый из неотвеченных. */
const topOf = (list: Modal[]): SheetModal | null => {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!
    if (isSheet(m) && !m.settled) return m
  }
  return null
}

/** Отмена верхнего вопроса: лист смахнули вниз. */
function dismissTop(): void {
  const t = topOf(modals)
  if (t) settle(t.id, cancelValue(t.kind))
}

/** Насколько экран под листом уходит вглубь: до 94% от верхнего края. */
const DEPTH = 0.06

/**
 * Экран под листом: #app уменьшается от верхнего края видимой области, а не документа,
 * поэтому сверху нет зазора и шапка Telegram не отрывается от экрана. transform делает
 * #app containing block для position: fixed внутри него, и нижняя панель считала бы
 * координаты от низа документа: низ видимой области уходит в CSS (--sheet-vb), и
 * панель стоит там же, где стояла, уменьшаясь вместе с экраном. Верх видимой области
 * (--sheet-vt) нужен по той же причине строке на стекле сверху (TopBar).
 */
const stage = (() => {
  let app: HTMLElement | null = null
  const sync = (): void => {
    if (!app) return
    const y = window.scrollY
    app.style.transformOrigin = `50% ${y}px`
    document.documentElement.style.setProperty('--sheet-vt', `${y}px`)
    document.documentElement.style.setProperty('--sheet-vb', `${y + window.innerHeight}px`)
  }
  return {
    begin(): void {
      if (app || reducedMotion()) return
      app = document.getElementById('app')
      if (!app) return
      sync()
      app.style.transform = 'scale(1)'
      document.documentElement.classList.add('sheet-recede')
      // Палец страницу под листом не прокрутит (затемнение не пускает), но её двигают и
      // без него: iOS подтягивает поле над клавиатурой, а «Передать другому» из меню
      // пилла открывает экран, и тот встаёт в начало, пока лист ещё уезжает.
      window.addEventListener('scroll', sync, { passive: true })
      window.addEventListener('resize', sync)
    },
    set(p: number): void {
      if (app) app.style.transform = `scale(${(1 - DEPTH * clamp(p, 0, 1)).toFixed(4)})`
    },
    end(): void {
      if (!app) return
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      app.style.transform = ''
      app.style.transformOrigin = ''
      document.documentElement.classList.remove('sheet-recede')
      document.documentElement.style.removeProperty('--sheet-vt')
      document.documentElement.style.removeProperty('--sheet-vb')
      app = null
    },
  }
})()

/** Клавиатура уходит вместе с вопросом, а не висит над следующим или над экраном. */
const blurInside = (root: HTMLElement | null): void => {
  const a = document.activeElement
  if (root && a instanceof HTMLElement && root.contains(a)) a.blur()
}

/** Фокус в поле, когда его вопрос впервые стал видимым. Кадром позже: до него лист ещё не встал. */
function useAutoFocus<T extends HTMLInputElement>(on: boolean) {
  const ref = useRef<T>(null)
  const done = useRef(false)
  useEffect(() => {
    if (!on || done.current) return
    const raf = requestAnimationFrame(() => {
      done.current = true
      ref.current?.focus({ preventScroll: true })
      ref.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [on])
  return ref
}

function SheetHead({ subject }: { subject: SheetSubject }) {
  return (
    <div className="modal-head">
      <Avatar user={subject.user} />
      <div className="modal-who">
        <div className="modal-name">{subject.user.name}</div>
        {subject.line ? <div className="modal-line">{subject.line}</div> : null}
      </div>
    </div>
  )
}

const headKey = (s: SheetSubject | undefined): string => (s ? `${s.user.userId}|${s.line ?? ''}` : '')

const Question = ({ text }: { text?: string }) => (text ? <div className="modal-text">{text}</div> : null)

/** Отмена — отдельной строкой внизу, как в системном меню iOS. */
function CancelRow({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="card modal-actions">
      <button type="button" className="modal-btn primary" onClick={onCancel}>
        {label}
      </button>
    </div>
  )
}

/** Главное действие строкой во всю ширину. Необратимое — красное и с жёстким откликом. */
function Actions({
  label,
  destructive = false,
  disabled = false,
  onConfirm,
  cancel,
  onCancel,
}: {
  label: string
  destructive?: boolean
  disabled?: boolean
  onConfirm: () => void
  cancel: string | null
  onCancel: () => void
}) {
  return (
    <>
      <div className="card modal-actions">
        <button
          type="button"
          className={'modal-btn primary' + (destructive ? ' destructive' : '') + (disabled ? ' disabled' : '')}
          disabled={disabled}
          onClick={() => {
            if (destructive) haptic.impact('rigid')
            onConfirm()
          }}
        >
          {label}
        </button>
      </div>
      {cancel ? <CancelRow label={cancel} onCancel={onCancel} /> : null}
    </>
  )
}

function ConfirmBody({ modal }: { modal: Of<'confirm'> }) {
  return (
    <>
      <Question text={modal.text} />
      <Actions
        label={modal.confirmLabel}
        destructive={modal.destructive}
        onConfirm={() => settle(modal.id, true)}
        cancel={modal.cancelLabel}
        onCancel={() => settle(modal.id, false)}
      />
    </>
  )
}

/**
 * Выбор действия: две-три строки столбиком. Нужен там, где за одним элементом стоит
 * больше одного действия и прятать их в свайп некуда, — например у пилла хоста в
 * строке заявки («передать другому» и «отменить хостинг»).
 */
function ChoiceBody({ modal }: { modal: Of<'choice'> }) {
  return (
    <>
      <Question text={modal.text} />
      <div className="card modal-actions">
        {modal.options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={'modal-btn' + (o.destructive ? ' destructive' : '')}
            onClick={() => {
              if (o.destructive) haptic.impact('rigid')
              settle(modal.id, o.key)
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <CancelRow label={modal.cancelLabel} onCancel={() => settle(modal.id, null)} />
    </>
  )
}

function TimeBody({ modal }: { modal: Of<'time'> }) {
  const [time, setTime] = useState(modal.initial || '15:00')
  return (
    <>
      <Question text={modal.text} />
      <div className="card">
        <div className="row modal-row">
          <span className="row-label">Время</span>
          <TimeField value={time} onChange={setTime} />
        </div>
      </div>
      <Actions
        label={modal.confirmLabel}
        onConfirm={() => settle(modal.id, time || null)}
        cancel="Отмена"
        onCancel={() => settle(modal.id, null)}
      />
    </>
  )
}

/** Перенос: выбор дня (чипы) + времени. Отдельный компонент — свои хуки (useDayTime). */
function RescheduleBody({ modal }: { modal: Of<'reschedule'> }) {
  const days = getState().data!.days
  const { day, time, min, selectDay, onTimeChange } = useDayTime(modal.initialDay, modal.initialTime)

  const confirm = (): void => {
    if (!time) return
    // Прошедший слот «на сегодня»: ответ ложится в тот же лист поверх вопроса, а выбор
    // дня и времени под ним сохраняется.
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло, выберите время позже текущего.')
      return
    }
    settle(modal.id, { dateKey: day, time })
  }

  return (
    <>
      <Question text={modal.text} />
      <div className="modal-resched-day">
        <DayChips days={days} selected={day} onSelect={selectDay} showCounts={false} />
      </div>
      <div className="card">
        <div className="row modal-row">
          <span className="row-label">Время</span>
          <TimeField value={time} min={min} onChange={onTimeChange} />
        </div>
      </div>
      <Actions label={modal.confirmLabel} onConfirm={confirm} cancel="Отмена" onCancel={() => settle(modal.id, null)} />
    </>
  )
}

/**
 * Ввод числа: ставка взноса, день сбора. Своя модалка, а не `window.prompt`:
 * нативный промпт в Telegram Desktop работает, а в клиенте на macOS не открывается
 * вовсе, и действие молча проваливается. Плюс отмена нативного промпта в вебвью
 * возвращает пустую строку вместо null, из-за чего «Отмена» ставила ноль.
 */
function NumberBody({ modal, active }: { modal: Of<'number'>; active: boolean }) {
  const [value, setValue] = useState(String(modal.initial))
  const inputRef = useAutoFocus<HTMLInputElement>(active)
  const parsed = Number(value.replace(',', '.').trim())
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= modal.min && parsed <= modal.max
  const confirm = (): void => {
    if (valid) settle(modal.id, Math.round(parsed))
  }

  return (
    <>
      <Question text={modal.text} />
      <div className="card modal-field">
        <input
          ref={inputRef}
          className="text-input modal-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={modal.text}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm()
          }}
        />
      </div>
      {modal.hint ? <div className="modal-num-hint">{modal.hint}</div> : null}
      <Actions label={modal.confirmLabel} disabled={!valid} onConfirm={confirm} cancel="Отмена" onCancel={() => settle(modal.id, null)} />
    </>
  )
}

/**
 * Число колесом, как время: вместимость дня. Клавиатура ради одной-двух цифр лишняя, а
 * колесо держит значение в границах без проверки ввода.
 */
function NumberWheelBody({ modal }: { modal: Of<'number'> }) {
  const [value, setValue] = useState(() => clamp(Math.round(modal.initial), modal.min, modal.max))
  return (
    <>
      <Question text={modal.text} />
      <NumberWheel value={value} min={modal.min} max={modal.max} unit={modal.wheel!.unit} onChange={setValue} />
      {modal.hint ? <div className="modal-num-hint">{modal.hint}</div> : null}
      <Actions label={modal.confirmLabel} onConfirm={() => settle(modal.id, value)} cancel="Отмена" onCancel={() => settle(modal.id, null)} />
    </>
  )
}

/**
 * Ввод строки: причина закрытия дня, повестка, комментарий гостю. Пустой текст — тоже
 * ответ («без пояснения», «снять повестку»), поэтому кнопка активна всегда, а отмена
 * возвращает null, а не пустую строку.
 */
function TextBody({ modal, active }: { modal: Of<'text'>; active: boolean }) {
  const [value, setValue] = useState(modal.initial)
  // Многострочное поле здесь всегда необязательное (комментарий к действию), и
  // клавиатура, выехавшая сама, закрывала бы главную кнопку.
  const inputRef = useAutoFocus<HTMLInputElement>(active && !modal.multiline)

  return (
    <>
      <Question text={modal.text} />
      <div className="card modal-field">
        {modal.multiline ? (
          <textarea
            className="text-input modal-text-input modal-textarea"
            rows={3}
            aria-label={modal.placeholder || modal.text}
            placeholder={modal.placeholder}
            maxLength={modal.maxLength}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            ref={inputRef}
            className="text-input modal-text-input"
            type="text"
            autoComplete="off"
            aria-label={modal.text}
            placeholder={modal.placeholder}
            maxLength={modal.maxLength}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') settle(modal.id, value.trim())
            }}
          />
        )}
      </div>
      {modal.hint ? <div className="modal-num-hint">{modal.hint}</div> : null}
      <Actions
        label={modal.confirmLabel}
        destructive={modal.destructive}
        onConfirm={() => settle(modal.id, value.trim())}
        cancel={modal.cancelLabel}
        onCancel={() => settle(modal.id, null)}
      />
    </>
  )
}

/** Выбор даты: нативный date-инпут строкой в карточке. */
function DateBody({ modal }: { modal: Of<'date'> }) {
  const [value, setValue] = useState(modal.initial)
  const valid = value !== '' && (!modal.max || value <= modal.max)

  return (
    <>
      <Question text={modal.text} />
      <div className="card">
        <label className="row modal-row">
          <span className="row-label">Дата</span>
          <input className="time-input" type="date" value={value} max={modal.max} onChange={(e) => setValue(e.target.value)} />
        </label>
      </div>
      <Actions
        label={modal.confirmLabel}
        disabled={!valid}
        onConfirm={() => {
          if (valid) settle(modal.id, value)
        }}
        cancel="Отмена"
        onCancel={() => settle(modal.id, null)}
      />
    </>
  )
}

/**
 * Один вопрос в листе. Неотвеченные вопросы под верхним остаются смонтированными
 * (`parked`): пока сверху «это время уже прошло», выбор дня и времени под ним жив.
 */
function Layer({ modal, state }: { modal: SheetModal; state: 'on' | 'out' | 'parked' }) {
  const active = state === 'on'
  let body: ReactNode
  switch (modal.kind) {
    case 'confirm':
      body = <ConfirmBody modal={modal} />
      break
    case 'choice':
      body = <ChoiceBody modal={modal} />
      break
    case 'time':
      body = <TimeBody modal={modal} />
      break
    case 'reschedule':
      body = <RescheduleBody modal={modal} />
      break
    case 'number':
      body = modal.wheel ? <NumberWheelBody modal={modal} /> : <NumberBody modal={modal} active={active} />
      break
    case 'text':
      body = <TextBody modal={modal} active={active} />
      break
    case 'date':
      body = <DateBody modal={modal} />
      break
  }
  return (
    <div
      className={'modal-layer' + (active ? '' : ' ' + state)}
      data-layer={modal.id}
      data-head={headKey(modal.subject)}
      inert={!active}
    >
      {modal.subject ? <SheetHead subject={modal.subject} /> : null}
      <div className="modal-body">{body}</div>
    </div>
  )
}

/** Смена вопроса в листе: старый гаснет, новый проявляется, высота доезжает до новой. */
const SWAP_MS = 380
/** Запас под тенью листа: за нижним краем она не должна выглядывать полоской. */
const HIDE_PAD = 40

function ModalSheet({ list }: { list: Modal[] }) {
  const [shownId, setShownId] = useState(() => (topOf(list) ?? list.filter(isSheet).pop()!).id)
  const [outId, setOutId] = useState<number | null>(null)
  const shown = useRef(shownId)
  shown.current = shownId
  const dimRef = useRef<HTMLDivElement>(null)
  const liftRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const swapRef = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const control = useSheetDrag(sheetRef, dimRef, dismissTop, undefined, { onProgress: stage.set })

  const finish = (): void => {
    stage.end()
    purge(isSheet)
  }
  const setClosing = (on: boolean): void => {
    closing.current = on
    // Уходящий лист пропускает тапы к экрану: ждать его, чтобы нажать что-то под ним, незачем.
    sheetRef.current?.classList.toggle('closing', on)
    dimRef.current?.classList.toggle('closing', on)
  }

  // Решение после ответа принимается кадром позже, по живому списку: вызывающий, ответ
  // которому только что ушёл, мог тут же задать следующий вопрос, и тогда лист не
  // уезжает, а меняет содержимое. Порядку рендера React и микрозадач промиса тут
  // доверять нельзя, кадр переживает их оба.
  const decide = (): void => {
    const t = topOf(modals)
    const sheet = sheetRef.current
    if (!t) {
      if (closing.current) return
      setClosing(true)
      blurInside(sheet)
      if (control.current) control.current.close(finish)
      else finish()
      return
    }
    const hidden = !sheet || (control.current?.offset() ?? 0) >= sheet.offsetHeight * 0.9
    if (closing.current) {
      // Новый вопрос на уходе: лист разворачивается с того места и той скоростью, что есть.
      setClosing(false)
      stage.begin()
      control.current?.open()
    }
    if (t.id === shown.current) return
    blurInside(sheet)
    setOutId(hidden || reducedMotion() ? null : shown.current)
    setShownId(t.id)
  }

  // Лист встаёт за нижний край до первого кадра: пружина рисует первый кадр только в
  // requestAnimationFrame, и без этого он мелькнул бы открытым.
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    const dim = dimRef.current
    if (sheet && dim) {
      sheet.style.transform = `translateY(${sheet.offsetHeight + HIDE_PAD}px)`
      dim.style.opacity = '0'
    }
    stage.begin()
    return () => stage.end()
  }, [])
  useEffect(() => {
    if (!topOf(modals)) {
      finish()
      return
    }
    control.current?.open((sheetRef.current?.offsetHeight ?? 0) + HIDE_PAD)
  }, [])

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(decide)
    return () => cancelAnimationFrame(raf)
  }, [list])

  useLayoutEffect(() => {
    if (outId === null) return
    const box = swapRef.current
    const a = box?.querySelector<HTMLElement>(`[data-layer="${outId}"]`)
    const b = box?.querySelector<HTMLElement>(`[data-layer="${shownId}"]`)
    if (!box || !a || !b) {
      setOutId(null)
      return
    }
    // Шапка с тем же человеком и слотом стоит на месте, меняется только вопрос под ней.
    // Новая шапка до конца лежит под старой невидимой: аватарка в ней успевает загрузиться.
    const shared = a.dataset.head !== '' && a.dataset.head === b.dataset.head
    const fa = (shared && a.querySelector<HTMLElement>('.modal-body')) || a
    const fb = (shared && b.querySelector<HTMLElement>('.modal-body')) || b
    const headB = shared ? b.querySelector<HTMLElement>('.modal-head') : null
    const h0 = a.offsetHeight
    const h1 = b.offsetHeight
    box.style.overflow = 'hidden'
    if (headB) headB.style.visibility = 'hidden'
    const stop = animate(
      SWAP_MS,
      (t) => {
        const s = pr(t, 0, SWAP_MS, E.inOut)
        box.style.height = `${mix(h0, h1, s).toFixed(2)}px`
        fa.style.opacity = String(clamp(1 - s * 1.6, 0, 1))
        fa.style.transform = `translateY(${(-8 * s).toFixed(2)}px)`
        fb.style.opacity = String(clamp(s * 1.6 - 0.6, 0, 1))
        fb.style.transform = `translateY(${(8 * (1 - s)).toFixed(2)}px)`
      },
      () => {
        setOutId(null)
        purge((m) => isSheet(m) && m.id !== shown.current)
      },
    )
    // Стили снимаются в том же коммите, что убирает старый слой: сними их раньше, он
    // проступил бы целиком на кадр до того, как React его уберёт.
    return () => {
      stop()
      box.style.height = ''
      box.style.overflow = ''
      for (const el of [fa, fb]) {
        el.style.opacity = ''
        el.style.transform = ''
      }
      if (headB) headB.style.visibility = ''
    }
  }, [outId, shownId])

  // Клавиатура: на Android окно Telegram ужимается само, и лист у нижнего края уезжает
  // вместе с ним, а на iOS ужимается только видимая область, и лист остался бы под
  // клавиатурой. Разницу видно по visualViewport: перекрытие это то, что лежит между
  // низом видимой области и низом окна, и на Android оно нулевое.
  useEffect(() => {
    const lift = liftRef.current
    if (!lift) return
    const vv = window.visualViewport
    const sync = (): void => {
      const cover = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
      lift.style.setProperty('--modal-vh', `${vv ? vv.height : window.innerHeight}px`)
      lift.style.transform = cover > 1 ? `translateY(${(-cover).toFixed(1)}px)` : ''
    }
    sync()
    vv?.addEventListener('resize', sync)
    vv?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    return () => {
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  // Колесо мыши над затемнением прокручивало бы уменьшенный экран под листом.
  useEffect(() => {
    const dim = dimRef.current
    if (!dim) return
    const stop = (e: WheelEvent): void => e.preventDefault()
    dim.addEventListener('wheel', stop, { passive: false })
    return () => dim.removeEventListener('wheel', stop)
  }, [])

  const tapDim = (): void => {
    const t = topOf(modals)
    // Сообщение без отмены (showAlert) тапом мимо не закрывается, как и раньше.
    if (t && !(t.kind === 'confirm' && t.cancelLabel === null)) settle(t.id, cancelValue(t.kind))
  }

  const layers = list.filter(isSheet).filter((m) => !m.settled || m.id === shownId || m.id === outId)
  return (
    <>
      <div className="modal-back" />
      <div className="modal-overlay" ref={dimRef} onClick={tapDim} />
      <div className="modal-lift" ref={liftRef}>
        <div className="modal-sheet" ref={sheetRef} role="dialog" aria-modal="true">
          <div className="ob-grabber" />
          <div className="modal-scroll">
            <div className="modal-swap" ref={swapRef}>
              {layers.map((m) => (
                <Layer key={m.id} modal={m} state={m.id === shownId ? 'on' : m.id === outId ? 'out' : 'parked'} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Картинка на весь экран. Тап по любому месту закрывает: это просмотрщик, а не диалог,
 * и целиться в крестик на телефоне незачем — он тут только как подсказка, что выход есть.
 */
function ImageCard({ modal }: { modal: Modal & { kind: 'image' } }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  // Затухание доигрывает, и только потом узел убирается.
  useEffect(() => {
    if (!modal.settled) return
    const timer = window.setTimeout(() => purge((m) => m.id === modal.id), 180)
    return () => window.clearTimeout(timer)
  }, [modal.settled])

  const close = (): void => settle(modal.id, true)
  return (
    <div className={'lightbox' + (shown && !modal.settled ? ' shown' : '')} onClick={close}>
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
      {list.some(isSheet) ? <ModalSheet list={list} /> : null}
      {list.map((m) => (m.kind === 'image' ? <ImageCard key={m.id} modal={m} /> : null))}
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
  opts?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean; subject?: SheetSubject },
): Promise<boolean> =>
  open<boolean>({
    kind: 'confirm',
    text: message,
    confirmLabel: opts?.confirmLabel ?? 'Да',
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    destructive: opts?.destructive ?? false,
    subject: opts?.subject,
  })

/** Выбор действия: возвращает `key` выбранного варианта, null — отменили. Пустой `message` — без вопроса. */
export const choiceDialog = (
  message: string,
  options: { key: string; label: string; destructive?: boolean }[],
  opts?: { cancelLabel?: string; subject?: SheetSubject },
): Promise<string | null> =>
  open<string | null>({
    kind: 'choice',
    text: message,
    options,
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    subject: opts?.subject,
  })

export const timePrompt = (opts: {
  text?: string
  initial?: string
  confirmLabel?: string
  subject?: SheetSubject
}): Promise<string | null> =>
  open<string | null>({
    kind: 'time',
    text: opts.text,
    initial: opts.initial,
    confirmLabel: opts.confirmLabel ?? 'Предложить',
    subject: opts.subject,
  })

/** Выбор дня + времени для переноса визита. null — отмена. */
export const reschedulePrompt = (opts: {
  text?: string
  initialDay: string
  initialTime: string
  confirmLabel?: string
  subject?: SheetSubject
}): Promise<{ dateKey: string; time: string } | null> =>
  open<{ dateKey: string; time: string } | null>({
    kind: 'reschedule',
    text: opts.text,
    initialDay: opts.initialDay,
    initialTime: opts.initialTime,
    confirmLabel: opts.confirmLabel ?? 'Предложить',
    subject: opts.subject,
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
  wheel?: { unit: (n: number) => string }
  confirmLabel?: string
  subject?: SheetSubject
}): Promise<number | null> =>
  open<number | null>({
    kind: 'number',
    text: opts.text,
    initial: opts.initial,
    hint: opts.hint,
    min: opts.min ?? 0,
    max: opts.max ?? 1_000_000,
    wheel: opts.wheel,
    confirmLabel: opts.confirmLabel ?? 'Сохранить',
    subject: opts.subject,
  })

/** Ввод строки. null — отмена; пустая строка — осознанный ответ «без текста». */
export const textPrompt = (opts: {
  text: string
  initial?: string
  placeholder?: string
  hint?: string
  maxLength?: number
  confirmLabel?: string
  cancelLabel?: string
  multiline?: boolean
  destructive?: boolean
  subject?: SheetSubject
}): Promise<string | null> =>
  open<string | null>({
    kind: 'text',
    text: opts.text,
    initial: opts.initial ?? '',
    placeholder: opts.placeholder,
    hint: opts.hint,
    maxLength: opts.maxLength ?? 200,
    confirmLabel: opts.confirmLabel ?? 'Сохранить',
    cancelLabel: opts.cancelLabel ?? 'Отмена',
    multiline: opts.multiline ?? false,
    destructive: opts.destructive ?? false,
    subject: opts.subject,
  })

/** Выбор даты ('YYYY-MM-DD'). null — отмена. */
export const datePrompt = (opts: {
  text: string
  initial: string
  max?: string
  confirmLabel?: string
  subject?: SheetSubject
}): Promise<string | null> =>
  open<string | null>({
    kind: 'date',
    text: opts.text,
    initial: opts.initial,
    max: opts.max,
    confirmLabel: opts.confirmLabel ?? 'Поставить',
    subject: opts.subject,
  })
