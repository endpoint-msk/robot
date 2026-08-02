import type { ChatMemberStatus, TelegramClient } from '@mtcute/node'
import { displayName } from './hosting.js'
import type { HostingUser } from './types.js'

/**
 * Директория резидентов — единственный источник правды о том, кто резидент и кто
 * вправе выполнять админ-команды. Сейчас реализована поверх Telegram
 * (резидент = админ/владелец **отдельного чата резидентов**, `RESIDENTS_CHAT_ID`),
 * но весь остальной код (handlers/presence/menu/dues) обращается только к этому
 * интерфейсу. Когда придёт Authentik, поменяется лишь реализация ниже —
 * вызывающие места трогать не надо.
 */
export interface ResidentDirectory {
    /** Является ли пользователь резидентом (проходит ли identity-проверку вообще). */
    isResident(userId: number): Promise<boolean>

    /**
     * Все резиденты с именами — состав чата резидентов.
     *
     * Живёт здесь, а не в hosting.ts, по тому же принципу, что и остальные вопросы
     * про резидентство: список плательщиков взносов, адресаты рассылок и кандидаты
     * «позвать в спейс» должны браться из одного места, иначе смена источника
     * (Authentik) потребует обхода всех вызывающих.
     */
    list(): Promise<HostingUser[]>

    /** Только userId — для рассылок, где имена не нужны. */
    listIds(): Promise<Set<number>>

    /**
     * Чаты, в которых нужно показывать присутствие этого резидента.
     *
     * Для резидента это все allowlist-чаты: бот работает в них, и присутствие имеет
     * смысл показывать везде, где он работает. Для не-резидента — пустой список, и
     * вызывающие места используют это как гейт «резидент ли». Метод специально
     * назван по вопросу, а не по механике: с Authentik ответ будет считаться иначе.
     */
    presenceChats(userId: number): Promise<number[]>

    /** Вправе ли пользователь выполнять админ-команды в конкретном чате. */
    isChatAdmin(chatId: number, userId: number): Promise<boolean>

    /**
     * Состоит ли пользователь хотя бы в одном allowlist-чате (и не забанен там).
     *
     * Это аудитория «свои»: шире резидентов, но уже, чем «любой, кто нашёл бота».
     * Ею гейтятся личные ответы, дублирующие групповые команды (`/inside`, `/printer`):
     * в группе их видят участники чата, значит и в личке — те же люди, а не весь Telegram.
     */
    isMember(userId: number): Promise<boolean>

    /**
     * Доступ к миниаппу одним вопросом: резидент ли, участник ли и не забанен ли.
     *
     * Отдельный метод, а не три вызова, потому что все ответы берутся из одного и
     * того же обхода allowlist-чатов — раздельные вызовы умножили бы количество
     * round-trip'ов в Telegram на каждый запрос миниаппа.
     */
    access(userId: number): Promise<{ resident: boolean; member: boolean; banned: boolean }>
}

/**
 * Реализация поверх Telegram: резидент = админ/владелец **чата резидентов**
 * (`residentsChatId`), админ-проверка — живой `getChatMember` на каждый вопрос
 * (без кэша, как и раньше).
 *
 * `residentsChatId === null` — чат не задан, и мы откатываемся на прежнее правило
 * «админ любого allowlist-чата». Иначе забытая переменная окружения означала бы
 * «резидентов нет вообще», то есть мгновенно выключала бы половину бота.
 */
export const createTelegramResidentDirectory = (
    client: TelegramClient,
    allowedChats: ReadonlySet<number>,
    residentsChatId: number | null,
): ResidentDirectory => {
    /** Где искать резидентов: выделенный чат либо, если он не задан, весь allowlist. */
    const residentChats: ReadonlySet<number> =
        residentsChatId !== null ? new Set([residentsChatId]) : allowedChats
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

    // `restricted` — это тоже участник: mtcute отдаёт его для channelParticipantBanned
    // без viewMessages, то есть человек в чате, просто урезан в правах. `left`/`banned`/
    // null участниками не считаются.
    const isMemberStatus = (status: ChatMemberStatus | null): boolean =>
        isAdminStatus(status) || status === 'member' || status === 'restricted'

    // Чаты опрашиваем параллельно: кэша нет, каждый ответ — round-trip в Telegram, а
    // access висит на каждом запросе миниаппа. Последовательный цикл складывал
    // задержки чатов в одну и заметно тормозил API.
    const statuses = async (userId: number): Promise<{ chatId: number; status: ChatMemberStatus | null }[]> => {
        const chats = [...allowedChats]
        const list = await Promise.all(chats.map((chatId) => statusIn(chatId, userId)))
        return chats.map((chatId, i) => ({ chatId, status: list[i] ?? null }))
    }

    /** Права на админ-команды в конкретном чате: это про чат, а не про резидентство. */
    const isChatAdmin = async (chatId: number, userId: number): Promise<boolean> =>
        isAdminStatus(await statusIn(chatId, userId))

    /** Резидент = админ чата резидентов. Опрашиваем только его, не весь allowlist. */
    const isResident = async (userId: number): Promise<boolean> => {
        const checks = await Promise.all([...residentChats].map((chatId) => statusIn(chatId, userId)))
        return checks.some(isAdminStatus)
    }

    // Присутствие показываем во всех чатах, где бот работает: резидентство больше не
    // привязано к конкретному чату, а доска и списки живут в allowlist-чатах.
    const presenceChats = async (userId: number): Promise<number[]> =>
        (await isResident(userId)) ? [...allowedChats] : []

    // Бан хотя бы в одном allowlist-чате = бан везде: blockUser банит сразу во всех,
    // а ручной бан админом в главном чате — такой же «персона нон грата» для спейса.
    const access = async (userId: number): Promise<{ resident: boolean; member: boolean; banned: boolean }> => {
        // Резидентство и членство считаются по разным множествам чатов, поэтому запрос
        // один, но параллельный: последовательные round-trip'ы висли бы на каждом
        // запросе миниаппа.
        const [all, resident] = await Promise.all([statuses(userId), isResident(userId)])
        const banned = all.some((s) => s.status === 'banned')
        return {
            resident,
            // Бан перевешивает членство: забаненный в одном чате мог остаться участником
            // другого, но «своим» он уже не считается.
            member: !banned && all.some((s) => isMemberStatus(s.status)),
            banned,
        }
    }

    const isMember = async (userId: number): Promise<boolean> => (await access(userId)).member

    /**
     * Состав чата резидентов: админы и создатель, без ботов. Живой запрос без кэша,
     * как и остальные проверки. Дубли (если чатов несколько, то есть при откате на
     * allowlist) схлопываем по userId — первое вхождение выигрывает.
     */
    const list = async (): Promise<HostingUser[]> => {
        const out = new Map<number, HostingUser>()
        for (const chatId of residentChats) {
            try {
                const members = await client.getChatMembers(chatId, { type: 'admins' })
                for (const m of members) {
                    if (m.status !== 'admin' && m.status !== 'creator') continue
                    if (m.user.type !== 'user' || m.user.isBot) continue
                    if (out.has(m.user.id)) continue
                    out.set(m.user.id, {
                        userId: m.user.id,
                        username: m.user.username ?? null,
                        name: displayName(m.user.displayName),
                    })
                }
            } catch (err) {
                console.warn(`[residents] не удалось получить админов чата ${chatId}:`, err)
            }
        }
        return [...out.values()]
    }

    const listIds = async (): Promise<Set<number>> => new Set((await list()).map((r) => r.userId))

    return { isResident, list, listIds, presenceChats, isChatAdmin, isMember, access }
}
