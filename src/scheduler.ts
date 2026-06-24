import type { TelegramClient } from '@mtcute/node'
import { periodKeyOf } from './fundraiser.js'
import { postFundraiserToChat, refreshLastMessageInChat, type AllowedChats } from './handlers.js'
import type { Storage } from './storage.js'

/**
 * Раз в минуту проверяет, не сменился ли месяц по сравнению с тем, что
 * нарисован в «последних сообщениях» по чатам. Если сменился — перерисовывает их
 * под новый сбор. Этого достаточно, чтобы первый «тик» нового месяца обновил
 * существующие сообщения /goals и /donate без участия админа.
 */
export const startMonthlyScheduler = (
    client: TelegramClient,
    storage: Storage,
): { stop: () => void } => {
    let lastSeenKey = periodKeyOf(new Date(), storage.get().resetDay)

    const tick = async () => {
        const now = new Date()
        const nowKey = periodKeyOf(now, storage.get().resetDay)
        if (nowKey === lastSeenKey) return
        lastSeenKey = nowKey

        const last = storage.get().lastMessages
        const chatIds = Object.values(last).map((m) => m.chatId)
        for (const chatId of chatIds) {
            try {
                await refreshLastMessageInChat(client, storage, chatId, now)
            } catch (err) {
                console.error(`[scheduler] failed to refresh chat ${chatId}:`, err)
            }
        }
    }

    const handle = setInterval(() => {
        void tick()
    }, 60_000)

    return {
        stop: () => clearInterval(handle),
    }
}

/** Часы по МСК (UTC+3), в которые автоматически постим список донатеров в каждый allowlist-чат. */
const DAILY_POST_HOURS_MSK = [0, 12] as const
/** Смещение МСК относительно UTC в часах. МСК — фиксированный UTC+3, без перехода на летнее время. */
const MSK_OFFSET_HOURS = 3

const moscowHour = (date: Date): number =>
    (date.getUTCHours() + MSK_OFFSET_HOURS) % 24

/**
 * Каждый день в 00:00 и 12:00 по МСК постит новое сообщение со сбором в каждый
 * allowlist-чат и запоминает его как «последнее актуальное». Дальнейшие правки
 * (через /donate и т.п.) будут редактировать именно это сообщение.
 *
 * Тик раз в минуту; срабатывает на минуте `:00` нужного часа МСК и страхуется
 * от двойного выстрела через ключ «дата+час».
 */
export const startDailyFundraiserPoster = (
    client: TelegramClient,
    storage: Storage,
    allowedChats: AllowedChats,
): { stop: () => void } => {
    let lastFiredKey: string | null = null

    const tick = async () => {
        const now = new Date()
        const hourMsk = moscowHour(now)
        if (!DAILY_POST_HOURS_MSK.includes(hourMsk as 0 | 12)) return
        if (now.getUTCMinutes() !== 0) return

        // Ключ — UTC-дата + час МСК; защищает от повторного запуска внутри одной минуты.
        const key = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}:${hourMsk}`
        if (lastFiredKey === key) return
        lastFiredKey = key

        for (const chatId of allowedChats) {
            try {
                await postFundraiserToChat(client, storage, chatId, now)
            } catch (err) {
                console.error(`[scheduler] failed to post daily fundraiser to chat ${chatId}:`, err)
            }
        }
    }

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[scheduler] daily tick error:', err))
    }, 60_000)

    return {
        stop: () => clearInterval(handle),
    }
}
