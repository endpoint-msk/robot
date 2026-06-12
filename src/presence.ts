import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import { isValidMac, normalizeMac, type KeeneticClient } from './keenetic.js'
import type { Storage } from './storage.js'
import type { ResidentPresence } from './types.js'

/** Длительность тишины в чате, после которой постим список присутствующих (5 часов). */
export const CHAT_SILENCE_MS = 5 * 60 * 60 * 1000
/** Период напоминаний резиденту в личку (3 часа). */
export const PRESENCE_PING_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Сколько ждём ответа на ping, прежде чем снять отметку (15 минут). */
export const PRESENCE_PING_TIMEOUT_MS = 15 * 60 * 1000
/** Через сколько отсутствия MAC в сети снимаем авто-отметку (10 минут — телефоны «засыпают» в WiFi). */
export const MAC_ABSENCE_GRACE_MS = 10 * 60 * 1000
/** Если предыдущее сообщение со списком в чате было отправлено больше этого срока назад,
 *  при checkin/checkout публикуем новое сообщение, а не редактируем старое (его в истории уже не видно). */
export const PRESENCE_LIST_REPOST_AFTER_MS = 4 * 60 * 60 * 1000
/** Как часто крутим планировщик. */
const TICK_INTERVAL_MS = 60 * 1000

const CB_CHECKIN_NICK = 'presence:checkin:nick'
const CB_CHECKIN_ANON = 'presence:checkin:anon'
const CB_CHECKOUT = 'presence:checkout'
const CB_CONFIRM = 'presence:confirm'
const CB_SETTINGS_NICK = 'presence:settings:nick'
const CB_SETTINGS_ANON = 'presence:settings:anon'

const ANON_LABEL = 'Без ника'

const startMenuKeyboard = () =>
    BotKeyboard.inline([
        [BotKeyboard.callback('Отметиться с ником', CB_CHECKIN_NICK)],
        [BotKeyboard.callback('Отметиться без ника', CB_CHECKIN_ANON)],
    ])

/** Клавиатура настроек авто-отметки по MAC. У текущего выбора — галочка. */
const settingsKeyboard = (anon: boolean) =>
    BotKeyboard.inline([
        [BotKeyboard.callback(`${anon ? '' : '✅ '}С ником`, CB_SETTINGS_NICK)],
        [BotKeyboard.callback(`${anon ? '✅ ' : ''}Без ника`, CB_SETTINGS_ANON)],
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

/**
 * HTML-разметка списка. Ники — t.me-ссылки, а не plain @username: текст-ссылка
 * не является mention-сущностью, поэтому Telegram не пингует упомянутых.
 * Парсить результат через `html()`.
 */
const buildPresenceMessage = (presents: ResidentPresence[]): string => {
    const named = presents.filter((p) => p.username)
    const lines: string[] = []
    lines.push(`Внутри [${presents.length}], отметились [${named.length}]:`)
    for (const p of named) {
        const nick = p.username!
        lines.push(`<a href="https://t.me/${encodeURIComponent(nick)}">@${nick}</a>`)
    }
    return lines.join('<br>')
}

/** Текущий список присутствующих в виде HTML-строки (для прямой отправки, без привязки к сообщению чата). */
export const renderPresenceText = (storage: Storage): string => {
    const presents = Object.values(storage.get().presence)
    return presents.length > 0 ? buildPresenceMessage(presents) : 'Внутри [0], отметились [0]:'
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

    // Если редактирование запросили, но прошлое сообщение со списком было отправлено
    // давно, оно похоронено в истории — апгрейдим до отправки нового, иначе апдейт
    // никто из чата не увидит.
    let effectiveMode = mode
    if (effectiveMode === 'edit' && existingId) {
        const postedAtIso = storage.get().presenceListPostedAt[String(chatId)]
        const postedAt = postedAtIso ? Date.parse(postedAtIso) : 0
        if (!Number.isFinite(postedAt) || Date.now() - postedAt >= PRESENCE_LIST_REPOST_AFTER_MS) {
            effectiveMode = 'new'
        }
    }

    if (effectiveMode === 'edit' && existingId) {
        // onDeleteMessage у бота приходит ненадёжно — перед редактированием пробиваем,
        // что сообщение ещё живо. Иначе восстановление откладывалось бы до тика
        // шедулера (до ~60с).
        try {
            const [probe] = await client.getMessages(chatId, existingId)
            if (probe == null) {
                await storage.update((s) => {
                    delete s.presenceListMessages[String(chatId)]
                    delete s.presenceListPostedAt[String(chatId)]
                })
                effectiveMode = 'new'
            }
        } catch (err) {
            console.warn(`[presence] getMessages probe failed in chat ${chatId}:`, err)
        }
    }

    if (effectiveMode === 'edit' && existingId) {
        try {
            await client.editMessage({ chatId, message: existingId, text: html(text), disableWebPreview: true })
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
                delete s.presenceListPostedAt[String(chatId)]
            })
        }
    }

    try {
        const sent = await client.sendText(chatId, html(text), { disableWebPreview: true })
        const nowIso = new Date().toISOString()
        await storage.update((s) => {
            s.presenceListMessages[String(chatId)] = sent.id
            s.presenceListPostedAt[String(chatId)] = nowIso
            s.chatLastActivity[String(chatId)] = nowIso
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
        source: 'manual',
        lastSeenOnlineAt: null,
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

    // /bindmac <MAC> в личке — добавить MAC-адрес устройства для авто-отметок (можно несколько).
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('bindmac')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await findChatsWhereUserIsAdmin(client, allowedChats, userId)
        if (adminChats.length === 0) {
            await msg.answerText('Эта команда доступна только резидентам (админам подключённого чата).')
            return
        }
        const arg = msg.command[1]
        if (!arg) {
            const cur = storage.get().macBindings[String(userId)]
            const list = cur && cur.macs.length > 0
                ? cur.macs.map((e) => `<code>${e.mac}</code>${e.label ? ` — ${e.label}` : ''}`).join('<br>')
                : null
            await msg.answerText(
                html(
                    list
                        ? `Твои устройства:<br>${list}<br><br>Добавить ещё — /bindmac &lt;MAC&gt; [имя], убрать — /unbindmac &lt;MAC&gt;.`
                        : 'Использование: /bindmac AA:BB:CC:DD:EE:FF [имя]<br>Например: /bindmac AA:BB:CC:DD:EE:FF Телефон<br>MAC устройства можно посмотреть в настройках Wi-Fi телефона/ноутбука. После привязки бот сам отметит тебя, когда устройство в сети спейса. Можно добавить несколько устройств.',
                ),
                { disableWebPreview: true },
            )
            return
        }
        if (!isValidMac(arg)) {
            await msg.answerText('Это не похоже на MAC-адрес. Формат: AA:BB:CC:DD:EE:FF (12 hex-символов).')
            return
        }
        const mac = normalizeMac(arg)
        const label = msg.command.slice(2).join(' ').trim()
        // MAC уникален: если он уже привязан к другому юзеру — отказываем.
        const owner = Object.values(storage.get().macBindings).find(
            (b) => b.userId !== userId && b.macs.some((e) => e.mac === mac),
        )
        if (owner) {
            await msg.answerText('Этот MAC уже привязан к другому резиденту.')
            return
        }
        const existing = storage.get().macBindings[String(userId)]
        if (existing?.macs.some((e) => e.mac === mac)) {
            await msg.answerText(`MAC ${mac} уже привязан к тебе. Чтобы переименовать — сначала /unbindmac ${mac}, потом добавь заново с именем.`)
            return
        }
        await storage.update((s) => {
            const now = new Date().toISOString()
            const cur = s.macBindings[String(userId)]
            if (cur) {
                cur.macs.push({ mac, label })
                cur.username = msg.sender!.username ?? null
                cur.updatedAt = now
            } else {
                s.macBindings[String(userId)] = {
                    userId,
                    username: msg.sender!.username ?? null,
                    macs: [{ mac, label }],
                    anon: false,
                    updatedAt: now,
                }
            }
        })
        await msg.answerText(`Привязал MAC ${mac}${label ? ` («${label}»)` : ''}. Теперь отмечу тебя автоматически, когда устройство появится в сети спейса.`)
    })

    // /unbindmac [MAC] в личке — убрать один MAC или все привязки.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('unbindmac')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const cur = storage.get().macBindings[String(userId)]
        if (!cur || cur.macs.length === 0) {
            await msg.answerText('У тебя нет привязанных MAC.')
            return
        }
        const arg = msg.command[1]
        // Без аргумента — убираем все привязки.
        if (!arg) {
            await storage.update((s) => {
                delete s.macBindings[String(userId)]
            })
            const present = storage.get().presence[String(userId)]
            if (present?.source === 'mac') {
                await removePresence(client, storage, allowedChats, userId, 'manual')
            }
            await msg.answerText('Убрал все привязки MAC. Авто-отметки больше не будут ставиться.')
            return
        }
        if (!isValidMac(arg)) {
            await msg.answerText('Это не похоже на MAC-адрес. Формат: AA:BB:CC:DD:EE:FF, или /unbindmac без аргумента — убрать все.')
            return
        }
        const mac = normalizeMac(arg)
        if (!cur.macs.some((e) => e.mac === mac)) {
            await msg.answerText(`MAC ${mac} к тебе не привязан.`)
            return
        }
        let leftEmpty = false
        await storage.update((s) => {
            const b = s.macBindings[String(userId)]
            if (!b) return
            b.macs = b.macs.filter((e) => e.mac !== mac)
            b.updatedAt = new Date().toISOString()
            if (b.macs.length === 0) {
                delete s.macBindings[String(userId)]
                leftEmpty = true
            }
        })
        // Если убрали последний MAC и текущая отметка была авто-по-MAC — снимаем её.
        if (leftEmpty) {
            const present = storage.get().presence[String(userId)]
            if (present?.source === 'mac') {
                await removePresence(client, storage, allowedChats, userId, 'manual')
            }
        }
        await msg.answerText(`Убрал MAC ${mac}.`)
    })

    // /maclist в личке — показать СВОИ привязанные MAC-адреса.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('maclist')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await findChatsWhereUserIsAdmin(client, allowedChats, userId)
        if (adminChats.length === 0) {
            await msg.answerText('Эта команда доступна только резидентам (админам подключённого чата).')
            return
        }
        const cur = storage.get().macBindings[String(userId)]
        if (!cur || cur.macs.length === 0) {
            await msg.answerText('У тебя нет привязанных MAC. Привяжи через /bindmac AA:BB:CC:DD:EE:FF.')
            return
        }
        const online = storage.get().presence[String(userId)]?.source === 'mac'
        const lines = [`Твои устройства [${cur.macs.length}]:`, '']
        for (const e of [...cur.macs].sort((a, b) => a.mac.localeCompare(b.mac))) {
            lines.push(`<code>${e.mac}</code>${e.label ? ` — ${e.label}` : ''}`)
        }
        lines.push('', online ? 'Сейчас ты отмечен по MAC.' : 'Сейчас авто-отметка не активна.')
        await msg.answerText(html(lines.join('<br>')), { disableWebPreview: true })
    })

    // /settings в личке — переключить, отмечаться по MAC с ником или анонимно.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('settings')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await findChatsWhereUserIsAdmin(client, allowedChats, userId)
        if (adminChats.length === 0) {
            await msg.answerText('Эта команда доступна только резидентам (админам подключённого чата).')
            return
        }
        const cur = storage.get().macBindings[String(userId)]
        const anon = cur?.anon ?? false
        await msg.answerText(
            `Авто-отметка по MAC: сейчас ${anon ? '«без ника»' : 'с ником'}.\nВыбери, как отмечаться:`,
            { replyMarkup: settingsKeyboard(anon) },
        )
    })


    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null) return
        const isOurs =
            data === CB_CHECKIN_NICK ||
            data === CB_CHECKIN_ANON ||
            data === CB_CHECKOUT ||
            data === CB_CONFIRM ||
            data === CB_SETTINGS_NICK ||
            data === CB_SETTINGS_ANON
        if (!isOurs) return PropagationAction.Continue

        if (data === CB_SETTINGS_NICK || data === CB_SETTINGS_ANON) {
            const userId = ctx.user.id
            const anon = data === CB_SETTINGS_ANON
            if (storage.get().macBindings[String(userId)] === undefined) {
                await ctx.answer({ text: 'Сначала привяжи MAC через /bindmac.', alert: true })
                return
            }
            await storage.update((s) => {
                const b = s.macBindings[String(userId)]
                if (b) {
                    b.anon = anon
                    b.updatedAt = new Date().toISOString()
                }
            })
            // Если сейчас активна авто-отметка — сразу применяем новый режим к ней и спискам.
            const present = storage.get().presence[String(userId)]
            if (present?.source === 'mac') {
                await storage.update((s) => {
                    const p = s.presence[String(userId)]
                    if (p) {
                        p.displayLabel = anon ? ANON_LABEL : (p.username ? `@${p.username}` : ANON_LABEL)
                        p.username = anon ? null : (storage.get().macBindings[String(userId)]?.username ?? null)
                    }
                })
                for (const chatId of await findChatsWhereUserIsAdmin(client, allowedChats, userId)) {
                    await upsertPresenceListInChat(client, storage, chatId)
                }
            }
            try {
                await ctx.editMessage({
                    text: `Авто-отметка по MAC: теперь ${anon ? '«без ника»' : 'с ником'}.`,
                    replyMarkup: settingsKeyboard(anon),
                })
            } catch {}
            await ctx.answer({ text: 'Сохранил' })
            return
        }

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
                delete s.presenceListPostedAt[String(chatId)]
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
                            delete s.presenceListPostedAt[String(chatId)]
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
            // Авто-отметки по MAC живут по присутствию устройства в сети (см. startMacPresencePoller),
            // их не пингуем и не снимаем по таймауту подтверждения.
            if (p.source === 'mac') continue
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

/**
 * Ставит/обновляет авто-отметку резидента по MAC (источник 'mac').
 * Не трогает ручную отметку (manual) того же юзера — ручная имеет приоритет.
 * Возвращает true, если список присутствующих надо перепостить (новая отметка).
 */
const macCheckIn = async (
    client: TelegramClient,
    storage: Storage,
    allowed: ReadonlySet<number>,
    binding: { userId: number; username: string | null; anon: boolean },
    nowIso: string,
): Promise<boolean> => {
    const existing = storage.get().presence[String(binding.userId)]
    if (existing && existing.source === 'manual') {
        // Резидент отметился руками — авто-логику не вмешиваем, только не даём ей мешать.
        return false
    }
    if (existing && existing.source === 'mac') {
        // Уже отмечен по MAC — просто продлеваем «последний раз онлайн».
        await storage.update((s) => {
            const p = s.presence[String(binding.userId)]
            if (p) p.lastSeenOnlineAt = nowIso
        })
        return false
    }
    // Новой отметки нет — проверяем, что юзер всё ещё резидент (админ чата), и ставим.
    const chats = await findChatsWhereUserIsAdmin(client, allowed, binding.userId)
    if (chats.length === 0) return false
    const useNick = !binding.anon && !!binding.username
    const presence: ResidentPresence = {
        userId: binding.userId,
        displayLabel: useNick ? `@${binding.username}` : ANON_LABEL,
        username: useNick ? binding.username : null,
        checkedInAt: nowIso,
        lastConfirmedAt: nowIso,
        pendingPingAt: null,
        source: 'mac',
        lastSeenOnlineAt: nowIso,
    }
    await storage.update((s) => {
        s.presence[String(binding.userId)] = presence
    })
    for (const chatId of chats) {
        await upsertPresenceListInChat(client, storage, chatId)
    }
    return true
}

/**
 * Поллер присутствия по MAC. Каждый тик опрашивает Keenetic об активных MAC и:
 *  - ставит авто-отметку (source 'mac') резидентам, чьи привязанные MAC онлайн;
 *  - продлевает `lastSeenOnlineAt` для уже отмеченных;
 *  - снимает 'mac'-отметку, если MAC не виден в сети дольше MAC_ABSENCE_GRACE_MS.
 *
 * Ручные ('manual') отметки поллер не трогает.
 */
export const startMacPresencePoller = (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    keenetic: KeeneticClient,
    intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void; triggerNow: () => Promise<void> } => {
    const tick = async () => {
        const bindings = Object.values(storage.get().macBindings)
        if (bindings.length === 0) return

        let activeMacs: Set<string>
        try {
            activeMacs = await keenetic.fetchActiveMacs()
        } catch (err) {
            console.warn('[keenetic] не удалось получить список устройств:', err)
            return
        }

        const nowIso = new Date().toISOString()
        const now = Date.now()

        for (const binding of bindings) {
            const online = binding.macs.some((e) => activeMacs.has(e.mac))
            const present = storage.get().presence[String(binding.userId)]

            if (online) {
                await macCheckIn(client, storage, allowedChats, binding, nowIso)
                continue
            }

            // MAC офлайн. Снимаем только нашу 'mac'-отметку и только после grace-периода.
            if (present?.source === 'mac') {
                const lastSeen = present.lastSeenOnlineAt ? Date.parse(present.lastSeenOnlineAt) : 0
                if (!Number.isFinite(lastSeen) || now - lastSeen >= MAC_ABSENCE_GRACE_MS) {
                    await removePresence(client, storage, allowedChats, binding.userId, 'manual')
                }
            }
        }
    }

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[keenetic] poller tick error:', err))
    }, intervalMs)

    return { stop: () => clearInterval(handle), triggerNow: tick }
}
