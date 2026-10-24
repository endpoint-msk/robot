// Шторку смахивают вниз, как в iOS: рука тянется туда первой, а закрыть её можно было
// только тапом по фону или кнопкой. Вертикальные свайпы Telegram выключены, так что
// жесту ничего не мешает.

import { useEffect, useRef, type RefObject } from 'react'
import { clamp, project, rubber, spring, tracker, type SpringOpts } from '../motion'

const BACK = { response: 0.3, damping: 1 }
/** Подъём без перелёта: подпрыгнувший лист читался желе, а не ответом. */
const OPEN = { response: 0.4, damping: 1 }

/**
 * Шторка, которую двигает код: подъём и уход вниз идут той же пружиной, что и жест.
 * Положением владеет только хук: двигай шторку чужая пружина, палец, взявший её на
 * подъёме, начинал бы с нуля, а не с того места, где она сейчас.
 */
export type SheetControl = {
  /** Поднять из `from` (без него из текущего положения, с текущей скоростью). */
  open: (from?: number) => void
  /** Увести за нижний край и позвать `done`. */
  close: (done: () => void) => void
  /** Смещение вниз от открытого положения. */
  offset: () => number
}

/**
 * `handle`: за что тянуть. У колеса времени только за шапку (колёса крутятся сами),
 * у остальных за всю шторку, но лишь пока её содержимое прокручено к началу: иначе
 * жест вниз это прокрутка списка. `dismiss` закрывает шторку так же, как кнопка.
 * `onProgress` получает долю открытия (1 открыта, 0 за краем) на каждом кадре жеста и
 * пружин: за ней едет то, что лежит под шторкой.
 */
export function useSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  dismiss: () => void,
  handle?: string,
  opts?: { onProgress?: (p: number) => void },
): RefObject<SheetControl | null> {
  const control = useRef<SheetControl | null>(null)
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const onProgress = opts?.onProgress
    const vt = tracker()
    let drag: { id: number; x0: number; y0: number; on: boolean } | null = null
    let y = 0
    // Высота снимается на касании: замер после записи transform заставил бы браузер
    // пересчитывать стили на каждом кадре жеста и пружины.
    let h = 1
    let settle: { stop: () => void; velocity: () => number } | null = null
    // Пружина, которую остановило касание. Смахивания не вышло (тап по кнопке на подъёме,
    // жест вбок) - она доезжает туда же, куда ехала: иначе шторка так и стояла бы
    // сдвинутой, а её кнопки не нажимались.
    let resume: (() => void) | null = null
    // Последний жест стал смахиванием: щелчок, который браузер шлёт следом, не должен
    // сработать по кнопке под пальцем.
    let dragged = false

    const set = (v: number): void => {
      y = v
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${v.toFixed(1)}px)`
      const o = overlayRef.current
      if (o) {
        // Иначе каждая запись запускает CSS-переход заново, и затемнение отстаёт от пальца.
        o.style.transition = 'none'
        o.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(v, 0) / h)))
      }
      onProgress?.(clamp(1 - v / h, 0, 1))
    }
    const reset = (): void => {
      dragged = false
      sheet.style.transition = ''
      sheet.style.transform = ''
      if (overlayRef.current) {
        overlayRef.current.style.transition = ''
        overlayRef.current.style.opacity = ''
      }
      onProgress?.(1)
    }
    const run = (to: number, v: number, s: SpringOpts, done: () => void, eps: number): void => {
      resume = () => run(to, 0, s, done, eps)
      settle = spring(y, to, v, s, set, () => {
        settle = null
        resume = null
        done()
      }, eps)
    }
    const goOn = (): void => {
      const next = resume
      resume = null
      next?.()
    }

    control.current = {
      open: (from) => {
        const v0 = settle?.velocity() ?? 0
        settle?.stop()
        drag = null
        dragged = false
        h = sheet.offsetHeight || 1
        if (from !== undefined) set(from)
        run(0, from === undefined ? v0 : 0, OPEN, reset, 0.5)
      },
      close: (done) => {
        const v0 = settle?.velocity() ?? 0
        settle?.stop()
        drag = null
        h = sheet.offsetHeight || 1
        run(h, Math.max(v0, 0), BACK, done, 1)
      },
      offset: () => y,
    }

    const scrolledInside = (t: Element | null): boolean => {
      for (let el = t; el && el !== sheet; el = el.parentElement) if (el.scrollTop > 0) return true
      return false
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button > 0 || drag) return
      dragged = false
      const t = e.target as Element
      if (handle ? !t.closest(handle) : scrolledInside(t)) return
      if (t.closest('input, textarea')) return
      settle?.stop()
      h = sheet.offsetHeight || 1
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
          goOn()
          return
        }
        drag.on = true
        dragged = true
        resume = null
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
      if (!d.on) {
        goOn()
        return
      }
      const v = vt.release(e.timeStamp)
      if (y + project(v, 0.99) > h / 2 || v > 1000) {
        run(h, Math.max(v, 0), BACK, dismiss, 1)
      } else {
        run(0, v, BACK, reset, 0.5)
      }
    }
    // При `pan-y` у содержимого браузер начал бы прокрутку поверх жеста.
    const onTouchMove = (e: TouchEvent): void => {
      if (drag?.on && e.cancelable) e.preventDefault()
    }
    // Щелчок по кнопке шторки после смахивания не должен сработать.
    const onClick = (e: MouseEvent): void => {
      if (dragged) {
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
      control.current = null
      sheet.removeEventListener('pointerdown', onDown)
      sheet.removeEventListener('pointermove', onMove)
      sheet.removeEventListener('pointerup', onUp)
      sheet.removeEventListener('pointercancel', onUp)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('click', onClick, true)
    }
  }, [])
  return control
}
