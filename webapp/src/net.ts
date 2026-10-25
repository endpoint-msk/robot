// Сеть пропала посреди своего действия: вместо алерта «Нет связи» шапка экрана говорит
// «Ожидание сети…», как Telegram, а запрос повторяется сам, когда сеть вернулась.

import { useSyncExternalStore } from 'react'

export type NetState = 'ok' | 'waiting' | 'connecting'

let state: NetState = 'ok'
const listeners = new Set<() => void>()
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const useNetState = (): NetState => useSyncExternalStore(subscribe, () => state, () => state)

export function setNetState(next: NetState): void {
  if (state === next) return
  state = next
  listeners.forEach((l) => l())
}

/** Подпись шапки вместо подзаголовка, пока сети нет. null - всё в порядке. */
export const netLabel = (s: NetState): string | null =>
  s === 'waiting' ? 'Ожидание сети…' : s === 'connecting' ? 'Соединение…' : null

/**
 * Сеть вернулась или прошло время: событие `online` в вебвью приходит не всегда (сеть
 * «есть», а сервер недоступен), поэтому ждём его не дольше `ms`.
 */
export const backOnline = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener('online', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, ms)
    window.addEventListener('online', done)
  })
