// Шторку смахивают вниз, как в iOS: рука тянется туда первой, а закрыть её можно было
// только тапом по фону или кнопкой. Вертикальные свайпы Telegram выключены, так что
// жесту ничего не мешает.

import { useEffect, type RefObject } from 'react'
import { project, rubber, spring, tracker } from '../motion'

const BACK = { response: 0.3, damping: 1 }

/**
 * `handle`: за что тянуть. У колеса времени только за шапку (колёса крутятся сами),
 * у остальных за всю шторку, но лишь пока её содержимое прокручено к началу: иначе
 * жест вниз это прокрутка списка. `dismiss` закрывает шторку так же, как кнопка.
 */
export function useSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  dismiss: () => void,
  handle?: string,
): void {
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const vt = tracker()
    let drag: { id: number; x0: number; y0: number; on: boolean } | null = null
    let y = 0
    let settle: { stop: () => void } | null = null

    const set = (v: number): void => {
      y = v
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${v.toFixed(1)}px)`
      const o = overlayRef.current
      if (o) o.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(v, 0) / (sheet.offsetHeight || 1))))
    }
    const reset = (): void => {
      sheet.style.transition = ''
      sheet.style.transform = ''
      if (overlayRef.current) overlayRef.current.style.opacity = ''
    }

    const scrolledInside = (t: Element | null): boolean => {
      for (let el = t; el && el !== sheet; el = el.parentElement) if (el.scrollTop > 0) return true
      return false
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || drag) return
      const t = e.target as Element
      if (handle ? !t.closest(handle) : scrolledInside(t)) return
      if (t.closest('input, textarea')) return
      settle?.stop()
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY - y, on: false }
      vt.start(e.clientY, e.timeStamp)
    }
    const onMove = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
      vt.move(e.clientY, e.timeStamp)
      const dy = e.clientY - drag.y0
      if (!drag.on) {
        const dx = e.clientX - drag.x0
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return
        // Вбок или вверх с места это не смахивание: отдаём жест содержимому.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
          drag = null
          return
        }
        drag.on = true
        try {
          sheet.setPointerCapture(e.pointerId)
        } catch {
          /* указатель уже отпущен */
        }
      }
      set(dy >= 0 ? dy : -rubber(-dy, 120))
    }
    const onUp = (e: PointerEvent): void => {
      const d = drag
      if (!d || e.pointerId !== d.id) return
      drag = null
      if (!d.on) return
      const v = vt.release(e.timeStamp)
      const h = sheet.offsetHeight
      if (y + project(v, 0.99) > h / 2 || v > 1000) {
        settle = spring(y, h, Math.max(v, 0), BACK, set, dismiss, 1)
      } else {
        settle = spring(y, 0, v, BACK, set, reset, 0.5)
      }
    }
    // При `pan-y` у содержимого браузер начал бы прокрутку поверх жеста.
    const onTouchMove = (e: TouchEvent): void => {
      if (drag?.on && e.cancelable) e.preventDefault()
    }
    // Щелчок по кнопке шторки после смахивания не должен сработать.
    const onClick = (e: MouseEvent): void => {
      if (y !== 0) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    sheet.addEventListener('pointerdown', onDown)
    sheet.addEventListener('pointermove', onMove)
    sheet.addEventListener('pointerup', onUp)
    sheet.addEventListener('pointercancel', onUp)
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('click', onClick, true)
    return () => {
      settle?.stop()
      sheet.removeEventListener('pointerdown', onDown)
      sheet.removeEventListener('pointermove', onMove)
      sheet.removeEventListener('pointerup', onUp)
      sheet.removeEventListener('pointercancel', onUp)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('click', onClick, true)
    }
  }, [])
}
