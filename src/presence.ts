import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import { startHeartbeatInterval } from './health.js'
import { remindAboutTodayRequests } from './hosting.js'
import { isValidMac, normalizeMac, type KeeneticClient } from './keenetic.js'
import { closePresenceSession, markRouterGap } from './presence-log.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { ResidentMacs, ResidentPresence } from './types.js'

/** Период напоминаний резиденту в личку (3 часа). */
export const PRESENCE_PING_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Сколько ждём ответа на ping, прежде чем снять отметку (15 минут). */
export const PRESENCE_PING_TIMEOUT_MS = 15 * 60 * 1000
/** Через сколько отсутствия MAC в сети снимаем авто-отметку (10 минут — телефоны «засыпают» в WiFi). */
export const MAC_ABSENCE_GRACE_MS = 10 * 60 * 1000
/**
 * Потолок авто-отметки: дольше 14 часов подряд «в спейсе» по устройству в сети никто
 * не сидит. Привязанный десктоп держал человека внутри круглосуточно - список врал,
 * а снять отметку он мог только руками, если вообще замечал.
 */
export const MAC_MAX_PRESENCE_MS = 14 * 60 * 60 * 1000
/** Сколько поллер может молчать, прежде чем авто-отметки считаются протухшими (30 минут). */
export const MAC_STALE_MS = 30 * 60 * 1000
/** После скольких неудачных опросов подряд жалуемся девам (console.error → личка). */
const MAC_FAIL_STREAK = 5
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

/** Максимальная длина имени устройства: длиннее в строку списка всё равно не влезает. */
export const MAC_LABEL_LIMIT = 50

/**
 * Хвост строки списка устройств: « - Ноутбук». Метку вводит человек, а вокруг -
 * HTML-разметка сообщения: без экранирования `/bindmac AA:.. <b` навсегда ломал
 * /maclist и раздел MAC в меню ошибкой парсинга, и починить это можно было только
 * отвязав устройство вслепую.
 */
export const macLabelSuffix = (label: string): string =>
    label ? ` - ${html.escape(label.slice(0, MAC_LABEL_LIMIT))}` : ''

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
    /** 'manual' - ушёл сам либо устройство пропало из сети; 'stale' - роутер замолчал. */
    reason: 'manual' | 'timeout' | 'stale',
    /** `silent` - не дёргать хук доски: массовое снятие пересобирает её один раз в конце. */
    opts: { silent?: boolean } = {},
): Promise<void> => {
    const present = storage.get().presence[String(userId)]
    if (!present) return
    // Журнал пишем до удаления: в `present` лежит начало визита, а после снятия
    // отметки восстанавливать его будет неоткуда. Единственная точка выхода на все
    // способы ухода — поэтому история не зависит от того, каким путём сняли отметку.
    await closePresenceSession(storage, present, reason === 'manual' ? 'checkout' : reason)
    await storage.update((s) => {
        delete s.presence[String(userId)]
    })

    if (!opts.silent) onPresenceChanged?.()

    if (reason === 'timeout') {
        try {
            await client.sendText(userId, 'Не получил подтверждение за 15 минут — снял отметку. Если ты ещё внутри, нажми /start.')
        } catch {
            // личка может быть закрыта — ничего страшного
        }
    }
}

/**
 * Подавляет авто-отметку по MAC до момента, когда устройства резидента уйдут из сети.
 *
 * Ставится, когда человек снял отметку сам, а его ноутбук всё ещё в Wi-Fi: поллер
 * возвращал отметку следующим тиком, «Снял отметку» было ложью, и единственным
 * выходом оставался /unbindmac. Снимается по факту ухода устройства, а не по таймеру:
 * таймер либо коротко (вернёт отметку тому, кто ушёл), либо длинно (не отметит того,
 * кто вернулся).
 */
const suppressMacPresence = async (storage: Storage, userId: number): Promise<void> => {
    if (!storage.get().macBindings[String(userId)]) return
    await storage.update((s) => {
        const b = s.macBindings[String(userId)]
        if (b) b.suppressedAt = new Date().toISOString()
    })
}

/** Режим «невидимка»: авто-отметка по MAC для этого резидента не ставится. */
export const isPresenceInvisible = (storage: Storage, userId: number): boolean =>
    storage.get().presenceInvisible[String(userId)] === true

/**
 * Переключает «невидимку». Включение снимает висящую авто-отметку - иначе человек
 * оставался бы в списке до ухода устройства из сети, то есть режим включался бы
 * с задержкой в неизвестное время. Ручную отметку не трогает: она осознанное действие,
 * и «невидимка» про автоматику, а не про запрет отмечаться.
 */
export const setPresenceInvisible = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    userId: number,
    invisible: boolean,
): Promise<void> => {
    await storage.update((s) => {
        if (invisible) s.presenceInvisible[String(userId)] = true
        else delete s.presenceInvisible[String(userId)]
    })
    if (!invisible) return
    if (storage.get().presence[String(userId)]?.source === 'mac') {
        await removePresence(client, storage, residents, userId, 'manual')
    }
}

/**
 * Снятие отметки по воле человека («Уйти»). Возвращает false, если отметки и не было.
 *
 * Единственная точка выхода для кнопок: она же ставит подавление авто-отметки, если
 * снимаемая отметка пришла от MAC.
 */
export const checkOutResident = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    userId: number,
): Promise<boolean> => {
    const present = storage.get().presence[String(userId)]
    if (!present) return false
    // Подавляем независимо от источника снимаемой отметки: ушедший руками с ручной
    // отметки получил бы авто-отметку от поллера через минуту - тот же обман. Если
    // устройства в сети уже нет, подавление снимет ближайший тик поллера.
    await suppressMacPresence(storage, userId)
    await removePresence(client, storage, residents, userId, 'manual')
    return true
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
            await msg.answerText('Эта команда доступна только резидентам (участникам чата резидентов).')
            return
        }
        const arg = msg.command[1]
        if (!arg) {
            const cur = storage.get().macBindings[String(userId)]
            const list = cur && cur.macs.length > 0
                ? cur.macs.map((e) => `<code>${e.mac}</code>${macLabelSuffix(e.label)}`).join('<br>')
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
        const label = msg.command.slice(2).join(' ').trim().slice(0, MAC_LABEL_LIMIT)
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
                    suppressedAt: null,
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
            await msg.answerText('Эта команда доступна только резидентам (участникам чата резидентов).')
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
            lines.push(`<code>${e.mac}</code>${macLabelSuffix(e.label)}`)
        }
        lines.push('', online ? 'Сейчас ты отмечен по MAC.' : 'Сейчас авто-отметка не активна.')
        if (isPresenceInvisible(storage, userId)) {
            lines.push('Включён режим «невидимка» - авто-отметка не ставится (переключить в меню /start).')
        } else if (cur.suppressedAt) {
            lines.push('Авто-отметка приостановлена: ты снял отметку вручную. Вернётся, когда устройство уйдёт из сети и появится снова.')
        }
        await msg.answerText(html(lines.join('<br>')), { disableWebPreview: true })
    })

    // /settings в личке — переключить, отмечаться по MAC с ником или анонимно.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('settings')), async (msg) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        const adminChats = await residents.presenceChats(userId)
        if (adminChats.length === 0) {
            await msg.answerText('Эта команда доступна только резидентам (участникам чата резидентов).')
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
            const wasMac = present?.source === 'mac'
            if (!present) {
                await ctx.answer({ text: 'Ты и так не отмечен.' })
                try {
                    await ctx.editMessage({
                        text: 'Ты не отмечен. Нажми /start чтобы отметиться.',
                    })
                } catch {}
                return
            }
            await checkOutResident(client, storage, residents, ctx.user.id)
            await ctx.answer({ text: 'Снял отметку' })
            try {
                await ctx.editMessage({
                    text: wasMac
                        ? 'Снял отметку. Пока твоё устройство в сети спейса, автоматически отмечать не буду - вернусь к этому, когда оно уйдёт и появится снова. Нажми /start, если снова внутри.'
                        : 'Снял отметку. Возвращайся 👋 - нажми /start, когда снова в спейсе.',
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
            const lastConfirmed = Date.parse(p.lastConfirmedAt)
            // Авто-отметки по MAC живут по присутствию устройства в сети (см. startMacPresencePoller),
            // поэтому обычным пингом раз в 3 часа их не трогаем. Но и вечными они быть не могут:
            // после MAC_MAX_PRESENCE_MS переспрашиваем ровно так же, как у ручной отметки.
            if (p.source === 'mac') {
                if (p.pendingPingAt) {
                    if (now - Date.parse(p.pendingPingAt) >= PRESENCE_PING_TIMEOUT_MS) {
                        await suppressMacPresence(storage, p.userId)
                        await removePresence(client, storage, residents, p.userId, 'timeout')
                    }
                } else if (now - lastConfirmed >= MAC_MAX_PRESENCE_MS) {
                    try {
                        await client.sendText(
                            p.userId,
                            'Ты ещё в спейсе? Отметка держится по твоему устройству в сети уже больше 14 часов - подтверди в течение 15 минут, иначе сниму.',
                            { replyMarkup: pingKeyboard() },
                        )
                        await storage.update((s) => {
                            const cur = s.presence[String(p.userId)]
                            if (cur) cur.pendingPingAt = new Date().toISOString()
                        })
                    } catch (err) {
                        // Личка закрыта - подтвердить он не сможет, а отметка врёт уже сутки.
                        console.warn(`[presence] cannot DM user ${p.userId} about mac ceiling:`, err)
                        await suppressMacPresence(storage, p.userId)
                        await removePresence(client, storage, residents, p.userId, 'timeout')
                    }
                }
                continue
            }
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

    return startHeartbeatInterval('presence', TICK_INTERVAL_MS, tick, '[presence]')
}

/**
 * Снимает все авто-отметки по MAC разом: данных о сети больше нет, и подтвердить их
 * нечем. Доску пересобираем один раз в конце - иначе на каждого снятого уходит свой
 * edit, и чат получает шквал одинаковых правок с MESSAGE_NOT_MODIFIED.
 */
export const dropMacPresence = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    reason: string,
): Promise<number> => {
    const stale = Object.values(storage.get().presence).filter((p) => p.source === 'mac')
    if (stale.length === 0) return 0
    for (const p of stale) {
        await removePresence(client, storage, residents, p.userId, 'stale', { silent: true })
    }
    onPresenceChanged?.()
    console.warn(`[keenetic] снял авто-отметок: ${stale.length} (${reason}).`)
    return stale.length
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
    binding: ResidentMacs,
    nowIso: string,
): Promise<boolean> => {
    // «Невидимка» и подавление после ручного ухода - оба про «не отмечай меня сам».
    // Проверяем до всего остального: продлевать чужую отметку тоже не надо.
    if (isPresenceInvisible(storage, binding.userId)) return false
    if (binding.suppressedAt) return false
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
    /** Когда последний раз получили данные о сети; от него считается протухание отметок. */
    let lastSuccessAt = Date.now()
    let failStreak = 0
    let reportedDown = false

    const tick = async () => {
        const bindings = Object.values(storage.get().macBindings)
        if (bindings.length === 0) return

        let activeMacs: Set<string>
        try {
            activeMacs = await keenetic.fetchActiveMacs()
        } catch (err) {
            failStreak++
            console.warn('[keenetic] не удалось получить список устройств:', err)
            // Один раз на переход, а не каждый тик: console.error уходит девам в личку,
            // и лежащий роутер превратился бы в сообщение в минуту.
            if (failStreak >= MAC_FAIL_STREAK && !reportedDown) {
                reportedDown = true
                console.error(`[keenetic] роутер не отвечает ${failStreak} опросов подряд - авто-отметки по MAC не обновляются.`)
            }
            // Про это время мы ничего не знаем — помечаем провал в журнале, иначе в
            // статистике «роутер лежал» будет неотличимо от «в спейсе никого не было».
            await markRouterGap(storage, lastSuccessAt, Date.now())
            // Снимает mac-отметки тот же поллер, который сейчас лежит. Без этого доска,
            // /inside и миниапп часами показывают людей в давно пустом спейсе.
            if (Date.now() - lastSuccessAt >= MAC_STALE_MS) {
                await dropMacPresence(client, storage, residents, `данных о сети нет дольше ${Math.round(MAC_STALE_MS / 60_000)} мин`)
            }
            return
        }
        if (reportedDown) console.log('[keenetic] опрос сети восстановился')
        failStreak = 0
        reportedDown = false
        lastSuccessAt = Date.now()

        const nowIso = new Date().toISOString()
        const now = Date.now()

        for (const binding of bindings) {
            const online = binding.macs.some((e) => activeMacs.has(e.mac))
            const present = storage.get().presence[String(binding.userId)]

            if (online) {
                await macCheckIn(client, storage, residents, binding, nowIso)
                continue
            }

            // Устройств в сети нет - человек ушёл, и подавление ручного ухода своё
            // отработало: следующее появление снова отметит автоматически.
            if (binding.suppressedAt) {
                await storage.update((s) => {
                    const b = s.macBindings[String(binding.userId)]
                    if (b) b.suppressedAt = null
                })
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

    const timer = startHeartbeatInterval('mac-poller', intervalMs, tick, '[keenetic] poller')
    return { stop: timer.stop, triggerNow: tick }
}
