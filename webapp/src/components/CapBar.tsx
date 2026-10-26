// Заполненность дня одной полосой, как память в настройках iOS: куски по видам с зазором в
// цвет подложки. Мест по одному в ней нет: при 18 местах они рябили пунктиром, а потолок
// сервера двести. Длина полосы - большее из вместимости и всех людей дня, поэтому сверх
// вместимости полоса не растёт за край, а краснеет.

import type { Ref } from 'react'

type Part = 'on' | 'over' | 'wait' | 'wover' | 'free' | 'add'

const PARTS: Part[] = ['on', 'over', 'wait', 'wover', 'free', 'add']

/**
 * Куски полосы: занятые в пределах вместимости и сверх неё, заявки без хоста в пределах и
 * сверх, свободное и `add` - гость, которого добавляют сейчас («Всё равно»). `cap` бывает
 * дробным: так полоса идёт за колесом без шагов.
 */
const partsOf = (occupied: number, pending: number, cap: number, add: number): Record<Part, number> => {
  const on = Math.min(occupied, cap)
  const wait = Math.max(0, Math.min(pending, cap - occupied))
  return { on, over: occupied - on, wait, wover: pending - wait, free: Math.max(0, cap - occupied - pending), add }
}

/** Кусок в пару сотых места не рисуется: от него на экране остался бы один зазор. */
const MIN_PART = 0.02

export function CapBar({
  occupied,
  pending,
  cap,
  add = 0,
  className,
  ref,
}: {
  occupied: number
  pending: number
  cap: number
  add?: number
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  const parts = partsOf(occupied, pending, cap, add)
  return (
    <div ref={ref} className={'cap-bar' + (className ? ' ' + className : '')} aria-hidden="true">
      {PARTS.map((k) => (
        <i key={k} className={k} style={{ flexGrow: parts[k], display: parts[k] > MIN_PART ? undefined : 'none' }} />
      ))}
    </div>
  )
}

/**
 * Та же полоса правками style, для колеса: оно шлёт дробную вместимость на каждом кадре
 * прокрутки, и перерисовка через React отставала бы от пальца.
 */
export const paintCapBar = (el: HTMLElement, occupied: number, pending: number, cap: number): void => {
  const parts = partsOf(occupied, pending, cap, 0)
  for (const child of Array.from(el.children) as HTMLElement[]) {
    const v = parts[child.className as Part] ?? 0
    child.style.flexGrow = v.toFixed(3)
    child.style.display = v > MIN_PART ? '' : 'none'
  }
}
