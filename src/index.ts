import 'dotenv/config'
import { BotCommands, TelegramClient } from '@mtcute/node'
import { Dispatcher } from '@mtcute/dispatcher'
import { parseAllowedChats, registerHandlers } from './handlers.js'
import {
    registerChatActivityTracker,
    registerPresenceDeleteWatcher,
    registerPresenceHandlers,
    startPresenceScheduler,
} from './presence.js'
import { startMonthlyScheduler } from './scheduler.js'
import { Storage } from './storage.js'

const required = (name: string): string => {
    const v = process.env[name]
    if (!v) {
        console.error(`Не задана переменная окружения ${name}. См. .env.example.`)
        process.exit(1)
    }
    return v
}

const main = async () => {
    const apiId = Number(required('API_ID'))
    const apiHash = required('API_HASH')
    const botToken = required('BOT_TOKEN')
    const allowedChats = parseAllowedChats(process.env.ALLOWED_CHATS)
    const dataFile = process.env.DATA_FILE ?? './data.json'

    if (allowedChats.size === 0) {
        console.warn('[warn] ALLOWED_CHATS пуст — бот не будет реагировать ни в одном чате.')
    }

    const storage = new Storage(dataFile)
    await storage.load()

    const tg = new TelegramClient({
        apiId,
        apiHash,
        storage: 'bot.session',
    })

    const dp = Dispatcher.for(tg)
    // presence-хендлеры регистрируем РАНЬШЕ — чтобы /start в личке ловил presence,
    // а групповой /start (алиас /help) — общий обработчик ниже
    registerPresenceHandlers(dp, { client: tg, storage, allowedChats })
    registerChatActivityTracker(dp, storage, allowedChats)
    registerPresenceDeleteWatcher(dp, tg, storage, allowedChats)
    registerHandlers(dp, { client: tg, storage, allowedChats })

    const self = await tg.start({ botToken })
    console.log(`Logged in as @${self.username ?? self.id} (${self.displayName})`)

    // Список команд, который Telegram показывает по / в меню.
    // Скоупим на админов групп — обычные участники в этих чатах меню не увидят.
    const commands = [
        BotCommands.cmd('start', 'Меню резидента (в личке): отметиться в спейсе'),
        BotCommands.cmd('inside', 'Показать, кто сейчас в спейсе'),
        BotCommands.cmd('goals', 'Показать текущий сбор'),
        BotCommands.cmd('donate', 'Добавить донат: /donate <сумма> <ник>'),
        BotCommands.cmd('remove', 'Удалить донат: /remove <номер|ник> [сумма]'),
        BotCommands.cmd('setgoal', 'Задать цель текущего сбора (0 — снять)'),
        BotCommands.cmd('settitle', 'Изменить тему сбора'),
        BotCommands.cmd('help', 'Справка по командам'),
    ]
    try {
        // В группах админам — полный набор админских команд
        await tg.setMyCommands({ commands, scope: BotCommands.allGroupAdmins })
        // В личке — только /start (для меню резидента)
        await tg.setMyCommands({
            commands: [BotCommands.cmd('start', 'Отметиться в спейсе')],
            scope: BotCommands.allPrivate,
        })
        // Дефолтный scope — пустой
        await tg.setMyCommands({ commands: null })
    } catch (err) {
        console.error('[warn] failed to register bot commands:', err)
    }

    const scheduler = startMonthlyScheduler(tg, storage)
    const presence = startPresenceScheduler(tg, storage, allowedChats)

    const shutdown = async () => {
        scheduler.stop()
        presence.stop()
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
