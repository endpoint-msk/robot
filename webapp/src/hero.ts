// Переходы на View Transitions API: экран по касанию въезжает целиком, главная кнопка
// гостя, общая у соседних экранов (ключ `cta`), и тема, расходящаяся кругом. У кнопки на
// обоих экранах одинаковое view-transition-name, и браузер ведёт её со старого места на
// новое, а экраны вокруг въезжают как обычно.
//
// Разметка: источник помечается data-hero="<ключ>", экран data-hero-screen="<ключ>", части
// data-hero-part. Имена ставятся только на время перехода: два элемента с одним именем в
// кадре срывают переход целиком.

import { flushSync } from 'react-dom'
import { reducedMotion } from './motion'

let running = false
let deferred: (() => void)[] = []
// Новый переход обрывает прежний, и прежний досчитывается позже: убирать флаг и отдавать
// отложенное вправе только последний.
let generation = 0

/** iOS 17 и старее, старые вебвью Android и «уменьшение движения» остаются на прежнем въезде. */
export const heroSupported = (): boolean => typeof document.startViewTransition === 'function' && !reducedMotion()

/**
 * Шапку Telegram рисует клиент, и в переход она не попадает: перекрашенная на старте, она
 * сменила бы цвет раньше экрана, поэтому экраны красят её в конце перехода.
 */
export function afterHero(fn: () => void): void {
  if (running) deferred.push(fn)
  else fn()
}

export const heroRunning = (): boolean => running

// Источник, который сам часть (кнопка гостя, карточка статуса), переходит целиком. Свои
// части у него с его именем в начале (cta-label): капсула меняет размер и цвет, а подпись
// внутри растворяется и проявляется отдельно, как слово в «Захостить».
const partsOf = (root: Element | null): HTMLElement[] => {
  if (!root) return []
  if (root instanceof HTMLElement && root.dataset.heroPart) {
    const own = root.dataset.heroPart
    return [root, ...Array.from(root.querySelectorAll<HTMLElement>(`[data-hero-part^="${CSS.escape(own)}-"]`))]
  }
  return Array.from(root.querySelectorAll<HTMLElement>('[data-hero-part]'))
}

const setNames = (els: HTMLElement[], on: boolean): void => {
  for (const el of els) el.style.viewTransitionName = on ? `h-${el.dataset.heroPart}` : ''
}

// Под верхним экраном на время жеста «вниз» лежит прежний (App.tsx, .screen-under): его
// элементы не должны откликаться на поиск, иначе имя досталось бы двум.
const live = (sel: string): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => !el.closest('.screen-under')) ?? null

/** Экран, который сейчас наверху и делит часть с соседним. */
export const heroScreen = (): HTMLElement | null => live('[data-hero-screen]')

export const heroRow = (key: string): HTMLElement | null => live(`[data-hero="${CSS.escape(key)}"]`)

export const heroScreenOf = (key: string): HTMLElement | null => live(`[data-hero-screen="${CSS.escape(key)}"]`)

// Смена экрана, которая ждёт колбэка своего перехода. Навигация, пришедшая раньше него
// (pop и сразу push), сначала доводит её сама: иначе отложенная смена легла бы поверх
// новой и откатила её.
let pending: { run: () => void; vt: ViewTransition | null } | null = null

export function settleHero(): void {
  const p = pending
  if (!p) return
  pending = null
  p.vt?.skipTransition()
  p.run()
}

/**
 * 'slide' и 'slide-back' — экран въезжает, как обычно, а общая часть (главная кнопка
 * гостя) остаётся на месте. 'replace' — форма становится визитом, кнопка вырастает в его
 * карточку статуса.
 */
export type HeroKind = 'replace' | 'slide' | 'slide-back'

/**
 * Проводит `update` (смену экрана) через переход с общими частями `from` и того, что вернёт
 * `to()` уже в новом дереве. `false` — перехода не будет, и `update` вызывает сам вызывающий.
 * Новое дерево должно быть готово, когда колбэк вернётся, поэтому смена экрана идёт через
 * flushSync: иначе React дорисовал бы его кадром позже, уже после снимка.
 */
export function heroSwap(update: () => void, from: HTMLElement | null, to: () => HTMLElement | null, kind: HeroKind): boolean {
  if (!from || !heroSupported()) return false
  return swap(update, partsOf(from), to, kind)
}

/**
 * Экран по касанию въезжает целиком, а «назад» уходит обратным ходом (app.css, push и pop):
 * та же геометрия, что у свайпа назад. В окне шире колонки экран во всё окно ехал бы мимо
 * неё, поэтому в Desktop, как и без View Transitions, остаётся прежнее проявление.
 */
export function pageSwap(update: () => void, kind: 'push' | 'pop'): boolean {
  if (!heroSupported() || window.innerWidth > 520) return false
  return swap(update, [], () => null, kind)
}

function swap(update: () => void, src: HTMLElement[], to: () => HTMLElement | null, kind: HeroKind | 'push' | 'pop'): boolean {
  const html = document.documentElement
  let dst: HTMLElement[] = []
  html.dataset.vt = kind
  setNames(src, true)
  running = true
  const mine = ++generation
  let done = false
  const run = (): void => {
    if (done) return
    done = true
    if (pending?.run === run) pending = null
    setNames(src, false)
    flushSync(update)
    dst = partsOf(to())
    setNames(dst, true)
  }
  let vt: ViewTransition
  try {
    pending = { run, vt: null }
    vt = document.startViewTransition(run)
    if (pending?.run === run) pending.vt = vt
  } catch {
    pending = null
    setNames(src, false)
    delete html.dataset.vt
    running = false
    return false
  }
  void settle(vt, mine, () => setNames(dst, false))
  return true
}

async function settle(vt: ViewTransition, mine: number, clean: () => void): Promise<void> {
  // Переход, который начался и не закончился (сбой вебвью), держал бы экран без касаний:
  // на время перехода html под pointer-events: none. Через 1,5 с он доводится сразу.
  const stuck = window.setTimeout(() => vt.skipTransition(), 1500)
  try {
    await vt.finished
  } catch {
    // Переход сорвался (например, его перебил следующий): дерево уже новое, чистим имена.
  }
  window.clearTimeout(stuck)
  clean()
  if (mine !== generation) return
  delete document.documentElement.dataset.vt
  running = false
  const fns = deferred
  deferred = []
  for (const fn of fns) fn()
}

/**
 * Новая тема расходится кругом из точки касания, как ночной режим в самом Telegram:
 * переход снимает экран в старой теме и открывает новую маской, перекрашивать руками
 * ничего не нужно. `false` — API нет, тему меняет сам вызывающий, разом.
 */
export function themeSwap(update: () => void, x: number, y: number): boolean {
  if (!heroSupported()) return false
  settleHero()
  const html = document.documentElement
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  html.style.setProperty('--vt-x', `${x.toFixed(0)}px`)
  html.style.setProperty('--vt-y', `${y.toFixed(0)}px`)
  html.style.setProperty('--vt-r', `${Math.ceil(r)}px`)
  html.dataset.vt = 'theme'
  running = true
  const mine = ++generation
  let vt: ViewTransition
  try {
    vt = document.startViewTransition(() => flushSync(update))
  } catch {
    delete html.dataset.vt
    running = false
    return false
  }
  void settle(vt, mine, () => {})
  return true
}
