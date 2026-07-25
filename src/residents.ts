import type { ChatMemberStatus, TelegramClient } from '@mtcute/node'

/**
 * Директория резидентов — единственный источник правды о том, кто резидент и кто
 * вправе выполнять админ-команды. Сейчас реализована поверх Telegram
 * (резидент = админ/владелец одного из allowlist-чатов), но весь остальной код
 * (handlers/presence/menu) обращается только к этому интерфейсу. Когда придёт
 * Authentik, поменяется лишь реализация ниже — вызывающие места трогать не надо.
 */
export interface ResidentDirectory {
    /** Является ли пользователь резидентом (проходит ли identity-проверку вообще). */
    isResident(userId: number): Promise<boolean>

    /**
     * Чаты, в которых нужно показывать присутствие этого резидента.
     *
     * Сейчас это «чаты, где он админ», поэтому вопрос совпадает с identity. С
     * переходом на Authentik совпадение исчезнет: Authentik не знает про Telegram-чаты,
     * и «где показывать присутствие» станет отдельным решением (все allowlist-чаты
     * либо явный маппинг). Метод специально назван по вопросу, а не по механике.
     */
    presenceChats(userId: number): Promise<number[]>

    /** Вправе ли пользователь выполнять админ-команды в конкретном чате. */
    isChatAdmin(chatId: number, userId: number): Promise<boolean>

    /**
     * Доступ к миниаппу одним вопросом: резидент ли и не забанен ли.
     *
     * Отдельный метод, а не `isResident` + `isBanned`, потому что оба ответа берутся
     * из одного и того же обхода allowlist-чатов — раздельные вызовы удвоили бы
     * количество round-trip'ов в Telegram на каждый запрос миниаппа.
     */
    access(userId: number): Promise<{ resident: boolean; banned: boolean }>
}

/**
 * Реализация поверх Telegram: резидент = админ/владелец одного из allowlist-чатов,
 * админ-проверка — живой `getChatMember` на каждый вопрос (без кэша, как и раньше).
 */
export const createTelegramResidentDirectory = (
    client: TelegramClient,
    allowedChats: ReadonlySet<number>,
): ResidentDirectory => {
    /** Статус участника в чате; null — нет доступа / он там не состоял вовсе. */
    const statusIn = async (chatId: number, userId: number): Promise<ChatMemberStatus | null> => {
        try {
            const member = await client.getChatMember({ chatId, userId })
            return member?.status ?? null
        } catch {
            // нет доступа / нет такого пользователя в чате
            return null
        }
    }

    const isAdminStatus = (status: ChatMemberStatus | null): boolean =>
        status === 'admin' || status === 'creator'

    // Чаты опрашиваем параллельно: кэша нет, каждый ответ — round-trip в Telegram, а
    // access висит на каждом запросе миниаппа. Последовательный цикл складывал
    // задержки чатов в одну и заметно тормозил API.
    const statuses = async (userId: number): Promise<{ chatId: number; status: ChatMemberStatus | null }[]> => {
        const chats = [...allowedChats]
        const list = await Promise.all(chats.map((chatId) => statusIn(chatId, userId)))
        return chats.map((chatId, i) => ({ chatId, status: list[i] ?? null }))
    }

    const isChatAdmin = async (chatId: number, userId: number): Promise<boolean> =>
        isAdminStatus(await statusIn(chatId, userId))

    const adminChats = async (userId: number): Promise<number[]> =>
        (await statuses(userId)).filter((s) => isAdminStatus(s.status)).map((s) => s.chatId)

    const presenceChats = adminChats

    const isResident = async (userId: number): Promise<boolean> => (await adminChats(userId)).length > 0

    // Бан хотя бы в одном allowlist-чате = бан везде: blockUser банит сразу во всех,
    // а ручной бан админом в главном чате — такой же «персона нон грата» для спейса.
    const access = async (userId: number): Promise<{ resident: boolean; banned: boolean }> => {
        const all = await statuses(userId)
        return {
            resident: all.some((s) => isAdminStatus(s.status)),
            banned: all.some((s) => s.status === 'banned'),
        }
    }

    return { isResident, presenceChats, isChatAdmin, access }
}
