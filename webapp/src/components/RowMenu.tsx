// Всплывающее меню под строкой («Новые заявки», тема, срок напоминания): тот же вид,
// что в шаге «Что присылать» знакомства.

import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react'
import { icons } from '../icons'
import { pushOverlay } from '../overlays'
import { haptic } from '../telegram'

/**
 * Всплывающее меню под строкой, как в шаге «Что присылать» знакомства. Закрывается
 * тапом мимо и системной «Назад».
 */
export function useRowMenu<K extends string>() {
  const [openFor, setOpenFor] = useState<K | null>(null)
  // Чья строка в меню. Закрытое меню ещё гаснет, и значения в нём должны остаться от неё:
  // по openFor отметка на миг перескочила бы на значение соседней строки.
  const [shownFor, setShownFor] = useState<K | null>(null)
  const [place, setPlace] = useState<{ top?: number; bottom?: number }>({})
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openFor) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element).closest('.ob-menu, .ob-popup')) setOpenFor(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    const un = pushOverlay(() => setOpenFor(null))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      un()
    }
  }, [openFor])
  const open = (key: K, btn: HTMLElement): void => {
    if (openFor === key) {
      setOpenFor(null)
      return
    }
    const host = hostRef.current?.getBoundingClientRect()
    const r = btn.getBoundingClientRect()
    // Строка у низа экрана: меню раскрывается вверх, иначе уехало бы за край.
    const up = window.innerHeight - r.bottom < 220
    setPlace(!host ? {} : up ? { bottom: host.bottom - r.top + 4 } : { top: r.bottom - host.top + 4 })
    setShownFor(key)
    setOpenFor(key)
  }
  /** Выбор отвечает щелчком и даёт меню мигнуть отметкой, прежде чем закрыться. */
  const close = (): void => {
    haptic.tick()
    setTimeout(() => setOpenFor(null), 140)
  }
  return { openFor, shownFor, place, hostRef, open, close }
}

export function MenuItems<V extends string>({
  open,
  place,
  items,
  value,
  onPick,
  gapBefore,
}: {
  open: boolean
  place: { top?: number; bottom?: number }
  items: { value: V; label: string; off?: boolean }[]
  value: V
  onPick: (v: V, e: MouseEvent<HTMLButtonElement>) => void
  gapBefore?: V
}) {
  return (
    <div className={'ob-menu' + (open ? ' open' : '') + (place.bottom !== undefined ? ' up' : '')} style={place} role="menu">
      {items.map((it) => (
        <Fragment key={it.value}>
          {it.value === gapBefore ? <div className="ob-menu-gap" /> : null}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === it.value}
            disabled={it.off}
            onClick={(e) => onPick(it.value, e)}
          >
            <span className="ob-mk">{icons.check(14, 'currentColor', 2.2)}</span>
            {it.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
