import { filters, PropagationAction, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import type { TelegramClient } from '@mtcute/node'

/**
 * Гард для «живого» чата (LIVE_CHAT_ID): любого, кто пытается зайти, кикает
 * (без занесения в ЧС — через kickChatMember = ban+unban) и удаляет служебные
 * сообщения о входе и о последующем кике.
 *
 * Бот должен быть админом этого чата с правом банить и удалять сообщения.
 */
export const registerLiveChatGuard = (
    dp: Dispatcher,
    client: TelegramClient,
    liveChatId: number,
): void => {
    dp.onNewMessage(
        filters.action(['users_added', 'user_joined_link', 'user_joined_approved']),
        async (msg) => {
            if (Number(msg.chat.id) !== liveChatId) return PropagationAction.Continue

            for (const userId of collectJoinedUserIds(msg)) {
                try {
                    const kickServiceMsg = await client.kickChatMember({ chatId: liveChatId, userId })
                    if (kickServiceMsg) {
                        try {
                            await client.deleteMessages([kickServiceMsg])
                        } catch (err) {
                            console.error(
                                `[livechat] failed to delete kick service message ${kickServiceMsg.id}:`,
                                err,
                            )
                        }
                    }
                } catch (err) {
                    console.error(`[livechat] failed to kick user ${userId} in ${liveChatId}:`, err)
                }
            }

            try {
                await msg.delete()
            } catch (err) {
                console.error(`[livechat] failed to delete join service message ${msg.id}:`, err)
            }
            return PropagationAction.Stop
        },
    )
}

const collectJoinedUserIds = (msg: MessageContext): number[] => {
    const action = msg.action
    if (!action) return []
    if (action.type === 'users_added') return action.users
    // user_joined_link / user_joined_approved — присоединившийся = отправитель служебки
    if (msg.sender && msg.sender.type === 'user') return [msg.sender.id]
    return []
}
