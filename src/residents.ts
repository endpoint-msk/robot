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
/**
 * Состав резидентов вместе с признаком «список полный».
 *
 * `complete: false` - обход состава оборвался (флуд-вейт, бот перестал быть админом
 * чата резидентов), и в `users` лежит то, что успели собрать. Признак обязателен,
 * потому что по этому списку синхронизируется ростер взносов: раньше `list()` отдавал
 * частичный результат неотличимо от полного, и один сбойный запрос вычёркивал людей
 * из открытого периода - а на этом снимке потом считается просрочка.
 */
export type ResidentRoster = {
    users: HostingUser[]
    complete: boolean
}

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
    list(): Promise<ResidentRoster>

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

    /**
     * Сбрасывает закэшированные ответы: про конкретного человека либо про всех.
     *
     * Нужен там, где мы сами меняем права и не можем ждать истечения TTL: блокировка
     * и разблокировка участника. Реализация без кэша делает no-op.
     */
    invalidate(userId?: number): void
}

/**
 * Сколько живёт ответ Telegram про участие в чате.
 *
 * Минута - компромисс: `access()` висит на каждом запросе миниаппа и на каждом тапе
 * меню, а один запрос - это `getChatMember` по каждому allowlist-чату плюс чат
 * резидентов, всё через тот же mtcute-клиент, которым бот отвечает в чатах. Без кэша
 * лента афиш и пара открытых миниаппов упирались во FLOOD_WAIT, а он кладёт бота
 * целиком. Отставание в минуту допустимо: блокировку мы инвалидируем руками, а
 * ручной бан в Telegram - редкое событие, и минута задержки его не спасает и не портит.
 */
const MEMBER_TTL_MS = 60_000
/** Состав чата резидентов меняется куда реже, чем спрашивается (рассылки, ростер взносов, «позвать в спейс»). */
const ROSTER_TTL_MS = 5 * 60_000
/** С какого размера подчищаем протухшие записи - чтобы Map не рос по числу заглянувших. */
const SWEEP_AT = 512

/**
 * Определённый ответ сервера (`USER_NOT_PARTICIPANT`, `CHAT_ADMIN_REQUIRED` и т. п.)
 * против сетевого сбоя: у RpcError код лежит в `.text`.
 *
 * Кэшируем только определённые: иначе одна потеря пакета запирала бы человека снаружи
 * миниаппа на целую минуту.
 */
const isDefiniteError = (err: unknown): boolean => typeof (err as { text?: unknown } | null)?.text === 'string'

/**
 * Реализация поверх Telegram: резидент = **участник чата резидентов**
 * (`residentsChatId`), кроме ботов. Не админ: админство в Telegram про модерацию,
 * а состав спейса про членство, и держать их синонимами значит выдавать права
 * резидента вместе с правом удалять сообщения.
 *
 * Проверки живые, без кэша: `getChatMember` на каждый вопрос.
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
    /**
     * Потолок на выгрузку состава. Больше 200 участников супергруппы Telegram боту
     * за проход всё равно не отдаст, но пусть ограничение будет явным.
     */
    const MAX_RESIDENTS = 500

    /** Кэш ответов про участие: ключ - `${chatId}#${userId}`. */
    const statusCache = new Map<string, { status: ChatMemberStatus | null; at: number }>()
    /** Запросы в полёте: два параллельных вопроса об одном человеке - один round-trip. */
    const inFlight = new Map<string, Promise<ChatMemberStatus | null>>()
    let roster: { value: ResidentRoster; at: number } | null = null
    let rosterInFlight: Promise<ResidentRoster> | null = null

    const sweep = (now: number): void => {
        if (statusCache.size < SWEEP_AT) return
        for (const [key, hit] of statusCache) {
            if (now - hit.at >= MEMBER_TTL_MS) statusCache.delete(key)
        }
    }

    const invalidate = (userId?: number): void => {
        if (userId === undefined) {
            statusCache.clear()
            roster = null
            return
        }
        const suffix = `#${userId}`
        for (const key of statusCache.keys()) {
            if (key.endsWith(suffix)) statusCache.delete(key)
        }
    }

    /** Статус участника в чате; null — нет доступа / он там не состоял вовсе. */
    const statusIn = async (chatId: number, userId: number): Promise<ChatMemberStatus | null> => {
        const key = `${chatId}#${userId}`
        const now = Date.now()
        const hit = statusCache.get(key)
        if (hit && now - hit.at < MEMBER_TTL_MS) return hit.status
        const pending = inFlight.get(key)
        if (pending) return pending

        const request = (async (): Promise<ChatMemberStatus | null> => {
            try {
                const member = await client.getChatMember({ chatId, userId })
                const status = member?.status ?? null
                statusCache.set(key, { status, at: Date.now() })
                return status
            } catch (err) {
                // нет доступа / нет такого пользователя в чате
                if (isDefiniteError(err)) statusCache.set(key, { status: null, at: Date.now() })
                return null
            } finally {
                inFlight.delete(key)
                sweep(Date.now())
            }
        })()
        inFlight.set(key, request)
        return request
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

    /**
     * Резидент = участник чата резидентов. Чат не задан — откат на прежнее правило
     * «админ любого allowlist-чата».
     */
    const isResident = async (userId: number): Promise<boolean> => {
        if (residentsChatId === null) {
            return (await statuses(userId)).some((s) => isAdminStatus(s.status))
        }
        return isMemberStatus(await statusIn(residentsChatId, userId))
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
     * Состав чата резидентов: все участники, кроме ботов и вышедших.
     *
     * Чтобы читать состав, бот должен быть админом этого чата: обычному участнику
     * Telegram список участников супергруппы не отдаёт. Не смогли прочитать — пишем
     * в лог и возвращаем что есть: ростер взносов и рассылки переживут неполный
     * список лучше, чем упавший вызов.
     *
     * При откате на allowlist (чат не задан) берём только админов: это прежнее
     * правило, и оно не должно превращаться в «все участники всех чатов».
     */
    const fetchRoster = async (): Promise<ResidentRoster> => {
        const out = new Map<number, HostingUser>()
        let complete = true
        const add = (user: { id: number; type: string; isBot: boolean; username: string | null; displayName: string }): void => {
            if (user.type !== 'user' || user.isBot) return
            if (out.has(user.id)) return
            out.set(user.id, {
                userId: user.id,
                username: user.username ?? null,
                name: displayName(user.displayName),
            })
        }

        if (residentsChatId !== null) {
            try {
                for await (const m of client.iterChatMembers(residentsChatId, { limit: MAX_RESIDENTS })) {
                    if (m.status === 'left' || m.status === 'banned') continue
                    add(m.user)
                }
            } catch (err) {
                console.warn(`[residents] не удалось получить участников чата ${residentsChatId}:`, err)
                complete = false
            }
            return { users: [...out.values()], complete }
        }

        for (const chatId of allowedChats) {
            try {
                const members = await client.getChatMembers(chatId, { type: 'admins' })
                for (const m of members) {
                    if (m.status !== 'admin' && m.status !== 'creator') continue
                    add(m.user)
                }
            } catch (err) {
                console.warn(`[residents] не удалось получить админов чата ${chatId}:`, err)
                complete = false
            }
        }
        return { users: [...out.values()], complete }
    }

    const list = async (): Promise<ResidentRoster> => {
        const now = Date.now()
        if (roster && now - roster.at < ROSTER_TTL_MS) return roster.value
        if (rosterInFlight) return rosterInFlight
        rosterInFlight = (async () => {
            try {
                const value = await fetchRoster()
                // Неполный список не закрепляем на пять минут: следующий вызов должен
                // попробовать снова, иначе один флуд-вейт замораживает урезанный состав.
                if (value.complete) roster = { value, at: Date.now() }
                return value
            } finally {
                rosterInFlight = null
            }
        })()
        return rosterInFlight
    }

    const listIds = async (): Promise<Set<number>> => new Set((await list()).users.map((r) => r.userId))

    return { isResident, list, listIds, presenceChats, isChatAdmin, isMember, access, invalidate }
}
