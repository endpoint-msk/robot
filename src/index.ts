import 'dotenv/config'
import { BotCommands, TelegramClient } from '@mtcute/node'
import { Dispatcher, filters } from '@mtcute/dispatcher'
import { parseAllowedChats, registerHandlers } from './handlers.js'
import { parseChatId, registerForwarder } from './forwarder.js'
import { registerLiveChatGuard } from './livechat.js'
import { registerMenuHandlers } from './menu.js'
import { normalizePrinterUrl, parsePrinterAuth, registerPrinterHandlers, startPrinterCompletionWatcher } from './printer.js'
import { KeeneticClient, parseKeeneticConfig } from './keenetic.js'
import { createTelegramResidentDirectory } from './residents.js'
import {
    registerChatActivityTracker,
    registerPresenceDeleteWatcher,
    registerPresenceHandlers,
    setHostingMiniappLink,
    setHostingReminder,
    startMacPresencePoller,
    startPresenceScheduler,
} from './presence.js'
import { startDailyFundraiserPoster, startMonthlyScheduler } from './scheduler.js'
import { Storage } from './storage.js'
import { installErrorReporting } from './errors.js'
import { parseHostingTzOffset } from './hosting.js'
import { parseWebappConfig, startWebappServer } from './webapp.js'

const required = (name: string): string => {
    const v = process.env[name]
    if (!v) {
        console.error(`Не задана переменная окружения ${name}. См. .env.example.`)
        process.exit(1)
    }
    return v
}

/**
 * Гасит TimeoutNegativeWarning, оставляя остальные warning'и как есть.
 *
 * Ловится после сна машины: таймер во сне не тикает, на пробуждении дедлайн уже
 * в прошлом, и `deadline - now` уходит в минус (приходит из сетевого слоя mtcute —
 * у нас все задержки константные). Node зажимает такую задержку до 1 мс, так что
 * это косметика: на всегда включённом сервере не встречается.
 *
 * Штатный вывод варнингов — это листенер Node по умолчанию, поэтому его снимаем
 * и печатаем сами, пропуская только этот тип.
 */
const silenceNegativeTimeoutWarnings = (): void => {
    process.removeAllListeners('warning')
    process.on('warning', (w) => {
        if (w.name === 'TimeoutNegativeWarning') return
        console.warn(w.stack ?? `${w.name}: ${w.message}`)
    })
}

const main = async () => {
    silenceNegativeTimeoutWarnings()
    const apiId = Number(required('API_ID'))
    const apiHash = required('API_HASH')
    const botToken = required('BOT_TOKEN')
    const allowedChats = parseAllowedChats(process.env.ALLOWED_CHATS)
    const dataFile = process.env.DATA_FILE ?? './data.json'
    const forwardFrom = parseChatId(process.env.FORWARD_FROM_CHAT)
    const forwardTo = parseChatId(process.env.FORWARD_TO_CHAT)
    const liveChatId = parseChatId(process.env.LIVE_CHAT_ID)
    const printerUrl = normalizePrinterUrl(process.env.PRINTER_URL)
    const printerAuth = parsePrinterAuth(process.env.PRINTER_AUTH)
    const keeneticConfig = parseKeeneticConfig({
        url: process.env.KEENETIC_URL,
        login: process.env.KEENETIC_LOGIN,
        password: process.env.KEENETIC_PASSWORD,
        rciPath: process.env.KEENETIC_RCI_PATH,
    })
    // userId дев-аккаунтов (через запятую): отладочные команды, отчёты об ошибках
    // в личку и дев-меню миниаппа (переключатель перспективы + сид фейковых заявок).
    const devUserIds = parseAllowedChats(process.env.DEV_USER_IDS)
    // Миниапп хостинга: без WEBAPP_URL вся подсистема выключена.
    const webappConfig = parseWebappConfig({
        url: process.env.WEBAPP_URL,
        port: process.env.WEBAPP_PORT,
        host: process.env.WEBAPP_HOST,
    })
    const hostingTzOffset = parseHostingTzOffset(process.env.HOSTING_TZ_OFFSET_MINUTES)

    if (allowedChats.size === 0) {
        console.warn('[warn] ALLOWED_CHATS пуст — бот не будет реагировать ни в одном чате.')
    }

    if ((forwardFrom === null) !== (forwardTo === null)) {
        console.warn('[warn] FORWARD_FROM_CHAT и FORWARD_TO_CHAT должны быть заданы вместе — форвардинг отключён.')
    }

    const storage = new Storage(dataFile)
    await storage.load()

    const tg = new TelegramClient({
        apiId,
        apiHash,
        storage: 'bot.session',
        // Группируем сообщения одного альбома (media group) и отдаём их пачкой
        // в onMessageGroup, иначе форвардер разбивал бы альбом на отдельные посты.
        updates: { messageGroupingInterval: 250 },
    })

    // Единый источник правды «кто резидент/админ». Сейчас поверх Telegram
    // (админ allowlist-чата); при переходе на Authentik меняется только эта реализация.
    const residents = createTelegramResidentDirectory(tg, allowedChats)

    const dp = Dispatcher.for(tg)
    // Единый обработчик ошибок: логируем (а console.error форвардит в личку dev'ам)
    // и гасим, чтобы упавший хендлер не ронял обработку остальных апдейтов.
    dp.onError((err, update) => {
        console.error(`[dispatcher] ошибка в обработчике ${update.name}:`, err)
        return true
    })
    // livechat guard регистрируем ПЕРВЫМ — чтобы служебные сообщения о входе/выходе
    // были перехвачены и удалены до того, как доберутся до других хендлеров.
    if (liveChatId !== null) {
        registerLiveChatGuard(dp, tg, liveChatId)
        console.log(`[livechat] guard active for chat ${liveChatId}`)
    }
    // presence-хендлеры регистрируем РАНЬШЕ — чтобы /start в личке ловил presence,
    // а групповой /start (алиас /help) — общий обработчик ниже
    registerPresenceHandlers(dp, { client: tg, storage, residents })
    registerChatActivityTracker(dp, storage, allowedChats)
    registerPresenceDeleteWatcher(dp, tg, storage, allowedChats)
    registerMenuHandlers(dp, { client: tg, storage, residents, printerUrl, printerAuth, webappUrl: webappConfig?.publicUrl ?? null })
    registerHandlers(dp, { client: tg, storage, allowedChats, residents, webappUrl: webappConfig?.publicUrl ?? null })
    if (printerUrl !== null) {
        registerPrinterHandlers(dp, { client: tg, storage, allowedChats, printerUrl, printerAuth })
        console.log(`[printer] /printer active for ${printerUrl}`)
    } else {
        console.warn('[warn] PRINTER_URL не задан — команда /printer отключена.')
    }
    if (forwardFrom !== null && forwardTo !== null) {
        registerForwarder(dp, tg, forwardFrom, forwardTo)
        console.log(`[forward] forwarding ${forwardFrom} -> ${forwardTo}`)
    }

    const self = await tg.start({ botToken })
    console.log(`Logged in as @${self.username ?? self.id} (${self.displayName})`)

    // Миниапп хостинга: HTTP-сервер, deep link для кнопок в группах и кнопка меню
    // рядом с полем ввода (web_app; ставится API-вызовом, BotFather не нужен).
    let webappServer: { stop: () => void } | null = null
    if (webappConfig !== null) {
        webappServer = startWebappServer({
            client: tg,
            storage,
            allowedChats,
            residents,
            botToken,
            config: webappConfig,
            devUserIds,
            tzOffsetMinutes: hostingTzOffset,
        })
        if (self.username) {
            // В группах web_app-кнопки запрещены — используем deep link на Main Mini App
            // (его нужно один раз включить в BotFather, указав тот же WEBAPP_URL).
            setHostingMiniappLink(`https://t.me/${self.username}?startapp=hosting`)
        }
        // Появился в спейсе — напомнить про сегодняшние заявки без хоста.
        setHostingReminder({ webappUrl: webappConfig.publicUrl, tzOffsetMinutes: hostingTzOffset })
        try {
            await tg.call({
                _: 'bots.setBotMenuButton',
                userId: { _: 'inputUserEmpty' },
                button: { _: 'botMenuButton', text: 'Хост', url: webappConfig.publicUrl },
            })
        } catch (err) {
            console.error('[webapp] не удалось установить кнопку меню:', err)
        }
    } else {
        console.warn('[warn] WEBAPP_URL не задан — миниапп хостинга отключён.')
    }

    // После логина: форвардить все ошибки (console.error + process-level) в личку dev'ам.
    installErrorReporting(tg, devUserIds)
    if (devUserIds.size > 0) {
        console.log(`[errors] отчёты об ошибках идут в личку: ${[...devUserIds].join(', ')}`)
    }

    // Список команд, который Telegram показывает по / в меню.
    // Большинство админских команд показываем только админам группы; /inside — всем участникам.
    const adminCommands = [
        BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
        BotCommands.cmd('insidemute', 'Вкл/выкл авто-рассылку списка присутствующих в чат'),
        BotCommands.cmd('komanda', 'команда'),
        BotCommands.cmd('printer', 'Статус 3D-принтера'),
        BotCommands.cmd('goals', 'Показать текущий сбор'),
        BotCommands.cmd('goalsmute', 'Вкл/выкл автоотправку сбора в этот чат'),
        BotCommands.cmd('donate', 'Добавить донат: /donate <сумма> <ник>'),
        BotCommands.cmd('remove', 'Удалить донат: /remove <номер|ник> [сумма]'),
        BotCommands.cmd('setgoal', 'Задать цель текущего сбора (0 — снять)'),
        BotCommands.cmd('settitle', 'Изменить тему сбора'),
        BotCommands.cmd('setdesc', 'Изменить описание сбора (реквизиты/ссылки)'),
        BotCommands.cmd('setresetday', 'День сброса сбора (1–29)'),
        BotCommands.cmd('help', 'Справка по командам'),
    ]
    const memberCommands = [
        BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
        BotCommands.cmd('komanda', 'команда'),
        BotCommands.cmd('printer', 'Статус 3D-принтера'),
        BotCommands.cmd('goals', 'Показать текущий сбор'),
        BotCommands.cmd('help', 'Справка по командам'),
    ]
    try {
        // Всем участникам групп — только /inside в меню.
        await tg.setMyCommands({ commands: memberCommands, scope: BotCommands.allGroups })
        // Админам групп — полный набор админских команд (перекрывает allGroups для админов).
        await tg.setMyCommands({ commands: adminCommands, scope: BotCommands.allGroupAdmins })
        // В личке — /start (меню резидента), /printer (статус принтера), /bindmac (привязка MAC)
        await tg.setMyCommands({
            commands: [
                BotCommands.cmd('start', 'Открыть меню бота'),
                BotCommands.cmd('menu', 'Открыть меню бота'),
                BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
                BotCommands.cmd('printer', 'Статус 3D-принтера'),
                BotCommands.cmd('bindmac', 'Привязать MAC для авто-отметок'),
                BotCommands.cmd('unbindmac', 'Убрать привязку MAC'),
                BotCommands.cmd('maclist', 'Показать свои привязанные MAC'),
                BotCommands.cmd('settings', 'Настройки авто-отметки (ник/аноним)'),
            ],
            scope: BotCommands.allPrivate,
        })
        // Дефолтный scope — пустой
        await tg.setMyCommands({ commands: null })
    } catch (err) {
        console.error('[warn] failed to register bot commands:', err)
    }

    const scheduler = startMonthlyScheduler(tg, storage)
    const dailyPoster = startDailyFundraiserPoster(tg, storage, allowedChats)
    const presence = startPresenceScheduler(tg, storage, allowedChats, residents)
    const printerWatcher = printerUrl !== null ? startPrinterCompletionWatcher(tg, storage, printerUrl, printerAuth) : null
    let macPoller: { stop: () => void; triggerNow: () => Promise<void> } | null = null
    if (keeneticConfig !== null) {
        macPoller = startMacPresencePoller(tg, storage, residents, new KeeneticClient(keeneticConfig))
        console.log(`[keenetic] MAC presence poller active for ${keeneticConfig.baseUrl}`)
    } else {
        console.warn('[warn] KEENETIC_URL/LOGIN/PASSWORD не заданы — авто-отметки по MAC отключены.')
    }

    // Дев-команда: форсировать опрос Keenetic и пересчёт авто-отметок прямо сейчас.
    if (devUserIds.size > 0) {
        dp.onNewMessage(filters.and(filters.chat('user'), filters.command('forcemacupdate')), async (msg) => {
            if (!msg.sender || msg.sender.type !== 'user') return
            if (!devUserIds.has(msg.sender.id)) return
            if (macPoller === null) {
                await msg.answerText('Поллер MAC выключен (нет KEENETIC_*).')
                return
            }
            try {
                await macPoller.triggerNow()
                await msg.answerText('Готово: опросил Keenetic и пересчитал отметки.')
            } catch (err) {
                console.error('[keenetic] forcemacupdate failed:', err)
                await msg.answerText('Ошибка при опросе Keenetic — см. логи.')
            }
        })
        console.log(`[keenetic] /forcemacupdate enabled for dev users: ${[...devUserIds].join(', ')}`)
    }

    const shutdown = async () => {
        scheduler.stop()
        dailyPoster.stop()
        presence.stop()
        printerWatcher?.stop()
        macPoller?.stop()
        webappServer?.stop()
        await tg.destroy()
        process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
