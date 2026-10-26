// Тема. Выбор пользователя ('system' | 'light' | 'dark') живёт в localStorage —
// это клиентская настройка, гостям она нужна не меньше, чем резидентам, а на
// сервере хранить нечего. В CSS уходит уже разрешённая тема: data-theme на <html>.

import { setBottomBarColor, tg } from './telegram'
import type { ResolvedTheme, ThemeChoice } from './types'

export const THEMES: ThemeChoice[] = ['system', 'light', 'dark']
const THEME_KEY = 'endpoint-hosting-theme'
const THEME_BG: Record<ResolvedTheme, string> = { light: '#f2f2f7', dark: '#000000' }

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return (THEMES as string[]).includes(v ?? '') ? (v as ThemeChoice) : 'system'
  } catch {
    return 'system' // хранилище недоступно (приватный режим) — не падаем
  }
}

export function saveTheme(t: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* не сохранится — не критично */
  }
}

/** Системная тема: внутри Telegram — тема клиента, вне — системная настройка ОС. */
export function systemTheme(): ResolvedTheme {
  if (tg && tg.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light'
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export const resolveTheme = (choice: ThemeChoice): ResolvedTheme =>
  choice === 'system' ? systemTheme() : choice

// Текущая разрешённая тема — модульная переменная, чтобы sec() был вызываем как
// sec(0.5) из любой точки рендера (как глобальный sec в старом vanilla-миниаппе).
// applyTheme() держит её в синхроне; компоненты перерисовываются на смене темы.
let currentResolved: ResolvedTheme = 'light'

export const resolvedTheme = (): ResolvedTheme => currentResolved

/** Вторичный цвет текущей темы с заданной альфой. Нужен для inline-SVG: в атрибут
    `stroke` CSS-переменную не подставить, поэтому цвет считаем в JS. */
export const sec = (a: number): string =>
  `rgba(${currentResolved === 'dark' ? '235, 235, 245' : '60, 60, 67'}, ${a})`

const DEFAULT_ACCENT = '#007aff'
let accentRgb: [number, number, number] = [0, 122, 255]
let accentHex = DEFAULT_ACCENT

/** Акцент текущей темы, как sec(): для inline-SVG и цветов, которые считает скрипт. */
export const accent = (): string => accentHex
/** Тот же акцент тройкой «r, g, b» для полупрозрачных подложек. */
export const accentTriple = (): string => accentRgb.join(', ')

const linear = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = (c: number[]): number => 0.2126 * linear(c[0]! / 255) + 0.7152 * linear(c[1]! / 255) + 0.0722 * linear(c[2]! / 255)

/** Яркость акцента, при которой белая подпись на нём даёт 3:1. */
const LUM_MAX = 0.3
/** То же для акцента на тёмной карточке (#1c1c1e). На белой карточке хватает верхней границы. */
const LUM_MIN_DARK = 0.135

/**
 * Цвет кнопки из темы Telegram, приведённый к нашим фонам. Тема клиента рассчитана на свой
 * фон, а тема миниаппа выбирается отдельно и может с ним не совпадать: светлый акцент
 * Telegram Desktop на белой кнопке давал бы белую подпись с контрастом 2,7:1. Поэтому цвет
 * темнеет к чёрному (а на тёмной теме при нужде светлеет к белому), пока белая подпись на
 * нём и он сам на карточке не наберут 3:1. Оттенок при этом остаётся оттенком темы.
 */
const fitAccent = (hex: string, theme: ResolvedTheme): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const toward = (target: number, k: number): number[] => base.map((v) => Math.round(v + (target - v) * k))
  let c = base
  for (let k = 0.02; luminance(c) > LUM_MAX && k <= 1; k += 0.02) c = toward(0, k)
  if (theme === 'dark') for (let k = 0.02; luminance(c) < LUM_MIN_DARK && k <= 1; k += 0.02) c = toward(255, k)
  const L = luminance(c)
  return L <= LUM_MAX && (theme !== 'dark' || L >= LUM_MIN_DARK) ? [c[0]!, c[1]!, c[2]!] : null
}

/**
 * Кнопки, ссылки и выбранное красятся в цвет кнопки из темы Telegram человека. Зелёный,
 * оранжевый и красный остаются нашими: они значат исход, а не оформление. Графики тоже
 * свои: их ступени подобраны под наш синий. Вне Telegram и без темы остаётся #007aff.
 */
function applyAccent(theme: ResolvedTheme): void {
  const fit = fitAccent(tg?.themeParams?.button_color ?? '', theme)
  accentRgb = fit ?? [0, 122, 255]
  accentHex = '#' + accentRgb.map((v) => v.toString(16).padStart(2, '0')).join('')
  const root = document.documentElement.style
  if (accentHex === DEFAULT_ACCENT) {
    root.removeProperty('--blue')
    root.removeProperty('--blue-rgb')
    return
  }
  root.setProperty('--blue', accentHex)
  root.setProperty('--blue-rgb', accentTriple())
}

/** Тема миниаппа выбрана вручную, а тема Telegram сменилась: акцент берётся из неё всё равно. */
export const refreshAccent = (): void => applyAccent(currentResolved)

export function applyTheme(choice: ThemeChoice): void {
  const t = resolveTheme(choice)
  currentResolved = t
  document.documentElement.dataset.theme = t
  applyAccent(t)
  try {
    tg?.setHeaderColor(THEME_BG[t])
  } catch {
    /* старый клиент */
  }
  try {
    tg?.setBackgroundColor(THEME_BG[t])
  } catch {
    /* старый клиент */
  }
  setBottomBarColor(THEME_BG[t])
}
