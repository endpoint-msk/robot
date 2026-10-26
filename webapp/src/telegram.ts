// Тонкая обёртка над window.Telegram.WebApp. Все вызовы — через try/catch или
// проверки: вне Telegram (в браузере) и на старых клиентах методов может не быть.

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id?: number; allows_write_to_pm?: boolean }; start_param?: string }
  colorScheme?: 'light' | 'dark'
  /** Цвета темы клиента, #RRGGBB. Telegram кладёт их и в CSS как --tg-theme-*. */
  themeParams?: { button_color?: string; button_text_color?: string; link_color?: string; bg_color?: string }
  /** 'ios' | 'android' | 'macos' | 'tdesktop' | 'weba' | 'webk' | ... */
  platform?: string
  ready(): void
  expand(): void
  disableVerticalSwipes?(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  setBottomBarColor?(color: string): void
  openLink(url: string): void
  openTelegramLink(url: string): void
  requestWriteAccess?(callback: (granted: boolean) => void): void
  switchInlineQuery?(query: string, chooseChatTypes?: string[]): void
  onEvent(event: string, callback: () => void): void
  offEvent?(event: string, callback: () => void): void
  /** Bot API 8.0. Углы в радианах. */
  DeviceOrientation?: { start(params: { refresh_rate?: number }): void; stop(): void; beta: number | null; gamma: number | null }
  isVersionAtLeast?(version: string): boolean
  HapticFeedback?: {
    impactOccurred?(style: ImpactStyle): void
    notificationOccurred(kind: NotifyKind): void
    selectionChanged?(): void
  }
  BackButton: { show(): void; hide(): void; onClick(callback: () => void): void }
  /** Bot API 7.0: пункт «Настройки» в меню «⋯» миниаппа. */
  SettingsButton?: { show(): void; hide(): void; onClick(callback: () => void): void }
  /** Bot API 6.9: хранилище Telegram на человека и бота, одно на все его устройства. */
  CloudStorage?: CloudStorage
  /** Bot API 8.0: свой выбор чата Telegram для сообщения, подготовленного ботом. */
  shareMessage?(id: string, callback?: (sent: boolean) => void): void
}

export type CloudStorage = {
  setItem(key: string, value: string, callback?: (err: string | null, ok?: boolean) => void): void
  getItems(keys: string[], callback: (err: string | null, values?: Record<string, string>) => void): void
  removeItems(keys: string[], callback?: (err: string | null, ok?: boolean) => void): void
  getKeys(callback: (err: string | null, keys?: string[]) => void): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export const tg: TelegramWebApp | null = window.Telegram?.WebApp ?? null

export const initData = (): string => (tg ? tg.initData : '')

/**
 * Кнопку «Назад» (Bot API 6.1) рисует в шапке любой клиент Telegram, десктоп тоже: своя
 * строка «‹ Экран» её только дублирует. Нужна она вне Telegram (`unknown`) и в старых клиентах.
 */
export const nativeBack = ((): boolean => {
  try {
    return Boolean(tg) && (tg!.platform ?? 'unknown') !== 'unknown' && (tg!.isVersionAtLeast?.('6.1') ?? false)
  } catch {
    return false
  }
})()

export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
export type NotifyKind = 'success' | 'warning' | 'error'

// Без проверки версии клиент до 6.1 пишет предупреждение в консоль на каждый тик.
const hapticsOn = !!tg?.HapticFeedback && (tg.isVersionAtLeast?.('6.1') ?? false)
const IMPACT_RANK: Record<ImpactStyle, number> = { soft: 2, light: 2, medium: 3, rigid: 4, heavy: 4 }
let lastAt = 0
let lastRank = 0

// Один тап часто зовёт два отклика подряд (тумблер и вызывающий, тик и удар), и они
// сливаются в дребезг. В пределах 40 мс звучит только более сильный.
function play(rank: number, fire: (h: NonNullable<TelegramWebApp['HapticFeedback']>) => void): void {
  if (!hapticsOn) return
  const now = performance.now()
  if (now - lastAt < 40 && rank <= lastRank) return
  lastAt = now
  lastRank = rank
  try {
    fire(tg!.HapticFeedback!)
  } catch {
    /* своя копия telegram-web-app.js бросает на неизвестный стиль */
  }
}

/**
 * Словарь отклика. Отклик только дополняет картинку: на десктопе его нет вовсе, а на
 * Android без управления амплитудой удар и тик молчат.
 */
export const haptic = {
  /** Значение сменилось под пальцем: колесо, день листалки, порог свайпа, пункт меню. */
  tick: (): void => play(1, (h) => h.selectionChanged?.()),
  /**
   * Свой тап, в момент касания, а не после сервера. light меняет на месте, soft снимает,
   * medium задевает других (чужая личка, деньги), rigid подтверждает необратимое.
   */
  impact: (style: ImpactStyle = 'light'): void => play(IMPACT_RANK[style], (h) => h.impactOccurred?.(style)),
  /** Исход, которого глаз ещё не видел. Единственный отклик, что доходит почти везде, поэтому редкий. */
  notify: (kind: NotifyKind): void => play(5, (h) => h.notificationOccurred(kind)),
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

/** Облако Telegram для черновиков. null: клиент старше 6.9 или миниапп открыт вне Telegram. */
export const cloudStorage = (): CloudStorage | null => {
  try {
    return tg?.CloudStorage && (tg.isVersionAtLeast?.('6.9') ?? false) ? tg.CloudStorage : null
  } catch {
    return null
  }
}

export const shareSupported = (): boolean => {
  try {
    return typeof tg?.shareMessage === 'function' && (tg.isVersionAtLeast?.('8.0') ?? false)
  } catch {
    return false
  }
}

/**
 * Выбор чата Telegram для подготовленной ботом карточки. true: отправили, false: закрыли
 * выбор или клиент отказал. null: клиент бросил, не открыв выбор. Так бывает, если прошлый
 * выбор закрыли, а клиент об этом не сообщил: тогда он считает его открытым до перезапуска.
 */
export function shareMessage(id: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      tg!.shareMessage!(id, (sent) => resolve(Boolean(sent)))
    } catch {
      resolve(null)
    }
  })
}

/**
 * Цвет нижней панели Telegram (Bot API 7.10). На Android красит и системную панель
 * навигации, поэтому сцена в тон выглядит цельной снизу так же, как сверху.
 */
export function setBottomBarColor(hex: string): void {
  try {
    if (tg?.isVersionAtLeast?.('7.10')) tg.setBottomBarColor?.(hex)
  } catch {
    /* старый клиент */
  }
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
