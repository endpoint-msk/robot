// «Вернуть» вместо «Вы уверены?»: обратимое действие делается сразу, а внизу пять секунд
// висит плашка с отсчётом, как у удаления чата в Telegram. Сервер держит то, что действие
// отправляет людям, до конца отсчёта (src/undo.ts), и «Вернуть» кладёт объект обратно тем
// же. Убранная строка при этом рассыпается (dust.ts), а «Вернуть» собирает её из точек.

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { api } from './api'
import { foldOut, reappear, vanish, type Dust } from './dust'
import { showAlert } from './modals'
import { setData } from './store'
import { haptic } from './telegram'
import type { Bootstrap } from './types'

/** Столько плашка ждёт «Вернуть»; сервер держит с запасом на дорогу запроса. */
export const UNDO_MS = 5000

export type UndoOffer = {
  id: number
  text: string
  token: string
  /** Свежие данные после возврата. Без него они просто встают в стор. */
  onBack?: (data: Bootstrap) => void
}

let offer: UndoOffer | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const useUndoOffer = (): UndoOffer | null => useSyncExternalStore(subscribe, () => offer, () => offer)

/** Плашка с отсчётом. Новое действие сменяет прежнюю: вернуть можно только последнее. */
export function offerUndo(text: string, token: string | null | undefined, onBack?: (data: Bootstrap) => void): void {
  if (!token) return
  offer = { id: ++seq, text, token, onBack }
  emit()
}

/** Плашка ушла: кончился отсчёт или её смахнули. Действие остаётся в силе. */
export function dismissUndo(id: number): void {
  if (offer?.id !== id) return
  offer = null
  emit()
}

/** «Вернуть»: плашка уходит сразу, данные встают, когда ответит сервер. */
export async function takeBack(id: number): Promise<void> {
  const o = offer
  if (!o || o.id !== id) return
  offer = null
  emit()
  haptic.impact('light')
  try {
    const data = await api<Bootstrap>('undo', { token: o.token })
    if (o.onBack) o.onBack(data)
    else setData(data)
  } catch (err) {
    haptic.notify('error')
    showAlert((err as Error).message)
  }
}

/** Ctrl+Z в Desktop: вернуть то, что сейчас на плашке. Плашки нет - ничего не делает. */
export function takeBackLatest(): boolean {
  if (!offer) return false
  void takeBack(offer.id)
  return true
}

/** Ответ обратимой ручки: свежий bootstrap и токен для «Вернуть». */
export type Undoable = Bootstrap & { undo?: string }

/**
 * Строка рассыпается, пока сервер выполняет действие (`request` из mutate: отказ уже
 * показан и даёт null): из данных она уходит только после того, как свернулось её место,
 * иначе список прыгнул бы на её высоту. Отказ собирает её обратно на месте. Без строки
 * (её не видно) просто ждём ответа.
 */
export async function removeRow<T>(row: HTMLElement | null, request: Promise<T | null>): Promise<{ data: T; dust: Dust | null } | null> {
  const gone = row ? vanish(row) : null
  const data = await request
  if (data === null) {
    await gone?.back()
    return null
  }
  await gone?.folded
  return { data, dust: gone ? await gone.dust : null }
}

const until = (done: () => boolean, max: number): Promise<void> =>
  new Promise((resolve) => {
    const t0 = performance.now()
    const check = (): void => {
      if (done() || performance.now() - t0 > max) resolve()
      else requestAnimationFrame(check)
    }
    check()
  })

/** Лист вопроса уехал, и экран под ним встал на место: снимок строки до этого вышел бы уменьшенным. */
export const sheetGone = (): Promise<void> => until(() => !document.documentElement.classList.contains('sheet-recede'), 1500)

/** Верхний экран стека (копия под ним на время жеста не в счёт). */
export const topScreen = (): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>('.screen')).find((s) => !s.closest('.screen-under')) ?? null

/**
 * Навигация сменила экран (верхний уже не `from`), и новый доехал: снимок на ходу поймал
 * бы строку сдвинутой и полупрозрачной.
 */
export const screenSettled = (from: HTMLElement | null): Promise<void> =>
  until(() => {
    const top = topScreen()
    return !!top && top !== from && top.getAnimations().length === 0
  }, 1000)

/** Строка по ключу `data-dust`: так её находят и после ухода с экрана, и после возврата. */
export const dustRow = (key: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-dust="${CSS.escape(key)}"]`)

/**
 * Вернули: данные встают синхронно, и в том же кадре строка прячется и собирается из своих
 * точек. Иначе между подменой данных и началом сборки она мелькнула бы целиком.
 */
export async function bringBack(key: string, dust: Dust | null, apply: () => void): Promise<void> {
  // Пустое состояние, вставшее на место строки, сначала сворачивается: иначе в кадр
  // возврата оно пропало бы рывком.
  const empty = visibleEmpty()
  const reopen = empty ? await foldOut(empty) : null
  flushSync(apply)
  // Осталось на экране: возвращали что-то с другого экрана, и пустым он быть не перестал.
  if (empty?.isConnected) reopen?.()
  const row = dustRow(key)
  if (row) void reappear(row, dust)
}

/** Пустое состояние на верхнем экране, которое сейчас видно (см. growIn в dust.ts). */
const visibleEmpty = (): HTMLElement | null => {
  for (const el of Array.from(topScreen()?.querySelectorAll<HTMLElement>('[data-dust-empty]') ?? [])) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== 'hidden') return el
  }
  return null
}
