import { BotKeyboard, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import type { Storage } from './storage.js'
import type { ResidentPresence } from './types.js'

/** Длительность тишины в чате, после которой постим список присутствующих (5 часов). */
export const CHAT_SILENCE_MS = 5 * 60 * 60 * 1000
/** Период напоминаний резиденту в личку (3 часа). */
export const PRESENCE_PING_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Сколько ждём ответа на ping, прежде чем снять отметку (15 минут). */
export const PRESENCE_PING_TIMEOUT_MS = 15 * 60 * 1000
/** Как часто крутим планировщик. */
const TICK_INTERVAL_MS = 60 * 1000

const CB_CHECKIN_NICK = 'presence:checkin:nick'
const CB_CHECKIN_ANON = 'presence:checkin:anon'
const CB_CHECKOUT = 'presence:checkout'
const CB_CONFIRM = 'presence:confirm'

const ANON_LABEL = 'Без ника'

const startMenuKeyboard = () =>
    BotKeyboard.inline([
        [BotKeyboard.callback('Отметиться с ником', CB_CHECKIN_NICK)],
        [BotKeyboard.callback('Отметиться без ника', CB_CHECKIN_ANON)],
    ])

const checkedInKeyboard = () =>
    BotKeyboard.inline([
        [BotKeyboard.callback('Уйти / снять отметку', CB_CHECKOUT)],
    ])

const pingKeyboard = () =>
    BotKeyboard.inline([
        [BotKeyboard.callback('Я внутри', CB_CONFIRM)],
        [BotKeyboard.callback('Уйти', CB_CHECKOUT)],
    ])

/** Возвращает список chatId из allowedChats, в которых данный пользователь — админ. */
const findChatsWhereUserIsAdmin = async (
    client: TelegramClient,
    allowed: ReadonlySet<number>,
    userId: number,
): Promise<number[]> => {
    const result: number[] = []
    for (const chatId of allowed) {
        try {
            const member = await client.getChatMember({ chatId, userId })
            if (member && (member.status === 'admin' || member.status === 'creator')) {
                result.push(chatId)
            }
        } catch {
            // нет доступа / нет такого пользователя в чате — пропускаем
        }
    }
    return result
}

const buildPresenceMessage = (presents: ResidentPresence[]): string => {
    const named = presents.filter((p) => p.username)
    const lines: string[] = []
    lines.push(`Внутри [${presents.length}], отметились [${named.length}]:`)
    for (const p of named) {
        lines.push(`@${p.username}`)
    }
    return lines.join('\n')
}

/**
 * Постит список присутствующих в чат.
 *
 * - `mode: 'edit'` (по умолчанию) — если есть сохранённое сообщение, редактирует его,
 *   иначе отправляет новое и запоминает id.
 * - `mode: 'new'` — всегда отправляет новое сообщение и обновляет id (используется
 *   при долгой тишине в чате, чтобы напоминание реально всплыло наверх).
 */
export const upsertPresenceListInChat = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    mode: 'edit' | 'new' = 'edit',
): Promise<void> => {
    const presents = Object.values(storage.get().presence)
    const text = presents.length > 0
        ? buildPresenceMessage(presents)
        : 'Внутри [0], отметились [0]:'

    const existingId = storage.get().presenceListMessages[String(chatId)]

    if (mode === 'edit' && existingId) {
        try {
            await client.editMessage({ chatId, message: existingId, text })
            return
        } catch (err) {
            const msg = (err as Error)?.message ?? ''
            if (/MESSAGE_NOT_MODIFIED/i.test(msg)) return
            if (!/MESSAGE_ID_INVALID|MESSAGE_DELETE|MESSAGE_AUTHOR_REQUIRED|MESSAGE_EDIT_TIME_EXPIRED/i.test(msg)) {
                console.error(`[presence] edit failed in chat ${chatId}:`, err)
                return
            }
            // редактировать нечего — забываем id и отправим новое сообщение
            await storage.update((s) => {
                delete s.presenceListMessages[String(chatId)]
            })
        }
    }

    try {
        const sent = await client.sendText(chatId, text)
        await storage.update((s) => {
            s.presenceListMessages[String(chatId)] = sent.id
            s.chatLastActivity[String(chatId)] = new Date().toISOString()
        })
    } catch (err) {
        console.error(`[presence] failed to post list to chat ${chatId}:`, err)
    }
}

/**
 * Снимает отметку с резидента и постит обновлённый список во все чаты,
 * где он был админом.
 */
const removePresence = async (
    client: TelegramClient,
    storage: Storage,
    allowed: ReadonlySet<number>,
    userId: number,
    reason: 'manual' | 'timeout',
): Promise<void> => {
    const present = storage.get().presence[String(userId)]
    if (!present) return
    await storage.update((s) => {
        delete s.presence[String(userId)]
    })

    const chats = await findChatsWhereUserIsAdmin(client, allowed, userId)
    for (const chatId of chats) {
        await upsertPresenceListInChat(client, storage, chatId)
    }

    if (reason === 'timeout') {
        try {
            await client.sendText(userId, 'Не получил подтверждение за 15 минут — снял отметку. Если ты ещё внутри, нажми /start.')
        } catch {
            // личка может быть закрыта — ничего страшного
        }
    }
}

const checkInResident = async (
    client: TelegramClient,
    storage: Storage,
    allowed: ReadonlySet<number>,
    user: { id: number; username: string | null; displayName: string },
    mode: 'nick' | 'anon',
): Promise<{ chats: number[]; alreadyChecked: boolean }> => {
    const chats = await findChatsWhereUserIsAdmin(client, allowed, user.id)
    if (chats.length === 0) return { chats: [], alreadyChecked: false }

    const now = new Date().toISOString()
    const existing = storage.get().presence[String(user.id)]
    const useNick = mode === 'nick' && !!user.username

    const presence: ResidentPresence = {
        userId: user.id,
        displayLabel: useNick && user.username ? `@${user.username}` : ANON_LABEL,
        username: useNick ? user.username : null,
        checkedInAt: existing?.checkedInAt ?? now,
        lastConfirmedAt: now,
        pendingPingAt: null,
    }
    await storage.update((s) => {
        s.presence[String(user.id)] = presence
    })

    for (const chatId of chats) {
        await upsertPresenceListInChat(client, storage, chatId)
    }
    return { chats, alreadyChecked: !!existing }
}

export const registerPresenceHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        allowedChats: ReadonlySet<number>
    },
): void => {
    const { client, storage, allowedChats } = deps

    // /start в личке — открываем меню. В групповом чате /start уже перехватывается /help.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('start')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const adminChats = await findChatsWhereUserIsAdmin(client, allowedChats, msg.sender.id)
        if (adminChats.length === 0) {
            await msg.answerText('Этот бот доступен только резидентам (админам подключённого чата).')
            return
        }
        const present = storage.get().presence[String(msg.sender.id)]
        if (present) {
            await msg.answerText(
                `Ты уже отмечен как «${present.displayLabel}». Если уходишь — нажми кнопку ниже.`,
                { replyMarkup: checkedInKeyboard() },
            )
            return
        }
        await msg.answerText(
            'Привет! Отметься, чтобы остальные видели, что ты в спейсе.',
            { replyMarkup: startMenuKeyboard() },
        )
    })

    // Любое входящее сообщение в личке от резидента, у которого открыт ping —
    // не считается подтверждением (по решению пользователя ответом считается только кнопка).
    // Но мы всё же отслеживаем активность групповых чатов отдельно (см. trackChatActivity).

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null) return
        const isOurs =
            data === CB_CHECKIN_NICK ||
            data === CB_CHECKIN_ANON ||
            data === CB_CHECKOUT ||
            data === CB_CONFIRM
        if (!isOurs) return PropagationAction.Continue

        if (data === CB_CHECKIN_NICK || data === CB_CHECKIN_ANON) {
            const user = ctx.user
            if (user.username == null && data === CB_CHECKIN_NICK) {
                await ctx.answer({
                    text: 'У тебя нет username — отметься «без ника».',
                    alert: true,
                })
                return
            }
            const res = await checkInResident(
                client, storage, allowedChats,
                { id: user.id, username: user.username, displayName: user.displayName },
                data === CB_CHECKIN_NICK ? 'nick' : 'anon',
            )
            if (res.chats.length === 0) {
                await ctx.answer({ text: 'Ты не админ ни в одном из подключённых чатов.', alert: true })
                return
            }
            const present = storage.get().presence[String(user.id)]!
            try {
                await ctx.editMessage({
                    text: `Готово, отметил тебя как «${present.displayLabel}». Каждые 3 часа буду спрашивать, ты ещё внутри. Если уходишь — нажми кнопку ниже.`,
                    replyMarkup: checkedInKeyboard(),
                })
            } catch {
                // если редактировать нечего (например, прислал /start заново) — игнор
            }
            await ctx.answer({ text: res.alreadyChecked ? 'Обновил отметку' : 'Отметил' })
            return
        }

        if (data === CB_CHECKOUT) {
            const present = storage.get().presence[String(ctx.user.id)]
            if (!present) {
                await ctx.answer({ text: 'Ты и так не отмечен.' })
                try {
                    await ctx.editMessage({
                        text: 'Ты не отмечен. Нажми /start чтобы отметиться.',
                    })
                } catch {}
                return
            }
            await removePresence(client, storage, allowedChats, ctx.user.id, 'manual')
            await ctx.answer({ text: 'Снял отметку' })
            try {
                await ctx.editMessage({
                    text: 'Снял отметку. Возвращайся 👋 — нажми /start, когда снова в спейсе.',
                })
            } catch {}
            return
        }

        if (data === CB_CONFIRM) {
            const present = storage.get().presence[String(ctx.user.id)]
            if (!present) {
                await ctx.answer({ text: 'Отметки нет — нажми /start.' })
                return
            }
            const now = new Date().toISOString()
            await storage.update((s) => {
                const p = s.presence[String(ctx.user.id)]
                if (p) {
                    p.lastConfirmedAt = now
                    p.pendingPingAt = null
                }
            })
            await ctx.answer({ text: 'Принял, ты внутри.' })
            try {
                await ctx.editMessage({
                    text: `Подтвердил, ты внутри. Спрошу снова через 3 часа.`,
                    replyMarkup: checkedInKeyboard(),
                })
            } catch {}
            return
        }
    })
}

/**
 * Регистрирует подписку на сообщения в групповых чатах для отслеживания «тишины».
 * В режим тишины уходим, если в чате никто не пишет CHAT_SILENCE_MS подряд,
 * а в чате есть хотя бы один отмеченный резидент.
 */
export const registerChatActivityTracker = (
    dp: Dispatcher,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
): void => {
    dp.onNewMessage(async (msg) => {
        const chatId = Number(msg.chat.id)
        if (!allowedChats.has(chatId)) return PropagationAction.Continue
        if (msg.isOutgoing) return PropagationAction.Continue
        await storage.update((s) => {
            s.chatLastActivity[String(chatId)] = new Date().toISOString()
        })
        // Не глотаем сообщение — пусть командные обработчики тоже видят его.
        return PropagationAction.Continue
    })
}

/**
 * Подписка на удаление сообщений: если удалили наше «последнее сообщение со списком»,
 * забываем его id и сразу постим новое (если есть отмеченные).
 */
export const registerPresenceDeleteWatcher = (
    dp: Dispatcher,
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
): void => {
    dp.onDeleteMessage(async (upd) => {
        const ids = new Set(upd.messageIds)
        const channelId = upd.channelId
        const candidates: number[] = []
        const map = storage.get().presenceListMessages
        for (const [chatIdStr, messageId] of Object.entries(map)) {
            if (!ids.has(messageId)) continue
            const chatId = Number(chatIdStr)
            if (!allowedChats.has(chatId)) continue
            // У супергрупп/каналов update'ы привязаны к channelId; у обычных групп он null
            // и удаления приходят глобально по сообщению — поэтому если channelId есть,
            // сравниваем с положительной формой (chatId у супергрупп — отрицательный с префиксом).
            if (channelId !== null) {
                // chatId хранится в «marked» виде (-100xxxxxxxxxx); channelId — без префикса.
                // Простейший матчинг: проверим, что -1000000000000 - channelId == chatId.
                const expected = -1000000000000 - channelId
                if (expected !== chatId) continue
            }
            candidates.push(chatId)
        }
        if (candidates.length === 0) return PropagationAction.Continue

        for (const chatId of candidates) {
            await storage.update((s) => {
                delete s.presenceListMessages[String(chatId)]
            })
            if (Object.keys(storage.get().presence).length > 0) {
                await upsertPresenceListInChat(client, storage, chatId, 'new')
            }
        }
        return PropagationAction.Continue
    })
}

/** Запускает таймер: пинги резидентам, обработка таймаутов, авто-постинг при тишине. */
export const startPresenceScheduler = (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
): { stop: () => void } => {
    const tick = async () => {
        const now = Date.now()

        // 0) Страховка: если в чате с отмеченными «последнее сообщение со списком»
        //    физически удалено (а onDeleteMessage не пришёл) — забываем его id, чтобы
        //    при следующей же отметке либо при тишине отправилось новое.
        if (Object.keys(storage.get().presence).length > 0) {
            const ids = storage.get().presenceListMessages
            for (const [chatIdStr, messageId] of Object.entries(ids)) {
                const chatId = Number(chatIdStr)
                if (!allowedChats.has(chatId)) continue
                try {
                    const [m] = await client.getMessages(chatId, messageId)
                    if (m == null) {
                        await storage.update((s) => {
                            delete s.presenceListMessages[String(chatId)]
                        })
                        // Сразу постим новый список, чтобы участники чата его увидели.
                        await upsertPresenceListInChat(client, storage, chatId, 'new')
                    }
                } catch (err) {
                    // Не удалось проверить — не критично, попробуем на следующем тике.
                    console.warn(`[presence] getMessages probe failed in chat ${chatId}:`, err)
                }
            }
        }

        // 1) Пинги и таймауты по каждому отмеченному резиденту
        const presents = Object.values(storage.get().presence)
        for (const p of presents) {
            const lastConfirmed = Date.parse(p.lastConfirmedAt)
            if (p.pendingPingAt) {
                const pingedAt = Date.parse(p.pendingPingAt)
                if (now - pingedAt >= PRESENCE_PING_TIMEOUT_MS) {
                    await removePresence(client, storage, allowedChats, p.userId, 'timeout')
                }
            } else if (now - lastConfirmed >= PRESENCE_PING_INTERVAL_MS) {
                // отправляем ping в личку
                try {
                    await client.sendText(p.userId, 'Ты ещё в спейсе? Подтверди в течение 15 минут — иначе сниму отметку.', {
                        replyMarkup: pingKeyboard(),
                    })
                    await storage.update((s) => {
                        const cur = s.presence[String(p.userId)]
                        if (cur) cur.pendingPingAt = new Date().toISOString()
                    })
                } catch (err) {
                    // Не смогли написать в личку — снимаем отметку, чтобы не висел вечно.
                    console.warn(`[presence] cannot DM user ${p.userId}, removing presence:`, err)
                    await removePresence(client, storage, allowedChats, p.userId, 'timeout')
                }
            }
        }

        // 2) Тишина в чатах: если есть отмеченные и в чате нет сообщений >= 5 часов — постим список
        if (Object.keys(storage.get().presence).length > 0) {
            const lastActivity = storage.get().chatLastActivity
            for (const chatId of allowedChats) {
                const ts = lastActivity[String(chatId)]
                const last = ts ? Date.parse(ts) : 0
                if (now - last >= CHAT_SILENCE_MS) {
                    await upsertPresenceListInChat(client, storage, chatId, 'new')
                }
            }
        }
    }

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[presence] tick error:', err))
    }, TICK_INTERVAL_MS)

    return { stop: () => clearInterval(handle) }
}
