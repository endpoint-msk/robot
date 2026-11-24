import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher } from '@mtcute/dispatcher'
import {
    checkInResident,
    checkOutResident,
    isPresenceInvisible,
    macHintFor,
    macLabelSuffix,
    setPresenceInvisible,
    renderPresenceText,
} from './presence.js'
import type { ResidentDirectory } from './residents.js'
import { newRequestTarget, webappAt } from './deeplink.js'
import { doorAlertText, doorCodeOf } from './door.js'
import { inviteOnStart } from './onboarding.js'
import type { CreateIssuesInvite } from './issues.js'
import {
    ACTIVE_STATES,
    fetchPrinterStatus,
    fetchPrinterThumbnail,
    fetchWebcamSnapshot,
    renderStatus,
    type PrinterStatus,
} from './printer.js'
import type { Storage } from './storage.js'
import { languageChoiceOf, setUserLanguage, tr, userLocale, withLocale } from './i18n.js'
import { LANGUAGE_MENU_CALLBACK as CB_LANGUAGE, languageButton, syncPrivateLanguageCommands } from './bot-language-commands.js'

const CB_ROOT = 'menu:root'
const CB_INSIDE = 'menu:inside'
const CB_PRESENCE = 'menu:presence'
const CB_CHECKIN_NICK = 'menu:checkin:nick'
const CB_CHECKIN_ANON = 'menu:checkin:anon'
const CB_CHECKOUT = 'menu:checkout'
const CB_INVISIBLE = 'menu:invisible'
const CB_MAC = 'menu:mac'
const CB_PRINTER = 'menu:printer'
const CB_PRINTER_PREVIEW = 'menu:printer:preview'
const CB_PRINTER_CAMERA = 'menu:printer:camera'
const CB_DOOR = 'menu:door'
const LANGUAGE_CHOICES = ['auto', 'ru', 'en'] as const

const backRow = () => [BotKeyboard.callback(tr('⬅️ Назад', "⬅️ Back"), CB_ROOT)]
const languageRow = () => [languageButton()]

const languageScreen = (storage: Storage, userId: number) => {
    const choice = languageChoiceOf(storage, userId)
    const labels = { auto: tr('Язык Telegram', 'Telegram language'), ru: 'Русский', en: 'English' }
    return {
        kind: 'text' as const,
        text: tr('Выбери язык бота и миниаппа.', 'Choose the language for the bot and mini app.'),
        keyboard: BotKeyboard.inline([
            ...LANGUAGE_CHOICES.map((language) => [
                BotKeyboard.callback(`${choice === language ? '✓ ' : ''}${labels[language]}`, `${CB_LANGUAGE}:${language}`),
            ]),
            backRow(),
        ]),
    }
}

const guestScreen = (webappUrl: string | null) => ({
    kind: 'text' as const,
    text: webappUrl
        ? tr('Привет! Это бот хакспейса. Хотите зайти в гости — оставьте заявку на визит, резиденты увидят её и откликнутся.', "Hi! I'm the hackerspace bot. If you'd like to stop by, request a visit and a resident can offer to host you.")
        : tr('Этот бот доступен только резидентам (участникам чата резидентов).', "This bot is available to members of the residents' chat."),
    keyboard: BotKeyboard.inline(webappUrl
        ? [[BotKeyboard.webView(tr('🚪 Оставить заявку на визит', "🚪 Request a visit"), webappAt(webappUrl, newRequestTarget()))], languageRow()]
        : [languageRow()]),
})

/**
 * Корневое меню. Галочка у «Отметиться» отражает, отмечен ли резидент. Принтер - только
 * если подключён, домофон - только если код задан.
 */
const rootKeyboard = (storage: Storage, userId: number, hasPrinter: boolean, webappUrl: string | null) => {
    const present = storage.get().presence[String(userId)] !== undefined
    const rows: Parameters<typeof BotKeyboard.inline>[0] = [
        [BotKeyboard.callback(tr('Кто в спейсе', "Who's at the space"), CB_INSIDE)],
        [BotKeyboard.callback(tr(`${present ? '✅' : '☐'} Отметиться`, `${present ? '✅' : '☐'} Check in`), CB_PRESENCE)],
        [BotKeyboard.callback(tr('Авто-отметка по MAC', "Automatic check-in by MAC address"), CB_MAC)],
    ]
    if (hasPrinter) rows.push([BotKeyboard.callback(tr('3D-принтер', "3D printer"), CB_PRINTER)])
    if (doorCodeOf(storage)) rows.push([BotKeyboard.callback(tr('Домофон', "Intercom"), CB_DOOR)])
    // web_app-кнопка (в личке разрешена): миниапп с заявками гостей на визит.
    if (webappUrl) rows.push([BotKeyboard.webView(tr('🚪 Хостинг гостей', "🚪 Guest visits"), webappUrl)])
    rows.push(languageRow())
    return BotKeyboard.inline(rows)
}

const rootText = () => tr('Главное меню. Выбери раздел:', "Main menu. Choose a section:")

/**
 * Раздел «Отметиться / уйти»: кнопки зависят от того, отмечен ли уже резидент.
 *
 * Переключатель «невидимка» стоит здесь, а не в разделе MAC: человек приходит сюда с
 * вопросом «видно ли меня», а не «как настроена привязка устройства».
 */
const presenceSection = (storage: Storage, userId: number): { text: string; keyboard: ReturnType<typeof BotKeyboard.inline> } => {
    const present = storage.get().presence[String(userId)]
    const invisible = isPresenceInvisible(storage, userId)
    const invisibleRow = [BotKeyboard.callback(tr(`${invisible ? '✅' : '☐'} Невидимка`, `${invisible ? '✅' : '☐'} Invisible mode`), CB_INVISIBLE)]
    const invisibleNote = invisible
        ? tr('<br><br>Невидимка включена: сам я тебя по устройству в сети не отмечаю. Отметиться кнопкой можно всегда.', "<br><br>Invisible mode is on. Your device won't check you in automatically. You can still check in manually.")
        : ''
    const macHint = macHintFor(storage, userId)
    if (present) {
        const label = html.escape(present.displayLabel)
        const checkedIn = present.username ? `You're checked in as ${label}.` : "You're checked in anonymously."
        return {
            text: tr(`Ты отмечен как «${label}».`, checkedIn) + invisibleNote + macHint,
            keyboard: BotKeyboard.inline([
                [BotKeyboard.callback(tr('Уйти / снять отметку', "Check out"), CB_CHECKOUT)],
                invisibleRow,
                backRow(),
            ]),
        }
    }
    return {
        text: tr('Отметься, чтобы остальные видели, что ты в спейсе.', "Check in so others can see you're at the space.") + invisibleNote + macHint,
        keyboard: BotKeyboard.inline([
            [BotKeyboard.callback(tr('Отметиться с ником', "Check in with username"), CB_CHECKIN_NICK)],
            [BotKeyboard.callback(tr('Отметиться без ника', "Check in anonymously"), CB_CHECKIN_ANON)],
            invisibleRow,
            backRow(),
        ]),
    }
}

/** Раздел MAC: краткая справка + текущий статус привязок. Управление — по командам (так уже есть). */
const macSection = (storage: Storage, userId: number): string => {
    const cur = storage.get().macBindings[String(userId)]
    const lines: string[] = []
    if (cur && cur.macs.length > 0) {
        lines.push(tr(`Привязано устройств: ${cur.macs.length}.`, `Linked devices: ${cur.macs.length}.`))
        for (const e of [...cur.macs].sort((a, b) => a.mac.localeCompare(b.mac))) {
            lines.push(`<code>${e.mac}</code>${macLabelSuffix(e.label)}`)
        }
        const online = storage.get().presence[String(userId)]?.source === 'mac'
        lines.push('')
        lines.push(online ? tr('Сейчас ты отмечен по MAC.', "You're currently checked in by MAC address.") : tr('Сейчас авто-отметка не активна.', "You're not currently checked in automatically."))
        if (isPresenceInvisible(storage, userId)) {
            lines.push(tr('Режим «невидимка» включён - авто-отметка не ставится (раздел «Отметиться»).', "Invisible mode is on. To resume automatic check-in, turn it off in Check in."))
        } else if (cur.suppressedAt) {
            lines.push(tr('Авто-отметка приостановлена: ты ушёл вручную. Вернётся, когда устройство уйдёт из сети и появится снова.', "Automatic check-in is paused because you checked out manually. It resumes after your device disconnects and reconnects."))
        }
        lines.push('')
        const mode = cur.anon ? tr('«без ника»', 'anonymously') : tr('с ником', 'with username')
        lines.push(tr(`Режим отметки: ${mode} (сменить — /settings).`, `Check in ${mode}. Change with /settings.`))
        lines.push(tr('Добавить устройство — /bindmac, убрать — /unbindmac.', "Add a device with /bindmac or remove one with /unbindmac."))
    } else {
        lines.push(tr('Привяжи MAC-адрес устройства — и я буду отмечать тебя автоматически, пока ты в сети спейса.', "Link your device's MAC address to check in automatically while it's connected to the space's network."))
        lines.push('')
        lines.push(tr('Привязать: /bindmac AA:BB:CC:DD:EE:FF [имя]', "To link a device: /bindmac AA:BB:CC:DD:EE:FF [name]"))
        lines.push(tr('MAC можно посмотреть в настройках Wi-Fi телефона/ноутбука.', "You can find the MAC address in your device's Wi-Fi settings."))
        lines.push('')
        lines.push(tr('⚠️ Сначала выключи ротацию (рандомизацию) MAC-адреса для Wi-Fi спейса — иначе адрес будет меняться и авто-отметка перестанет работать.', "⚠️ Turn off MAC address rotation for the space's Wi-Fi first. A rotating address will stop automatic check-in from working."))
    }
    return lines.join('<br>')
}

const macKeyboard = () => BotKeyboard.inline([backRow()])

const printerKeyboard = (view: 'preview' | 'camera', active: boolean) => {
    if (!active) return BotKeyboard.inline([backRow()])
    return BotKeyboard.inline([
        [
            BotKeyboard.callback(tr(`${view === 'preview' ? '✅ ' : ''}🖼 Превью`, `${view === 'preview' ? '✅ ' : ''}🖼 Preview`), CB_PRINTER_PREVIEW),
            BotKeyboard.callback(tr(`${view === 'camera' ? '✅ ' : ''}📷 Камера`, `${view === 'camera' ? '✅ ' : ''}📷 Camera`), CB_PRINTER_CAMERA),
        ],
        backRow(),
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
        status = await fetchPrinterStatus(printerUrl, printerAuth, { withEta: true })
    } catch {
        return {
            kind: 'text',
            text: tr('Не удалось связаться с принтером. Он включён и доступен в сети?', "Couldn't reach the printer. Is it powered on and connected to the network?"),
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
        createIssuesInvite: CreateIssuesInvite | null
        /** Публичный URL миниаппа хостинга. null — миниапп не настроен. */
        webappUrl: string | null
    },
): void => {
    const { client, storage, residents, printerUrl, printerAuth, webappUrl, createIssuesInvite } = deps
    const keyboardFor = (userId: number) => rootKeyboard(storage, userId, printerUrl !== null, webappUrl)

    type MenuMessage = Parameters<Parameters<Dispatcher['onNewMessage']>[1]>[0]

    /**
     * Раздел меню по диплинку `t.me/<бот>?start=<раздел>`: так в него ведут строки
     * знакомства в миниаппе. false - раздела нет, открываем корень.
     */
    const openSection = async (msg: MenuMessage, userId: number, section: string): Promise<boolean> => {
        switch (section) {
            case 'presence': {
                const s = presenceSection(storage, userId)
                await msg.answerText(html(s.text), { replyMarkup: s.keyboard, disableWebPreview: true })
                return true
            }
            case 'inside':
                await msg.answerText(html(renderPresenceText(storage)), {
                    replyMarkup: BotKeyboard.inline([backRow()]),
                    disableWebPreview: true,
                })
                return true
            case 'printer': {
                if (printerUrl === null) return false
                const screen = await buildPrinterScreen(printerUrl, printerAuth, 'preview')
                if (screen.kind === 'text') {
                    await msg.answerText(html(screen.text), { replyMarkup: screen.keyboard, disableWebPreview: true })
                } else {
                    await msg.answerMedia(InputMedia.photo(screen.photo, { caption: html(screen.caption) }), {
                        replyMarkup: screen.keyboard,
                    })
                }
                return true
            }
            default:
                return false
        }
    }

    const openMenu = async (msg: MenuMessage, welcome: boolean) => {
        if (!msg.sender || msg.sender.type !== 'user') return
        const userId = msg.sender.id
        if (!(await residents.isResident(userId))) {
            const screen = guestScreen(webappUrl)
            await msg.answerText(screen.text, { replyMarkup: screen.keyboard })
            return
        }
        const section = msg.text.trim().split(/\s+/)[1] ?? ''
        if (welcome) await inviteOnStart(client, storage, userId, webappUrl, createIssuesInvite)
        if (section && (await openSection(msg, userId, section))) return
        await msg.answerText(rootText(), { replyMarkup: keyboardFor(userId) })
    }

    // /start и /menu в личке открывают один и тот же хаб. В группах /start — алиас /help.
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('start')), (msg) => openMenu(msg, true))
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('menu')), (msg) => openMenu(msg, false))
    dp.onNewMessage(filters.and(filters.chat('user'), filters.command('language')), async (msg) => {
        if (msg.sender?.type !== 'user') return
        const screen = languageScreen(storage, msg.sender.id)
        await msg.answerText(screen.text, { replyMarkup: screen.keyboard })
    })

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (data === null || !data.startsWith('menu:')) return PropagationAction.Continue

        // Меню — только в личке. В группах кнопок меню нет, но на всякий случай гейтим.
        if (ctx.chat.type !== 'user') {
            await ctx.answer({ text: tr('Меню доступно только в личке с ботом.', "The menu is available in your private chat with the bot."), alert: true })
            return
        }

        const userId = ctx.user.id
        if (data === CB_LANGUAGE) {
            await replaceScreen(ctx, languageScreen(storage, userId))
            await ctx.answer({})
            return
        }
        if (data.startsWith(`${CB_LANGUAGE}:`)) {
            const choice = LANGUAGE_CHOICES.find((language) => data === `${CB_LANGUAGE}:${language}`)
            if (!choice) return PropagationAction.Continue
            await setUserLanguage(storage, userId, choice)
            void syncPrivateLanguageCommands(client, storage, userId).catch((err) => {
                console.warn('[i18n] failed to update private commands:', err)
            })
            await withLocale(userLocale(storage, userId, ctx.user.language), async () => {
                await replaceScreen(ctx, languageScreen(storage, userId))
                await ctx.answer({ text: tr('Язык сохранён', 'Language saved') })
            })
            return
        }

        const isResident = await residents.isResident(userId)
        if (!isResident && data === CB_ROOT) {
            await replaceScreen(ctx, guestScreen(webappUrl))
            await ctx.answer({})
            return
        }
        if (!isResident) {
            await ctx.answer({ text: tr('Бот доступен только резидентам.', "This bot is available to residents."), alert: true })
            return
        }

        switch (data) {
            case CB_ROOT: {
                await replaceScreen(ctx, { kind: 'text', text: rootText(), keyboard: keyboardFor(userId) })
                await ctx.answer({})
                return
            }
            case CB_INSIDE: {
                await replaceScreen(ctx, {
                    kind: 'text',
                    text: renderPresenceText(storage),
                    keyboard: BotKeyboard.inline([backRow()]),
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
                    await ctx.answer({ text: tr('У тебя нет username — отметься «без ника».', "You don't have a Telegram username. Choose to check in anonymously."), alert: true })
                    return
                }
                const res = await checkInResident(
                    client, storage, residents,
                    { id: userId, username: ctx.user.username, displayName: ctx.user.displayName },
                    data === CB_CHECKIN_NICK ? 'nick' : 'anon',
                )
                if (res.chats.length === 0) {
                    await ctx.answer({
                        text: tr('Отметиться могут только резиденты. Если ты резидент, напиши в чат спейса, тебя добавят.', "Only residents can check in. If you're a resident, ask in the space's chat to be added."),
                        alert: true,
                    })
                    return
                }
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({ text: res.alreadyChecked ? tr('Обновил отметку', "Check-in refreshed") : tr('Отметил', "Checked in") })
                return
            }
            case CB_CHECKOUT: {
                const removed = await checkOutResident(client, storage, residents, userId)
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({ text: removed ? tr('Снял отметку', "Checked out") : tr('Ты и так не отмечен', "You're already checked out") })
                return
            }
            case CB_INVISIBLE: {
                const next = !isPresenceInvisible(storage, userId)
                await setPresenceInvisible(client, storage, residents, userId, next)
                const section = presenceSection(storage, userId)
                await replaceScreen(ctx, { kind: 'text', text: section.text, keyboard: section.keyboard })
                await ctx.answer({ text: next ? tr('Невидимка включена', "Invisible mode on") : tr('Невидимка выключена', "Invisible mode off") })
                return
            }
            case CB_MAC: {
                await replaceScreen(ctx, { kind: 'text', text: macSection(storage, userId), keyboard: macKeyboard() })
                await ctx.answer({})
                return
            }
            // Всплывающим окном, а не сообщением: окно исчезает, и в истории лички
            // (её тоже скриншотят) код не остаётся.
            case CB_DOOR: {
                const door = doorCodeOf(storage)
                await ctx.answer({ text: door ? doorAlertText(door) : tr('Код домофона пока не задан.', "The intercom code hasn't been set yet."), alert: true })
                return
            }
            case CB_PRINTER:
            case CB_PRINTER_PREVIEW:
            case CB_PRINTER_CAMERA: {
                if (printerUrl === null) {
                    await ctx.answer({ text: tr('Принтер не подключён.', "The printer isn't connected."), alert: true })
                    return
                }
                const view = data === CB_PRINTER_CAMERA ? 'camera' : 'preview'
                const screen = await buildPrinterScreen(printerUrl, printerAuth, view)
                await replaceScreen(ctx, screen)
                await ctx.answer(
                    data === CB_PRINTER_CAMERA ? { text: tr('📷 Камера', "📷 Camera") } : data === CB_PRINTER_PREVIEW ? { text: tr('🖼 Превью', "🖼 Preview") } : {},
                )
                return
            }
            default:
                return PropagationAction.Continue
        }
    })
}
