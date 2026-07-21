// Единый внешний стор + стек экранов. Аналог глобального `store` и `stack` из
// старого vanilla-миниаппа, но подписка — через useSyncExternalStore. Мутации
// (push/pop/setData/setTheme) заменяют объект state целиком, что и триггерит
// перерисовку подписчиков.

import { useSyncExternalStore } from 'react'
import { applyTheme, loadTheme, saveTheme } from './theme'
import type { Bootstrap, Perspective, ThemeChoice } from './types'

export type ScreenName =
  | 'overview'
  | 'day'
  | 'archive'
  | 'archiveWeek'
  | 'settings'
  | 'myVisits'
  | 'peek'
  | 'peekDay'
  | 'visit'
  | 'newRequest'
  | 'editRequest'
  | 'dev'
  | 'devEdit'
  | 'announce'

export type NavParams = Record<string, any>
export type NavEntry = { name: ScreenName; params: NavParams }
export type Anim = 'in-forward' | 'in-back' | 'in-fade' | null

export type State = {
  data: Bootstrap | null
  perspective: Perspective
  theme: ThemeChoice
  stack: NavEntry[]
  /** Растёт на каждую навигацию: ключ для ремаунта экрана (анимация + сброс скролла).
      На чистом обновлении данных (setData) не меняется — экран сохраняет state. */
  navId: number
  anim: Anim
}

let state: State = {
  data: null,
  perspective: 'guest',
  theme: loadTheme(),
  stack: [],
  navId: 0,
  anim: null,
}

const listeners = new Set<() => void>()

export const getState = (): State => state
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const emit = (): void => listeners.forEach((l) => l())
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch }
  emit()
}

export const useStore = (): State => useSyncExternalStore(subscribe, getState, getState)

/** Параметры текущего (верхнего) экрана. */
export const useParams = (): NavParams => {
  const { stack } = useStore()
  return stack[stack.length - 1]?.params ?? {}
}

// --- Навигация ---

export function push(name: ScreenName, params: NavParams = {}): void {
  set({ stack: [...state.stack, { name, params }], navId: state.navId + 1, anim: 'in-forward' })
}

export function pop(): void {
  if (state.stack.length > 1) {
    set({ stack: state.stack.slice(0, -1), navId: state.navId + 1, anim: 'in-back' })
  }
}

export function resetRoot(): void {
  const root: ScreenName = state.perspective === 'resident' ? 'overview' : 'myVisits'
  set({ stack: [{ name: root, params: {} }], navId: state.navId + 1, anim: 'in-fade' })
}

export function setPerspective(p: Perspective): void {
  state = { ...state, perspective: p }
  resetRoot() // ремаунтит корневой экран под новую перспективу
}

// --- Данные ---

/** Обновление данных без навигации: экран не ремаунтится, скролл/фокус сохраняются. */
export const setData = (data: Bootstrap): void => set({ data })

// --- Busy-оверлей (как в старом миниаппе: класс на body, CSS показывает #busy-overlay) ---

export const setBusy = (on: boolean): void => {
  document.body.classList.toggle('busy', on)
}

// --- Тема ---

export function setTheme(next: ThemeChoice): void {
  saveTheme(next)
  applyTheme(next)
  // Иконки рисуются цветом темы прямо в разметке SVG — нужна перерисовка.
  set({ theme: next })
}

/** Форсированная перерисовка (например, системная тема сменилась при выборе 'system'). */
export const bump = (): void => set({})
