import type { TelegramClient } from '@mtcute/node'
import { periodKeyOf } from './fundraiser.js'
import { refreshLastMessageInChat } from './handlers.js'
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
    let lastSeenKey = periodKeyOf(new Date())

    const tick = async () => {
        const now = new Date()
        const nowKey = periodKeyOf(now)
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
