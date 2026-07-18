import type { TelegramClient } from '@mtcute/node'

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
}

/**
 * Реализация поверх Telegram: резидент = админ/владелец одного из allowlist-чатов,
 * админ-проверка — живой `getChatMember` на каждый вопрос (без кэша, как и раньше).
 */
export const createTelegramResidentDirectory = (
    client: TelegramClient,
    allowedChats: ReadonlySet<number>,
): ResidentDirectory => {
    const isChatAdmin = async (chatId: number, userId: number): Promise<boolean> => {
        try {
            const member = await client.getChatMember({ chatId, userId })
            if (!member) return false
            return member.status === 'admin' || member.status === 'creator'
        } catch {
            // нет доступа / нет такого пользователя в чате — считаем, что не админ
            return false
        }
    }

    // Чаты опрашиваем параллельно: кэша нет, каждый ответ — round-trip в Telegram, а
    // isResident висит на каждом запросе миниаппа. Последовательный цикл складывал
    // задержки чатов в одну и заметно тормозил API.
    const adminChats = async (userId: number): Promise<number[]> => {
        const chats = [...allowedChats]
        const flags = await Promise.all(chats.map((chatId) => isChatAdmin(chatId, userId)))
        return chats.filter((_, i) => flags[i])
    }

    const presenceChats = adminChats

    const isResident = async (userId: number): Promise<boolean> => (await adminChats(userId)).length > 0

    return { isResident, presenceChats, isChatAdmin }
}
