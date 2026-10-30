// Единый внешний стор + стек экранов. Аналог глобального `store` и `stack` из
// старого vanilla-миниаппа, но подписка — через useSyncExternalStore. Мутации
// (push/pop/setData/setTheme) заменяют объект state целиком, что и триггерит
// перерисовку подписчиков.

import { useContext, useSyncExternalStore } from 'react'
import { heroRow, heroScreen, heroScreenOf, heroSwap, pageSwap, settleHero, themeSwap, type HeroKind } from './hero'
import { markOwnTap } from './motion'
import { pruneRemote } from './remote'
import { SnapContext } from './screenContext'
import { applyTheme, loadTheme, saveTheme } from './theme'
import type { Bootstrap, Perspective, ThemeChoice } from './types'

export type ScreenName =
  | 'overview'
  | 'day'
  | 'invite'
  | 'archive'
  | 'archiveWeek'
  | 'guestVisits'
  | 'visits'
  | 'walkIn'
  | 'settings'
  | 'dues'
  | 'duesPerson'
  | 'duesHistory'
  | 'duesSettings'
  | 'stats'
  | 'statsDay'
  | 'statsDays'
  | 'statsPerson'
  | 'myVisits'
  | 'peek'
  | 'peekDay'
  | 'visit'
  | 'guestNote'
  | 'newRequest'
  | 'editRequest'
  | 'event'
  | 'eventApply'
  | 'eventApps'
  | 'route'
  | 'dev'
  | 'devEdit'
  | 'residents'
  | 'residentProfile'
  | 'announce'
  | 'onboarding'
  | 'wrap'

export type NavParams = Record<string, any>
export type NavEntry = {
  name: ScreenName
  params: NavParams
  /** Своя у каждого входа в экран: по ней держатся данные экрана, пока он в стеке. */
  id: number
  /** Где был экран, когда с него ушли вперёд: «назад» возвращает его туда же. */
  scrollY?: number
  /** Данные, с которыми с экрана ушли вперёд: с ними он встаёт на «назад», см. heldData. */
  snap?: Bootstrap | null
  /** Глубже было своё действие: смена данных доиграет на этом экране, когда он встанет. */
  own?: boolean
}
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

let entrySeq = 0
const entry = (name: ScreenName, params: NavParams): NavEntry => ({ name, params, id: ++entrySeq })

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

/** Экран, вставший на «назад» со снимком (App.tsx), видит снимок вместо свежих данных. */
export const useStore = (): State => {
  const s = useSyncExternalStore(subscribe, getState, getState)
  const snap = useContext(SnapContext)
  return snap ? { ...s, data: snap } : s
}

/** Параметры текущего (верхнего) экрана. */
export const useParams = (): NavParams => {
  const { stack } = useStore()
  return stack[stack.length - 1]?.params ?? {}
}

// --- Навигация ---

/**
 * Смена стека. С общей главной кнопкой гостя (hero.ts) и по касанию (`page`) экран въезжает
 * переходом, а класс въезда снимается, чтобы не наложиться на него.
 */
function navigate(
  patch: Partial<State>,
  hero?: { from: HTMLElement | null; to: () => HTMLElement | null; kind: HeroKind },
  page?: 'push' | 'pop',
): void {
  if (hero && heroSwap(() => commit(patch, null), hero.from, hero.to, hero.kind)) return
  if (page && pageSwap(() => commit(patch, null), page)) return
  commit(patch, patch.anim ?? null)
}

const commit = (patch: Partial<State>, anim: Anim): void => {
  const next = { ...patch, anim }
  if (next.stack) pruneRemote(new Set(next.stack.map((e) => e.id)))
  setUnder(null)
  set(next)
}

/** Уходящий вперёд экран запоминает прокрутку и то, что показывал. */
const leaving = (): NavEntry[] => {
  const top = state.stack[state.stack.length - 1]
  return top ? [...state.stack.slice(0, -1), { ...top, scrollY: window.scrollY, snap: state.data, own: false }] : []
}

/**
 * Экраны, которые показывают итог своего действия на глубоком экране, когда на них
 * вернулись: умеют сыграть смену своих данных (лица, подписи, карточки). Остальные встают
 * сразу свежими, иначе смена без движения выскочила бы уже после перехода.
 */
const HOLDS: ReadonlySet<ScreenName> = new Set<ScreenName>(['overview', 'day', 'event', 'guestVisits', 'visits'])

/**
 * Снимок, с которым встаёт экран записи: только после своего действия глубже. Чужое
 * изменение без своего приходит, как везде, без движения.
 */
export const heldData = (e: NavEntry): Bootstrap | null => (e.own && e.snap && HOLDS.has(e.name) ? e.snap : null)

/**
 * Своё действие на верхнем экране: экраны под ним, когда на них вернутся, сыграют смену.
 * Без emit: метку читает только навигация, а данные следом кладёт setData.
 */
export function markOwnChange(): void {
  const n = state.stack.length
  if (n < 2) return
  state = { ...state, stack: state.stack.map((e, i) => (i < n - 1 && !e.own ? { ...e, own: true } : e)) }
}

/**
 * Экран встал после «назад» со снимком: дальше он на свежих данных, и смена играет, как
 * после касания на месте. Пока он вставал, могли уйти дальше: тогда метку не трогаем.
 */
export function releaseHeld(id: number): void {
  const top = state.stack[state.stack.length - 1]
  if (!top || top.id !== id || !top.own) return
  markOwnTap()
  set({ stack: [...state.stack.slice(0, -1), { ...top, own: false, snap: null }] })
}

/**
 * `hero` — ключ общей части (data-hero): главная кнопка гостя остаётся на месте, пока
 * экран въезжает справа. Без ключа или без View Transitions экран просто въезжает.
 */
export function push(name: ScreenName, params: NavParams = {}, hero?: string): void {
  settleHero()
  const patch = { stack: [...leaving(), entry(name, params)], navId: state.navId + 1, anim: 'in-forward' as const }
  navigate(patch, hero ? { from: heroRow(hero), to: () => heroScreenOf(hero), kind: 'slide' } : undefined, 'push')
}

/** Экран с общей главной кнопкой гостя (data-hero-screen) уходит, оставляя её на месте. */
export function pop(): void {
  settleHero()
  if (state.stack.length <= 1) return
  const patch = { stack: state.stack.slice(0, -1), navId: state.navId + 1, anim: 'in-back' as const }
  const from = heroScreen()
  const key = from?.dataset.heroScreen
  navigate(patch, key ? { from, to: () => heroRow(key), kind: 'slide-back' } : undefined, 'pop')
}

/**
 * Экран уже убран жестом: карточка уехала вниз без перехода, и прежний экран под ней виден
 * целиком. Въезжать ему незачем, он просто остаётся.
 */
export function popStill(): void {
  settleHero()
  if (state.stack.length <= 1) return
  navigate({ stack: state.stack.slice(0, -1), navId: state.navId + 1, anim: null })
}

/**
 * Новые параметры верхнего экрана без навигации: navId не растёт, экран не ремаунтится
 * и не уезжает в начало. Так листается день: пролистанный день заменяет текущий, а не
 * ложится в стек, иначе «назад» прошёл бы по всем пролистанным дням.
 */
export function setTopParams(params: NavParams): void {
  settleHero()
  const top = state.stack[state.stack.length - 1]
  if (!top) return
  set({ stack: [...state.stack.slice(0, -1), { ...top, params }] })
}

export function resetRoot(): void {
  settleHero()
  const root: ScreenName = state.perspective === 'resident' ? 'overview' : 'myVisits'
  navigate({ stack: [entry(root, {})], navId: state.navId + 1, anim: 'in-fade' })
}

/**
 * Место из кнопки бота (deeplink.ts): корень и экраны над ним встают разом. Миниапп только
 * открылся, въезжать экрану неоткуда, поэтому первый же кадр показывает целевой экран, а
 * «назад» ведёт по стеку, как если бы до места дошли тапами.
 */
export function openAt(entries: { name: ScreenName; params?: NavParams }[]): void {
  settleHero()
  const root: ScreenName = state.perspective === 'resident' ? 'overview' : 'myVisits'
  const stack = [entry(root, {}), ...entries.map((e) => entry(e.name, e.params ?? {}))]
  navigate({ stack, navId: state.navId + 1, anim: null })
}

/**
 * Знакомство, открытое само, встаёт корнем стека: с обложки «назад» вести некуда,
 * и Telegram показывает на её месте «Закрыть».
 */
export function openOnboardingRoot(params: NavParams): void {
  settleHero()
  navigate({ stack: [entry('onboarding', params)], navId: state.navId + 1, anim: 'in-fade' })
}

/**
 * Новая заявка. `params`: день и время, с которыми открыть форму (например, «Хочу прийти»
 * на ивенте). Главная кнопка гостя (data-hero="cta") остаётся на месте и меняет подпись на
 * кнопку формы. До первой заявки форма сама поднимает над собой лист правил.
 */
export function startNewRequest(params?: NavParams): void {
  push('newRequest', params, 'cta')
}

/**
 * Верхний экран сменяется другим без перехода: форма становится созданным визитом на месте.
 * `hero` — часть формы (data-hero), которая вырастает в часть нового экрана с тем же ключом;
 * `slide` — новый экран при этом въезжает, как обычный следующий (правила → форма).
 */
export function replaceTop(name: ScreenName, params: NavParams = {}, hero?: string, slide = false): void {
  settleHero()
  const patch = { stack: [...state.stack.slice(0, -1), entry(name, params)], navId: state.navId + 1, anim: slide ? ('in-forward' as const) : null }
  navigate(patch, hero ? { from: heroRow(hero), to: () => heroScreenOf(hero), kind: slide ? 'slide' : 'replace' } : undefined, slide ? 'push' : undefined)
}

// --- Прежний экран под верхним ---
// Флаг живёт отдельно от состояния: его ставит начало жеста, а смена состояния
// перерисовывает все экраны, подписанные на стор, и рвала бы первые кадры жеста.

/** Чей жест открыл прежний экран: «вниз» (usePullDismiss) или назад вправо (useSwipeBack). */
export type UnderMode = 'pull' | 'swipe'

let under: UnderMode | null = null
const underListeners = new Set<() => void>()
const subscribeUnder = (fn: () => void): (() => void) => {
  underListeners.add(fn)
  return () => {
    underListeners.delete(fn)
  }
}

/** Прежний экран нарисован под верхним: идёт жест, который может увести экран. */
export const useUnder = (): UnderMode | null => useSyncExternalStore(subscribeUnder, () => under, () => under)

export const underMode = (): UnderMode | null => under

/** Жест начался или отменён: прежний экран рисуется под верхним, пока палец тянет. */
export function setUnder(mode: UnderMode | null): void {
  if (under === mode) return
  under = mode
  underListeners.forEach((l) => l())
}

export function setPerspective(p: Perspective): void {
  state = { ...state, perspective: p }
  resetRoot() // ремаунтит корневой экран под новую перспективу
}

// --- Данные ---

/**
 * Когда пришёл bootstrap. `nowTime` в нём — снимок минуты, в которую загрузился
 * миниапп, и без точки отсчёта его нельзя пересчитать на «сейчас»: сессия
 * миниаппа короткая, но окно «Я на месте» открывается ровно по ходу того, как
 * человек идёт к двери с уже открытым экраном.
 */
let dataAt = 0
export const getDataAt = (): number => dataAt

/** Обновление данных без навигации: экран не ремаунтится, скролл/фокус сохраняются. */
export const setData = (data: Bootstrap): void => {
  dataAt = Date.now()
  set({ data })
}

// --- Busy-оверлей (как в старом миниаппе: класс на body, CSS показывает #busy-overlay) ---

/**
 * Счётчик, а не флаг: два перекрывающихся запроса снимали оверлей по первому
 * завершившемуся, и экран оживал, пока второй ещё летел.
 */
let busyDepth = 0
export const setBusy = (on: boolean): void => {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1))
  document.body.classList.toggle('busy', busyDepth > 0)
}

// --- Тема ---

export function setTheme(next: ThemeChoice): void {
  saveTheme(next)
  applyTheme(next)
  // Иконки рисуются цветом темы прямо в разметке SVG — нужна перерисовка.
  set({ theme: next })
}

/** Тема выбрана своим тапом: новая расходится кругом от пальца (hero.ts). */
export function setThemeFrom(next: ThemeChoice, x: number, y: number): void {
  if (!themeSwap(() => setTheme(next), x, y)) setTheme(next)
}

/** Форсированная перерисовка (например, системная тема сменилась при выборе 'system'). */
export const bump = (): void => set({})
