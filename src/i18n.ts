import { AsyncLocalStorage } from 'node:async_hooks'
import type { Storage } from './storage.js'
import { own, type Language, type LanguageChoice } from './types.js'

const current = new AsyncLocalStorage<Language>()

// Общие сообщения используют язык спейса. У личных есть контекст адресата.
export const locale = (): Language => current.getStore() ?? 'ru'
export const tr = (ru: string, en: string): string => locale() === 'ru' ? ru : en
export const withLocale = <T>(language: Language, fn: () => T): T => current.run(language, fn)

export const languageFromTelegram = (code?: string | null): Language =>
    code?.trim().split(/[-_]/, 1)[0]?.toLowerCase() === 'ru' ? 'ru' : 'en'

export const languageChoiceOf = (store: Storage, userId: number): LanguageChoice =>
    own(store.get().userLanguages, String(userId))?.choice ?? 'auto'

export const userLocale = (store: Storage, userId: number, telegramLanguage?: string | null): Language => {
    const settings = own(store.get().userLanguages, String(userId))
    return settings?.choice ?? (telegramLanguage
        ? languageFromTelegram(telegramLanguage)
        : settings?.telegram ?? 'en')
}

export const withUserLocale = <T>(store: Storage, userId: number, fn: () => T): T =>
    withLocale(userLocale(store, userId), fn)

export const rememberTelegramLanguage = (store: Storage, userId: number, code?: string | null): void => {
    if (!code) return
    const key = String(userId)
    const telegram = languageFromTelegram(code)
    if (own(store.get().userLanguages, key)?.telegram === telegram) return
    void store.update((state) => {
        state.userLanguages[key] = { ...state.userLanguages[key], telegram }
    }).catch((err) => console.error('[i18n] не удалось сохранить язык Telegram:', err))
}

export const setUserLanguage = (store: Storage, userId: number, choice: LanguageChoice): Promise<void> =>
    store.update((state) => {
        const key = String(userId)
        const telegram = state.userLanguages[key]?.telegram
        if (choice !== 'auto') state.userLanguages[key] = { choice, telegram }
        else if (telegram) state.userLanguages[key] = { telegram }
        else delete state.userLanguages[key]
    })
