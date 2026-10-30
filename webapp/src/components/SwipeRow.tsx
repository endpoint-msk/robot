// Свайп-действия строки в стиле iOS/macOS: тянешь строку влево — из-под неё
// выезжают кнопки. Заменяют инлайновые подписи «Перенести»/«Заблокировать»:
// в списке из десятка заявок ряд кнопок у каждого гостя перегружал строку.
//
// Жест приходит двумя разными путями, и оба обязательны:
//   • Pointer Events — палец на тач-экране и зажатая кнопка мыши;
//   • wheel с deltaX — двумя пальцами по трекпаду. Трекпад НЕ шлёт pointer-событий,
//     поэтому без этой ветки на макбуке строка не двигается вообще.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { project, reducedMotion, rubber, spring, tracker, type SpringOpts } from '../motion'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'

/**
 * Значки действий свайпа. Части с классами sw-* играют, когда строку открыли (app.css,
 * .swipe-actions.revealed), как значки в списке чатов Telegram: черты и круги
 * дорисовываются, стрелки часов делают оборот. Свои, а не из icons.tsx: там галочку и
 * крестик рисуют штрихом в пикселях, а здесь длина пути - единица.
 */
export const swipeIcons = {
  note: (size = 21): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <rect className="sw-sheet" x="2.6" y="2.6" width="10.8" height="10.8" rx="3.2" fill="none" stroke="#fff" strokeWidth="1.5" />
      <path className="sw-draw sw-late" d="M5.5 6.5h5M5.5 9.4h3.2" pathLength={1} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  clock: (size = 21): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="7" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path className="sw-hands" d="M9 5v4.2l2.6 1.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  close: (size = 21): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path className="sw-draw" d="M5.5 5.5l9 9M14.5 5.5l-9 9" pathLength={1} stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  // Круг начинается слева сверху, оттуда же идёт черта.
  ban: (size = 21): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <circle className="sw-draw" cx="10" cy="10" r="7.2" transform="rotate(-135 10 10)" pathLength={1} fill="none" stroke="#fff" strokeWidth="1.7" />
      <path className="sw-draw sw-late" d="M5 5l10 10" pathLength={1} stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  tag: (size = 19): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <g className="sw-swing">
        <path d="M10.2 2.4H16a1.6 1.6 0 0 1 1.6 1.6v5.8a1.6 1.6 0 0 1-.5 1.1l-6 6a1.6 1.6 0 0 1-2.2 0l-5.4-5.4a1.6 1.6 0 0 1 0-2.2l6-6a1.6 1.6 0 0 1 1.1-.5z" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="13.4" cy="6.6" r="1.3" fill="#fff" />
      </g>
    </svg>
  ),
  undo: (size = 19): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path className="sw-draw" d="M4.5 9.5A5.8 5.8 0 1 1 10 16" pathLength={1} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path className="sw-draw sw-late" d="M4.4 5.4v4.3h4.3" pathLength={1} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (size = 18): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <path className="sw-draw" d="M2.5 7.5l3 3L11.5 4" pathLength={1} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

export type SwipeAction = {
  key: string
  /** Подпись действия: показывается, если нет иконки, и всегда идёт в aria-label. */
  label: string
  /** Иконка вместо подписи — три текстовые кнопки растягивали панель на всю строку. */
  icon?: ReactElement
  /** 'red' — деструктивное (блокировка), 'orange' — обратимое (закрыть заявку),
   *  'neutral' — нейтральное (заметка). По умолчанию синее. */
  tone?: 'blue' | 'red' | 'orange' | 'neutral'
  onSelect: () => void | Promise<void>
}

/**
 * Открытая строка всегда одна на весь экран (как в нативных списках): открывая
 * новую, закрываем предыдущую. Идентичность `close` стабильна между рендерами
 * (useCallback с пустыми зависимостями), поэтому сравнение по ссылке корректно.
 */
let closeOpened: (() => void) | null = null

/** Доля ширины действий, после которой строка защёлкивается открытой. */
const OPEN_THRESHOLD = 0.4
/** Смещение, после которого жест признаётся горизонтальным, а не скроллом. */
const DIRECTION_SLOP = 8
/**
 * Доводка пружиной со скоростью пальца, а не CSS-переходом постоянной длины: у перехода
 * скорость задаёт кривая, и брошенная строка на миг замирала. Открытие с лёгким
 * перелётом, закрытие без него.
 */
const OPEN_SPRING: SpringOpts = { response: 0.3, damping: 0.9 }
const CLOSE_SPRING: SpringOpts = { response: 0.3, damping: 1 }
/**
 * Пауза без событий колеса, после которой жест трекпада считается законченным.
 * У wheel нет аналога pointerup, а инерция macOS досылает события ещё долго после
 * того, как пальцы оторвались, — поэтому «конец жеста» определяется только тишиной.
 */
const WHEEL_IDLE_MS = 110

const TONE_CLASS = { red: ' danger', orange: ' warn', neutral: ' neutral', blue: '' } as const
/** Сколько тает меню правой кнопки: столько же длится ctx-out в app.css. */
const CTX_OUT_MS = 170

/**
 * Меню правой кнопки мыши (Telegram Desktop): те же действия, что под свайпом, у курсора,
 * как контекстное меню сообщения. Мышью строку никто не тянет, и без него действия на
 * компьютере почти не найти. Закрывается кликом мимо, прокруткой, Escape и «Назад».
 */
function RowContextMenu({
  x,
  y,
  actions,
  closing,
  onClose,
}: {
  x: number
  y: number
  actions: SwipeAction[]
  /** Меню тает (см. CTX_OUT_MS): уже не ловит клики и не держит «Назад». */
  closing: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null)
  // Выбранный пункт остаётся подсвеченным, пока меню тает: глаз видит, что нажато.
  const [picked, setPicked] = useState<string | null>(null)

  // У края окна меню открывается в другую сторону от курсора, как системное.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + w + 8 > window.innerWidth ? Math.max(8, x - w) : x
    const top = y + h + 8 > window.innerHeight ? Math.max(8, y - h) : y
    setPlace({ left, top, origin: `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}` })
  }, [x, y])

  // Фокус уходит в меню, когда оно уже видно (скрытое его не берёт): иначе он остаётся на
  // кнопке строки под курсором, и Escape, закрывая меню, зажигал бы на ней рамку фокуса.
  useEffect(() => {
    if (place) ref.current?.focus({ preventScroll: true })
  }, [place])

  useEffect(() => {
    if (closing) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    const un = pushOverlay(onClose)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      un()
    }
  }, [onClose, closing])

  return createPortal(
    <div
      className={'ctx-menu' + (place ? ' open' : '') + (closing ? ' closing' : '')}
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={place ? { left: place.left, top: place.top, transformOrigin: place.origin } : { left: x, top: y, visibility: 'hidden' }}
      // Меню живёт в дереве строки: без этого клик по пункту всплыл бы к её родителям.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((a, i) => (
        <button
          key={a.key}
          type="button"
          role="menuitem"
          className={'ctx-item' + TONE_CLASS[a.tone ?? 'blue'] + (picked === a.key ? ' picked' : '')}
          style={{ '--i': i } as CSSProperties}
          onClick={() => {
            setPicked(a.key)
            onClose()
            void a.onSelect()
          }}
        >
          <span className="ctx-ico" aria-hidden="true">
            {a.icon ?? null}
          </span>
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Строка за порогом открытия: иконки подрастают, палец узнаёт, что строка откроется,
  // раньше, чем его отпустили.
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  const settleRef = useRef<{ stop: () => void } | null>(null)
  const vt = useRef(tracker()).current
  // Панель действий скрыта, пока строку не тронули. Перекрывать её сдвинутым
  // контентом недостаточно: слой с transform композитится отдельно, и на дробном
  // device-pixel-ratio по правому краю проступала полоска красного.
  const [revealed, setRevealed] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  /** Снятие себя из реестра оверлеев: строка регистрируется, только пока открыта. */
  const dropOverlay = useRef<(() => void) | null>(null)
  // Живое значение смещения: в pointerup состояние из замыкания может отставать
  // на один кадр, а решение «открыть или закрыть» принимается именно там.
  const offsetRef = useRef(0)
  const dragRef = useRef<{ id: number; x: number; y: number; base: number; axis: 'none' | 'x' | 'y' } | null>(null)
  // Был ли жест перетаскиванием — чтобы гасить клик, который браузер шлёт после drag.
  const draggedRef = useRef(false)
  // Чем нажали последний раз: долгое нажатие пальцем на Android тоже шлёт contextmenu,
  // а меню по правой кнопке нужно только мыши.
  const pointerTypeRef = useRef('')
  // n меняется на каждое открытие: меню монтируется заново и снова вырастает из курсора.
  const [menu, setMenu] = useState<{ x: number; y: number; n: number } | null>(null)
  const [menuClosing, setMenuClosing] = useState(false)
  const menuTimer = useRef(0)
  const closeMenu = useCallback(() => {
    window.clearTimeout(menuTimer.current)
    if (reducedMotion()) {
      setMenu(null)
      return
    }
    setMenuClosing(true)
    menuTimer.current = window.setTimeout(() => {
      setMenu(null)
      setMenuClosing(false)
    }, CTX_OUT_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(menuTimer.current), [])

  const widthOf = (): number => actionsRef.current?.offsetWidth ?? 0

  /** Смещение с резинкой UIScrollView за пределом ширины действий: тянется всё туже и не бесконечно. */
  const clampOffset = (raw: number): number => {
    const w = widthOf()
    if (raw < 0) return 0
    return raw > w ? w + rubber(raw - w, w) : raw
  }

  const applyOffset = (value: number): void => {
    offsetRef.current = value
    setOffset(value)
  }

  /** Порог защёлкивания: открытую строку закрыть легче, чем закрытую открыть. */
  const threshold = (): number => widthOf() * (openRef.current ? 1 - OPEN_THRESHOLD : OPEN_THRESHOLD)

  /** Пересечение порога под пальцем: щелчок и подросшие иконки, как в «Почте» iOS. */
  const track = (value: number): void => {
    const over = value > threshold()
    if (over !== armedRef.current) {
      armedRef.current = over
      setArmed(over)
      haptic.tick()
    }
  }

  const stopSettle = (): void => {
    settleRef.current?.stop()
    settleRef.current = null
  }

  const close = useCallback((velocity = 0) => {
    stopSettle()
    openRef.current = false
    armedRef.current = false
    setArmed(false)
    setDragging(false)
    // Панель действий гаснет только когда строка доехала: пока она едет обратно,
    // действия должны оставаться видимыми, иначе контент возвращается по пустому месту.
    settleRef.current = spring(offsetRef.current, 0, velocity, CLOSE_SPRING, applyOffset, () => setRevealed(false))
    dropOverlay.current?.()
    dropOverlay.current = null
    if (closeOpened === close) closeOpened = null
  }, [])

  const open = useCallback(
    (velocity = 0) => {
      if (closeOpened && closeOpened !== close) closeOpened()
      closeOpened = close
      // Открытая строка — такой же оверлей, как модалка: системная «Назад» сначала
      // закрывает её, а уже потом уводит с экрана.
      dropOverlay.current?.()
      dropOverlay.current = pushOverlay(close)
      stopSettle()
      openRef.current = true
      armedRef.current = true
      setArmed(true)
      setDragging(false)
      setRevealed(true)
      settleRef.current = spring(offsetRef.current, widthOf(), velocity, OPEN_SPRING, applyOffset)
    },
    [close],
  )

  /**
   * Конец жеста: решает не место, где палец отпустили, а куда строка доехала бы по
   * инерции. Быстрый короткий флик открывает, как в нативных списках.
   */
  const settle = useCallback(
    (velocity = 0) => {
      if (offsetRef.current + project(velocity, 0.99) > threshold()) open(velocity)
      else close(velocity)
    },
    [open, close],
  )

  useEffect(() => () => {
    stopSettle()
    dropOverlay.current?.()
    dropOverlay.current = null
    if (closeOpened === close) closeOpened = null
  }, [close])

  // Трекпад. Слушаем нативно, а не через onWheel: React вешает wheel пассивно,
  // а без preventDefault macOS уводит горизонтальный жест в навигацию «назад».
  useEffect(() => {
    const el = contentRef.current
    if (!el || actions.length === 0) return
    let idle: ReturnType<typeof setTimeout> | undefined

    const onWheel = (e: WheelEvent): void => {
      // Вертикальный жест — обычный скролл страницы, не трогаем.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      // Строка закрыта, а жест ведёт вправо — открывать нечего, отдаём событие дальше.
      if (offsetRef.current <= 0 && e.deltaX <= 0) return
      e.preventDefault()
      stopSettle()
      setDragging(true)
      setRevealed(true)
      const next = clampOffset(offsetRef.current + e.deltaX)
      applyOffset(next)
      track(next)
      clearTimeout(idle)
      // Тишина в событиях и есть отпускание: пальцы уже стоят, скорости нет.
      idle = setTimeout(() => settle(0), WHEEL_IDLE_MS)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(idle)
    }
  }, [actions.length, settle])

  // Палец наискось: при `touch-action: pan-y` браузер прокручивал бы страницу, пока
  // строка едет вбок. Ось решаем по touchmove и, если жест горизонтальный, гасим
  // прокрутку до конца жеста, как в листалке дней.
  useEffect(() => {
    const el = contentRef.current
    if (!el || actions.length === 0) return
    let t0: { x: number; y: number; axis: 0 | 1 | 2 } | null = null
    const onStart = (e: TouchEvent): void => {
      const t = e.touches[0]
      t0 = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, axis: 0 } : null
    }
    const onMove = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!t0 || !t) return
      if (t0.axis === 0) {
        const dx = Math.abs(t.clientX - t0.x)
        const dy = Math.abs(t.clientY - t0.y)
        if (dx < 6 && dy < 6) return
        t0.axis = dx > dy ? 1 : 2
      }
      if (t0.axis === 1 && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [actions.length])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    pointerTypeRef.current = e.pointerType
    if (e.button !== 0) return
    draggedRef.current = false
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: offsetRef.current, axis: 'none' }
    vt.start(-e.clientX, e.timeStamp)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    vt.move(-e.clientX, e.timeStamp)
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.axis === 'none') {
      if (Math.abs(dx) < DIRECTION_SLOP && Math.abs(dy) < DIRECTION_SLOP) return
      // Увели по вертикали — жест отдаём скроллу и в него больше не вмешиваемся.
      if (Math.abs(dy) >= Math.abs(dx)) {
        dragRef.current = null
        return
      }
      d.axis = 'x'
      draggedRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      // Строку поймали на лету: доводка останавливается, жест ведёт с того же места.
      stopSettle()
      d.base = offsetRef.current + dx
      setDragging(true)
      setRevealed(true)
    }
    const next = clampOffset(d.base - dx)
    applyOffset(next)
    track(next)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.id !== e.pointerId || d.axis !== 'x') return
    settle(vt.release(e.timeStamp))
  }

  // Тап по открытой строке закрывает её и не проходит внутрь (в профиль/ссылку).
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const dragged = draggedRef.current
    draggedRef.current = false
    // Клик, который браузер шлёт после перетаскивания мышью, гасим, но состояние
    // строки НЕ трогаем: его уже решил settle(). Chromium (Telegram Desktop на Windows)
    // шлёт этот клик даже при pointer capture — без этой ветки строка открывалась
    // жестом и тут же схлопывалась обратно. WebKit его не шлёт, поэтому на маке бага нет.
    if (dragged) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!openRef.current) return
    e.preventDefault()
    e.stopPropagation()
    close()
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (pointerTypeRef.current !== 'mouse') return
    e.preventDefault()
    if (openRef.current) close()
    window.clearTimeout(menuTimer.current)
    setMenuClosing(false)
    setMenu((m) => ({ x: e.clientX, y: e.clientY, n: (m?.n ?? 0) + 1 }))
  }

  if (actions.length === 0) return <>{children}</>

  return (
    <div className="swipe-row">
      <div className={'swipe-actions' + (revealed ? ' revealed' : '') + (armed ? ' armed' : '')} ref={actionsRef}>
        {actions.map((a) => (
          <button
            key={a.key}
            className={'swipe-action' + TONE_CLASS[a.tone ?? 'blue']}
            aria-label={a.label}
            title={a.label}
            onClick={() => {
              close()
              void a.onSelect()
            }}
          >
            {a.icon ?? a.label}
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        className={'swipe-content' + (dragging ? ' dragging' : '')}
        style={{ transform: `translate3d(${-offset}px, 0, 0)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onContextMenu={onContextMenu}
        // Без этого жест мышью не живёт: строка содержит <img> аватарки, и перетаскивание
        // с неё запускает нативный drag-and-drop, который тут же шлёт pointercancel.
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
      {menu ? (
        <RowContextMenu key={menu.n} x={menu.x} y={menu.y} actions={actions} closing={menuClosing} onClose={closeMenu} />
      ) : null}
    </div>
  )
}
