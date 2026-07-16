import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import {
    checkInResident,
    macHintFor,
    removePresence,
    renderPresenceText,
} from './presence.js'
import type { ResidentDirectory } from './residents.js'
import {
    ACTIVE_STATES,
    fetchPrinterStatus,
    fetchPrinterThumbnail,
    fetchWebcamSnapshot,
    renderStatus,
    type PrinterStatus,
} from './printer.js'
import type { Storage } from './storage.js'

const CB_ROOT = 'menu:root'
const CB_INSIDE = 'menu:inside'
const CB_PRESENCE = 'menu:presence'
const CB_CHECKIN_NICK = 'menu:checkin:nick'
const CB_CHECKIN_ANON = 'menu:checkin:anon'
const CB_CHECKOUT = 'menu:checkout'
const CB_MAC = 'menu:mac'
const CB_PRINTER = 'menu:printer'
const CB_PRINTER_PREVIEW = 'menu:printer:preview'
const CB_PRINTER_CAMERA = 'menu:printer:camera'

const BACK_ROW = [BotKeyboard.callback('⬅️ Назад', CB_ROOT)]

/** Корневое меню. Галочка у «Отметиться» отражает, отмечен ли резидент. Принтер — только если подключён. */
const rootKeyboard = (storage: Storage, userId: number, hasPrinter: boolean, webappUrl: string | null) => {
    const present = storage.get().presence[String(userId)] !== undefined
    const rows: Parameters<typeof BotKeyboard.inline>[0] = [
        [BotKeyboard.callback('Кто в спейсе', CB_INSIDE)],
        [BotKeyboard.callback(`${present ? '✅' : '☐'} Отметиться`, CB_PRESENCE)],
        [BotKeyboard.callback('Авто-отметка по MAC', CB_MAC)],
    ]
    if (hasPrinter) rows.push([BotKeyboard.callback('3D-принтер', CB_PRINTER)])
    // web_app-кнопка (в личке разрешена): миниапп с заявками гостей на визит.
    if (webappUrl) rows.push([BotKeyboard.webView('🚪 Хостинг гостей', webappUrl)])
    return BotKeyboard.inline(rows)
}

const ROOT_TEXT = 'Главное меню. Выбери раздел:'

/** Раздел «Отметиться / уйти»: кнопки зависят от того, отмечен ли уже резидент. */
const presenceSection = (storage: Storage, userId: number): { text: string; keyboard: ReturnType<typeof BotKeyboard.inline> } => {
    const present = storage.get().presence[String(userId)]
    if (present) {
        return {
            text: `Ты отмечен как «${present.displayLabel}».${macHintFor(storage, userId)}`,
            keyboard: BotKeyboard.inline([
                [BotKeyboard.callback('Уйти / снять отметку', CB_CHECKOUT)],
                BACK_ROW,
            ]),
        }
    }
    return {
        text: `Отметься, чтобы остальные видели, что ты в спейсе.${macHintFor(storage, userId)}`,
        keyboard: BotKeyboard.inline([
            [BotKeyboard.callback('Отметиться с ником', CB_CHECKIN_NICK)],
            [BotKeyboard.callback('Отметиться без ника', CB_CHECKIN_ANON)],
            BACK_ROW,
        ]),
    }
}

/** Раздел MAC: краткая справка + текущий статус привязок. Управление — по командам (так уже есть). */
const macSection = (storage: Storage, userId: number): string => {
    const cur = storage.get().macBindings[String(userId)]
    const lines: string[] = []
    if (cur && cur.macs.length > 0) {
        lines.push(`Привязано устройств: ${cur.macs.length}.`)
        for (const e of [...cur.macs].sort((a, b) => a.mac.localeCompare(b.mac))) {
            lines.push(`<code>${e.mac}</code>${e.label ? ` — ${e.label}` : ''}`)
        }
        const online = storage.get().presence[String(userId)]?.source === 'mac'
        lines.push('')
        lines.push(online ? 'Сейчас ты отмечен по MAC.' : 'Сейчас авто-отметка не активна.')
        lines.push('')
        lines.push(`Режим отметки: ${cur.anon ? '«без ника»' : 'с ником'} (сменить — /settings).`)
        lines.push('Добавить устройство — /bindmac, убрать — /unbindmac.')
    } else {
        lines.push('Привяжи MAC-адрес устройства — и я буду отмечать тебя автоматически, пока ты в сети спейса.')
        lines.push('')
        lines.push('Привязать: /bindmac AA:BB:CC:DD:EE:FF [имя]')
        lines.push('MAC можно посмотреть в настройках Wi-Fi телефона/ноутбука.')
        lines.push('')
        lines.push('⚠️ Сначала выключи ротацию (рандомизацию) MAC-адреса для Wi-Fi спейса — иначе адрес будет меняться и авто-отметка перестанет работать.')
    }
    return lines.join('<br>')
}

const macKeyboard = () => BotKeyboard.inline([BACK_ROW])

const printerKeyboard = (view: 'preview' | 'camera', active: boolean) => {
    if (!active) return BotKeyboard.inline([BACK_ROW])
    return BotKeyboard.inline([
        [
            BotKeyboard.callback(`${view === 'preview' ? '✅ ' : ''}🖼 Превью`, CB_PRINTER_PREVIEW),
            BotKeyboard.callback(`${view === 'camera' ? '✅ ' : ''}📷 Камера`, CB_PRINTER_CAMERA),
        ],
        BACK_ROW,
    ])
}

/**
 * Заменяет текущее сообщение меню новым экраном. Между текстом и фото Telegram
 * не редактирует «на месте» (text↔media), поэтому навигация всегда «удалить и отправить
 * заново» — так раздел принтера (фото) и текстовые разделы свободно переключаются.
 */
const replaceScreen = async (
    ctx: CallbackQueryContext,
    screen:
        | { kind: 'text'; text: string; keyboard: ReturnType<typeof BotKeyboard.inline> }
        | { kind: 'photo'; photo: Uint8Array; caption: string; keyboard: ReturnType<typeof BotKeyboard.inline> },
): Promise<void> => {
    const chatId = ctx.chat.id
    const oldId = ctx.messageId
    if (screen.kind === 'text') {
        await ctx.client.sendText(chatId, html(screen.text), {
            replyMarkup: screen.keyboard,
            disableWebPreview: true,
        })
    } else {
        await ctx.client.sendMedia(chatId, InputMedia.photo(screen.photo, { caption: html(screen.caption) }), {
            replyMarkup: screen.keyboard,
        })
    }
    try {
        await ctx.client.deleteMessagesById(chatId, [oldId])
    } catch {
        // старое сообщение могло быть уже удалено — не критично
    }
}

/** Собирает экран принтера: текст + (если печатает) картинку нужного вида. */
const buildPrinterScreen = async (
    printerUrl: string,
    printerAuth: string | null,
    view: 'preview' | 'camera',
): Promise<
    | { kind: 'text'; text: string; keyboard: ReturnType<typeof BotKeyboard.inline> }
    | { kind: 'photo'; photo: Uint8Array; caption: string; keyboard: ReturnType<typeof BotKeyboard.inline> }
> => {
    let status: PrinterStatus
    try {
        status = await fetchPrinterStatus(printerUrl, printerAuth)
    } catch {
        return {
            kind: 'text',
            text: 'Не удалось связаться с принтером. Он включён и доступен в сети?',
            keyboard: macKeyboard(),
        }
    }
    const text = renderStatus(status)
    const active = ACTIVE_STATES.has(status.state)
    if (!active) {
        return { kind: 'text', text, keyboard: printerKeyboard(view, false) }
    }
    const image =
        view === 'camera'
            ? await fetchWebcamSnapshot(printerUrl, printerAuth)
            : await fetchPrinterThumbnail(printerUrl, status.filename, printerAuth).catch(() => null)
    if (!image) {
        // Активная печать, но картинки нет — показываем хотя бы текст с кнопками переключения.
        return { kind: 'text', text, keyboard: printerKeyboard(view, true) }
    }
    return { kind: 'photo', photo: image, caption: text, keyboard: printerKeyboard(view, true) }
}

export const registerMenuHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        residents: ResidentDirectory
        printerUrl: string | null
        printerAuth: string | null
        /** Публичный URL миниаппа хостинга. null — миниапп не настроен. */
        webappUrl: string | null
    },
): void => {
    const { client, storage, residents, printerUrl, printerAuth, webappUrl } = deps
    const hasPrinter = printerUrl !== null

    const openMenu = async (msg: Parameters<Parameters<Dispatcher['onNewMessage']>[1]>[0]) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const adminChats = await residents.presenceChats(msg.sender.id)
        if (adminChats.length === 0) {
            // Гостям меню резидента не показываем, но даём оставить заявку на визит через миниапп.
            if (webappUrl) {
                await msg.answerText(
                    'Привет! Это бот хакспейса. Хочешь зайти в гости — оставь заявку на визит, резиденты увидят её и откликнутся.',
                    { replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('🚪 Оставить заявку на визит', webappUrl)]]) },
                )
                return
            }
            await msg.answerText('Этот бот доступен только резидентам (админам подключённого чата).')
            return
        }
        await msg.answerText(ROOT_TEXT, { replyMarkup: rootKeyboard(storage, msg.sender.id, hasPrinter, webappUrl) })
    }

    // /start и /menu в личке открывают один и тот же хаб. В группах /start — алиас /help.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('start')), openMenu)
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('menu')), openMenu)

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null || !data.startsWith('menu:')) return PropagationAction.Continue

        // Меню — только в личке. В группах кнопок меню нет, но на всякий случай гейтим.
        if (ctx.chat.type !== 'user') {
            await ctx.answer({ text: 'Меню доступно только в личке с ботом.', alert: true })
            return
        }

        const userId = ctx.user.id
        const isResident = await residents.isResident(userId)
        if (!isResident) {
            await ctx.answer({ text: 'Бот доступен только резидентам.', alert: true })
            return
        }

        switch (data) {
            case CB_ROOT: {
                await replaceScreen(ctx, { kind: 'text', text: ROOT_TEXT, keyboard: rootKeyboard(storage, userId, hasPrinter, webappUrl) })
                await ctx.answer({})
                return
            }
            case CB_INSIDE: {
                await replaceScreen(ctx, {
                    kind: 'text',
                    text: renderPresenceText(storage),
                    keyboard: BotKeyboard.inline([BACK_ROW]),
                })
                await ctx.answer({})
                return
            }
            case CB_PRESENCE: {
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({})
                return
            }
            case CB_CHECKIN_NICK:
            case CB_CHECKIN_ANON: {
                if (ctx.user.username == null && data === CB_CHECKIN_NICK) {
                    await ctx.answer({ text: 'У тебя нет username — отметься «без ника».', alert: true })
                    return
                }
                const res = await checkInResident(
                    client, storage, residents,
                    { id: userId, username: ctx.user.username, displayName: ctx.user.displayName },
                    data === CB_CHECKIN_NICK ? 'nick' : 'anon',
                )
                if (res.chats.length === 0) {
                    await ctx.answer({ text: 'Ты не админ ни в одном из подключённых чатов.', alert: true })
                    return
                }
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({ text: res.alreadyChecked ? 'Обновил отметку' : 'Отметил' })
                return
            }
            case CB_CHECKOUT: {
                const present = storage.get().presence[String(userId)]
                if (present) await removePresence(client, storage, residents, userId, 'manual')
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({ text: present ? 'Снял отметку' : 'Ты и так не отмечен' })
                return
            }
            case CB_MAC: {
                await replaceScreen(ctx, { kind: 'text', text: macSection(storage, userId), keyboard: macKeyboard() })
                await ctx.answer({})
                return
            }
            case CB_PRINTER:
            case CB_PRINTER_PREVIEW:
            case CB_PRINTER_CAMERA: {
                if (printerUrl === null) {
                    await ctx.answer({ text: 'Принтер не подключён.', alert: true })
                    return
                }
                const view = data === CB_PRINTER_CAMERA ? 'camera' : 'preview'
                const screen = await buildPrinterScreen(printerUrl, printerAuth, view)
                await replaceScreen(ctx, screen)
                await ctx.answer(
                    data === CB_PRINTER_CAMERA ? { text: '📷 Камера' } : data === CB_PRINTER_PREVIEW ? { text: '🖼 Превью' } : {},
                )
                return
            }
            default:
                return PropagationAction.Continue
        }
    })
}
