// Напоминание гостю о его визите: DM в личку за выбранный им срок до слота.
//
// Это опция, а не рассылка: гость сам выбирает срок в форме заявки, и без выбора бот
// молчит. Кнопка под напоминанием одна — «Не смогу прийти»: планы чаще всего рушатся
// именно в этот момент, и заставлять человека лезть ради отмены в миниапп незачем.
// Подтверждать приход кнопкой не просим: она ничего не меняет, а сообщение, которое
// можно просто проигнорировать, ничем не хуже.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { CallbackQueryContext, Dispatcher } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import {
    addDaysToKey,
    ARRIVAL_LATE_MS,
    displayName,
    formatDayKey,
    isFakeUserId,
    notifyApproverCancelled,
    slotStartUtc,
    todayKey,
} from './hosting.js'
import { syncHostingBoard } from './hosting-board.js'
import { startHeartbeatInterval } from './health.js'
import type { Storage } from './storage.js'
import type { HostingRequest, VisitReminder, VisitReminderChoice } from './types.js'

/** Сроки в порядке показа в миниаппе. */
export const REMINDER_CHOICES = ['m30', 'h1', 'h2', 'morning', 'evening'] as const

/** Что предлагаем по умолчанию: за два часа — успеть собраться и доехать. */
export const DEFAULT_REMINDER_CHOICE: VisitReminderChoice = 'h2'

/** Время суток для сроков, привязанных не к слоту (пояс спейса). */
const MORNING_TIME = '09:00'
const EVENING_TIME = '20:00'

const TICK_INTERVAL_MS = 60 * 1000

export const isReminderChoice = (raw: unknown): raw is VisitReminderChoice =>
    typeof raw === 'string' && (REMINDER_CHOICES as readonly string[]).includes(raw)

/** Момент отправки напоминания (мс UTC). NaN — слот заявки не разбирается. */
export const reminderAtUtc = (
    dateKey: string,
    time: string,
    choice: VisitReminderChoice,
    tzOffsetMinutes: number,
): number => {
    const slot = slotStartUtc(dateKey, time, tzOffsetMinutes)
    switch (choice) {
        case 'm30':
            return slot - 30 * 60_000
        case 'h1':
            return slot - 60 * 60_000
        case 'h2':
            return slot - 120 * 60_000
        case 'morning':
            return slotStartUtc(dateKey, MORNING_TIME, tzOffsetMinutes)
        case 'evening':
            return slotStartUtc(addDaysToKey(dateKey, -1), EVENING_TIME, tzOffsetMinutes)
    }
}

/**
 * Срок применим к этому слоту: момент ещё не прошёл и он раньше самого визита.
 *
 * Второе условие не формальность: «утром в день визита» для слота в 08:00 наступает
 * уже после прихода гостя, и такое напоминание было бы вредным.
 */
export const reminderFits = (
    dateKey: string,
    time: string,
    choice: VisitReminderChoice,
    tzOffsetMinutes: number,
    now: number = Date.now(),
): boolean => {
    const at = reminderAtUtc(dateKey, time, choice, tzOffsetMinutes)
    const slot = slotStartUtc(dateKey, time, tzOffsetMinutes)
    return Number.isFinite(at) && Number.isFinite(slot) && at > now && at <= slot
}

/**
 * Новое значение поля `remind` при правке заявки.
 *
 * Факт отправки переживает правку цели или анонимности, но не смену слота и не смену
 * самого срока: перенесли визит на вечер — напомним заново, иначе гость останется без
 * напоминания именно там, где оно нужнее всего.
 */
export const mergeReminder = (
    previous: VisitReminder | null | undefined,
    choice: VisitReminderChoice | null,
    slotChanged: boolean,
): VisitReminder | null => {
    if (choice === null) return null
    const keepSent = !slotChanged && previous?.choice === choice
    return { choice, sentAt: keepSent ? previous?.sentAt ?? null : null }
}

export type ReminderError = 'not_found' | 'not_yours' | 'too_late'

/** Ставит/снимает напоминание по своей заявке (экран визита). */
export const setVisitReminder = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    userId: number,
    choice: VisitReminderChoice | null,
): Promise<{ ok: true } | { ok: false; error: ReminderError }> => {
    const request = storage.get().hostingRequests[id]
    if (!request) return { ok: false, error: 'not_found' }
    if (request.guest.userId !== userId) return { ok: false, error: 'not_yours' }
    if (choice !== null && !reminderFits(request.dateKey, request.time, choice, tzOffsetMinutes)) {
        return { ok: false, error: 'too_late' }
    }
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r) r.remind = mergeReminder(r.remind, choice, false)
    })
    return { ok: true }
}

// ---------------------------------------------------------------------------
// Отправка
// ---------------------------------------------------------------------------

const CB_CANCEL = 'visitremind:no:'

/** «Пт, 17 июля» с пометкой, если это сегодня или завтра: напоминание читают наспех. */
const whenLabel = (dateKey: string, tzOffsetMinutes: number): string => {
    const today = todayKey(tzOffsetMinutes)
    if (dateKey === today) return 'сегодня'
    if (dateKey === addDaysToKey(today, 1)) return 'завтра'
    return formatDayKey(dateKey)
}

/**
 * Само напоминание. У неподтверждённой заявки текст другой: обещать визит, который
 * никто не взялся хостить, нельзя — гость приедет к закрытой двери.
 */
export const notifyVisitReminder = async (
    client: TelegramClient,
    webappUrl: string,
    tzOffsetMinutes: number,
    request: HostingRequest,
): Promise<void> => {
    const when = whenLabel(request.dateKey, tzOffsetMinutes)
    const host = request.approvedBy
    const lines = host
        ? [
            `🔔 Напоминаю: визит в спейс <b>${when} к ${request.time}</b>.`,
            `Вас хостит ${displayName(host.name)}${host.username ? ` (@${host.username})` : ''}.`,
            'У двери откройте свой визит и нажмите «Я на месте».',
        ]
        : [
            `🔔 Напоминаю: вы собирались в спейс <b>${when} к ${request.time}</b>.`,
            'Заявку пока никто не подтвердил — резиденты её видят.',
        ]
    await client.sendText(request.guest.userId, html(lines.join('<br>')), {
        replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback('Не смогу прийти', `${CB_CANCEL}${request.id}`)],
            [BotKeyboard.webView('Мои визиты', webappUrl)],
        ]),
        disableWebPreview: true,
    })
}

/**
 * Заявки, которым пора напомнить: срок настал, но визит ещё не безнадёжно прошёл.
 *
 * Верхняя граница нужна из-за простоя: после суток лежачего бота напоминание о вчерашнем
 * визите — это спам, а не забота. Фейки дев-сида отсекаем, как на любой поверхности,
 * которая пишет живым людям.
 */
const dueReminders = (storage: Storage, tzOffsetMinutes: number, now: number): HostingRequest[] =>
    Object.values(storage.get().hostingRequests).filter((r) => {
        if (!r.remind || r.remind.sentAt) return false
        if (isFakeUserId(r.guest.userId)) return false
        const at = reminderAtUtc(r.dateKey, r.time, r.remind.choice, tzOffsetMinutes)
        const slot = slotStartUtc(r.dateKey, r.time, tzOffsetMinutes)
        if (!Number.isFinite(at) || !Number.isFinite(slot)) return false
        return at <= now && now <= slot + ARRIVAL_LATE_MS
    })

/**
 * Тик рассылки. Отметку «отправлено» ставим и после неудачной отправки: закрытая личка
 * — это норма, а без отметки бот пытался бы достучаться каждую минуту до самого визита.
 */
export const startVisitReminderScheduler = (
    client: TelegramClient,
    storage: Storage,
    tzOffsetMinutes: number,
    webappUrl: string,
): { stop: () => void } =>
    startHeartbeatInterval(
        'visit-reminders',
        TICK_INTERVAL_MS,
        async () => {
            for (const request of dueReminders(storage, tzOffsetMinutes, Date.now())) {
                try {
                    await notifyVisitReminder(client, webappUrl, tzOffsetMinutes, request)
                } catch (err) {
                    console.warn(`[visit-reminder] не удалось напомнить ${request.guest.userId}:`, err)
                }
                await storage.update((s) => {
                    const r = s.hostingRequests[request.id]
                    if (r?.remind) r.remind.sentAt = new Date().toISOString()
                })
            }
        },
        '[visit-reminder]',
    )

/**
 * Кнопка под напоминанием. «Не смогу прийти» — та же отмена, что в миниаппе: заявка
 * удаляется, хосту уходит DM. Чужие callback'и пропускаем дальше (см. инвариант про
 * PropagationAction в CLAUDE.md).
 */
export const registerVisitReminderHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        allowedChats: ReadonlySet<number>
        tzOffsetMinutes: number
    },
): void => {
    const { client, storage, allowedChats, tzOffsetMinutes } = deps

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        if (!ctx.dataStr?.startsWith(CB_CANCEL)) return PropagationAction.Continue
        const id = ctx.dataStr.slice(CB_CANCEL.length)

        const request = storage.get().hostingRequests[id]
        if (!request || request.guest.userId !== ctx.user.id) {
            await ctx.answer({ text: 'Заявки уже нет.', alert: true })
            return
        }
        await storage.update((s) => {
            delete s.hostingRequests[id]
        })
        if (request.status === 'approved') {
            void notifyApproverCancelled(client, request)
                .catch((err) => console.error('[visit-reminder] не удалось уведомить резидента об отмене визита:', err))
        }
        void syncHostingBoard(client, storage, allowedChats, tzOffsetMinutes)
            .catch((err) => console.error('[hosting-board] не удалось обновить доску после отмены визита:', err))
        // Переписываем напоминание итогом и гасим кнопку: заявки уже нет.
        try {
            await ctx.editMessage({
                text: html('Заявка отменена. Приходите в другой раз — заявку можно оставить заново.'),
                replyMarkup: BotKeyboard.inline([]),
            })
        } catch (err) {
            console.warn('[visit-reminder] не удалось переписать напоминание:', err)
        }
        await ctx.answer({ text: 'Отменил' })
    })
}
