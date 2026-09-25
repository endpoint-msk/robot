// Тонкая обёртка над window.Telegram.WebApp. Все вызовы — через try/catch или
// проверки: вне Telegram (в браузере) и на старых клиентах методов может не быть.

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id?: number; allows_write_to_pm?: boolean }; start_param?: string }
  colorScheme?: 'light' | 'dark'
  /** 'ios' | 'android' | 'macos' | 'tdesktop' | 'weba' | 'webk' | ... */
  platform?: string
  ready(): void
  expand(): void
  disableVerticalSwipes?(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  openLink(url: string): void
  openTelegramLink(url: string): void
  requestWriteAccess?(callback: (granted: boolean) => void): void
  switchInlineQuery?(query: string, chooseChatTypes?: string[]): void
  onEvent(event: string, callback: () => void): void
  HapticFeedback?: { notificationOccurred(kind: string): void; selectionChanged?(): void }
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

/** Щелчок прокрутки колеса времени: у нативных пикеров iOS он есть, без него жест мёртвый. */
export function hapticTick(): void {
  try {
    tg?.HapticFeedback?.selectionChanged?.()
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

/** Раздел бота по диплинку `t.me/<бот>?start=<раздел>`: параметр разбирает меню бота (src/menu.ts). */
export function openBotSection(bot: string, section: string): void {
  openUrl(`https://t.me/${bot}?start=${encodeURIComponent(section)}`)
}

/** Инлайн бота в чате, который человек выберет сам. false: клиент так не умеет. */
export function switchInline(): boolean {
  try {
    if (tg?.switchInlineQuery) {
      tg.switchInlineQuery('', ['users', 'groups', 'channels'])
      return true
    }
  } catch {
    /* старый клиент */
  }
  return false
}

/** Цвет шапки Telegram. Только #RRGGBB: rgba и имена цветов понимают не все клиенты. */
export function setHeaderColor(hex: string): void {
  try {
    tg?.setHeaderColor(hex)
  } catch {
    /* старый клиент */
  }
}

// Профиль открывается только по @нику: ссылки t.me на человека без ника не существует.
// Обходные пути проверены и не работают: `tg://user?id=` из вебвью не открывается ни в
// каком виде (openTelegramLink берёт только t.me, openLink/window.open/location.href схему
// проглатывают), а карточка с text-mention от бота бесполезна для тех, у кого в приватности
// запрещена ссылка на аккаунт — Telegram молча выкидывает сущность упоминания.
// Поэтому без ника строка просто не тапается.
export const hasProfile = (u: { username?: string | null } | null | undefined): boolean =>
  Boolean(u && u.username)

export const openProfile = (u: { username?: string | null }): void => {
  if (u.username) openUrl('https://t.me/' + u.username)
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
