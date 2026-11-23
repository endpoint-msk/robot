import { tr } from './i18n.js'
import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import {
    buildDonationsCsv,
    buildLeaderboard,
    createFundraiser,
    formatMoney,
    fundraiserPeriodLabel,
    isAnonNick,
    anonymousDonorLabel,
    parseDonateArgs,
    parseRemoveArgs,
    pastFundraisers,
    periodAnchorOf,
    periodKeyOf,
    renderDescription,
    renderFundraiser,
    renderHistoryList,
    totalPages,
    clampPage,
    clampResetDay,
    MIN_RESET_DAY,
    MAX_RESET_DAY,
} from './fundraiser.js'
import { audit, auditUser } from './audit.js'
import { newRequestTarget, webappAt } from './deeplink.js'
import { postPresenceList, renderPresenceText } from './presence.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { Fundraiser, State } from './types.js'

const PAGE_CALLBACK_PREFIX = 'fundraiser:page:'
/** Возврат к списку истории. */
const HISTORY_LIST_CALLBACK = 'fundraiser:history'
/** Открытый сбор из истории: `fundraiser:history:<periodKey>:<page>` (в ключе только цифры и дефисы). */
const HISTORY_OPEN_PREFIX = 'fundraiser:history:'
/** Сколько периодов показываем в списке истории; остальные - по `/history <период>`. */
const HISTORY_LIMIT = 12

export type AllowedChats = Set<number>

export const parseAllowedChats = (raw: string | undefined): AllowedChats => {
    const out: AllowedChats = new Set()
    if (!raw) return out
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (/^-?\d+$/.test(part)) out.add(Number(part))
    }
    return out
}

const isAllowedChat = (allowed: AllowedChats, chatId: number): boolean =>
    allowed.has(chatId)

const buildKeyboard = (page: number, pages: number) => {
    const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
    if (pages > 1) {
        const prev = page > 1 ? page - 1 : pages
        const next = page < pages ? page + 1 : 1
        rows.push([
            BotKeyboard.callback('◀️', `${PAGE_CALLBACK_PREFIX}${prev}`),
            BotKeyboard.callback(`${page}/${pages}`, `${PAGE_CALLBACK_PREFIX}${page}`),
            BotKeyboard.callback('▶️', `${PAGE_CALLBACK_PREFIX}${next}`),
        ])
    }
    // Пустая inline-клавиатура (одна страница, нет стрелок) - это REPLY_MARKUP_INVALID.
    // Возвращаем undefined, чтобы сообщение ушло вообще без разметки.
    if (rows.length === 0) return undefined
    return BotKeyboard.inline(rows)
}

/** Кнопки списка истории: по кнопке на период, свежие сверху, по две в ряд. */
const historyListKeyboard = (past: Fundraiser[]) => {
    const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
    for (let i = 0; i < past.length; i += 2) {
        rows.push(
            past.slice(i, i + 2).map((f) =>
                BotKeyboard.callback(fundraiserPeriodLabel(f), `${HISTORY_OPEN_PREFIX}${f.periodKey}:1`),
            ),
        )
    }
    if (rows.length === 0) return undefined
    return BotKeyboard.inline(rows)
}

/** Клавиатура открытого сбора из истории: пагинация лидерборда + возврат к списку. */
const historyEntryKeyboard = (periodKey: string, page: number, pages: number) => {
    const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
    if (pages > 1) {
        const prev = page > 1 ? page - 1 : pages
        const next = page < pages ? page + 1 : 1
        rows.push([
            BotKeyboard.callback('◀️', `${HISTORY_OPEN_PREFIX}${periodKey}:${prev}`),
            BotKeyboard.callback(`${page}/${pages}`, `${HISTORY_OPEN_PREFIX}${periodKey}:${page}`),
            BotKeyboard.callback('▶️', `${HISTORY_OPEN_PREFIX}${periodKey}:${next}`),
        ])
    }
    rows.push([BotKeyboard.callback(tr('⬅️ К списку', "⬅️ Back to list"), HISTORY_LIST_CALLBACK)])
    return BotKeyboard.inline(rows)
}

/** Прошлые сборы (свежие сверху) на момент вызова. */
const historyOf = (storage: Storage, now: Date = new Date()): Fundraiser[] => {
    const state = storage.get()
    return pastFundraisers(Object.values(state.fundraisers), periodKeyOf(now, state.resetDay))
}

/** Самый поздний из уже существующих сборов (по periodKey). undefined - если сборов ещё нет. */
const latestFundraiser = (state: State): Fundraiser | undefined => {
    let latest: Fundraiser | undefined
    for (const f of Object.values(state.fundraisers)) {
        if (!latest || f.periodKey > latest.periodKey) latest = f
    }
    return latest
}

/** Возвращает текущий сбор (по периоду с учётом дня сброса), создавая, если его ещё нет. */
const ensureCurrentFundraiser = (storage: Storage, now: Date = new Date()): Fundraiser => {
    const state = storage.get()
    const { year, month } = periodAnchorOf(now, state.resetDay)
    const key = periodKeyOf(now, state.resetDay)
    let f = state.fundraisers[key]
    if (!f) {
        // Цель, тема и описание (реквизиты/ссылки) - «липкие» настройки: переносим их
        // с прошлого сбора, чтобы на новом периоде не сбрасывались к дефолту. Аренда
        // из месяца в месяц одна и та же, заново звать /setgoal каждый период незачем.
        const prev = latestFundraiser(state)
        f = createFundraiser(
            year,
            month,
            { goal: prev?.goal, title: prev?.title, description: prev?.description },
            state.resetDay,
        )
        state.fundraisers[key] = f
    }
    return f
}

/**
 * Сбор за предыдущий период относительно текущего, если он есть.
 *
 * Ищем ближайший существующий сбор с меньшим ключом, а не вычисляем ключ по текущему
 * `resetDay`: после /setresetday меняется сам формат ключа (`YYYY-MM` ↔ `YYYY-MM-DD`),
 * и вычисленный ключ переставал находить прошлый сбор — строка «Топ за <месяц>» молча
 * исчезала из сообщения до тех пор, пока не пройдут два полных периода. Заодно
 * переживает пропущенные периоды: сборы заводятся лениво, месяц без обращений записи
 * не получает вовсе. Ключи сравнимы лексикографически: `2026-06` < `2026-06-25` < `2026-07`.
 */
const previousFundraiser = (storage: Storage, current: Fundraiser): Fundraiser | undefined => {
    let best: Fundraiser | undefined
    for (const f of Object.values(storage.get().fundraisers)) {
        if (f.periodKey >= current.periodKey) continue
        if (!best || f.periodKey > best.periodKey) best = f
    }
    return best
}

const rememberLastMessage = async (
    storage: Storage,
    chatId: number,
    messageId: number,
    periodKey: string,
) => {
    await storage.update((s) => {
        s.lastMessages[String(chatId)] = { chatId, messageId, periodKey }
    })
}

/** Публикует новое сообщение со сбором в чат и запоминает его как «последнее актуальное». */
export const postFundraiserToChat = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    now: Date = new Date(),
): Promise<void> => {
    const f = ensureCurrentFundraiser(storage, now)
    const rendered = renderFundraiser(f, 1, previousFundraiser(storage, f))
    const sent = await client.sendText(chatId, html(rendered.text), {
        replyMarkup: buildKeyboard(rendered.page, rendered.pages),
        disableWebPreview: true,
    })
    await rememberLastMessage(storage, chatId, sent.id, f.periodKey)
}

/** Перерисовывает «последнее сообщение со сбором» для конкретного чата под актуальный месяц. */
export const refreshLastMessageInChat = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    now: Date = new Date(),
): Promise<void> => {
    const last = storage.get().lastMessages[String(chatId)]
    if (!last) return
    const f = ensureCurrentFundraiser(storage, now)
    const rendered = renderFundraiser(f, 1, previousFundraiser(storage, f))
    try {
        await client.editMessage({
            chatId: last.chatId,
            message: last.messageId,
            text: html(rendered.text),
            replyMarkup: buildKeyboard(rendered.page, rendered.pages),
            disableWebPreview: true,
        })
        if (last.periodKey !== f.periodKey) {
            await storage.update((s) => {
                const cur = s.lastMessages[String(chatId)]
                if (cur && cur.messageId === last.messageId) {
                    cur.periodKey = f.periodKey
                }
            })
        }
    } catch (err) {
        // У mtcute RpcError код лежит в `.text` (напр. 'MESSAGE_NOT_MODIFIED'), а `.message` - описание без кода.
        const msg = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
        if (/MESSAGE_NOT_MODIFIED/i.test(msg)) return
        if (/MESSAGE_ID_INVALID|MESSAGE_DELETE/i.test(msg)) {
            await storage.update((s) => {
                delete s.lastMessages[String(chatId)]
            })
            return
        }
        throw err
    }
}

/** Чат в allowlist и сообщение от обычного пользователя. Иначе - молча или с ответом, что только пользователям. */
const requireUserInAllowedChat = async (
    msg: MessageContext,
    allowed: AllowedChats,
): Promise<boolean> => {
    const chatId = Number(msg.chat.id)
    if (!isAllowedChat(allowed, chatId)) {
        // В неразрешённых чатах - полное молчание, чтобы бот не светился.
        return false
    }
    if (!msg.sender || msg.sender.type !== 'user') {
        await msg.answerText(tr('Команды доступны только пользователям.', "Commands are available to users only."))
        return false
    }
    return true
}

const adminOnlyText = () => tr('Эта команда доступна только админам этой группы.', "This command is available to this group's admins.")

/** Прошёл ли пользователь все проверки (чат в allowlist + админ). Если нет - отвечает и возвращает false. */
export const requireChatAdminInAllowedChat = async (
    residents: ResidentDirectory,
    msg: MessageContext,
    allowed: AllowedChats,
): Promise<boolean> => {
    if (!(await requireUserInAllowedChat(msg, allowed))) return false
    const chatId = Number(msg.chat.id)
    if (!(await residents.isChatAdmin(chatId, msg.sender!.id))) {
        await msg.answerText(adminOnlyText())
        return false
    }
    return true
}

export const registerHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        allowedChats: AllowedChats
        residents: ResidentDirectory
        /** Публичный URL миниаппа хостинга. null - миниапп не настроен. */
        webappUrl: string | null
    },
): void => {
    const { client, storage, allowedChats, residents, webappUrl } = deps

    /**
     * Справка в личке: резиденту - резидентский набор, остальным - что тут вообще можно.
     *
     * Наборы разные, потому что в личке нет allowlist-гейта: общий текст рассказывал бы
     * любому, кто нашёл бота, про присутствие и привязку устройств.
     */
    const answerPrivateHelp = async (msg: MessageContext): Promise<void> => {
        const resident = await residents.isResident(msg.sender!.id)
        if (!resident) {
            await msg.answerText(
                [
                    tr('Это бот хакспейса.', "This is the hackerspace bot."),
                    '',
                    webappUrl
                        ? tr('Хочешь зайти в гости - оставь заявку на визит: выбери день, время и цель, резиденты её увидят и откликнутся.', "If you'd like to visit, choose a day and time and tell us why you're coming. A resident can then offer to host you.")
                        : tr('Заявки на визит сейчас не принимаются.', "Visit requests are currently closed."),
                    '',
                    tr('/start - открыть бота', "/start — open the bot"),
                    tr('/language — язык бота и миниаппа', '/language — bot and mini app language'),
                    tr('/help - это сообщение', "/help — show this message"),
                ].join('\n'),
                {
                    replyMarkup: webappUrl
                        ? BotKeyboard.inline([[BotKeyboard.webView(tr('🚪 Оставить заявку на визит', "🚪 Request a visit"), webappAt(webappUrl, newRequestTarget()))]])
                        : undefined,
                },
            )
            return
        }
        await msg.answerText(
            [
                tr('Меню резидента:', "Resident menu:"),
                tr('/start, /menu - кто в спейсе, отметиться, MAC, принтер, миниапп', "/start, /menu — see who's at the space, check in, manage devices, check the printer, or open the mini app"),
                '',
                tr('Присутствие:', "Check-in:"),
                tr('/inside - кто сейчас в спейсе', "/inside — see who's at the space"),
                tr('Отметиться, уйти и включить «невидимку» - в меню, раздел «Отметиться»', "Use Check in in the menu to check in, check out, or turn on Invisible mode"),
                '',
                tr('Авто-отметка по MAC:', "Automatic check-in by MAC address:"),
                tr('/bindmac <MAC> [имя] - привязать устройство', "/bindmac <MAC> [name] — link a device"),
                tr('/unbindmac [MAC] - отвязать одно устройство или все', "/unbindmac [MAC] — unlink a device or all devices"),
                tr('/maclist - свои привязки и текущий статус', "/maclist — show linked devices and their status"),
                tr('/settings - отмечаться с ником или без', "/settings — choose whether to check in anonymously"),
                tr('/language — язык бота и миниаппа', '/language — bot and mini app language'),
                '',
                tr('3D-принтер:', "3D printer:"),
                tr('/printer - статус, превью печати и кадр с камеры', "/printer — view the status, print preview, and camera snapshot"),
                '',
                tr('Взносы:', "Dues:"),
                tr('Бот пишет о сборе в личку, кнопка «Я внёс» там же', "The bot messages you when dues are due. Tap “I paid” in that message when you've paid."),
                tr('Список, история и настройки - в миниаппе, раздел «Взносы»', "See the list, history, and settings under Dues in the mini app"),
                '',
                tr('Хостинг гостей, ивенты и заявки - в миниаппе', "Guest visits, events, and applications are in the mini app"),
                '',
                tr('/help - это сообщение', "/help — show this message"),
            ].join('\n'),
        )
    }

    dp.onNewMessage(filters.command('help'), async (msg) => {
        // В личке гейта allowlist нет: msg.chat.id там - это userId, и requireUserInAllowedChat
        // молча отбрасывал команду. Справка в личке - единственный способ узнать про
        // /bindmac, /maclist и /settings, которых в групповом наборе нет вовсе.
        if (msg.chat.type === 'user') {
            if (!msg.sender || msg.sender.type !== 'user') return
            await answerPrivateHelp(msg)
            return
        }
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        await msg.answerText(
            [
                tr('Присутствие в спейсе:', "Who's at the space:"),
                tr('/inside - показать список тех, кто сейчас в спейсе', "/inside — see who's at the space"),
                '',
                tr('Сборы донатов:', "Fundraisers:"),
                tr('/goals - показать текущий сбор (доступно всем участникам)', "/goals — show the current fundraiser (available to all members)"),
                tr('/history - прошлые сборы: список периодов с итогами, по кнопке - полный лидерборд', "/history — see past fundraiser totals and open each leaderboard"),
                tr('/history <период> - сразу открыть сбор за период, например: /history 2026-06', "/history <period> — open a specific fundraiser, e.g. /history 2026-06"),
                '',
                tr('Управление сбором (админ):', "Fundraiser management (admin):"),
                tr('/donate <сумма> <ник> - добавить донат', "/donate <amount> <username> — add a donation"),
                tr('/donate <сумма> - добавить анонимный донат (без ника, в списке «Анонимно»)', "/donate <amount> — add a donation under Anonymous"),
                tr('/remove <номер> - удалить все донаты участника №<номер> в лидерборде (работает и для «Анонимно»)', "/remove <rank> — remove all donations at this leaderboard rank, including Anonymous"),
                tr('/remove <ник> [сумма] - удалить один донат по нику (и опционально сумме)', "/remove <username> [amount] — remove one donation by username and optional amount"),
                tr('/setgoal <сумма> - задать цель текущего сбора (0 - снять цель)', "/setgoal <amount> — set the fundraiser goal (0 to clear)"),
                tr('/settitle <тема> - изменить тему сбора, например: /settitle аренду', "/settitle <title> — change the fundraiser title, e.g. /settitle rent"),
                tr('/setdesc <текст> - задать описание под сбором', "/setdesc <text> — set the fundraiser description"),
                tr('/setresetday <число 1–29> - день месяца, в который сбор сбрасывается (по умолчанию 1)', "/setresetday <day 1–29> — set the day of the month when the fundraiser resets (default: 1)"),
                tr('/export [all] - выгрузить донаты в CSV: текущий сбор или все периоды', "/export [all] — export donations to CSV for the current fundraiser or every period"),
                '',
                tr('Резидентские взносы:', "Resident dues:"),
                tr('Бот пишет о сборе в личку, кнопка «Я внёс» там же', "The bot messages you when dues are due. Tap “I paid” in that message when you've paid."),
                tr('Список, история и настройки - в миниаппе, раздел «Взносы»', "See the list, history, and settings under Dues in the mini app"),
                '',
                tr('Что бот присылает в этот чат (админ):', "Bot posts in this chat (admin):"),
                tr('/goalsmute - вкл/выкл ежедневную автоотправку сбора', "/goalsmute — toggle daily fundraiser posts"),
                tr('/boardmute - вкл/выкл доску «кто сегодня в спейсе»', "/boardmute — toggle the space board"),
                tr('/eventmute - вкл/выкл анонсы новых ивентов', "/eventmute — toggle new event announcements"),
                tr('/announcemute - вкл/выкл анонсы обновлений и объявления', "/announcemute — toggle bot updates and announcements"),
                '',
                tr('/help - это сообщение', "/help — show this message"),
            ].join('\n'),
        )
    })

    dp.onNewMessage(filters.command('inside'), async (msg) => {
        // В личке /inside просто отдаёт текущий список текстом - без привязки к сообщению чата.
        // В личке web_app-кнопки разрешены, поэтому открываем миниапп хостинга напрямую.
        if (msg.chat.type === 'user') {
            // Кто внутри - это данные о резидентах, а не публичная витрина: в группе
            // список видят участники allowlist-чата, значит и в личке - только они.
            // Гостю миниаппа и постороннему тут отвечать нечем.
            if (!msg.sender || msg.sender.type !== 'user') return
            if (!(await residents.isMember(msg.sender.id))) {
                await msg.answerText(
                    webappUrl
                        ? tr('Список тех, кто в спейсе, виден участникам сообщества. Если хочешь зайти в гости - оставь заявку на визит.', "The list of who's at the space is visible to community members. You can submit a visit request if you'd like to stop by.")
                        : tr('Список тех, кто в спейсе, виден участникам сообщества.', "The list of who's at the space is visible to community members."),
                    {
                        replyMarkup: webappUrl
                            ? BotKeyboard.inline([[BotKeyboard.webView(tr('🚪 Оставить заявку на визит', "🚪 Request a visit"), webappAt(webappUrl, newRequestTarget()))]])
                            : undefined,
                    },
                )
                return
            }
            await msg.answerText(html(renderPresenceText(storage)), {
                disableWebPreview: true,
                replyMarkup: webappUrl
                    ? BotKeyboard.inline([[BotKeyboard.webView(tr('🚪 Хочу прийти', "🚪 Request a visit"), webappAt(webappUrl, newRequestTarget()))]])
                    : undefined,
            })
            return
        }
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        // Разовый снимок списка присутствующих: постоянная поверхность - доска (/boardmute).
        await postPresenceList(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('komanda'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        let set
        try {
            set = await client.getStickerSet('komoji23')
        } catch (err) {
            console.warn('[warn] не удалось получить набор эмодзи komoji23:', err)
            await msg.answerText(tr('Не удалось получить набор эмодзи.', "Couldn't get the emoji pack."))
            return
        }
        const first = set.stickers[0]
        if (!first) {
            await msg.answerText(tr('В наборе нет эмодзи.', "The pack has no emojis."))
            return
        }
        const id = first.sticker.customEmojiId.toString()
        const alt = html.escape(first.alt || '🙂')
        await msg.replyText(html(`<emoji id="${id}">${alt}</emoji>`))
    })

    dp.onNewMessage(filters.command('goals'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        const f = ensureCurrentFundraiser(storage)
        const rendered = renderFundraiser(f, 1, previousFundraiser(storage, f))
        const sent = await msg.answerText(html(rendered.text), {
            replyMarkup: buildKeyboard(rendered.page, rendered.pages),
            disableWebPreview: true,
        })
        await rememberLastMessage(storage, Number(msg.chat.id), sent.id, f.periodKey)
    })

    // /history [период] - прошлые сборы. Без аргумента - список периодов с кнопками,
    // с аргументом (`2026-06` или `2026-06-25` для нестандартного дня сброса) - сразу сбор.
    // Сообщение НЕ запоминается как «последнее со сбором»: иначе шедулер смены периода
    // перерисовал бы историю в текущий сбор.
    dp.onNewMessage(filters.command('history'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        const past = historyOf(storage)
        const arg = (msg.command[1] ?? '').trim()

        if (arg) {
            if (!/^\d{4}-\d{2}(-\d{2})?$/.test(arg)) {
                await msg.answerText(tr('Период указывается как 2026-06 (год-месяц). Список прошлых сборов - /history без аргументов.', "Use a period like 2026-06 (year-month). Run /history without a period to list past fundraisers."))
                return
            }
            const f = past.find((x) => x.periodKey === arg || x.periodKey.startsWith(arg + '-'))
            if (!f) {
                await msg.answerText(tr(`Не нашёл сбор за ${arg}. Список прошлых сборов - /history без аргументов.`, `No fundraiser found for ${arg}. Run /history without a period to list past fundraisers.`))
                return
            }
            const rendered = renderFundraiser(f, 1)
            await msg.answerText(html(rendered.text), {
                replyMarkup: historyEntryKeyboard(f.periodKey, rendered.page, rendered.pages),
                disableWebPreview: true,
            })
            return
        }

        const shown = past.slice(0, HISTORY_LIMIT)
        await msg.answerText(html(renderHistoryList(shown, past.length > shown.length)), {
            replyMarkup: historyListKeyboard(shown),
            disableWebPreview: true,
        })
    })

    // /export [all] - выгрузка донатов в CSV. Без аргумента - текущий сбор, `all` - все сборы.
    // Только для админов: это выгрузка для отчётности.
    dp.onNewMessage(filters.command('export'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const wantsAll = (msg.command[1] ?? '').toLowerCase() === 'all'
        const state = storage.get()

        let fundraisers: Fundraiser[]
        let fileName: string
        if (wantsAll) {
            fundraisers = Object.values(state.fundraisers)
            fileName = 'donations-all.csv'
        } else {
            const f = ensureCurrentFundraiser(storage)
            fundraisers = [f]
            fileName = `donations-${f.periodKey}.csv`
        }

        const donationCount = fundraisers.reduce((n, f) => n + f.donations.length, 0)
        if (donationCount === 0) {
            await msg.answerText(wantsAll ? tr('Пока нет ни одного доната.', "There are no donations yet.") : tr('В текущем сборе пока нет донатов.', "There are no donations in the current fundraiser yet."))
            return
        }

        // BOM (U+FEFF) в начале - чтобы Excel открыл кириллицу в UTF-8 без «крякозябр».
        const csv = Buffer.from(String.fromCharCode(0xfeff) + buildDonationsCsv(fundraisers), 'utf8')
        await msg.answerMedia(
            InputMedia.document(csv, {
                fileName,
                fileMime: 'text/csv',
                caption: html(tr(`Выгрузка донатов (${donationCount} шт.).`, `Donation export (${donationCount}).`)),
            }),
        )
    })

    /**
     * Мьюты — настройка чата, а не человека: включённая обратно доска или анонсы ничем
     * не отличаются от никогда не выключавшихся, и кто их трогал, из стейта не узнать.
     */
    const auditMute = (msg: MessageContext, what: string, enabled: boolean): void =>
        audit({
            action: 'chat.mute',
            actor: auditUser(msg.sender!),
            text: `${enabled ? 'включил' : 'выключил'} ${what} в чате ${msg.chat.id}`,
        })

    dp.onNewMessage(filters.command('goalsmute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().goalsMuted[key]
        await storage.update((s) => {
            if (muted) delete s.goalsMuted[key]
            else s.goalsMuted[key] = true
        })
        auditMute(msg, 'автоотправку сбора', Boolean(muted))
        await msg.answerText(
            muted
                ? tr('Автоотправка сбора в этот чат снова включена (12:00 по МСК).', "Daily fundraiser posts in this chat are back on (12:00 Moscow time).")
                : tr('Автоотправка сбора в этот чат отключена. Ручной /goals по-прежнему работает. Повторный /goalsmute включит её обратно.', "Daily fundraiser posts in this chat are off. You can still use /goals. Run /goalsmute again to turn them back on."),
        )
    })

    // /announcemute - вкл/выкл анонсы (рассылку обновлений/объявлений) в этот чат.
    // Настройка чата, поэтому только для админов. Сами анонсы шлёт дев из миниаппа.
    dp.onNewMessage(filters.command('announcemute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().announceMuted[key]
        await storage.update((s) => {
            if (muted) delete s.announceMuted[key]
            else s.announceMuted[key] = true
        })
        auditMute(msg, 'анонсы и объявления', Boolean(muted))
        await msg.answerText(
            muted
                ? tr('Анонсы (обновления бота и объявления) снова будут приходить в этот чат. Выключить - /announcemute.', "Bot updates and announcements are back on in this chat. Run /announcemute to turn them off.")
                : tr('Больше не буду присылать анонсы в этот чат. Включить обратно - /announcemute.', "Bot announcements are off in this chat. Run /announcemute to turn them back on."),
        )
    })

    // /eventmute - вкл/выкл анонсы новых ивентов в этот чат. Настройка чата - только админам.
    dp.onNewMessage(filters.command('eventmute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().eventsMuted[key]
        await storage.update((s) => {
            if (muted) delete s.eventsMuted[key]
            else s.eventsMuted[key] = true
        })
        auditMute(msg, 'анонсы новых ивентов', Boolean(muted))
        await msg.answerText(
            muted
                ? tr('Анонсы новых ивентов снова будут приходить в этот чат. Выключить - /eventmute.', "New event announcements are back on in this chat. Run /eventmute to turn them off.")
                : tr('Больше не буду присылать анонсы новых ивентов в этот чат. Включить обратно - /eventmute.', "New event announcements are off in this chat. Run /eventmute to turn them back on."),
        )
    })

    // /boardmute - вкл/выкл доску «кто сегодня в спейсе» в этом чате. Настройка чата - только админам.
    // Замьютили: шедулер откреплит и забудет висящую доску на ближайшем тике (≤60 с).
    dp.onNewMessage(filters.command('boardmute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().hostingBoardMuted[key]
        await storage.update((s) => {
            if (muted) delete s.hostingBoardMuted[key]
            else s.hostingBoardMuted[key] = true
        })
        auditMute(msg, 'доску «кто сегодня в спейсе»', Boolean(muted))
        await msg.answerText(
            muted
                ? tr('Доска «кто сегодня в спейсе» снова включена в этом чате. Выключить - /boardmute.', "The space board is back on in this chat. Run /boardmute to turn it off.")
                : tr('Доска «кто сегодня в спейсе» отключена в этом чате - открепляю. Включить обратно - /boardmute.', "The space board is off and has been unpinned. Run /boardmute to turn it back on."),
        )
    })

    dp.onNewMessage(filters.command('donate'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        if (!(await residents.isChatAdmin(Number(msg.chat.id), msg.sender!.id))) {
            // Учёт донатов ведёт админ, но набравший /donate обычно хочет перевести
            // деньги, а не записать чужой перевод: отвечаем ему описанием сбора
            // (/setdesc - там реквизиты). Описания нет - остаётся прежний отказ,
            // иначе на месте ответа оказывается пустота.
            const description = (ensureCurrentFundraiser(storage).description ?? '').trim()
            if (description) {
                await msg.answerText(html(renderDescription(description)), { disableWebPreview: true })
            } else {
                await msg.answerText(adminOnlyText())
            }
            return
        }
        const args = msg.command.slice(1)
        const parsed = parseDonateArgs(args)
        if (typeof parsed === 'string') {
            await msg.answerText(parsed)
            return
        }
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.donations.push({
                nick: parsed.nick,
                amount: parsed.amount,
                addedAt: new Date().toISOString(),
            })
        })
        const who = parsed.nick === '' ? anonymousDonorLabel() : `@${parsed.nick}`
        await msg.answerText(tr(`Добавил: ${who} - ${formatMoney(parsed.amount, f.currency)}.`, `Added: ${who} — ${formatMoney(parsed.amount, f.currency)}.`))
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('setgoal'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const arg = msg.command[1]
        if (arg === undefined) {
            await msg.answerText(tr('Использование: /setgoal <сумма> (0 - снять цель)', "Usage: /setgoal <amount> (0 to clear)"))
            return
        }
        const value = Number(arg.replace(',', '.'))
        if (!Number.isFinite(value) || value < 0) {
            await msg.answerText(tr('Сумма должна быть неотрицательным числом.', "The amount must be zero or greater."))
            return
        }
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.goal = value
        })
        await msg.answerText(value > 0 ? tr(`Цель установлена: ${formatMoney(value, f.currency)}.`, `Goal set to ${formatMoney(value, f.currency)}.`) : tr('Цель снята.', "Goal cleared."))
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('settitle'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const title = msg.command.slice(1).join(' ').trim()
        if (!title) {
            await msg.answerText(tr('Использование: /settitle <тема>, например: /settitle аренду', "Usage: /settitle <title>, e.g. /settitle rent"))
            return
        }
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.title = title
        })
        await msg.answerText(tr(`Тема сбора: «${title}».`, `Fundraiser title: “${title}”.`))
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('setdesc'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        // Берём сырой текст (msg.command схлопывает переносы) и срезаем саму команду,
        // чтобы сохранить многострочное описание с реквизитами как есть.
        const raw = (msg.text ?? '').replace(/^\/setdesc(@\S+)?\s*/i, '')
        const description = raw.trim()
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.description = description
        })
        await msg.answerText(
            description
                ? tr('Описание сбора обновлено.', "Fundraiser description updated.")
                : tr('Описание сбора убрано.', "Fundraiser description removed."),
        )
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('setresetday'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const arg = msg.command[1]
        if (arg === undefined || !/^\d+$/.test(arg)) {
            await msg.answerText(tr(`Использование: /setresetday <число ${MIN_RESET_DAY}–${MAX_RESET_DAY}> - день месяца, когда сбор сбрасывается.`, `Usage: /setresetday <day ${MIN_RESET_DAY}–${MAX_RESET_DAY}> — set the day of the month when the fundraiser resets.`))
            return
        }
        const value = Number(arg)
        if (value < MIN_RESET_DAY || value > MAX_RESET_DAY) {
            await msg.answerText(tr(`День сброса должен быть от ${MIN_RESET_DAY} до ${MAX_RESET_DAY} (ограничение для совместимости со всеми месяцами).`, `The reset day must be between ${MIN_RESET_DAY} and ${MAX_RESET_DAY}.`))
            return
        }
        const resetDay = clampResetDay(value)
        // Смена дня сброса меняет и формулу ключа периода: то, что было «текущим сбором»,
        // мгновенно становится прошлым, а на его месте заводится пустой. Раньше об этом
        // не говорилось ни слова, и админ считал, что донаты пропали.
        const now = new Date()
        const beforeKey = periodKeyOf(now, storage.get().resetDay)
        const movedDonations = storage.get().fundraisers[beforeKey]?.donations.length ?? 0
        const afterKey = periodKeyOf(now, resetDay)
        await storage.update((s) => {
            s.resetDay = resetDay
        })
        const lines = [tr(`Сбор теперь сбрасывается ${resetDay} числа каждого месяца.`, `The fundraiser now resets on day ${resetDay} of every month.`)]
        if (afterKey !== beforeKey) {
            lines.push(
                movedDonations > 0
                    ? tr(`Текущий период при этом сменился: прошлый сбор (донатов: ${movedDonations}) ушёл в /history, новый начат с нуля — цель, тема и описание перенесены.`, `The period changed. The previous fundraiser (${movedDonations} donations) moved to /history. The new one starts at zero with the same goal, title, and description.`)
                    : tr('Текущий период при этом сменился — начат новый сбор с теми же целью, темой и описанием.', "The period changed. A new fundraiser has started with the same goal, title, and description."),
            )
        }
        await msg.answerText(lines.join('\n'))
        // День сброса мог сменить «текущий» период - перерисуем запомненное сообщение.
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('remove'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const args = msg.command.slice(1)
        const spec = parseRemoveArgs(args)
        if (typeof spec === 'string') {
            await msg.answerText(spec)
            return
        }
        const f = ensureCurrentFundraiser(storage)

        if (spec.kind === 'index') {
            const board = buildLeaderboard(f)
            const i = spec.index - 1
            if (i < 0 || i >= board.length) {
                await msg.answerText(tr(`Нет доната под номером ${spec.index}.`, `No donation found at rank ${spec.index}.`))
                return
            }
            const entry = board[i]!
            const isAnon = isAnonNick(entry.nick)
            const wantedNick = entry.nick.toLowerCase()
            const total = entry.total
            await storage.update(() => {
                f.donations = f.donations.filter((d) =>
                    isAnon ? !isAnonNick(d.nick) : d.nick.toLowerCase() !== wantedNick,
                )
            })
            const who = isAnon ? anonymousDonorLabel() : `@${entry.nick}`
            await msg.answerText(tr(`Удалил все донаты ${who} (всего ${formatMoney(total, f.currency)}).`, `Removed all donations from ${who} (${formatMoney(total, f.currency)} total).`))
        } else {
            const wantedNick = spec.nick.toLowerCase()
            const idx = f.donations.findIndex((d) => {
                if (d.nick.toLowerCase() !== wantedNick) return false
                return !(spec.amount !== undefined && d.amount !== spec.amount);

            })
            if (idx < 0) {
                const donor = `@${spec.nick}`
                await msg.answerText(spec.amount === undefined
                    ? tr(`Не нашёл доната от ${donor}.`, `No donation found from ${donor}.`)
                    : tr(`Не нашёл доната от ${donor} на ${spec.amount}.`, `No donation of ${spec.amount} found from ${donor}.`))
                return
            }
            const removed = f.donations[idx]!
            await storage.update(() => {
                f.donations.splice(idx, 1)
            })
            await msg.answerText(tr(`Удалил: @${removed.nick} - ${formatMoney(removed.amount, f.currency)}.`, `Removed: @${removed.nick} — ${formatMoney(removed.amount, f.currency)}.`))
        }
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    // История сборов: список ↔ конкретный сбор с пагинацией лидерборда.
    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null) return PropagationAction.Continue
        const isList = data === HISTORY_LIST_CALLBACK
        const isOpen = data.startsWith(HISTORY_OPEN_PREFIX)
        if (!isList && !isOpen) return PropagationAction.Continue

        const chatId = Number(ctx.chat.id)
        if (!isAllowedChat(allowedChats, chatId)) {
            await ctx.answer({ text: tr('Бот в этой группе не работает.', "The bot is inactive in this group."), alert: true })
            return
        }

        const past = historyOf(storage)
        let text: string
        let replyMarkup: ReturnType<typeof BotKeyboard.inline> | undefined
        let answer: string
        if (isList) {
            const shown = past.slice(0, HISTORY_LIMIT)
            text = renderHistoryList(shown, past.length > shown.length)
            replyMarkup = historyListKeyboard(shown)
            answer = tr('История сборов', "Fundraiser history")
        } else {
            // `<periodKey>:<page>` - ключ сам содержит дефисы, но не двоеточия.
            const rest = data.slice(HISTORY_OPEN_PREFIX.length)
            const sep = rest.lastIndexOf(':')
            const periodKey = sep < 0 ? rest : rest.slice(0, sep)
            const f = past.find((x) => x.periodKey === periodKey)
            if (!f) {
                await ctx.answer({ text: tr('Этот сбор больше недоступен.', "This fundraiser is no longer available."), alert: true })
                return
            }
            const requested = sep < 0 ? 1 : Number(rest.slice(sep + 1))
            const pages = totalPages(buildLeaderboard(f))
            const rendered = renderFundraiser(f, clampPage(Number.isFinite(requested) ? requested : 1, pages))
            text = rendered.text
            replyMarkup = historyEntryKeyboard(f.periodKey, rendered.page, rendered.pages)
            answer = pages > 1 ? tr(`Страница ${rendered.page}`, `Page ${rendered.page}`) : fundraiserPeriodLabel(f)
        }

        try {
            await ctx.editMessage({ text: html(text), replyMarkup, disableWebPreview: true })
            await ctx.answer({ text: answer })
        } catch (err) {
            const msg = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
            if (/MESSAGE_NOT_MODIFIED/i.test(msg)) {
                await ctx.answer({ text: tr('Уже актуально', "Already up to date") })
                return
            }
            throw err
        }
    })

    // Пагинация лидерборда. Кнопки «Обновить» тут нет и не было в разметке: сообщение
    // сбора и так перерисовывается само на каждую правку (refreshLastMessageInChat).
    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null) return PropagationAction.Continue
        if (!data.startsWith(PAGE_CALLBACK_PREFIX)) return PropagationAction.Continue

        const chatId = Number(ctx.chat.id)
        if (!isAllowedChat(allowedChats, chatId)) {
            await ctx.answer({ text: tr('Бот в этой группе не работает.', "The bot is inactive in this group."), alert: true })
            return
        }

        const f = ensureCurrentFundraiser(storage)
        const n = Number(data.slice(PAGE_CALLBACK_PREFIX.length))
        const pages = totalPages(buildLeaderboard(f))
        const requestedPage = clampPage(Number.isFinite(n) ? n : 1, pages)
        const rendered = renderFundraiser(f, requestedPage, previousFundraiser(storage, f))

        const messageId = ctx.messageId
        try {
            await ctx.editMessage({
                text: html(rendered.text),
                replyMarkup: buildKeyboard(rendered.page, rendered.pages),
                disableWebPreview: true,
            })
            await rememberLastMessage(storage, chatId, messageId, f.periodKey)
            await ctx.answer({ text: tr(`Страница ${rendered.page}`, `Page ${rendered.page}`) })
        } catch (err) {
            const text = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
            if (/MESSAGE_NOT_MODIFIED/i.test(text)) {
                await ctx.answer({ text: tr('Уже актуально', "Already up to date") })
                return
            }
            throw err
        }
    })
}
