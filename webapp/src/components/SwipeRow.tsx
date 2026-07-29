// Свайп-действия строки в стиле iOS/macOS: тянешь строку влево — из-под неё
// выезжают кнопки. Заменяют инлайновые подписи «Перенести»/«Заблокировать»:
// в списке из десятка заявок ряд кнопок у каждого гостя перегружал строку.
//
// Жест приходит двумя разными путями, и оба обязательны:
//   • Pointer Events — палец на тач-экране и зажатая кнопка мыши;
//   • wheel с deltaX — двумя пальцами по трекпаду. Трекпад НЕ шлёт pointer-событий,
//     поэтому без этой ветки на макбуке строка не двигается вообще.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'

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
/** Сопротивление за пределом полной ширины действий («резинка»). */
const RUBBER = 0.3
/**
 * Пауза без событий колеса, после которой жест трекпада считается законченным.
 * У wheel нет аналога pointerup, а инерция macOS досылает события ещё долго после
 * того, как пальцы оторвались, — поэтому «конец жеста» определяется только тишиной.
 */
const WHEEL_IDLE_MS = 110

export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const [offset, setOffset] = useState(0)
  const [animate, setAnimate] = useState(true)
  const [dragging, setDragging] = useState(false)
  // Панель действий скрыта, пока строку не тронули. Перекрывать её сдвинутым
  // контентом недостаточно: слой с transform композитится отдельно, и на дробном
  // device-pixel-ratio по правому краю проступала полоска красного.
  const [revealed, setRevealed] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  // Живое значение смещения: в pointerup состояние из замыкания может отставать
  // на один кадр, а решение «открыть или закрыть» принимается именно там.
  const offsetRef = useRef(0)
  const dragRef = useRef<{ id: number; x: number; y: number; base: number; axis: 'none' | 'x' | 'y' } | null>(null)
  // Был ли жест перетаскиванием — чтобы гасить клик, который браузер шлёт после drag.
  const draggedRef = useRef(false)

  const widthOf = (): number => actionsRef.current?.offsetWidth ?? 0

  /** Смещение с «резинкой» за пределом ширины действий. */
  const clampOffset = (raw: number): number => {
    const w = widthOf()
    if (raw < 0) return 0
    return raw > w ? w + (raw - w) * RUBBER : raw
  }

  const applyOffset = (value: number): void => {
    offsetRef.current = value
    setOffset(value)
  }

  const close = useCallback(() => {
    // Панель гасим не здесь, а в onTransitionEnd: пока строка едет обратно, действия
    // должны оставаться видимыми, иначе контент возвращается по пустому месту.
    // Если ехать нечему (уже закрыто) — transitionend не придёт, гасим сразу.
    const wasClosed = offsetRef.current === 0
    openRef.current = false
    offsetRef.current = 0
    setAnimate(true)
    setDragging(false)
    setOffset(0)
    if (wasClosed) setRevealed(false)
    if (closeOpened === close) closeOpened = null
  }, [])

  const open = useCallback(() => {
    if (closeOpened && closeOpened !== close) closeOpened()
    closeOpened = close
    openRef.current = true
    const w = actionsRef.current?.offsetWidth ?? 0
    offsetRef.current = w
    setAnimate(true)
    setDragging(false)
    setRevealed(true)
    setOffset(w)
  }, [close])

  /** Конец жеста: защёлкиваем в ближайшее состояние. */
  const settle = useCallback(() => {
    // Открытую строку закрыть легче, чем закрытую открыть: порог считаем от того,
    // в каком состоянии жест начался.
    const need = (actionsRef.current?.offsetWidth ?? 0) * (openRef.current ? 1 - OPEN_THRESHOLD : OPEN_THRESHOLD)
    if (offsetRef.current > need) open()
    else close()
  }, [open, close])

  useEffect(() => () => {
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
      setAnimate(false)
      setDragging(true)
      setRevealed(true)
      applyOffset(clampOffset(offsetRef.current + e.deltaX))
      clearTimeout(idle)
      idle = setTimeout(settle, WHEEL_IDLE_MS)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(idle)
    }
  }, [actions.length, settle])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    draggedRef.current = false
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: offsetRef.current, axis: 'none' }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
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
      setAnimate(false)
      setDragging(true)
      setRevealed(true)
    }
    applyOffset(clampOffset(d.base - dx))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.id !== e.pointerId || d.axis !== 'x') return
    settle()
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
      <div className={'swipe-actions' + (revealed ? ' revealed' : '')} ref={actionsRef}>
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
        className={'swipe-content' + (animate ? ' animate' : '') + (dragging ? ' dragging' : '')}
        style={{ transform: `translate3d(${-offset}px, 0, 0)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        // Без этого жест мышью не живёт: строка содержит <img> аватарки, и перетаскивание
        // с неё запускает нативный drag-and-drop, который тут же шлёт pointercancel.
        onDragStart={(e) => e.preventDefault()}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'transform' && e.currentTarget === e.target && offsetRef.current === 0) {
            setRevealed(false)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
