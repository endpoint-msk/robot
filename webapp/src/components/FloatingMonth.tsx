// Месяц над длинным списком, пока его листают, как дата в чате Telegram: плашка сверху
// говорит, чей месяц сейчас под ней, и гаснет через секунду после остановки. Месяцы - узлы
// с `data-month` на экране, плашка рисуется порталом рядом с нижней панелью: внутри .screen
// transform въезда сделал бы экран containing block для position: fixed.

import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from '../barContext'
import { reducedMotion } from '../motion'
import { UnderContext } from '../screenContext'

/** Плашка гаснет через столько после последнего события прокрутки, мс. */
const IDLE_MS = 1000
/** Касание без прокрутки за это время прокруткой уже не считается, мс. */
const INPUT_MS = 600
/** Высота плашки с подписью, как у `.float-month` в app.css, px. */
const PILL_H = 28
/** Перетекание месяца: длительность ухода прежнего, как у `.fm-label.out` в app.css. */
const SWAP_MS = 200

export function FloatingMonth() {
  const node = useContext(BarContext)
  const under = useContext(UnderContext)
  const [label, setLabel] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const pill = useRef<HTMLDivElement>(null)
  const shown = useRef(false)

  useEffect(() => {
    if (under) return
    // Только своя прокрутка: «назад» ставит прокрутку экрана кодом (App.tsx), и плашка от
    // этого вспыхивать не должна. Касание, колесо и клавиши открывают окно, прокрутка его
    // держит, тишина закрывает.
    let user = false
    let inputTimer = 0
    let idleTimer = 0
    let raf = 0
    const input = (): void => {
      user = true
      window.clearTimeout(inputTimer)
      inputTimer = window.setTimeout(() => {
        if (!idleTimer) user = false
      }, INPUT_MS)
    }
    const show = (on: boolean): void => {
      if (shown.current === on) return
      shown.current = on
      pill.current?.classList.toggle('shown', on)
    }
    // Месяц под плашкой - последний, чьё начало ушло выше неё. Пока начало первого месяца
    // видно, плашка не нужна: она повторяла бы его заголовок.
    const measure = (): void => {
      raf = 0
      // Низ плашки с подписью; пустая (до первого показа) ниже по высоте, поэтому от верха.
      const edge = (pill.current?.getBoundingClientRect().top ?? 10) + PILL_H + 4
      let current: HTMLElement | null = null
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.screen [data-month]'))) {
        if (el.closest('.screen-under')) continue
        if (el.getBoundingClientRect().top >= edge) break
        current = el
      }
      if (!current) {
        show(false)
        return
      }
      setLabel(current.dataset.month ?? null)
      show(true)
    }
    const scroll = (): void => {
      if (!user) return
      if (!raf) raf = requestAnimationFrame(measure)
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        idleTimer = 0
        user = false
        show(false)
      }, IDLE_MS)
    }
    const opts = { passive: true }
    window.addEventListener('touchstart', input, opts)
    window.addEventListener('touchmove', input, opts)
    window.addEventListener('wheel', input, opts)
    window.addEventListener('keydown', input)
    window.addEventListener('pointerdown', input, opts)
    window.addEventListener('scroll', scroll, opts)
    return () => {
      window.removeEventListener('touchstart', input)
      window.removeEventListener('touchmove', input)
      window.removeEventListener('wheel', input)
      window.removeEventListener('keydown', input)
      window.removeEventListener('pointerdown', input)
      window.removeEventListener('scroll', scroll)
      window.clearTimeout(inputTimer)
      window.clearTimeout(idleTimer)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [under])

  // Сменился месяц на видимой плашке: прежний тает на месте, новый проявляется, по эталону
  // «Захостить». Скрытая плашка меняет подпись без перехода.
  const drawn = useRef<string | null>(null)
  useEffect(() => {
    const was = drawn.current
    drawn.current = label
    if (!was || !label || was === label || !shown.current || reducedMotion()) return
    setLeaving(was)
    const t = window.setTimeout(() => setLeaving(null), SWAP_MS)
    return () => window.clearTimeout(t)
  }, [label])

  if (under || !node) return null
  return createPortal(
    <div className="float-month" ref={pill} aria-hidden="true">
      {leaving ? (
        <span className="fm-label out" key={'o' + leaving}>
          {leaving}
        </span>
      ) : null}
      <span className={'fm-label' + (leaving ? ' in' : '')} key={label ?? ''}>
        {label}
      </span>
    </div>,
    node,
  )
}
