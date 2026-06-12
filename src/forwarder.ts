import { PropagationAction, type Dispatcher } from '@mtcute/dispatcher'
import type { TelegramClient } from '@mtcute/node'

/**
 * Подписывается на новые сообщения из исходного канала и форвардит каждое
 * в целевой чат «как есть» (через forwardMessagesById, с авторством канала).
 *
 * Бот должен быть администратором (или хотя бы участником) исходного канала,
 * иначе апдейты о новых постах ему не придут. В целевой чат он должен иметь
 * право писать.
 */
export const registerForwarder = (
    dp: Dispatcher,
    client: TelegramClient,
    fromChatId: number,
    toChatId: number,
): void => {
    const forward = async (ids: number[]): Promise<void> => {
        try {
            await client.forwardMessagesById({
                fromChatId,
                toChatId,
                messages: ids,
            })
        } catch (err) {
            console.error(`[forward] failed to forward messages ${ids.join(',')} from ${fromChatId} to ${toChatId}:`, err)
        }
    }

    dp.onNewMessage(async (msg) => {
        if (Number(msg.chat.id) !== fromChatId) return PropagationAction.Continue
        await forward([msg.id])
        return PropagationAction.Continue
    })

    // Альбомы (media group) приходят отдельным апдейтом пачкой — форвардим все id
    // одним вызовом, чтобы в целевом чате они тоже остались единым альбомом.
    dp.onMessageGroup(async (msg) => {
        if (Number(msg.chat.id) !== fromChatId) return PropagationAction.Continue
        await forward(msg.messages.map((m) => m.id))
        return PropagationAction.Continue
    })
}

/** Парсит id чата из переменной окружения. Возвращает null, если переменная пуста или некорректна. */
export const parseChatId = (raw: string | undefined): number | null => {
    if (!raw) return null
    const trimmed = raw.trim()
    if (!/^-?\d+$/.test(trimmed)) return null
    return Number(trimmed)
}
