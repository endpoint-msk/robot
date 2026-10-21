// Свайп-действия строки в стиле iOS/macOS: тянешь строку влево — из-под неё
// выезжают кнопки. Заменяют инлайновые подписи «Перенести»/«Заблокировать»:
// в списке из десятка заявок ряд кнопок у каждого гостя перегружал строку.
//
// Жест приходит двумя разными путями, и оба обязательны:
//   • Pointer Events — палец на тач-экране и зажатая кнопка мыши;
//   • wheel с deltaX — двумя пальцами по трекпаду. Трекпад НЕ шлёт pointer-событий,
//     поэтому без этой ветки на макбуке строка не двигается вообще.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { project, rubber, spring, tracker, type SpringOpts } from '../motion'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'

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

  if (actions.length === 0) return <>{children}</>

  return (
    <div className="swipe-row">
      <div className={'swipe-actions' + (revealed ? ' revealed' : '') + (armed ? ' armed' : '')} ref={actionsRef}>
        {actions.map((a) => (
          <button
            key={a.key}
            className={
              'swipe-action' +
              (a.tone === 'red' ? ' danger' : a.tone === 'orange' ? ' warn' : a.tone === 'neutral' ? ' neutral' : '')
            }
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
        // Без этого жест мышью не живёт: строка содержит <img> аватарки, и перетаскивание
        // с неё запускает нативный drag-and-drop, который тут же шлёт pointercancel.
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </div>
  )
}
