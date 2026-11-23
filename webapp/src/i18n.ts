import { tg } from './telegram'

export type Language = 'ru' | 'en'
export type LanguageChoice = Language | 'auto'

let current: Language = tg?.initDataUnsafe?.user?.language_code
  ?.trim().split(/[-_]/, 1)[0]?.toLowerCase() === 'ru' ? 'ru' : 'en'

export const locale = (): Language => current
export const tr = (ru: string, en: string): string => current === 'ru' ? ru : en

export function setLocale(language: Language = current): void {
  current = language
  document.documentElement.lang = language
  document.title = tr('Хостинг · endpoint', 'Visits · endpoint')
}

setLocale()

const plurals = { ru: new Intl.PluralRules('ru'), en: new Intl.PluralRules('en') }

export function plural(n: number, ru: readonly [string, string, string], en: readonly [string, string]): string {
  const form = plurals[current].select(n)
  if (current === 'en') return form === 'one' ? en[0] : en[1]
  return form === 'one' ? ru[0] : form === 'few' ? ru[1] : ru[2]
}
