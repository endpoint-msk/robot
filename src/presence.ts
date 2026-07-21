import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import { remindAboutTodayRequests } from './hosting.js'
import { isValidMac, normalizeMac, type KeeneticClient } from './keenetic.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { ResidentPresence } from './types.js'

/** Период напоминаний резиденту в личку (3 часа). */
export const PRESENCE_PING_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Сколько ждём ответа на ping, прежде чем снять отметку (15 минут). */
export const PRESENCE_PING_TIMEOUT_MS = 15 * 60 * 1000
/** Через сколько отсутствия MAC в сети снимаем авто-отметку (10 минут — телефоны «засыпают» в WiFi). */
export const MAC_ABSENCE_GRACE_MS = 10 * 60 * 1000
/** Как часто крутим планировщик. */
const TICK_INTERVAL_MS = 60 * 1000

/**
 * Хук «присутствие изменилось»: чек-ин/чек-аут/MAC дёргают его, чтобы пересобрать
 * доску «кто сегодня в спейсе» (src/hosting-board.ts). null — доска выключена
 * (миниапп хостинга не настроен), тогда авто-поверхности присутствия в чате нет,
 * остаётся только ручной /inside. Ставится на старте (setPresenceChangeHook).
 * Так presence не зависит от hosting-board напрямую (без циклического импорта).
 */
let onPresenceChanged: (() => void) | null = null

export const setPresenceChangeHook = (fn: (() => void) | null): void => {
    onPresenceChanged = fn
}

const CB_CHECKOUT = 'presence:checkout'
const CB_CONFIRM = 'presence:confirm'
const CB_SETTINGS_NICK = 'presence:settings:nick'
const CB_SETTINGS_ANON = 'presence:settings:anon'

export const ANON_LABEL = 'Без ника'

/**
 * Deep link на миниапп хостинга (t.me/<bot>?startapp=…) для кнопки «Хочу прийти»
 * под списками присутствующих. null — миниапп не настроен, кнопки нет.
 * URL-кнопка вместо webview-кнопки: в группах Telegram запрещает web_app-кнопки.
 * Ставится один раз на старте (setHostingMiniappLink), когда известен username бота.
 */
let hostingMiniappLink: string | null = null

export const setHostingMiniappLink = (link: string | null): void => {
    hostingMiniappLink = link
}

/**
 * Конфиг напоминания о заявках при появлении в спейсе. null — миниапп не настроен,
 * напоминаний нет. Ставится на старте, как и hostingMiniappLink.
 */
let hostingReminder: { webappUrl: string; tzOffsetMinutes: number } | null = null

export const setHostingReminder = (config: { webappUrl: string; tzOffsetMinutes: number } | null): void => {
    hostingReminder = config
}

/**
 * Резидент только что появился в спейсе — напоминаем ему про сегодняшние заявки.
 * Fire-and-forget: чек-ин не должен ждать отправки DM.
 */
const remindOnArrival = (client: TelegramClient, storage: Storage, userId: number): void => {
    if (!hostingReminder) return
    void remindAboutTodayRequests(client, storage, hostingReminder.tzOffsetMinutes, hostingReminder.webappUrl, userId)
        .catch((err) => console.error('[presence] не удалось напомнить о заявках:', err))
}

/** Клавиатура под списком присутствующих: кнопка заявки на визит для гостей, читающих чат. */
const presenceListMarkup = () =>
    hostingMiniappLink
        ? BotKeyboard.inline([[BotKeyboard.url('🚪 Хочу прийти', hostingMiniappLink)]])
        : undefined

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

/** Подсказка про авто-отметку для тех, у кого ещё не привязан MAC. Пустая строка, если MAC уже есть. */
export const macHintFor = (storage: Storage, userId: number): string => {
    const cur = storage.get().macBindings[String(userId)]
    if (cur && cur.macs.length > 0) return ''
    return '<br><br>💡 Можешь привязать MAC-адрес своего устройства командой /bindmac — тогда я буду отмечать тебя автоматически, пока ты в сети спейса. Только сначала выключи на устройстве ротацию (рандомизацию) MAC-адреса для Wi-Fi спейса — иначе адрес будет меняться и авто-отметка перестанет работать.'
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
 * Блок «кто сейчас в спейсе» для доски (src/hosting-board.ts): заголовок со счётчиком
 * и ники-ссылки отметившихся. [] — если внутри никого (блок на доску не выводится).
 * Отметившиеся без ника в список не попадают, но учитываются в счётчике [N].
 */
export const insideBoardLines = (storage: Storage): string[] => {
    const presents = Object.values(storage.get().presence)
    if (presents.length === 0) return []
    const lines = [`<b>Сейчас в спейсе [${presents.length}]:</b>`]
    for (const p of presents) {
        if (!p.username) continue
        lines.push(`• <a href="https://t.me/${encodeURIComponent(p.username)}">@${p.username}</a>`)
    }
    return lines
}

/** Постит новое сообщение со списком присутствующих в чат (ручной /inside). */
export const postPresenceList = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
): Promise<void> => {
    try {
        await client.sendText(chatId, html(renderPresenceText(storage)), {
            disableWebPreview: true,
            replyMarkup: presenceListMarkup(),
        })
    } catch (err) {
        console.error(`[presence] failed to post list to chat ${chatId}:`, err)
    }
}

/**
 * Снимает отметку с резидента и пересобирает доску «кто сегодня в спейсе».
 * `residents` больше не нужен для постинга, оставлен для единообразия сигнатуры вызовов.
 */
export const removePresence = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    userId: number,
    reason: 'manual' | 'timeout',
): Promise<void> => {
    const present = storage.get().presence[String(userId)]
    if (!present) return
    await storage.update((s) => {
        delete s.presence[String(userId)]
    })

    onPresenceChanged?.()

    if (reason === 'timeout') {
        try {
            await client.sendText(userId, 'Не получил подтверждение за 15 минут — снял отметку. Если ты ещё внутри, нажми /start.')
        } catch {
            // личка может быть закрыта — ничего страшного
        }
    }
}

export const checkInResident = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    user: { id: number; username: string | null; displayName: string },
    mode: 'nick' | 'anon',
): Promise<{ chats: number[]; alreadyChecked: boolean }> => {
    const chats = await residents.presenceChats(user.id)
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

    onPresenceChanged?.()
    // Только на появление в спейсе: existing — это смена ника/повторный тап, юзер уже внутри.
    if (!existing) remindOnArrival(client, storage, user.id)
    return { chats, alreadyChecked: !!existing }
}

export const registerPresenceHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        residents: ResidentDirectory
    },
): void => {
    const { client, storage, residents } = deps

    // /bindmac <MAC> в личке — добавить MAC-адрес устройства для авто-отметок (можно несколько).
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('bindmac')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await residents.presenceChats(userId)
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
                        : 'Использование: /bindmac AA:BB:CC:DD:EE:FF [имя]<br>Например: /bindmac AA:BB:CC:DD:EE:FF Телефон<br>MAC устройства можно посмотреть в настройках Wi-Fi телефона/ноутбука. После привязки бот сам отметит тебя, когда устройство в сети спейса. Можно добавить несколько устройств.<br><br>⚠️ Сначала выключи ротацию (рандомизацию) MAC-адреса для Wi-Fi спейса в настройках устройства — иначе адрес будет меняться и авто-отметка перестанет работать.',
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
                await removePresence(client, storage, residents, userId, 'manual')
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
                await removePresence(client, storage, residents, userId, 'manual')
            }
        }
        await msg.answerText(`Убрал MAC ${mac}.`)
    })

    // /maclist в личке — показать СВОИ привязанные MAC-адреса.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('maclist')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await residents.presenceChats(userId)
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
        const adminChats = await residents.presenceChats(userId)
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
                        const uname = storage.get().macBindings[String(userId)]?.username ?? null
                        p.username = anon ? null : uname
                        p.displayLabel = anon ? ANON_LABEL : (uname ? `@${uname}` : ANON_LABEL)
                    }
                })
                onPresenceChanged?.()
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
            await removePresence(client, storage, residents, ctx.user.id, 'manual')
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
 * Регистрирует подписку на сообщения в групповых чатах для отслеживания последней активности.
 * chatLastActivity — информационный сигнал, на отправку сообщений не влияет.
 */
export const registerChatActivityTracker = (
    dp: Dispatcher,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
): void => {
    const track = async (msg: { chat: { id: number | string }; isOutgoing: boolean }) => {
        const chatId = Number(msg.chat.id)
        if (!allowedChats.has(chatId)) return PropagationAction.Continue
        if (msg.isOutgoing) return PropagationAction.Continue
        await storage.update((s) => {
            s.chatLastActivity[String(chatId)] = new Date().toISOString()
        })
        // Не глотаем сообщение — пусть командные обработчики тоже видят его.
        return PropagationAction.Continue
    }
    dp.onNewMessage(track)
    // Альбомы приходят отдельным апдейтом и не дублируются как new_message — учитываем и их.
    dp.onMessageGroup(track)
}

/** Запускает таймер: пинги резидентам и снятие отметок по таймауту подтверждения. */
export const startPresenceScheduler = (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
): { stop: () => void } => {
    const tick = async () => {
        const now = Date.now()

        // Пинги и таймауты по каждому отмеченному резиденту
        const presents = Object.values(storage.get().presence)
        for (const p of presents) {
            // Авто-отметки по MAC живут по присутствию устройства в сети (см. startMacPresencePoller),
            // их не пингуем и не снимаем по таймауту подтверждения.
            if (p.source === 'mac') continue
            const lastConfirmed = Date.parse(p.lastConfirmedAt)
            if (p.pendingPingAt) {
                const pingedAt = Date.parse(p.pendingPingAt)
                if (now - pingedAt >= PRESENCE_PING_TIMEOUT_MS) {
                    await removePresence(client, storage, residents, p.userId, 'timeout')
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
                    await removePresence(client, storage, residents, p.userId, 'timeout')
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
    residents: ResidentDirectory,
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
    const chats = await residents.presenceChats(binding.userId)
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
    let created = false
    await storage.update((s) => {
        // За время await выше могла появиться отметка (ручная — приоритетна, или mac
        // от соседнего тика). Не затираем её и не перепощиваем список.
        if (s.presence[String(binding.userId)]) return
        s.presence[String(binding.userId)] = presence
        created = true
    })
    if (!created) return false
    onPresenceChanged?.()
    remindOnArrival(client, storage, binding.userId)
    return true
}

/**
 * Поллер присутствия по MAC. Каждый тик опрашивает Keenetic об активных MAC и:
 *  - ставит авто-отметку (source 'mac') резидентам, чьи привязанные MAC онлайн;
 *  - продлевает `lastSeenOnlineAt` для уже отмеченных;
 *  - снимает 'mac'-отметку, если MAC не виден в сети дольше MAC_ABSENCE_GRACE_MS.
 *
 * Ручные ('manual') отметки поллер не трогает.
 *
 * NB: всё держится на том, что у устройства резидента выключена ротация (рандомизация)
 * MAC-адреса для Wi-Fi спейса — иначе видимый MAC будет меняться и привязка перестанет
 * совпадать. Об этом предупреждаем пользователя при /bindmac и в меню (см. macHintFor / macSection).
 */
export const startMacPresencePoller = (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
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
                await macCheckIn(client, storage, residents, binding, nowIso)
                continue
            }

            // MAC офлайн. Снимаем только нашу 'mac'-отметку и только после grace-периода.
            if (present?.source === 'mac') {
                const lastSeen = present.lastSeenOnlineAt ? Date.parse(present.lastSeenOnlineAt) : 0
                if (!Number.isFinite(lastSeen) || now - lastSeen >= MAC_ABSENCE_GRACE_MS) {
                    await removePresence(client, storage, residents, binding.userId, 'manual')
                }
            }
        }
    }

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[keenetic] poller tick error:', err))
    }, intervalMs)

    return { stop: () => clearInterval(handle), triggerNow: tick }
}
