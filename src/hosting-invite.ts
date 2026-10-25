// «Позвать в спейс»: резидент из миниаппа зовёт человека на конкретный день, тому
// приходит DM. Резиденту в личку кладём кнопку «Приду» (сразу ставит отметку на день),
// гостю — вход в миниапп: у гостя визит это заявка со временем и одобрением, одной
// кнопкой её не оформить.

import { BotInline, BotInlineMessage, BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { CallbackQueryContext, Dispatcher } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import {
    addDaysToKey,
    displayName,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    isBlocked,
    isDayLocked,
    isValidDayKey,
    listKnownGuests,
    requestsForDay,
    residentsAttendingDay,
    setResidentAttendance,
    todayKey,
} from './hosting.js'
import { dayTarget, newRequestTarget, startappAt, webappAt } from './deeplink.js'
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
    directory: ResidentDirectory,
    dateKey: string,
    selfId: number,
): Promise<InviteCandidate[]> => {
    const busy = new Set<number>([
        ...residentsAttendingDay(storage, dateKey).map((a) => a.user.userId),
        ...requestsForDay(storage, dateKey).map((r) => r.guest.userId),
    ])
    // Неполный состав (`complete: false`) тут не беда: зов - ручное действие, список
    // кандидатов просто окажется короче, а не соврёт про чьи-то права.
    const residents = (await directory.list()).users
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

export type InviteError = 'bad_date' | 'blocked' | 'self' | 'dm_closed' | 'day_locked'

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
    const isResident = await residents.isResident(target.userId)
    // Гостя на закрытый день звать некуда: заявку он всё равно не оставит. Резидента
    // зовём как обычно — запрет только про гостей.
    if (!isResident && isDayLocked(storage, dateKey)) return { ok: false, error: 'day_locked' }

    const who = from.username
        ? `${html.escape(displayName(from.name))} (@${from.username})`
        : html.escape(displayName(from.name))
    const when = `${formatDayKey(dateKey)}${dateKey === today ? ' (сегодня)' : ''}`
    const text = isResident
        ? `👋 ${who} зовёт тебя в спейс: <b>${when}</b>.`
        : `👋 ${who} зовёт вас в спейс: <b>${when}</b>.<br>Оставьте заявку на визит — резиденты увидят её и подтвердят.`
    const keyboard = BotKeyboard.inline(
        isResident
            ? [
                [BotKeyboard.callback('✅ Приду', `${CB_COME}${dateKey}`)],
                [BotKeyboard.webView('Открыть хостинг', webappAt(webappUrl, dayTarget(dateKey)))],
            ]
            : [[BotKeyboard.webView('Оставить заявку', webappAt(webappUrl, newRequestTarget(dateKey)))]],
    )

    try {
        await client.sendText(target.userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        return { ok: true }
    } catch {
        return { ok: false, error: 'dm_closed' }
    }
}

/**
 * Карточка «Позвать из Telegram» для выбора чата (`WebApp.shareMessage`): так резидент
 * зовёт тех, кого бот не знает и кому первым написать не может. Уходит сообщением самого
 * резидента, поэтому от первого лица; кнопка открывает форму заявки на этот день.
 */
export const prepareDayShare = async (
    client: TelegramClient,
    storage: Storage,
    tzOffsetMinutes: number,
    botLink: string | null,
    dateKey: string,
    userId: number,
): Promise<{ ok: true; id: string; expireDate: number } | { ok: false; error: 'bad_date' | 'day_locked' }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    // Карточка зовёт оставить заявку, а в закрытый день её не примут.
    if (isDayLocked(storage, dateKey)) return { ok: false, error: 'day_locked' }

    const when = `${formatDayKey(dateKey)}${dateKey === today ? ' (сегодня)' : ''}`
    const text = html(`👋 Зову в спейс: <b>${when}</b>.<br>Оставьте заявку на визит по кнопке, и резиденты её подтвердят.`)
    const replyMarkup = botLink
        ? BotKeyboard.inline([[BotKeyboard.url('🚪 Хочу прийти', startappAt(botLink, newRequestTarget(dateKey)))]])
        : undefined
    const prepared = await client.prepareInlineMessage({
        userId,
        result: BotInline.article(newRequestTarget(dateKey), {
            title: 'Позвать в спейс',
            description: when,
            message: BotInlineMessage.text(text, { disableWebPreview: true, replyMarkup }),
        }),
        filter: { private: true, chats: true, supergroups: true, channels: true },
    })
    return { ok: true, id: prepared.id, expireDate: prepared.expireDate }
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
