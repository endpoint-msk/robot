import 'dotenv/config'
import { BotCommands, TelegramClient } from '@mtcute/node'
import { Dispatcher, filters } from '@mtcute/dispatcher'
import { parseAllowedChats, registerHandlers } from './handlers.js'
import { parseChatId, registerForwarder } from './forwarder.js'
import { registerLiveChatGuard } from './livechat.js'
import { registerEventIntake } from './event-intake.js'
import { registerMenuHandlers } from './menu.js'
import { normalizePrinterUrl, parsePrinterAuth, registerPrinterHandlers, startPrinterCompletionWatcher } from './printer.js'
import { KeeneticClient, parseKeeneticConfig } from './keenetic.js'
import { createTelegramResidentDirectory } from './residents.js'
import {
    registerPresenceHandlers,
    setHostingMiniappLink,
    setHostingReminder,
    setPresenceChangeHook,
    startMacPresencePoller,
    startPresenceScheduler,
} from './presence.js'
import { setHostingBoardLink, startHostingBoardScheduler, syncHostingBoard } from './hosting-board.js'
import { registerHostingInviteHandlers } from './hosting-invite.js'
import { registerBackupHandlers, startBackupScheduler } from './backup.js'
import { registerDuesHandlers, setDuesMiniappUrl, startDuesScheduler } from './dues.js'
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
    // Канал анонсов: пересланный оттуда пост бот предлагает превратить в ивент.
    const announceChannelId = parseChatId(process.env.ANNOUNCE_CHANNEL_ID)
    // Чат резидентов: его участники и есть резиденты. Не задан — откат на прежнее
    // правило «админ любого allowlist-чата», иначе забытая переменная выключила бы полбота.
    const residentsChatId = parseChatId(process.env.RESIDENTS_CHAT_ID)
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
    // Репо для чтения GitHub-релизов в дев-анонсах (публичное, токен не нужен).
    const githubRepo = process.env.GITHUB_REPO?.trim() || 'endpoint-msk/robot'
    // Табло донатов (GET /board). Без токена ручка не поднимается вовсе: она отдаёт
    // лидерборд без Telegram-авторизации, и «забыли задать» не должно означать «открыто всем».
    const boardToken = process.env.BOARD_TOKEN?.trim() || null

    if (allowedChats.size === 0) {
        console.warn('[warn] ALLOWED_CHATS пуст — бот не будет реагировать ни в одном чате.')
    }

    if (residentsChatId === null) {
        console.warn('[warn] RESIDENTS_CHAT_ID не задан — резидентами считаются админы любого allowlist-чата.')
    } else {
        console.log(`[residents] резиденты — участники чата ${residentsChatId}`)
    }

    if ((forwardFrom === null) !== (forwardTo === null)) {
        console.warn('[warn] FORWARD_FROM_CHAT и FORWARD_TO_CHAT должны быть заданы вместе — форвардинг отключён.')
    }

    const storage = new Storage(dataFile)
    await storage.load()

    const tg = new TelegramClient({
        apiId,
        apiHash,
        // Путь к сессии тоже настраиваемый: в контейнере он обязан лежать в примонтированном
        // томе, иначе пересборка образа теряет сессию вместе со всем слоем.
        storage: process.env.SESSION_FILE?.trim() || 'bot.session',
        // Группируем сообщения одного альбома (media group) и отдаём их пачкой
        // в onMessageGroup, иначе форвардер разбивал бы альбом на отдельные посты.
        updates: { messageGroupingInterval: 250 },
    })

    // Единый источник правды «кто резидент/админ». Сейчас поверх Telegram
    // (участник чата резидентов); при переходе на Authentik меняется только эта реализация.
    const residents = createTelegramResidentDirectory(tg, allowedChats, residentsChatId)

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
    registerMenuHandlers(dp, { client: tg, storage, residents, printerUrl, printerAuth, webappUrl: webappConfig?.publicUrl ?? null })
    registerHandlers(dp, { client: tg, storage, allowedChats, residents, webappUrl: webappConfig?.publicUrl ?? null })
    // Кнопка «Приду» из зова в личку — часть подсистемы хостинга, живёт только с миниаппом.
    if (webappConfig !== null) {
        registerHostingInviteHandlers(dp, { client: tg, storage, residents, allowedChats, tzOffsetMinutes: hostingTzOffset })
    }
    // Пересланный из канала анонсов пост → заготовка ивента. Редактор живёт в миниаппе,
    // поэтому без WEBAPP_URL приёмник бесполезен.
    if (webappConfig !== null && announceChannelId !== null) {
        registerEventIntake(dp, {
            client: tg,
            storage,
            residents,
            channelId: announceChannelId,
            webappUrl: webappConfig.publicUrl,
            dataFile,
        })
        console.log(`[events] приём анонсов из канала ${announceChannelId} включён`)
    } else if (announceChannelId === null) {
        console.warn('[warn] ANNOUNCE_CHANNEL_ID не задан — пересылка постов канала в ивенты отключена.')
    }
    // Резидентские взносы. Живут в миниаппе и в личке; в боте от них остались только
    // кнопка «Я внёс» из DM и тестовые дев-команды.
    registerDuesHandlers(dp, {
        client: tg,
        storage,
        residents,
        allowedChats,
        tzOffsetMinutes: hostingTzOffset,
        devUserIds,
    })
    // Дев-команды бэкапа стейта: /backup (разово) и /autobackup <интервал> (по расписанию).
    if (devUserIds.size > 0) {
        registerBackupHandlers(dp, { client: tg, storage, devUserIds, allowedChats })
    }
    if (printerUrl !== null) {
        registerPrinterHandlers(dp, { client: tg, storage, allowedChats, residents, printerUrl, printerAuth })
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
            githubRepo,
            boardToken,
        })
        if (self.username) {
            // В группах web_app-кнопки запрещены — используем deep link на Main Mini App
            // (его нужно один раз включить в BotFather, указав тот же WEBAPP_URL).
            const deepLink = `https://t.me/${self.username}?startapp=hosting`
            setHostingMiniappLink(deepLink)
            setHostingBoardLink(deepLink)
        }
        // Появился в спейсе — напомнить про сегодняшние заявки без хоста.
        setHostingReminder({ webappUrl: webappConfig.publicUrl, tzOffsetMinutes: hostingTzOffset })
        // Кнопка «Открыть взносы» в личке: в приватном чате web_app-кнопки разрешены,
        // поэтому deep link тут не нужен.
        setDuesMiniappUrl(webappConfig.publicUrl)
        // Чек-ин/чек-аут/MAC-отметки пересобирают доску «кто сегодня в спейсе» (присутствие
        // на ней показывается). Без миниаппа доски нет, хук не ставится — остаётся ручной /inside.
        setPresenceChangeHook(() => {
            void syncHostingBoard(tg, storage, allowedChats, hostingTzOffset).catch((err) =>
                console.error('[hosting-board] presence sync error:', err),
            )
        })
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
    // Жалобы загрузки стейта копятся до этого момента: сама загрузка идёт раньше логина,
    // и console.error там ушёл бы только в докер-лог (см. Storage.takeWarnings).
    for (const w of storage.takeWarnings()) console.error('[storage]', w)
    if (devUserIds.size > 0) {
        console.log(`[errors] отчёты об ошибках идут в личку: ${[...devUserIds].join(', ')}`)
    }

    // Список команд, который Telegram показывает по / в меню.
    // Большинство админских команд показываем только админам группы; /inside — всем участникам.
    const adminCommands = [
        BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
        BotCommands.cmd('komanda', 'команда'),
        BotCommands.cmd('printer', 'Статус 3D-принтера'),
        BotCommands.cmd('goals', 'Показать текущий сбор'),
        BotCommands.cmd('history', 'Прошлые сборы: /history [период]'),
        BotCommands.cmd('goalsmute', 'Вкл/выкл автоотправку сбора в этот чат'),
        BotCommands.cmd('donate', 'Добавить донат: /donate <сумма> <ник>'),
        BotCommands.cmd('remove', 'Удалить донат: /remove <номер|ник> [сумма]'),
        BotCommands.cmd('setgoal', 'Задать цель текущего сбора (0 — снять)'),
        BotCommands.cmd('settitle', 'Изменить тему сбора'),
        BotCommands.cmd('setdesc', 'Изменить описание сбора (реквизиты/ссылки)'),
        BotCommands.cmd('setresetday', 'День сброса сбора (1–29)'),
        BotCommands.cmd('announcemute', 'Вкл/выкл анонсы (обновления/объявления) в этот чат'),
        BotCommands.cmd('boardmute', 'Вкл/выкл доску «кто сегодня в спейсе» в этом чате'),
        BotCommands.cmd('export', 'Выгрузить донаты в CSV (all — за все периоды)'),
        BotCommands.cmd('help', 'Справка по командам'),
    ]
    const memberCommands = [
        BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
        BotCommands.cmd('komanda', 'команда'),
        BotCommands.cmd('printer', 'Статус 3D-принтера'),
        BotCommands.cmd('goals', 'Показать текущий сбор'),
        BotCommands.cmd('history', 'Прошлые сборы: /history [период]'),
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
    // Шедулер бэкапов поднимаем всегда: расписания лежат в стейте и переживают рестарт,
    // даже если DEV_USER_IDS временно пуст (иначе включённый бэкап тихо перестал бы ходить).
    const backups = startBackupScheduler(tg, storage)
    // Взносы: тик открывает период, когда настал день сбора (и добирает пропущенный за простой).
    const dues = startDuesScheduler(tg, storage, residents, hostingTzOffset)
    const presence = startPresenceScheduler(tg, storage, residents)
    // Доска «кто сегодня в спейсе» — часть подсистемы хостинга: только при включённом миниаппе.
    const hostingBoard = webappConfig !== null
        ? startHostingBoardScheduler(tg, storage, allowedChats, hostingTzOffset)
        : null
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

    /** Сколько ждём дозаписи стейта на выключении: дальше докер всё равно пришлёт SIGKILL. */
    const DRAIN_TIMEOUT_MS = 5_000
    let shuttingDown = false
    const shutdown = async (signal: string) => {
        if (shuttingDown) return
        shuttingDown = true
        console.log(`[shutdown] ${signal}`)
        scheduler.stop()
        dailyPoster.stop()
        backups.stop()
        dues.stop()
        presence.stop()
        hostingBoard?.stop()
        printerWatcher?.stop()
        macPoller?.stop()
        webappServer?.stop()
        // Записи в Storage поставлены в очередь и могут быть ещё в полёте: без ожидания
        // подтверждённая пользователю правка (донат, одобренный визит, чек-ин) терялась.
        await Promise.race([
            storage.drain(),
            new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS)),
        ])
        await tg.destroy()
        process.exit(0)
    }
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
