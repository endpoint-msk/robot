import { BotCommands, BotKeyboard, type TelegramClient } from '@mtcute/node'
import { languageChoiceOf, tr, withLocale } from './i18n.js'
import type { Storage } from './storage.js'

export const LANGUAGE_MENU_CALLBACK = 'menu:language'
export const languageButton = () => BotKeyboard.callback(tr('🌐 Язык', '🌐 Language'), LANGUAGE_MENU_CALLBACK)

export const insideCommand = () => BotCommands.cmd('inside', tr('Показать, кто сейчас в спейсе', 'See who is at the space'))

// /printer в группах не показывается: камера видна только резидентам в личке.
export const privateCommands = () => [
    BotCommands.cmd('start', tr('Открыть меню бота', 'Open the bot menu')),
    BotCommands.cmd('menu', tr('Открыть меню бота', 'Open the bot menu')),
    insideCommand(),
    BotCommands.cmd('printer', tr('Статус 3D-принтера', '3D printer status')),
    BotCommands.cmd('bindmac', tr('Привязать MAC для авто-отметок', 'Link a MAC address for automatic check-in')),
    BotCommands.cmd('unbindmac', tr('Убрать привязку MAC', 'Unlink a MAC address')),
    BotCommands.cmd('maclist', tr('Показать свои привязанные MAC', 'Show linked MAC addresses')),
    BotCommands.cmd('settings', tr('Настройки авто-отметки (ник/аноним)', 'Automatic check-in settings')),
    BotCommands.cmd('language', tr('Язык бота', 'Bot language')),
]

const pending = new Map<number, Promise<void>>()

// Настройка в боте и миниаппе может меняться одновременно. Читаем её после
// предыдущей записи в Telegram, чтобы старый запрос не перезаписал новый выбор.
export const syncPrivateLanguageCommands = (client: TelegramClient, storage: Storage, userId: number): Promise<void> => {
    const scope = BotCommands.peer(userId)
    const previous = pending.get(userId) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(() => {
        const choice = languageChoiceOf(storage, userId)
        const commands = choice === 'auto' ? null : withLocale(choice, privateCommands)
        return client.setMyCommands({ commands, scope })
    }).finally(() => {
        if (pending.get(userId) === run) pending.delete(userId)
    })
    pending.set(userId, run)
    return run
}
