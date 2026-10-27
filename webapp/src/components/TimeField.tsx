// Поле времени вместо <input type="time">. Нативный инпут рисует am/pm, когда
// локаль браузера/системы английская, а формат ему не задать ничем: он берётся
// из локали, а не из lang/атрибутов. Спейс живёт в 24-часовом времени, поэтому
// пикер свой: тап по «таблетке» открывает шторку с колесом часов и минут — то
// же движение, что у системного пикера iOS, но подписи наши и всегда 00–23.
// В форме заявки гостя то же колесо раскрывается прямо в карточке (TimeRow).

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clamp, landing, project, spring, tracker, type SpringOpts } from '../motion'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'
import { Flip } from './Flip'
import { useSheetDrag } from './useSheetDrag'

/** Высота строки колеса; должна совпадать с --tp-item-h в app.css. */
const ITEM_H = 40
/** Пауза без событий скролла = жест закончился (аналога scrollend в Safari нет). */
const SETTLE_MS = 90
/**
 * Барабан: соседние строки стоят на цилиндре через DRUM_STEP градусов, а радиус такой,
 * что грани высотой в строку смыкаются. Дальше DRUM_REACH строк от полосы грань почти
 * ребром к глазу, её не рисуем.
 */
const DRUM_STEP = 20
const DRUM_R = ITEM_H / 2 / Math.tan(((DRUM_STEP / 2) * Math.PI) / 180)
const DRUM_REACH = 4.4
const DRUM_IN = `translateZ(${(-DRUM_R).toFixed(2)}px) rotateX(`
const DRUM_OUT = `deg) translateZ(${DRUM_R.toFixed(2)}px)`

/** Доводка колеса после протяжки мышью: без перелёта, как у пальца. */
const GLIDE: SpringOpts = { response: 0.34, damping: 1 }

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

const split = (value: string): [string, string] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  return m ? [m[1]!.padStart(2, '0'), m[2]!] : ['15', '00']
}

/** `HH:MM` сравниваются строкой: время раньше границы встаёт на неё. */
const clampMin = (value: string, min: string | undefined): string => (min && value < min ? min : value)

function Wheel({
  values,
  index,
  minIndex,
  label,
  onLive,
  onSettle,
  onScrub,
}: {
  values: string[]
  /** Строка, на которой колесо стоит по данным; правка снаружи доезжает плавно. */
  index: number
  /** Всё выше по списку недоступно (прошедший час/минута сегодня). */
  minIndex: number
  label: string
  /** Под полосой сменилась строка, а палец ещё крутит. */
  onLive: (index: number) => void
  /** Жест кончился: колесо встало, недоступное уже откатывается. */
  onSettle: (index: number) => void
  /** Дробная позиция колеса на каждом кадре прокрутки: за ней идёт то, что меняется без шагов. */
  onScrub?: (pos: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drumRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  const live = useRef(index)
  const target = useRef(index)
  // Колесо крутит палец: правка снаружи ждёт конца жеста, иначе дёрнула бы его назад.
  const busy = useRef(false)
  // Прокрутку начал код (откат, подтяжка минут, правка снаружи): она не тикает и не
  // шлёт время наверх, его уже знают.
  const auto = useRef(false)
  // Строки барабана, показанные прошлым кадром: из них прячутся ушедшие за край.
  const lit = useRef<[number, number]>([0, -1])
  const cb = useRef({ onLive, onSettle, onScrub, minIndex })
  cb.current = { onLive, onSettle, onScrub, minIndex }
  const [active, setActive] = useState(index)
  // Мышью колесо тянут, как пальцем: колёсико мыши крутит его само, а с зажатой кнопкой
  // список не прокручивается вовсе.
  const drag = useRef<{ id: number; y0: number; top0: number; moved: boolean } | null>(null)
  const glide = useRef<{ stop: () => void } | null>(null)
  const dragged = useRef(false)
  const [vt] = useState(tracker)

  // Строки встают на цилиндр по scrollTop на каждом кадре прокрутки, правками style:
  // перерисовка через состояние React отставала бы от пальца.
  const paint = (): void => {
    const el = ref.current
    const drum = drumRef.current
    if (!el || !drum) return
    const s = el.scrollTop / ITEM_H
    const rows = drum.children
    const lo = Math.max(0, Math.ceil(s - DRUM_REACH))
    const hi = Math.min(rows.length - 1, Math.floor(s + DRUM_REACH))
    const [plo, phi] = lit.current
    for (let i = plo; i <= phi; i++) {
      const row = rows[i] as HTMLElement | undefined
      if (!row || (i >= lo && i <= hi)) continue
      row.style.display = ''
      row.style.transform = ''
      row.style.opacity = ''
    }
    for (let i = lo; i <= hi; i++) {
      const row = rows[i] as HTMLElement
      const a = (s - i) * DRUM_STEP
      row.style.display = 'block'
      row.style.transform = DRUM_IN + a.toFixed(2) + DRUM_OUT
      row.style.opacity = Math.pow(Math.cos((a * Math.PI) / 180), 1.4).toFixed(3)
    }
    lit.current = [lo, hi]
    cb.current.onScrub?.(clamp(s, 0, values.length - 1))
  }

  // Позиция колеса — это scrollTop, а не разметка: держим её в согласии с index
  // (первый кадр — без анимации, дальше внешние правки доезжают плавно).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if ((index !== target.current || !mounted.current) && !busy.current) {
      target.current = index
      if (Math.round(el.scrollTop / ITEM_H) !== index) {
        auto.current = true
        el.scrollTo({ top: index * ITEM_H, behavior: mounted.current ? 'smooth' : 'auto' })
      }
    }
    paint()
  }, [index])

  useEffect(() => {
    mounted.current = true
    return () => {
      window.clearTimeout(timer.current)
      glide.current?.stop()
    }
  }, [])

  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    paint()
    const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
    if (i !== live.current) {
      live.current = i
      setActive(i)
      if (!auto.current) {
        haptic.tick()
        cb.current.onLive(i)
      }
    }
    if (!auto.current) busy.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // Мышь ещё держит колесо: пауза в протяжке — не конец жеста.
      if (drag.current) return
      busy.current = false
      const byCode = auto.current
      auto.current = false
      if (byCode && i === target.current) return
      // Заехали в недоступную часть списка — откатываем к первому разрешённому.
      const j = Math.max(i, cb.current.minIndex)
      target.current = j
      if (j !== i) {
        auto.current = true
        el.scrollTo({ top: j * ITEM_H, behavior: 'smooth' })
      }
      cb.current.onSettle(j)
    }, SETTLE_MS)
  }

  // Палец перехватил колесо, пока его докатывал код: дальше это снова жест.
  const takeOver = (): void => {
    auto.current = false
  }

  // Прилипание к строкам на время протяжки снято: Chrome доводит до строки и
  // программную прокрутку, и колесо прыгало бы под курсором. Отпустили, и колесо
  // доезжает до строки с той скоростью, с какой его бросили.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    takeOver()
    dragged.current = false
    const el = ref.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return
    e.preventDefault()
    glide.current?.stop()
    glide.current = null
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* указатель уже отпущен */
    }
    el.style.scrollSnapType = 'none'
    drag.current = { id: e.pointerId, y0: e.clientY, top0: el.scrollTop, moved: false }
    vt.start(e.clientY, e.timeStamp)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const el = ref.current
    if (!d || !el || e.pointerId !== d.id) return
    const dy = e.clientY - d.y0
    if (Math.abs(dy) > 3) d.moved = true
    vt.move(e.clientY, e.timeStamp)
    el.scrollTop = d.top0 - dy
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const el = ref.current
    if (!d || !el || e.pointerId !== d.id) return
    drag.current = null
    dragged.current = d.moved
    const v = -vt.release(e.timeStamp)
    const from = el.scrollTop
    const to = clamp(Math.round((from + project(v, 0.995)) / ITEM_H), 0, values.length - 1) * ITEM_H
    glide.current = spring(
      from,
      to,
      landing(from - to, v, GLIDE),
      GLIDE,
      (y) => {
        el.scrollTop = y
      },
      () => {
        glide.current = null
        el.style.scrollSnapType = ''
        // Колесо встало: дальше как после жеста пальцем — откат с прошедшего и время наверх.
        onScroll()
      },
    )
  }

  // Тап по строке подкатывает её к полосе. Какую строку задели, решает барабан: на
  // цилиндре она стоит не там, где её место в прокручиваемом списке.
  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const el = ref.current
    const drum = drumRef.current
    // Кнопку отпустили после протяжки: это не тап по строке.
    if (dragged.current) {
      dragged.current = false
      return
    }
    if (!el || !drum) return
    const [lo, hi] = lit.current
    let best = -1
    let gap = Infinity
    for (let i = lo; i <= hi; i++) {
      const r = (drum.children[i] as HTMLElement).getBoundingClientRect()
      const g = Math.abs((r.top + r.bottom) / 2 - e.clientY)
      if (g < gap) {
        gap = g
        best = i
      }
    }
    if (best < 0) return
    auto.current = false
    target.current = best
    el.scrollTo({ top: best * ITEM_H, behavior: 'smooth' })
  }

  return (
    <div className="tp-col">
      <div
        className="tp-wheel"
        ref={ref}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={takeOver}
        onClick={onClick}
        role="listbox"
        aria-label={label}
      >
        {values.map((v, i) => (
          <div key={v} role="option" aria-selected={i === active} className="tp-slot">
            {v}
          </div>
        ))}
      </div>
      <div className="tp-drum" ref={drumRef} aria-hidden="true">
        {values.map((v, i) => (
          <div key={v} className={'tp-item' + (i === active ? ' active' : '') + (i < minIndex ? ' disabled' : '')}>
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Колесо числа (вместимость дня) тем же барабаном, что время. Число уходит наверх на
 * каждой смене строки, и подпись единиц справа склоняется вместе с ним.
 */
export function NumberWheel({
  value,
  min,
  max,
  unit,
  onChange,
  onScrub,
}: {
  value: number
  min: number
  max: number
  unit: (n: number) => string
  onChange: (n: number) => void
  /** Дробное число под полосой на каждом кадре прокрутки. */
  onScrub?: (value: number) => void
}) {
  const values = useMemo(() => Array.from({ length: max - min + 1 }, (_, i) => String(min + i)), [min, max])
  const [n, setN] = useState(() => clamp(Math.round(value), min, max))
  const pick = (i: number): void => {
    setN(min + i)
    onChange(min + i)
  }
  return (
    <div className="tp-wheels tp-number">
      <div className="tp-band" />
      <Wheel
        values={values}
        index={n - min}
        minIndex={0}
        label="Число"
        onLive={pick}
        onSettle={pick}
        onScrub={onScrub ? (pos) => onScrub(min + pos) : undefined}
      />
      <span className="tp-unit">{unit(n)}</span>
    </div>
  )
}

/**
 * Колёса часов и минут. Время уходит наверх на каждой смене строки, ещё до отпускания:
 * форма заявки показывает его сразу. И никогда не раньше min: прошедшее сегодня колесо
 * проезжает, но время за ним не тянется, а после жеста колесо откатывается.
 */
function TimeWheels({
  value,
  min,
  onChange,
}: {
  value: string
  min: string | undefined
  onChange: (value: string) => void
}) {
  const [hm, setHm] = useState(() => split(clampMin(value, min)))
  const [hour, minute] = hm
  // Что сейчас под полосой, включая недокрученный жест.
  const under = useRef(hm)
  const sent = useRef(value)
  const [minHour, minMinute] = min ? split(min) : [null, null]

  const emit = (h: string, m: string): void => {
    under.current = [h, m]
    const next = clampMin(h + ':' + m, min)
    if (next === sent.current) return
    sent.current = next
    onChange(next)
  }

  // Время сменили снаружи (в форме выбрали другой день) или оно ушло в прошлое: колёса
  // доезжают до него сами.
  useEffect(() => {
    const next = clampMin(value, min)
    if (value === sent.current && next === value) return
    sent.current = value
    const pair = split(next)
    setHm(pair)
    emit(pair[0], pair[1])
  }, [value, min])

  const settleHour = (h: string): void => {
    // Приехали на граничный час — минуты могли остаться в прошлом.
    const m = h === minHour && minMinute !== null && under.current[1] < minMinute ? minMinute : under.current[1]
    setHm([h, m])
    emit(h, m)
  }
  const settleMinute = (m: string): void => {
    setHm(([h]) => [h, m])
    emit(under.current[0], m)
  }

  return (
    <div className="tp-wheels">
      <div className="tp-band" />
      <Wheel
        values={HOURS}
        index={Math.max(0, HOURS.indexOf(hour))}
        minIndex={minHour !== null ? HOURS.indexOf(minHour) : 0}
        label="Часы"
        onLive={(i) => emit(HOURS[i]!, under.current[1])}
        onSettle={(i) => settleHour(HOURS[i]!)}
      />
      <span className="tp-colon">:</span>
      <Wheel
        values={MINUTES}
        index={Math.max(0, MINUTES.indexOf(minute))}
        minIndex={minHour !== null && hour === minHour && minMinute !== null ? MINUTES.indexOf(minMinute) : 0}
        label="Минуты"
        onLive={(i) => emit(under.current[0], MINUTES[i]!)}
        onSettle={(i) => settleMinute(MINUTES[i]!)}
      />
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
  const [draft, setDraft] = useState(() => clampMin(initial, min))

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
          <button className="tp-bar-btn primary" onClick={() => close(draft)}>
            Готово
          </button>
        </div>
        <TimeWheels value={draft} min={min} onChange={setDraft} />
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

/** Раскрытие и сворачивание без перелёта: колесо встаёт, а не подпрыгивает. */
const UNFOLD: SpringOpts = { response: 0.4, damping: 1 }
const FOLD: SpringOpts = { response: 0.34, damping: 1 }
/** Зазор между раскрытым колесом и нижней панелью экрана. */
const REVEAL_GAP = 8
/** Ближе к верху окна страница строку со временем не утаскивает. */
const REVEAL_KEEP = 96

/**
 * Колесо раскрылось бы под нижнюю панель экрана: страница едет вверх вместе с ростом,
 * так что низ колеса упирается в панель. Плавная прокрутка одним вызовом сюда не
 * годится: её цель браузер ограничивает высотой страницы на старте, а страница ещё
 * растёт.
 */
function revealer(el: HTMLElement): (height: number) => void {
  const bar = document.querySelector('.bottom-bar')
  const limit = (bar ? bar.getBoundingClientRect().top : window.innerHeight) - REVEAL_GAP
  const top = el.getBoundingClientRect().top
  const y0 = window.scrollY
  return (height) => {
    const over = Math.min(top + height - limit, top - REVEAL_KEEP)
    if (over > 0) window.scrollTo(0, y0 + over)
  }
}

/**
 * Рост по высоте, как у Collapse, но на пружине: встречный тап подхватывает движение
 * с той же высоты и скорости, а не начинает заново. Свёрнутое размонтируется.
 */
function Unfold({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  const ref = useRef<HTMLDivElement>(null)
  const run = useRef<{ stop: () => void; velocity: () => number } | null>(null)
  const height = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const moving = run.current
    run.current = null
    moving?.stop()
    const full = el.scrollHeight
    const from = moving ? height.current : open ? 0 : full
    const reveal = open ? revealer(el) : null
    const set = (h: number): void => {
      height.current = h
      el.style.height = `${Math.max(0, h).toFixed(2)}px`
      reveal?.(h)
    }
    set(from)
    run.current = spring(from, open ? full : 0, moving ? moving.velocity() : 0, open ? UNFOLD : FOLD, set, () => {
      run.current = null
      if (open) el.style.height = ''
      else setShown(false)
    })
  }, [open, shown])

  useEffect(() => () => run.current?.stop(), [])

  if (!shown) return null
  return (
    <div className="tp-unfold" ref={ref}>
      {children}
    </div>
  )
}

/**
 * Строка времени в форме заявки гостя: тап по времени раскрывает колесо прямо в
 * карточке, повторный сворачивает. Время уходит в форму на каждой смене строки, так что
 * значение в строке и подпись напоминания меняются, пока колесо крутится. Шторка с
 * «Готово» здесь лишняя: у формы своя кнопка отправки. В узких местах (строка «Ко
 * скольки?» на экране дня, модалка переноса) колесо остаётся шторкой, это TimeField.
 * Время, которое поставила смена дня, перещёлкивается; под пальцем на колесе нет.
 */
export function TimeRow({
  label,
  value,
  min,
  onChange,
}: {
  label: string
  value: string
  /** Нижняя граница `HH:MM` (слот «на сегодня» не должен быть в прошлом). */
  min?: string | undefined
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hour, minute] = split(value)

  return (
    <>
      <div className="row time-row">
        <span style={{ fontSize: 16 }}>{label}</span>
        <button
          type="button"
          className={'time-input time-field inline' + (open ? ' open' : '')}
          aria-label={'Время: ' + hour + ':' + minute}
          aria-expanded={open}
          onClick={() => {
            haptic.impact('light')
            setOpen(!open)
          }}
        >
          <Flip value={hour + ':' + minute} still={open} />
        </button>
      </div>
      <Unfold open={open}>
        <TimeWheels value={value} min={min} onChange={onChange} />
      </Unfold>
    </>
  )
}
