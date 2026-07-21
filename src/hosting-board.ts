import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import {
    addDaysToKey,
    attendeesForDay,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    requestsForDay,
    residentsAttendingDay,
    todayKey,
} from './hosting.js'
import { insideBoardLines } from './presence.js'
import type { Storage } from './storage.js'

/** Как часто сверяем доску с состоянием (открепление на следующий день, смена показанного дня, свежесть счётчиков). */
const TICK_INTERVAL_MS = 60 * 1000

/**
 * Deep link на миниапп хостинга для кнопки «Хочу прийти» под доской. null — миниапп
 * не настроен, кнопки нет. Ставится на старте (setHostingBoardLink), как в presence.
 */
let hostingBoardLink: string | null = null

export const setHostingBoardLink = (link: string | null): void => {
    hostingBoardLink = link
}

const boardMarkup = () =>
    hostingBoardLink
        ? BotKeyboard.inline([[BotKeyboard.url('🚪 Хочу прийти', hostingBoardLink)]])
        : undefined

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * В дне есть активность, ради которой заводится доска: подтверждённый визит, отметка
 * резидента «я приду» или (только для сегодня) кто-то отмечен внутри спейса.
 */
const dayHasActivity = (storage: Storage, dateKey: string, today: string): boolean =>
    residentsAttendingDay(storage, dateKey).length > 0 ||
    requestsForDay(storage, dateKey).some((r) => r.status === 'approved') ||
    (dateKey === today && Object.keys(storage.get().presence).length > 0)

/** Ближайший день в окне [сегодня; +6] с активностью, или null — активности нет нигде. */
export const activeDayForBoard = (storage: Storage, tzOffsetMinutes: number): string | null => {
    const today = todayKey(tzOffsetMinutes)
    for (let i = 0; i < HOSTING_DAYS_AHEAD; i++) {
        const dateKey = addDaysToKey(today, i)
        if (dayHasActivity(storage, dateKey, today)) return dateKey
    }
    return null
}

/**
 * Текст доски за конкретный день: кто сейчас внутри (блок «Сейчас в спейсе», только
 * для сегодня), кто придёт (резиденты «я приду» + подтверждённые гости без анонимных)
 * и общее число заявок. Ники — t.me-ссылки (текст-ссылка не пингует упомянутого),
 * имена без ника — экранируем. Собираем через `<br>`.
 */
export const buildBoardMessage = (storage: Storage, dateKey: string, tzOffsetMinutes: number): string => {
    const isToday = dateKey === todayKey(tzOffsetMinutes)
    const attendees = attendeesForDay(storage, dateKey)
    const requests = requestsForDay(storage, dateKey)
    const total = requests.length
    const approved = requests.filter((r) => r.status === 'approved').length

    const lines: string[] = []
    lines.push(`🚪 <b>${formatDayKey(dateKey)}${isToday ? ' (сегодня)' : ''}</b> в спейсе`)
    lines.push('')
    // Кто физически внутри прямо сейчас — только на доске сегодняшнего дня.
    if (isToday) {
        const inside = insideBoardLines(storage)
        if (inside.length > 0) {
            lines.push(...inside)
            lines.push('')
        }
    }
    if (attendees.length > 0) {
        lines.push('<b>Придут:</b>')
        for (const a of attendees) {
            const who = a.username
                ? `<a href="https://t.me/${encodeURIComponent(a.username)}">@${a.username}</a>`
                : escapeHtml(a.name)
            const mark = a.resident ? ' (резидент)' : a.time ? ` к ${a.time}` : ''
            lines.push(`• ${who}${mark}`)
        }
    } else {
        lines.push('Пока никого в открытом списке.')
    }
    lines.push('')
    lines.push(`Заявок на день: <b>${total}</b>${approved > 0 ? `, одобрено ${approved}` : ''}`)
    return lines.join('<br>')
}

const safeUnpin = async (client: TelegramClient, chatId: number, messageId: number): Promise<void> => {
    try {
        await client.unpinMessage({ chatId, message: messageId })
    } catch (err) {
        console.warn(`[hosting-board] unpin failed in chat ${chatId}:`, err)
    }
}

/**
 * Сверяет доску одного чата с актуальным состоянием:
 *  - доску, отправленную в прошлый день, открепляем и забываем («одно сообщение в день»);
 *  - при наличии активности показываем ближайший активный день (редактируем существующую
 *    доску либо, если её нет, отправляем новую и тихо закрепляем — без loud-пина);
 *  - существующую доску всегда обновляем (в т.ч. до «пустого» состояния, если активность сняли).
 */
const syncChatBoard = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    today: string,
    activeDay: string | null,
    tzOffsetMinutes: number,
): Promise<void> => {
    const key = String(chatId)
    let entry = storage.get().hostingBoard[key]

    // Доску отключили в этом чате (/boardmute) — открепляем и забываем существующую, новую не постим.
    if (storage.get().hostingBoardMuted[key]) {
        if (entry) {
            await safeUnpin(client, chatId, entry.messageId)
            await storage.update((s) => {
                delete s.hostingBoard[key]
            })
        }
        return
    }

    // «Одно сообщение в день»: вчерашнюю доску открепляем и забываем — новая заведётся
    // при первой активности уже нового дня.
    if (entry && entry.postedDay !== today) {
        await safeUnpin(client, chatId, entry.messageId)
        await storage.update((s) => {
            delete s.hostingBoard[key]
        })
        entry = undefined
    }

    // Новую доску постим только при реальной активности; уже существующую — обновляем всегда.
    if (!entry && activeDay === null) return

    const displayDay = activeDay ?? today
    const text = buildBoardMessage(storage, displayDay, tzOffsetMinutes)

    if (entry) {
        try {
            await client.editMessage({
                chatId,
                message: entry.messageId,
                text: html(text),
                disableWebPreview: true,
                replyMarkup: boardMarkup(),
            })
            if (entry.shownDay !== displayDay) {
                await storage.update((s) => {
                    const e = s.hostingBoard[key]
                    if (e) e.shownDay = displayDay
                })
            }
            return
        } catch (err) {
            // У mtcute RpcError код ошибки лежит в `.text` ('MESSAGE_NOT_MODIFIED'), а `.message` —
            // человекочитаемое описание без кода. Матчим по обоим, иначе NOT_MODIFIED «протекает»
            // в console.error и улетает дев-аккаунтам как ошибка.
            const tag = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
            if (/MESSAGE_NOT_MODIFIED/i.test(tag)) return
            if (!/MESSAGE_ID_INVALID|MESSAGE_DELETE|MESSAGE_AUTHOR_REQUIRED|MESSAGE_EDIT_TIME_EXPIRED/i.test(tag)) {
                console.error(`[hosting-board] edit failed in chat ${chatId}:`, err)
                return
            }
            // Сообщение удалили — забываем id и ниже отправим новое (если активность ещё есть).
            await storage.update((s) => {
                delete s.hostingBoard[key]
            })
            entry = undefined
            if (activeDay === null) return
        }
    }

    // Доски нет (или её удалили) и есть активность — постим новую и тихо закрепляем.
    try {
        const sent = await client.sendText(chatId, html(text), { disableWebPreview: true, replyMarkup: boardMarkup() })
        await storage.update((s) => {
            s.hostingBoard[key] = { chatId, messageId: sent.id, postedDay: today, shownDay: displayDay }
        })
        // Тихий пин: notify:false — без loud-уведомления. В супергруппах пин всё равно
        // порождает служебное сообщение «закрепил сообщение» — pinMessage возвращает его,
        // если оно создано, и мы его удаляем, чтобы доска не тянула за собой шум.
        try {
            const service = await client.pinMessage({ chatId, message: sent.id, notify: false })
            if (service) {
                try {
                    await client.deleteMessages([service])
                } catch (err) {
                    console.warn(`[hosting-board] не удалось удалить служебное сообщение о пине в чате ${chatId}:`, err)
                }
            }
        } catch (err) {
            console.warn(`[hosting-board] pin failed in chat ${chatId}:`, err)
        }
    } catch (err) {
        console.error(`[hosting-board] post failed in chat ${chatId}:`, err)
    }
}

const doSync = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    tzOffsetMinutes: number,
): Promise<void> => {
    const today = todayKey(tzOffsetMinutes)
    const activeDay = activeDayForBoard(storage, tzOffsetMinutes)
    for (const chatId of allowedChats) {
        try {
            await syncChatBoard(client, storage, chatId, today, activeDay, tzOffsetMinutes)
        } catch (err) {
            console.error(`[hosting-board] sync failed in chat ${chatId}:`, err)
        }
    }
}

/**
 * Сверяет доску во всех allowlist-чатах. Каждый чат — в своём try/catch, чтобы сбой в
 * одном не ронял остальные. Все вызовы сериализуются через промис-цепочку (как
 * `Storage.writeChain`): событийный `syncBoard()` из ручек и тик шедулера могут прийти
 * одновременно, а без сериализации оба увидели бы «доски нет» и отправили бы по копии.
 */
let syncChain: Promise<void> = Promise.resolve()

export const syncHostingBoard = (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    tzOffsetMinutes: number,
): Promise<void> => {
    const run = syncChain.then(() => doSync(client, storage, allowedChats, tzOffsetMinutes))
    syncChain = run.catch(() => {})
    return run
}

/**
 * Планировщик доски (тик 60 с): открепляет доску прошедшего дня, переключает показанный
 * день на ближайший активный и держит счётчики свежими. Событийные апдейты (одобрение,
 * «я приду») дёргают syncHostingBoard сразу — тик страхует переходы по времени.
 */
export const startHostingBoardScheduler = (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    tzOffsetMinutes: number,
): { stop: () => void } => {
    const handle = setInterval(() => {
        void syncHostingBoard(client, storage, allowedChats, tzOffsetMinutes).catch((err) =>
            console.error('[hosting-board] tick error:', err),
        )
    }, TICK_INTERVAL_MS)
    return { stop: () => clearInterval(handle) }
}
