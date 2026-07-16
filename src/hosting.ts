import { randomUUID } from 'node:crypto'
import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { Storage } from './storage.js'
import type { HostingNotifyPrefs, HostingRequest, HostingUser } from './types.js'

/** Сколько дней вперёд показывает обзор (включая сегодня). */
export const HOSTING_DAYS_AHEAD = 7

/** Дефолт настроек уведомлений: включены, только заявки на текущий день. */
export const DEFAULT_HOSTING_NOTIFY: HostingNotifyPrefs = { enabled: true, mode: 'today' }

export const notifyPrefsFor = (storage: Storage, userId: number): HostingNotifyPrefs =>
    storage.get().hostingNotify[String(userId)] ?? { ...DEFAULT_HOSTING_NOTIFY }

// ---------------------------------------------------------------------------
// Дни и недели. Ключ дня — 'YYYY-MM-DD' в поясе спейса (сдвиг в минутах от UTC,
// HOSTING_TZ_OFFSET_MINUTES). Все вычисления — простая арифметика от UTC, без
// локального времени процесса (см. инвариант про periodKey в CLAUDE.md).
// ---------------------------------------------------------------------------

export const parseHostingTzOffset = (raw: string | undefined): number => {
    if (!raw?.trim()) return 180 // Europe/Moscow, у спейса нет переходов на летнее время
    const n = Number(raw.trim())
    return Number.isFinite(n) ? Math.trunc(n) : 180
}

export const dayKeyOf = (date: Date, offsetMinutes: number): string =>
    new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10)

export const todayKey = (offsetMinutes: number): string => dayKeyOf(new Date(), offsetMinutes)

export const isValidDayKey = (key: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
    const parsed = new Date(`${key}T12:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key
}

export const addDaysToKey = (key: string, days: number): string => {
    const base = new Date(`${key}T12:00:00Z`)
    base.setUTCDate(base.getUTCDate() + days)
    return base.toISOString().slice(0, 10)
}

/** День недели ключа: 0 = понедельник … 6 = воскресенье. */
export const weekdayOfKey = (key: string): number =>
    (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7

/** Ключ понедельника недели, в которую входит день. */
export const weekStartOf = (key: string): string => addDaysToKey(key, -weekdayOfKey(key))

export const isValidTime = (raw: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)

// ---------------------------------------------------------------------------
// Операции над заявками
// ---------------------------------------------------------------------------

export const MAX_PURPOSE_LENGTH = 300

export type CreateRequestError = 'bad_date' | 'bad_time' | 'duplicate'

/**
 * Создаёт заявку на визит. День должен попадать в окно обзора (сегодня..+6),
 * у одного гостя — не больше одной активной заявки на день.
 */
export const createHostingRequest = async (
    storage: Storage,
    tzOffsetMinutes: number,
    input: { guest: HostingUser; dateKey: string; time: string; purpose: string },
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: CreateRequestError }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(input.dateKey) || input.dateKey < today || input.dateKey > maxDay) {
        return { ok: false, error: 'bad_date' }
    }
    if (!isValidTime(input.time)) return { ok: false, error: 'bad_time' }
    const duplicate = Object.values(storage.get().hostingRequests).some(
        (r) => r.guest.userId === input.guest.userId && r.dateKey === input.dateKey,
    )
    if (duplicate) return { ok: false, error: 'duplicate' }

    const request: HostingRequest = {
        id: randomUUID(),
        dateKey: input.dateKey,
        time: input.time,
        purpose: input.purpose.trim().slice(0, MAX_PURPOSE_LENGTH),
        guest: input.guest,
        createdAt: new Date().toISOString(),
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
    }
    await storage.update((s) => {
        s.hostingRequests[request.id] = request
    })
    return { ok: true, request }
}

/** Заявки на конкретный день, отсортированные по времени прихода. */
export const requestsForDay = (storage: Storage, dateKey: string): HostingRequest[] =>
    Object.values(storage.get().hostingRequests)
        .filter((r) => r.dateKey === dateKey)
        .sort((a, b) => (a.time === b.time ? a.createdAt.localeCompare(b.createdAt) : a.time.localeCompare(b.time)))

/**
 * Прошедшие недели (до текущей), в которых были заявки: ключ понедельника + счётчики.
 * Сортировка — от свежих к старым.
 */
export const archiveWeeks = (
    storage: Storage,
    tzOffsetMinutes: number,
): { weekStart: string; total: number; approved: number }[] => {
    const currentWeek = weekStartOf(todayKey(tzOffsetMinutes))
    const byWeek = new Map<string, { total: number; approved: number }>()
    for (const r of Object.values(storage.get().hostingRequests)) {
        const week = weekStartOf(r.dateKey)
        if (week >= currentWeek) continue
        const agg = byWeek.get(week) ?? { total: 0, approved: 0 }
        agg.total += 1
        if (r.status === 'approved') agg.approved += 1
        byWeek.set(week, agg)
    }
    return [...byWeek.entries()]
        .map(([weekStart, agg]) => ({ weekStart, ...agg }))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

// ---------------------------------------------------------------------------
// Русские подписи дат для сообщений в личку
// ---------------------------------------------------------------------------

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** '2026-07-17' → 'Пт, 17 июля'. */
export const formatDayKey = (key: string): string => {
    const [, m, d] = key.split('-').map(Number)
    return `${WEEKDAYS_SHORT[weekdayOfKey(key)]}, ${d} ${MONTHS_GENITIVE[(m ?? 1) - 1]}`
}

const guestLabel = (guest: HostingUser): string =>
    guest.username ? `${guest.name} (@${guest.username})` : guest.name

// ---------------------------------------------------------------------------
// Уведомления
// ---------------------------------------------------------------------------

/**
 * Собирает userId всех резидентов: админы (и создатели) каждого allowlist-чата,
 * кроме ботов. Живой запрос без кэша — как и остальные админ-проверки.
 */
export const listResidentIds = async (
    client: TelegramClient,
    allowedChats: ReadonlySet<number>,
): Promise<Set<number>> => {
    const out = new Set<number>()
    for (const chatId of allowedChats) {
        try {
            const members = await client.getChatMembers(chatId, { type: 'admins' })
            for (const m of members) {
                if (m.status !== 'admin' && m.status !== 'creator') continue
                if (m.user.type !== 'user' || m.user.isBot) continue
                out.add(m.user.id)
            }
        } catch (err) {
            console.warn(`[hosting] не удалось получить админов чата ${chatId}:`, err)
        }
    }
    return out
}

/**
 * Рассылает резидентам уведомление о новой заявке — в личку, с учётом настроек
 * (дефолт: включено, только заявки на сегодня). Автора заявки не уведомляем.
 * Ошибки отправки (закрытая личка) не считаем фатальными.
 */
export const notifyResidentsAboutRequest = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    tzOffsetMinutes: number,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const isForToday = request.dateKey === todayKey(tzOffsetMinutes)
    const residents = await listResidentIds(client, allowedChats)
    const lines = [
        `🚪 Новая заявка на визит: <b>${formatDayKey(request.dateKey)}</b> к ${request.time}${isForToday ? ' (сегодня)' : ''}.`,
        `Гость: ${guestLabel(request.guest)}.`,
    ]
    if (request.purpose) lines.push(`Цель: ${request.purpose}`)
    const text = lines.join('<br>')
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappUrl)]])

    for (const userId of residents) {
        if (userId === request.guest.userId) continue
        const prefs = notifyPrefsFor(storage, userId)
        if (!prefs.enabled) continue
        if (prefs.mode === 'today' && !isForToday) continue
        try {
            await client.sendText(userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        } catch {
            // резидент не открывал личку с ботом — молча пропускаем
        }
    }
}

/** Сообщает гостю в личку, что его заявку одобрили. */
export const notifyGuestApproved = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const approver = request.approvedBy
    if (!approver) return
    const who = approver.username ? `${approver.name} (@${approver.username})` : approver.name
    const text = `✅ Ваш визит <b>${formatDayKey(request.dateKey)}</b> к ${request.time} подтверждён!<br>Вас хостит ${who}.`
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappUrl)]]),
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
}

/** Сообщает гостю, что резидент отменил хостинг его визита (заявка снова в ожидании). */
export const notifyGuestUnapproved = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const text = `⚠️ Резидент отменил хостинг вашего визита <b>${formatDayKey(request.dateKey)}</b> к ${request.time}. Заявка снова ждёт ответа.`
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappUrl)]]),
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
}

/** Сообщает одобрившему резиденту, что гость отменил визит. */
export const notifyApproverCancelled = async (
    client: TelegramClient,
    request: HostingRequest,
): Promise<void> => {
    const approver = request.approvedBy
    if (!approver) return
    const text = `Гость ${guestLabel(request.guest)} отменил визит <b>${formatDayKey(request.dateKey)}</b> к ${request.time}.`
    try {
        await client.sendText(approver.userId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
}

// ---------------------------------------------------------------------------
// Дев-операции над заявками (гейт — requireDev в webapp.ts)
// ---------------------------------------------------------------------------

export type UpdateRequestError = 'bad_date' | 'bad_time' | 'not_found'

/**
 * Меняет день/время/цель существующей заявки. Ограничения на день — как при
 * создании (окно обзора), но проверку на дубль не делаем: это дев-инструмент,
 * а не пользовательский поток.
 */
export const updateHostingRequest = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    patch: { dateKey: string; time: string; purpose: string },
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: UpdateRequestError }> => {
    const existing = storage.get().hostingRequests[id]
    if (!existing) return { ok: false, error: 'not_found' }

    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(patch.dateKey) || patch.dateKey < today || patch.dateKey > maxDay) {
        return { ok: false, error: 'bad_date' }
    }
    if (!isValidTime(patch.time)) return { ok: false, error: 'bad_time' }

    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (!r) return
        r.dateKey = patch.dateKey
        r.time = patch.time
        r.purpose = patch.purpose.trim().slice(0, MAX_PURPOSE_LENGTH)
    })
    return { ok: true, request: storage.get().hostingRequests[id]! }
}

/** Удаляет заявку. true — если она была. */
export const deleteHostingRequest = async (storage: Storage, id: string): Promise<boolean> => {
    if (!storage.get().hostingRequests[id]) return false
    await storage.update((s) => {
        delete s.hostingRequests[id]
    })
    return true
}

// ---------------------------------------------------------------------------
// Экспорт визита в календарь (.ics, RFC 5545)
// ---------------------------------------------------------------------------

/** Заявка задаёт только начало визита — длительность в календаре берём фиксированную. */
const ICS_EVENT_HOURS = 2

const icsEscape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** '2026-07-17T12:00:00.000Z' -> '20260717T120000Z'. */
const icsStamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/**
 * Складывание строк по RFC 5545: строка длиннее 75 октетов продолжается на
 * следующей, начинающейся с пробела. Режем по символам, а не по байтам, —
 * иначе многобайтная кириллица развалится пополам.
 */
const icsFold = (line: string): string => {
    const out: string[] = []
    let rest = line
    while (Buffer.byteLength(rest, 'utf8') > 75) {
        let cut = rest.length
        while (cut > 1 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--
        out.push(rest.slice(0, cut))
        rest = ' ' + rest.slice(cut)
    }
    out.push(rest)
    return out.join('\r\n')
}

/** Событие визита для календаря гостя. */
export const buildVisitIcs = (
    request: HostingRequest,
    tzOffsetMinutes: number,
    now: Date = new Date(),
): string => {
    // dateKey/time — в поясе спейса; в DTSTART кладём UTC, чтобы не зависеть от
    // пояса устройства (см. инвариант про пояс в CLAUDE.md).
    const startUtc = new Date(Date.parse(`${request.dateKey}T${request.time}:00Z`) - tzOffsetMinutes * 60_000)
    const endUtc = new Date(startUtc.getTime() + ICS_EVENT_HOURS * 3600_000)

    const description: string[] = []
    if (request.purpose) description.push(request.purpose)
    if (request.approvedBy) {
        const a = request.approvedBy
        description.push(`Хостит: ${a.name}${a.username ? ` (@${a.username})` : ''}`)
    }

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//endpoint//hosting//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${request.id}@endpoint-hosting`,
        `DTSTAMP:${icsStamp(now)}`,
        `DTSTART:${icsStamp(startUtc)}`,
        `DTEND:${icsStamp(endUtc)}`,
        `SUMMARY:${icsEscape('Визит в хакспейс')}`,
        ...(description.length > 0 ? [`DESCRIPTION:${icsEscape(description.join('\n'))}`] : []),
        `STATUS:${request.status === 'approved' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ]
    return lines.map(icsFold).join('\r\n') + '\r\n'
}
