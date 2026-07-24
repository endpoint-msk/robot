// «Позвать в спейс»: резидент из миниаппа зовёт человека на конкретный день, тому
// приходит DM. Резиденту в личку кладём кнопку «Приду» (сразу ставит отметку на день),
// гостю — вход в миниапп: у гостя визит это заявка со временем и одобрением, одной
// кнопкой её не оформить.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { CallbackQueryContext, Dispatcher } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import {
    addDaysToKey,
    displayName,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    isBlocked,
    isValidDayKey,
    listKnownGuests,
    listResidents,
    requestsForDay,
    residentsAttendingDay,
    setResidentAttendance,
    todayKey,
} from './hosting.js'
import { syncHostingBoard } from './hosting-board.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { HostingUser } from './types.js'

/** callback_data кнопки «Приду» из зова: день дописывается ключом 'YYYY-MM-DD'. */
const CB_COME = 'hostinvite:come:'

/** Кандидат в списке «кого позвать» на день. */
export type InviteCandidate = HostingUser & {
    resident: boolean
    /** Уже придёт: резидент отметился «я приду» либо у гостя есть заявка на этот день. */
    attending: boolean
}

/**
 * Кого можно позвать на день: резиденты (админы allowlist-чатов) + гости из заявок.
 * Себя исключаем. Резиденты идут первыми, внутри группы — по имени.
 */
export const listInviteCandidates = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    dateKey: string,
    selfId: number,
): Promise<InviteCandidate[]> => {
    const busy = new Set<number>([
        ...residentsAttendingDay(storage, dateKey).map((a) => a.user.userId),
        ...requestsForDay(storage, dateKey).map((r) => r.guest.userId),
    ])
    const residents = await listResidents(client, allowedChats)
    const residentIds = new Set(residents.map((r) => r.userId))
    const toCandidate = (u: HostingUser, resident: boolean): InviteCandidate => ({
        ...u,
        resident,
        attending: busy.has(u.userId),
    })
    const byName = (a: InviteCandidate, b: InviteCandidate): number => a.name.localeCompare(b.name, 'ru')

    return [
        ...residents.filter((r) => r.userId !== selfId).map((r) => toCandidate(r, true)).sort(byName),
        ...listKnownGuests(storage)
            .filter((g) => g.userId !== selfId && !residentIds.has(g.userId))
            .map((g) => toCandidate(g, false))
            .sort(byName),
    ]
}

export type InviteError = 'bad_date' | 'blocked' | 'self' | 'dm_closed'

/**
 * Шлёт зов в личку. 'dm_closed' — человек не открывал чат с ботом (или закрыл его):
 * узнать это заранее нельзя, только по ошибке отправки.
 */
export const sendHostingInvite = async (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    tzOffsetMinutes: number,
    webappUrl: string,
    dateKey: string,
    target: InviteCandidate,
    from: HostingUser,
): Promise<{ ok: true } | { ok: false; error: InviteError }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    if (target.userId === from.userId) return { ok: false, error: 'self' }
    if (isBlocked(storage, target.userId)) return { ok: false, error: 'blocked' }

    const who = from.username
        ? `${html.escape(displayName(from.name))} (@${from.username})`
        : html.escape(displayName(from.name))
    const when = `${formatDayKey(dateKey)}${dateKey === today ? ' (сегодня)' : ''}`
    const isResident = await residents.isResident(target.userId)
    const text = isResident
        ? `👋 ${who} зовёт тебя в спейс: <b>${when}</b>.`
        : `👋 ${who} зовёт тебя в спейс: <b>${when}</b>.<br>Оставь заявку на визит — резиденты увидят её и подтвердят.`
    const keyboard = BotKeyboard.inline(
        isResident
            ? [
                [BotKeyboard.callback('✅ Приду', `${CB_COME}${dateKey}`)],
                [BotKeyboard.webView('Открыть хостинг', webappUrl)],
            ]
            : [[BotKeyboard.webView('Оставить заявку', webappUrl)]],
    )

    try {
        await client.sendText(target.userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        return { ok: true }
    } catch {
        return { ok: false, error: 'dm_closed' }
    }
}

/**
 * Кнопка «Приду» из зова: ставит отметку резидента на день и пересобирает доску.
 * Чужие callback'и пропускаем дальше (см. инвариант про PropagationAction в CLAUDE.md).
 */
export const registerHostingInviteHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        residents: ResidentDirectory
        allowedChats: ReadonlySet<number>
        tzOffsetMinutes: number
    },
): void => {
    const { client, storage, residents, allowedChats, tzOffsetMinutes } = deps

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        if (!ctx.dataStr?.startsWith(CB_COME)) return PropagationAction.Continue
        const dateKey = ctx.dataStr.slice(CB_COME.length)

        if (!(await residents.isResident(ctx.user.id))) {
            await ctx.answer({ text: 'Отметка «я приду» доступна только резидентам.', alert: true })
            return
        }
        const user: HostingUser = {
            userId: ctx.user.id,
            username: ctx.user.username ?? null,
            name: displayName(ctx.user.displayName),
        }
        const result = await setResidentAttendance(storage, tzOffsetMinutes, dateKey, user, true)
        if (!result.ok) {
            await ctx.answer({ text: 'Этот день уже прошёл или выпал из ближайшей недели.', alert: true })
            return
        }
        void syncHostingBoard(client, storage, allowedChats, tzOffsetMinutes).catch((err) =>
            console.error('[hosting-board] не удалось обновить доску после зова:', err),
        )
        // Кнопку убираем пустой inline-разметкой: отметка уже стоит, жать повторно незачем
        // (само по себе безвредно — setResidentAttendance идемпотентен).
        try {
            await ctx.editMessage({
                text: html(`✅ Отметил: ты придёшь <b>${formatDayKey(dateKey)}</b>. Передумаешь — сними отметку в миниаппе.`),
                replyMarkup: BotKeyboard.inline([]),
            })
        } catch (err) {
            console.warn('[hosting] не удалось переписать сообщение зова:', err)
        }
        await ctx.answer({ text: 'Отметил' })
    })
}
