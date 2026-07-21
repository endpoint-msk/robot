// Тема. Выбор пользователя ('system' | 'light' | 'dark') живёт в localStorage —
// это клиентская настройка, гостям она нужна не меньше, чем резидентам, а на
// сервере хранить нечего. В CSS уходит уже разрешённая тема: data-theme на <html>.

import { tg } from './telegram'
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

export function applyTheme(choice: ThemeChoice): void {
  const t = resolveTheme(choice)
  currentResolved = t
  document.documentElement.dataset.theme = t
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
}
