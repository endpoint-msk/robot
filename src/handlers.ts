import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import {
    buildDonationsCsv,
    buildLeaderboard,
    createFundraiser,
    isAnonNick,
    ANON_LABEL,
    parseDonateArgs,
    parseRemoveArgs,
    periodAnchorOf,
    periodKeyOf,
    previousPeriodKey,
    renderFundraiser,
    totalPages,
    clampPage,
    clampResetDay,
    MIN_RESET_DAY,
    MAX_RESET_DAY,
} from './fundraiser.js'
import { renderPresenceText, upsertPresenceListInChat } from './presence.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { Fundraiser, State } from './types.js'

const REFRESH_CALLBACK = 'fundraiser:refresh'
const PAGE_CALLBACK_PREFIX = 'fundraiser:page:'

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
    // Пустая inline-клавиатура (одна страница, нет стрелок) — это REPLY_MARKUP_INVALID.
    // Возвращаем undefined, чтобы сообщение ушло вообще без разметки.
    if (rows.length === 0) return undefined
    return BotKeyboard.inline(rows)
}

/** Самый поздний из уже существующих сборов (по periodKey). undefined — если сборов ещё нет. */
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
        // Тема и описание (реквизиты/ссылки) — «липкие» настройки: переносим их
        // с прошлого сбора, чтобы на новом периоде не сбрасывались к дефолту.
        // Цель (goal) намеренно НЕ переносим — она своя на каждый период.
        const prev = latestFundraiser(state)
        f = createFundraiser(year, month, { title: prev?.title, description: prev?.description }, state.resetDay)
        state.fundraisers[key] = f
    }
    return f
}

/** Сбор за предыдущий период относительно текущего, если он есть. */
const previousFundraiser = (storage: Storage, current: Fundraiser): Fundraiser | undefined =>
    storage.get().fundraisers[previousPeriodKey(current.year, current.month, storage.get().resetDay)]

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
        // У mtcute RpcError код лежит в `.text` (напр. 'MESSAGE_NOT_MODIFIED'), а `.message` — описание без кода.
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

/** Чат в allowlist и сообщение от обычного пользователя. Иначе — молча или с ответом, что только пользователям. */
const requireUserInAllowedChat = async (
    msg: MessageContext,
    allowed: AllowedChats,
): Promise<boolean> => {
    const chatId = Number(msg.chat.id)
    if (!isAllowedChat(allowed, chatId)) {
        // В неразрешённых чатах — полное молчание, чтобы бот не светился.
        return false
    }
    if (!msg.sender || msg.sender.type !== 'user') {
        await msg.answerText('Команды доступны только пользователям.')
        return false
    }
    return true
}

/** Прошёл ли пользователь все проверки (чат в allowlist + админ). Если нет — отвечает и возвращает false. */
const requireChatAdminInAllowedChat = async (
    residents: ResidentDirectory,
    msg: MessageContext,
    allowed: AllowedChats,
): Promise<boolean> => {
    if (!(await requireUserInAllowedChat(msg, allowed))) return false
    const chatId = Number(msg.chat.id)
    if (!(await residents.isChatAdmin(chatId, msg.sender!.id))) {
        await msg.answerText('Эта команда доступна только админам этой группы.')
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
        /** Публичный URL миниаппа хостинга. null — миниапп не настроен. */
        webappUrl: string | null
    },
): void => {
    const { client, storage, allowedChats, residents, webappUrl } = deps

    dp.onNewMessage(filters.command('help'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        await msg.answerText(
            [
                'Бот хакерспейса. Часть команд доступна любому участнику, часть — только админам группы.',
                '',
                'Присутствие в спейсе:',
                '/inside — показать (или обновить) список тех, кто сейчас в спейсе',
                '/insidemute — вкл/выкл автоматическую рассылку списка в этот чат (только админы)',
                'Отметиться, уйти и привязать MAC для авто-отметок — в личке с ботом (/start).',
                '',
                '3D-принтер:',
                '/printer — статус принтера, превью печати и подписка на уведомление об окончании',
                '',
                'Прочее:',
                '/boardmute — вкл/выкл доску «кто сегодня в спейсе» в этом чате (только админы)',
                '/announcemute — вкл/выкл анонсы (обновления бота и объявления) в этот чат (только админы)',
                '',
                'Сборы донатов:',
                '/goals — показать текущий сбор (доступно всем участникам)',
                '',
                'Управление сбором (только админы):',
                '/goalsmute — вкл/выкл автоотправку сбора в этот чат (00:00 и 12:00 по МСК)',
                '/donate <сумма> <ник> — добавить донат',
                '/donate <сумма> — добавить анонимный донат (без ника, в списке «Анонимно»)',
                '/remove <номер> — удалить все донаты участника №<номер> в лидерборде (работает и для «Анонимно»)',
                '/remove <ник> [сумма] — удалить один донат по нику (и опционально сумме)',
                '/setgoal <сумма> — задать цель текущего сбора (0 — снять цель)',
                '/settitle <тема> — изменить тему сбора, например: /settitle аренду',
                '/setdesc <текст> — задать описание под сбором (реквизиты/ссылки, можно в несколько строк; без текста — убрать)',
                '/setresetday <число 1–29> — день месяца, в который сбор сбрасывается (по умолчанию 1)',
                '/export — выгрузить донаты текущего сбора в CSV; /export all — за все периоды',
                'С новым периодом сбор обновляется автоматически; каждый день в 00:00 и 12:00 по МСК бот постит свежее сообщение со сбором.',
                '',
                '/help — это сообщение',
            ].join('\n'),
        )
    })

    dp.onNewMessage(filters.command('inside'), async (msg) => {
        // В личке /inside просто отдаёт текущий список текстом — без привязки к сообщению чата.
        // В личке web_app-кнопки разрешены, поэтому открываем миниапп хостинга напрямую.
        if (msg.chat.type === 'user') {
            await msg.answerText(html(renderPresenceText(storage)), {
                disableWebPreview: true,
                replyMarkup: webappUrl
                    ? BotKeyboard.inline([[BotKeyboard.webView('🚪 Хочу прийти', webappUrl)]])
                    : undefined,
            })
            return
        }
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        // Всегда новое сообщение — это и есть «принудительный вызов».
        await upsertPresenceListInChat(client, storage, Number(msg.chat.id), 'new')
    })

    // /insidemute — включить/выключить АВТОМАТИЧЕСКУЮ рассылку списка присутствующих в этот чат
    // (пуш по тишине ≥ 5ч и авто-восстановление удалённого списка). Ручной /inside работает всегда.
    // Касается только сообщений в чат, не авто-отметок по MAC. Только для админов: это настройка чата.
    dp.onNewMessage(filters.command('insidemute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const wasMuted = storage.get().presenceAutoMuted[String(chatId)] === true
        await storage.update((s) => {
            if (wasMuted) delete s.presenceAutoMuted[String(chatId)]
            else s.presenceAutoMuted[String(chatId)] = true
        })
        await msg.answerText(
            wasMuted
                ? 'Снова буду сам присылать список присутствующих в этот чат (при долгой тишине). Выключить — /insidemute.'
                : 'Больше не буду сам присылать список присутствующих в этот чат. Ручной /inside по-прежнему работает. Включить обратно — /insidemute.',
        )
    })

    dp.onNewMessage(filters.command('komanda'), async (msg) => {
        if (!(await requireUserInAllowedChat(msg, allowedChats))) return
        let set
        try {
            set = await client.getStickerSet('komoji23')
        } catch (err) {
            console.warn('[warn] не удалось получить набор эмодзи komoji23:', err)
            await msg.answerText('Не удалось получить набор эмодзи.')
            return
        }
        const first = set.stickers[0]
        if (!first) {
            await msg.answerText('В наборе нет эмодзи.')
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

    // /export [all] — выгрузка донатов в CSV. Без аргумента — текущий сбор, `all` — все сборы.
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
            await msg.answerText(wantsAll ? 'Пока нет ни одного доната.' : 'В текущем сборе пока нет донатов.')
            return
        }

        // BOM (U+FEFF) в начале — чтобы Excel открыл кириллицу в UTF-8 без «крякозябр».
        const csv = Buffer.from(String.fromCharCode(0xfeff) + buildDonationsCsv(fundraisers), 'utf8')
        await msg.answerMedia(
            InputMedia.document(csv, {
                fileName,
                fileMime: 'text/csv',
                caption: html(`Выгрузка донатов (${donationCount} шт.).`),
            }),
        )
    })

    dp.onNewMessage(filters.command('goalsmute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().goalsMuted[key] === true
        await storage.update((s) => {
            if (muted) delete s.goalsMuted[key]
            else s.goalsMuted[key] = true
        })
        await msg.answerText(
            muted
                ? 'Автоотправка сбора в этот чат снова включена (00:00 и 12:00 по МСК).'
                : 'Автоотправка сбора в этот чат отключена. Ручной /goals по-прежнему работает. Повторный /goalsmute включит её обратно.',
        )
    })

    // /announcemute — вкл/выкл анонсы (рассылку обновлений/объявлений) в этот чат.
    // Настройка чата, поэтому только для админов. Сами анонсы шлёт дев из миниаппа.
    dp.onNewMessage(filters.command('announcemute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().announceMuted[key] === true
        await storage.update((s) => {
            if (muted) delete s.announceMuted[key]
            else s.announceMuted[key] = true
        })
        await msg.answerText(
            muted
                ? 'Анонсы (обновления бота и объявления) снова будут приходить в этот чат. Выключить — /announcemute.'
                : 'Больше не буду присылать анонсы в этот чат. Включить обратно — /announcemute.',
        )
    })

    // /boardmute — вкл/выкл доску «кто сегодня в спейсе» в этом чате. Настройка чата — только админам.
    // Замьютили: шедулер откреплит и забудет висящую доску на ближайшем тике (≤60 с).
    dp.onNewMessage(filters.command('boardmute'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        const muted = storage.get().hostingBoardMuted[key] === true
        await storage.update((s) => {
            if (muted) delete s.hostingBoardMuted[key]
            else s.hostingBoardMuted[key] = true
        })
        await msg.answerText(
            muted
                ? 'Доска «кто сегодня в спейсе» снова включена в этом чате. Выключить — /boardmute.'
                : 'Доска «кто сегодня в спейсе» отключена в этом чате — открепляю. Включить обратно — /boardmute.',
        )
    })

    dp.onNewMessage(filters.command('donate'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
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
        const who = parsed.nick === '' ? ANON_LABEL : `@${parsed.nick}`
        await msg.answerText(`Добавил: ${who} — ${parsed.amount}${f.currency}.`)
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('setgoal'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const arg = msg.command[1]
        if (arg === undefined) {
            await msg.answerText('Использование: /setgoal <сумма> (0 — снять цель)')
            return
        }
        const value = Number(arg.replace(',', '.'))
        if (!Number.isFinite(value) || value < 0) {
            await msg.answerText('Сумма должна быть неотрицательным числом.')
            return
        }
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.goal = value
        })
        await msg.answerText(value > 0 ? `Цель установлена: ${value}${f.currency}.` : 'Цель снята.')
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('settitle'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const title = msg.command.slice(1).join(' ').trim()
        if (!title) {
            await msg.answerText('Использование: /settitle <тема>, например: /settitle аренду')
            return
        }
        const f = ensureCurrentFundraiser(storage)
        await storage.update(() => {
            f.title = title
        })
        await msg.answerText(`Тема сбора: «${title}».`)
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
                ? 'Описание сбора обновлено.'
                : 'Описание сбора убрано.',
        )
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onNewMessage(filters.command('setresetday'), async (msg) => {
        if (!(await requireChatAdminInAllowedChat(residents, msg, allowedChats))) return
        const arg = msg.command[1]
        if (arg === undefined || !/^\d+$/.test(arg)) {
            await msg.answerText(`Использование: /setresetday <число ${MIN_RESET_DAY}–${MAX_RESET_DAY}> — день месяца, когда сбор сбрасывается.`)
            return
        }
        const value = Number(arg)
        if (value < MIN_RESET_DAY || value > MAX_RESET_DAY) {
            await msg.answerText(`День сброса должен быть от ${MIN_RESET_DAY} до ${MAX_RESET_DAY} (ограничение для совместимости со всеми месяцами).`)
            return
        }
        const resetDay = clampResetDay(value)
        await storage.update((s) => {
            s.resetDay = resetDay
        })
        await msg.answerText(`Сбор теперь сбрасывается ${resetDay} числа каждого месяца.`)
        // День сброса мог сменить «текущий» период — перерисуем запомненное сообщение.
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
                await msg.answerText(`Нет доната под номером ${spec.index}.`)
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
            const who = isAnon ? ANON_LABEL : `@${entry.nick}`
            await msg.answerText(`Удалил все донаты ${who} (всего ${total}${f.currency}).`)
        } else {
            const wantedNick = spec.nick.toLowerCase()
            const idx = f.donations.findIndex((d) => {
                if (d.nick.toLowerCase() !== wantedNick) return false
                if (spec.amount !== undefined && d.amount !== spec.amount) return false
                return true
            })
            if (idx < 0) {
                await msg.answerText(`Не нашёл доната${spec.amount !== undefined ? ` от @${spec.nick} на ${spec.amount}` : ` от @${spec.nick}`}.`)
                return
            }
            const removed = f.donations[idx]!
            await storage.update(() => {
                f.donations.splice(idx, 1)
            })
            await msg.answerText(`Удалил: @${removed.nick} — ${removed.amount}${f.currency}.`)
        }
        await refreshLastMessageInChat(client, storage, Number(msg.chat.id))
    })

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null) return PropagationAction.Continue
        const isRefresh = data === REFRESH_CALLBACK
        const isPage = data.startsWith(PAGE_CALLBACK_PREFIX)
        if (!isRefresh && !isPage) return PropagationAction.Continue

        const chatId = Number(ctx.chat.id)
        if (!isAllowedChat(allowedChats, chatId)) {
            await ctx.answer({ text: 'Бот в этой группе не работает.', alert: true })
            return
        }
        // Листать страницы может любой участник; «Обновить» — только админы.
        if (isRefresh && !(await residents.isChatAdmin(chatId, ctx.user.id))) {
            await ctx.answer({ text: 'Кнопка доступна только админам этой группы.', alert: true })
            return
        }

        const f = ensureCurrentFundraiser(storage)
        // На «Обновить» всегда первая страница; на стрелки — указанная.
        let requestedPage = 1
        if (isPage) {
            const n = Number(data.slice(PAGE_CALLBACK_PREFIX.length))
            const pages = totalPages(buildLeaderboard(f))
            requestedPage = clampPage(Number.isFinite(n) ? n : 1, pages)
        }
        const rendered = renderFundraiser(f, requestedPage, previousFundraiser(storage, f))

        const messageId = ctx.messageId
        try {
            await ctx.editMessage({
                text: html(rendered.text),
                replyMarkup: buildKeyboard(rendered.page, rendered.pages),
                disableWebPreview: true,
            })
            await rememberLastMessage(storage, chatId, messageId, f.periodKey)
            await ctx.answer({ text: isRefresh ? 'Обновлено' : `Страница ${rendered.page}` })
        } catch (err) {
            const text = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
            if (/MESSAGE_NOT_MODIFIED/i.test(text)) {
                await ctx.answer({ text: 'Уже актуально' })
                return
            }
            throw err
        }
    })
}
