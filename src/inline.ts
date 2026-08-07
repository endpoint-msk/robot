import { BotInline, BotInlineMessage, BotKeyboard, html, type InputInlineResult } from '@mtcute/node'
import type { Dispatcher } from '@mtcute/dispatcher'
import {
    addDaysToKey,
    attendeesForDay,
    displayName,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    isFakeUserId,
    requestsForDay,
    todayKey,
} from './hosting.js'
import { activeDayForBoard, boardMarkup, buildBoardMessage } from './hosting-board.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { HostingRequest } from './types.js'

/** Сколько заявок отдаём в выдачу. Больше в списке инлайна всё равно не пролистывают. */
const MAX_REQUESTS = 20

const BOARD_ID = 'board'
const REQUEST_PREFIX = 'req:'

/**
 * Deep link на миниапп для кнопки под отправленной заявкой. Ставится после логина
 * (нужен username бота), как hostingBoardLink — до этого кнопки просто нет.
 */
let miniappLink: string | null = null

export const setInlineMiniappLink = (link: string | null): void => {
    miniappLink = link
}

const requestMarkup = () =>
    miniappLink ? BotKeyboard.inline([[BotKeyboard.url('🚪 Открыть заявки', miniappLink)]]) : undefined

/** Подстрока запроса в любом из полей; пустой запрос совпадает со всем. */
const matches = (query: string, ...fields: (string | null)[]): boolean => {
    if (query === '') return true
    return fields.some((f) => (f ?? '').toLowerCase().includes(query))
}

/**
 * Ничьи заявки в окне [сегодня; +6], от ближайшей к дальней.
 *
 * Фейки дев-сида отсекаем: выбранная заявка уходит сообщением в чат, то есть на
 * публичную поверхность, — тот же запрет, что на доске.
 */
const openRequests = (storage: Storage, tzOffsetMinutes: number): HostingRequest[] => {
    const today = todayKey(tzOffsetMinutes)
    const out: HostingRequest[] = []
    for (let i = 0; i < HOSTING_DAYS_AHEAD; i++) {
        for (const r of requestsForDay(storage, addDaysToKey(today, i))) {
            if (r.status !== 'pending') continue
            if (isFakeUserId(r.guest.userId)) continue
            out.push(r)
        }
    }
    return out
}

/**
 * Имя гостя в отправляемом сообщении.
 *
 * Анонимность гостя (`anon`) значит «не показывать меня в публичном списке дня», а
 * сообщение из инлайна летит именно в чат — поэтому имени там нет. В самой выдаче
 * инлайна имя видно: её читает только резидент, который выбирает заявку.
 */
const publicGuestLabel = (r: HostingRequest): string =>
    r.anon
        ? 'инкогнито'
        : `${html.escape(displayName(r.guest.name))}${r.guest.username ? ` (@${r.guest.username})` : ''}`

/** Детали заявки для отправки в чат: день, время, гость, цель. */
const renderRequest = (r: HostingRequest): string => {
    const lines = [
        '🚪 <b>Заявка на визит</b>',
        `${formatDayKey(r.dateKey)}, ${r.time}`,
        `Гость: ${publicGuestLabel(r)}`,
    ]
    if (r.purpose.trim() !== '') lines.push(`Цель: ${html.escape(r.purpose.trim())}`)
    lines.push('')
    lines.push('Пока никто не взялся хостить.')
    return lines.join('<br>')
}

/** Короткая подпись доски в выдаче: сколько придут и сколько всего заявок. */
const boardSummary = (storage: Storage, dateKey: string): string => {
    const attendees = attendeesForDay(storage, dateKey).length
    const requests = requestsForDay(storage, dateKey).filter((r) => !isFakeUserId(r.guest.userId)).length
    return `придут: ${attendees}, заявок: ${requests}`
}

/**
 * Инлайн-режим для резидентов: отправить в чат доску «кто сегодня в спейсе» или
 * детали конкретной ничьей заявки.
 *
 * Гейт — резидентство, и он тут обязателен по той же причине, что и в личке: инлайн
 * доступен из любого чата, включая те, где бота нет вовсе, поэтому allowlist здесь
 * ничего не решает. Ответ помечается `private: true` — иначе Telegram закэшировал бы
 * выдачу одного человека и показал её следующему.
 *
 * Режим нужно один раз включить в BotFather (`/setinline`), иначе апдейты не приходят.
 */
export const registerInlineHandlers = (
    dp: Dispatcher,
    deps: { storage: Storage; residents: ResidentDirectory; tzOffsetMinutes: number },
): void => {
    const { storage, residents, tzOffsetMinutes } = deps

    dp.onInlineQuery(async (query) => {
        if (!(await residents.isResident(query.user.id))) {
            await query.answer([], {
                cacheTime: 0,
                private: true,
                switchPm: { text: 'Инлайн доступен резидентам', parameter: 'inline' },
            })
            return
        }

        const text = query.query.trim().toLowerCase()
        const results: InputInlineResult[] = []

        const boardDay = activeDayForBoard(storage, tzOffsetMinutes) ?? todayKey(tzOffsetMinutes)
        if (matches(text, 'доска', 'board', 'спейс', formatDayKey(boardDay))) {
            results.push(
                BotInline.article(BOARD_ID, {
                    title: `Доска: ${formatDayKey(boardDay)}`,
                    description: boardSummary(storage, boardDay),
                    message: BotInlineMessage.text(html(buildBoardMessage(storage, boardDay, tzOffsetMinutes)), {
                        disableWebPreview: true,
                        replyMarkup: boardMarkup(),
                    }),
                }),
            )
        }

        let shown = 0
        for (const r of openRequests(storage, tzOffsetMinutes)) {
            if (shown >= MAX_REQUESTS) break
            const name = displayName(r.guest.name)
            if (!matches(text, name, r.guest.username, r.purpose, formatDayKey(r.dateKey), r.time)) continue
            const purpose = r.purpose.trim()
            results.push(
                BotInline.article(`${REQUEST_PREFIX}${r.id}`, {
                    title: `${formatDayKey(r.dateKey)}, ${r.time} — ${name}`,
                    description: `${r.anon ? 'инкогнито · ' : ''}${purpose || 'цель не указана'}`,
                    message: BotInlineMessage.text(html(renderRequest(r)), {
                        disableWebPreview: true,
                        replyMarkup: requestMarkup(),
                    }),
                }),
            )
            shown += 1
        }

        // cacheTime 0: и доска, и состав заявок меняются в любой момент, а закэшированная
        // выдача показывала бы отменённые заявки как живые.
        await query.answer(results, { cacheTime: 0, private: true })
    })
}
