// Тонкая обёртка над window.Telegram.WebApp. Все вызовы — через try/catch или
// проверки: вне Telegram (в браузере) и на старых клиентах методов может не быть.

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id?: number; allows_write_to_pm?: boolean } }
  colorScheme?: 'light' | 'dark'
  ready(): void
  expand(): void
  disableVerticalSwipes?(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  openLink(url: string): void
  openTelegramLink(url: string): void
  requestWriteAccess?(callback: (granted: boolean) => void): void
  onEvent(event: string, callback: () => void): void
  HapticFeedback?: { notificationOccurred(kind: string): void }
  BackButton: { show(): void; hide(): void; onClick(callback: () => void): void }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export const tg: TelegramWebApp | null = window.Telegram?.WebApp ?? null

export const initData = (): string => (tg ? tg.initData : '')

export type HapticKind = 'success' | 'warning' | 'error'

export function haptic(kind: HapticKind): void {
  try {
    tg?.HapticFeedback?.notificationOccurred(kind)
  } catch {
    /* старый клиент */
  }
}

/** Ссылку наружу открывает клиент Telegram: t.me — внутри приложения
    (openTelegramLink), остальное — во внешнем браузере. Вне Telegram — вкладка. */
export function openUrl(url: string): void {
  try {
    if (/^https:\/\/t\.me\//i.test(url)) tg!.openTelegramLink(url)
    else tg!.openLink(url)
    return
  } catch {
    /* не в Telegram или старый клиент */
  }
  window.open(url, '_blank', 'noopener')
}

// Профиль открывается только по юзернейму: у tg://user?id= нет гарантий (работает
// лишь для «известных» клиенту юзеров), поэтому без юзернейма строка не тапается.
export const hasProfile = (u: { username?: string | null } | null | undefined): boolean =>
  Boolean(u && u.username)

export const openProfile = (u: { username: string | null }): void => {
  if (hasProfile(u)) openUrl('https://t.me/' + u.username)
}

// initData не обновляется в рамках сессии, поэтому выданный доступ помним сами.
let writeAccessGranted = false

/** Может ли бот уже писать гостю в личку (он нажимал /start или дал доступ). */
export const botCanWrite = (): boolean =>
  writeAccessGranted || !!tg?.initDataUnsafe?.user?.allows_write_to_pm

/** Нативная плашка Telegram «разрешить боту писать в личку». Promise<boolean> —
    true, если доступ дали. На старых клиентах без метода — молча false. */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg || typeof tg.requestWriteAccess !== 'function') {
      resolve(false)
      return
    }
    try {
      tg.requestWriteAccess((granted) => {
        if (granted) writeAccessGranted = true
        resolve(!!granted)
      })
    } catch {
      resolve(false)
    }
  })
}
