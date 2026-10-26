import { randomUUID } from 'node:crypto'
import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { dayTarget, newRequestTarget, requestTarget, webappAt } from './deeplink.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { BlockedUser, DayAgenda, DayCap, DayLock, GuestNote, HostingAttendance, HostingNotifyPrefs, HostingRequest, HostingUser, HostTransfer, RescheduleProposal, VisitReminder, WalkIn } from './types.js'
import { own } from './types.js'

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

/** Текущее время 'HH:MM' в поясе спейса — для отсечения уже прошедших слотов «на сегодня». */
export const nowTimeKey = (offsetMinutes: number, now: Date = new Date()): string =>
    new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(11, 16)

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
// Закрытые дни: спейс не берёт гостей
// ---------------------------------------------------------------------------

/** Потолок пояснения «почему закрыт»: это подпись в строке дня, а не объявление. */
export const MAX_LOCK_REASON_LENGTH = 120

export const dayLockFor = (storage: Storage, dateKey: string): DayLock | null =>
    own(storage.get().hostingDayLocks, dateKey) ?? null

export const isDayLocked = (storage: Storage, dateKey: string): boolean =>
    own(storage.get().hostingDayLocks, dateKey) !== undefined

/**
 * Закрывает/открывает день для гостевых заявок. Окно то же, что у заявок
 * (сегодня..+6): закрывать день, которого нет ни на одной поверхности, незачем.
 *
 * Заодно чистим прошедшие замки: они ничего не значат, а копились бы вечно —
 * ключ у них дневной, и снимать их вручную никто не станет.
 */
export const setDayLock = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    locked: boolean,
    reason: string,
    by: HostingUser,
): Promise<{ ok: true; lock: DayLock | null } | { ok: false; error: 'bad_date' }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    await storage.update((s) => {
        for (const key of Object.keys(s.hostingDayLocks)) {
            if (key < today) delete s.hostingDayLocks[key]
        }
        if (locked) {
            s.hostingDayLocks[dateKey] = {
                dateKey,
                reason: reason.trim().slice(0, MAX_LOCK_REASON_LENGTH),
                by,
                at: new Date().toISOString(),
            }
        } else {
            delete s.hostingDayLocks[dateKey]
        }
    })
    return { ok: true, lock: dayLockFor(storage, dateKey) }
}

/**
 * Заявка переезжает на закрытый день. Именно переезд: визит, назначенный до закрытия,
 * никуда не девается, и время внутри того же дня ему двигать можно — иначе хост не
 * смог бы договориться по уже согласованному визиту.
 */
const movesIntoLockedDay = (storage: Storage, currentDateKey: string, nextDateKey: string): boolean =>
    nextDateKey !== currentDateKey && isDayLocked(storage, nextDateKey)

// ---------------------------------------------------------------------------
// Повестка дня: что в этот день происходит в спейсе
// ---------------------------------------------------------------------------

/** Потолок повестки: это строка под заголовком дня, а не анонс. Для анонса есть ивенты. */
export const MAX_AGENDA_LENGTH = 200

export const dayAgendaFor = (storage: Storage, dateKey: string): DayAgenda | null =>
    own(storage.get().hostingDayAgenda, dateKey) ?? null

/**
 * Ставит повестку дня, пустой текст её снимает. Окно и чистка прошедших как у замков:
 * повестка живёт на тех же дневных поверхностях, и ключ у неё тоже дневной.
 */
export const setDayAgenda = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    text: string,
    by: HostingUser,
): Promise<{ ok: true; agenda: DayAgenda | null } | { ok: false; error: 'bad_date' }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    // Повестка однострочная: перенос негде отрисовать ни в строке дня, ни на доске
    // (`html()` схлопывает `\n` в пробел), поэтому храним сразу то, что покажем.
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_AGENDA_LENGTH)
    await storage.update((s) => {
        for (const key of Object.keys(s.hostingDayAgenda)) {
            if (key < today) delete s.hostingDayAgenda[key]
        }
        if (clean) s.hostingDayAgenda[dateKey] = { dateKey, text: clean, by, at: new Date().toISOString() }
        else delete s.hostingDayAgenda[dateKey]
    })
    return { ok: true, agenda: dayAgendaFor(storage, dateKey) }
}

// ---------------------------------------------------------------------------
// Операции над заявками
// ---------------------------------------------------------------------------

export const MAX_PURPOSE_LENGTH = 300

export type CreateRequestError = 'bad_date' | 'bad_time' | 'past_time' | 'duplicate' | 'day_locked'

/** Слот дня/времени уже в прошлом относительно «сейчас» в поясе спейса (проверяем только текущий день). */
export const isPastSlot = (dateKey: string, time: string, offsetMinutes: number): boolean =>
    dateKey === todayKey(offsetMinutes) && time < nowTimeKey(offsetMinutes)

/**
 * Создаёт заявку на визит. День должен попадать в окно обзора (сегодня..+6),
 * время «на сегодня» — не в прошлом, у одного гостя — не больше одной активной
 * заявки на день.
 */
export const createHostingRequest = async (
    storage: Storage,
    tzOffsetMinutes: number,
    input: { guest: HostingUser; dateKey: string; time: string; purpose: string; anon?: boolean; remind?: VisitReminder | null },
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: CreateRequestError }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(input.dateKey) || input.dateKey < today || input.dateKey > maxDay) {
        return { ok: false, error: 'bad_date' }
    }
    if (!isValidTime(input.time)) return { ok: false, error: 'bad_time' }
    if (isPastSlot(input.dateKey, input.time, tzOffsetMinutes)) return { ok: false, error: 'past_time' }
    if (isDayLocked(storage, input.dateKey)) return { ok: false, error: 'day_locked' }
    const duplicate = Object.values(storage.get().hostingRequests).some(
        (r) => r.guest.userId === input.guest.userId && r.dateKey === input.dateKey,
    )
    if (duplicate) return { ok: false, error: 'duplicate' }

    const request: HostingRequest = {
        id: randomUUID(),
        dateKey: input.dateKey,
        time: input.time,
        purpose: input.purpose.trim().slice(0, MAX_PURPOSE_LENGTH),
        anon: input.anon === true,
        guest: input.guest,
        createdAt: new Date().toISOString(),
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        proposal: null,
        remind: input.remind ?? null,
    }
    await storage.update((s) => {
        s.hostingRequests[request.id] = request
    })
    return { ok: true, request }
}

export type EditRequestError = 'not_found' | 'not_pending' | 'bad_date' | 'bad_time' | 'past_time' | 'duplicate' | 'day_locked'

/**
 * Правка гостем своей заявки: день/время/цель/анонимность. Только пока заявка без
 * хоста (`pending`); окно дня и «не в прошлом» — как при создании; дубль на день
 * не считаем сам с собой. Любое незакрытое предложение переноса снимаем —
 * гость сам сменил слот.
 */
export const editHostingRequest = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    guestUserId: number,
    patch: { dateKey: string; time: string; purpose: string; anon: boolean; remind?: VisitReminder | null },
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: EditRequestError }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing || existing.guest.userId !== guestUserId) return { ok: false, error: 'not_found' }
    if (existing.status !== 'pending') return { ok: false, error: 'not_pending' }

    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(patch.dateKey) || patch.dateKey < today || patch.dateKey > maxDay) {
        return { ok: false, error: 'bad_date' }
    }
    if (!isValidTime(patch.time)) return { ok: false, error: 'bad_time' }
    if (isPastSlot(patch.dateKey, patch.time, tzOffsetMinutes)) return { ok: false, error: 'past_time' }
    if (movesIntoLockedDay(storage, existing.dateKey, patch.dateKey)) return { ok: false, error: 'day_locked' }
    const duplicate = Object.values(storage.get().hostingRequests).some(
        (r) => r.id !== id && r.guest.userId === guestUserId && r.dateKey === patch.dateKey,
    )
    if (duplicate) return { ok: false, error: 'duplicate' }

    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (!r) return
        // Отметка «пришёл» описывает визит в его слоте: переехал слот - описывать нечего.
        if (r.dateKey !== patch.dateKey || r.time !== patch.time) r.visit = null
        r.dateKey = patch.dateKey
        r.time = patch.time
        r.purpose = patch.purpose.trim().slice(0, MAX_PURPOSE_LENGTH)
        r.anon = patch.anon
        r.proposal = null
        if (patch.remind !== undefined) r.remind = patch.remind
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)! }
}

// ---------------------------------------------------------------------------
// Отметки резидентов «я приду» на день
// ---------------------------------------------------------------------------

const attendanceKey = (dateKey: string, userId: number): string => `${dateKey}#${userId}`

export type AttendanceError = 'bad_date' | 'bad_time' | 'past_time'

/**
 * Ставит/снимает отметку резидента «я приду» на день. День — в окне обзора (сегодня..+6).
 *
 * `time` - ко скольки собирается: строка ставит, null снимает, undefined оставляет как
 * было (кнопка «Приду» из зова времени не знает). Повторная отметка сохраняет `at`
 * первой: по нему идут порядок в списке и выдержка перед рассылкой гостям
 * (attend-alerts), а смена времени - не новая отметка.
 */
export const setResidentAttendance = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    user: HostingUser,
    coming: boolean,
    time?: string | null,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: AttendanceError }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    if (coming && typeof time === 'string') {
        if (!isValidTime(time)) return { ok: false, error: 'bad_time' }
        if (isPastSlot(dateKey, time, tzOffsetMinutes)) return { ok: false, error: 'past_time' }
    }
    const key = attendanceKey(dateKey, user.userId)
    const existed = own(storage.get().hostingAttendance, key) !== undefined
    await storage.update((s) => {
        if (!coming) {
            delete s.hostingAttendance[key]
            return
        }
        const prev = own(s.hostingAttendance, key)
        s.hostingAttendance[key] = {
            dateKey,
            user,
            at: prev?.at ?? new Date().toISOString(),
            time: time === undefined ? prev?.time ?? null : time,
        }
    })
    return { ok: true, changed: coming ? !existed : existed }
}

/** Резиденты, отметившиеся «я приду» на день, в порядке отметки. */
export const residentsAttendingDay = (storage: Storage, dateKey: string): HostingAttendance[] =>
    Object.values(storage.get().hostingAttendance)
        .filter((a) => a.dateKey === dateKey)
        .sort((a, b) => a.at.localeCompare(b.at))

// ---------------------------------------------------------------------------
// Подписка резидента на день
// ---------------------------------------------------------------------------

/**
 * Резидент подписывается на день, чтобы получать в личку, что на нём происходит:
 * кто кого захостил, кто отметился «я приду», перенос слота. Окно — как у заявок
 * (сегодня..+6); прошедшие подписки чистятся при каждой записи.
 */
export const setDaySubscription = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    userId: number,
    on: boolean,
): Promise<{ ok: true } | { ok: false; error: 'bad_date' }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    await storage.update((s) => {
        for (const key of Object.keys(s.hostingDaySubs)) {
            if (key < today) delete s.hostingDaySubs[key]
        }
        const next = (s.hostingDaySubs[dateKey] ?? []).filter((id) => id !== userId)
        if (on) next.push(userId)
        if (next.length > 0) s.hostingDaySubs[dateKey] = next
        else delete s.hostingDaySubs[dateKey]
    })
    return { ok: true }
}

export const isDaySubscribed = (storage: Storage, dateKey: string, userId: number): boolean =>
    (own(storage.get().hostingDaySubs, dateKey) ?? []).includes(userId)

/**
 * Шлёт подписчикам дня(ей) уведомление о событии на нём. Автора события
 * (`exceptUserId`) пропускаем — он и так знает, что сделал. Закрытая личка не фатальна.
 * `target`: куда ведёт кнопка (см. deeplink.ts).
 */
export const notifyDaySubscribers = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    dateKeys: string[],
    text: string,
    exceptUserId: number,
    target: string,
): Promise<void> => {
    const recipients = new Set<number>()
    for (const dateKey of dateKeys) {
        for (const userId of own(storage.get().hostingDaySubs, dateKey) ?? []) {
            if (userId !== exceptUserId) recipients.add(userId)
        }
    }
    if (recipients.size === 0) return
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть', webappAt(webappUrl, target))]])
    for (const userId of recipients) {
        try {
            await client.sendText(userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        } catch {
            // личка закрыта — пропускаем
        }
    }
}

/** Подписчикам дня: резидент захостил гостя. */
export const notifySubsHosted = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    request: HostingRequest,
    host: HostingUser,
): Promise<void> => {
    const text = `✅ ${await mentionLabel(client, host)} захостил ${await mentionLabel(client, request.guest)} — ${slotLabel(request.dateKey, request.time)}.`
    await notifyDaySubscribers(client, storage, webappUrl, [request.dateKey], text, host.userId, requestTarget(request.id))
}

/** Подписчикам дня: резидент отметился «я приду». */
export const notifySubsAttending = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    dateKey: string,
    resident: HostingUser,
    time: string | null,
): Promise<void> => {
    const text = `🙋 ${await mentionLabel(client, resident)} придёт <b>${formatDayKey(dateKey)}</b>${time ? ` к ${time}` : ''}.`
    await notifyDaySubscribers(client, storage, webappUrl, [dateKey], text, resident.userId, dayTarget(dateKey))
}

/** Подписчикам дня(ей): визит перенесён. Уведомляем и старый день, и новый. */
export const notifySubsRescheduled = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    request: HostingRequest,
    oldDateKey: string,
    oldTime: string,
    actorId: number,
): Promise<void> => {
    const guest = await mentionLabel(client, request.guest)
    const dayChanged = oldDateKey !== request.dateKey
    const from = dayChanged ? slotLabel(oldDateKey, oldTime) : oldTime
    const to = dayChanged ? slotLabel(request.dateKey, request.time) : request.time
    const text = `🔁 Перенос визита ${guest}: ${from} → ${to}.`
    const days = dayChanged ? [oldDateKey, request.dateKey] : [request.dateKey]
    await notifyDaySubscribers(client, storage, webappUrl, days, text, actorId, requestTarget(request.id))
}

/** Одна строка публичного списка «кто придёт»: резидент «я приду» или подтверждённый неанонимный гость. */
export type DayAttendee = {
    userId: number
    name: string
    username: string | null
    /** Резидент, отметившийся «я приду» (в приоритете над гостевой строкой того же человека). */
    resident: boolean
    /** Ко скольки придёт 'HH:MM': у гостя время заявки, у резидента - если указал. null - не указано. */
    time: string | null
}

/**
 * Фейковый гость из дев-сида (`dev.seed`): у него отрицательный userId, настоящие
 * Telegram-id всегда положительные.
 *
 * Такие заявки живут в обычном стейте, поэтому их надо отсекать на каждой публичной
 * поверхности — иначе отладка миниаппа выносит «Гришу Тестова» на закреплённую доску
 * в каждом чате. В резидентских списках (`days[].requests`, архив) они, наоборот,
 * должны быть видны: ради этого сид и существует.
 */
export const isFakeUserId = (userId: number): boolean => userId < 0

/**
 * Публичный список «кто придёт» на день (виден всем, включая гостей): резиденты,
 * отметившиеся «я приду» (в приоритете, с пометкой), затем подтверждённые гости
 * без анонимных. Цель визита сюда НЕ попадает. Фейки дев-сида отсекаются.
 */
export const attendeesForDay = (storage: Storage, dateKey: string): DayAttendee[] => {
    const residents: DayAttendee[] = residentsAttendingDay(storage, dateKey).map((a) => ({
        userId: a.user.userId,
        name: a.user.name,
        username: a.user.username,
        resident: true,
        time: a.time ?? null,
    }))
    const seen = new Set(residents.map((a) => a.userId))
    const guests: DayAttendee[] = requestsForDay(storage, dateKey)
        .filter((r) => r.status === 'approved' && !r.anon && !isFakeUserId(r.guest.userId))
        .map((r) => ({
            userId: r.guest.userId,
            name: r.guest.name,
            username: r.guest.username,
            resident: false,
            time: r.time,
        }))
        // Один и тот же человек мог и отметиться «я приду», и завести заявку как гость —
        // в списке он должен быть один раз, резидентской строкой (она приоритетнее).
        .filter((a) => !seen.has(a.userId))
    for (const a of guests) seen.add(a.userId)
    // Принятые заявки на ивенты этого дня — тоже «придут» (одобренная заявка = участие).
    const eventGoers = eventApplicantsForDay(storage, dateKey).filter((a) => !seen.has(a.userId))
    return [...residents, ...guests, ...eventGoers]
}

/**
 * Принятые заявители ивентов этого дня для публичного списка «кто придёт». Читаем стейт
 * напрямую (events + eventApplications), а не через `events.ts` — иначе импорт-цикл, ведь
 * `events.ts` уже зависит от `hosting.ts`. Фейки дев-сида и дубли по userId отсекаются.
 */
const eventApplicantsForDay = (storage: Storage, dateKey: string): DayAttendee[] => {
    const s = storage.get()
    const timeByEvent = new Map(Object.values(s.events).filter((e) => e.dateKey === dateKey).map((e) => [e.id, e.time]))
    const out: DayAttendee[] = []
    const seen = new Set<number>()
    for (const app of Object.values(s.eventApplications)) {
        if (app.status !== 'approved' || !timeByEvent.has(app.eventId)) continue
        if (isFakeUserId(app.guest.userId) || seen.has(app.guest.userId)) continue
        seen.add(app.guest.userId)
        out.push({
            userId: app.guest.userId,
            name: displayName(app.guest.name),
            username: app.guest.username,
            resident: false,
            time: timeByEvent.get(app.eventId) ?? null,
        })
    }
    return out
}

/** Заявки на конкретный день, отсортированные по времени прихода. */
export const requestsForDay = (storage: Storage, dateKey: string): HostingRequest[] =>
    Object.values(storage.get().hostingRequests)
        .filter((r) => r.dateKey === dateKey)
        .sort((a, b) => (a.time === b.time ? a.createdAt.localeCompare(b.createdAt) : a.time.localeCompare(b.time)))

// ---------------------------------------------------------------------------
// Вместимость дня: мягкий лимит
// ---------------------------------------------------------------------------

/** Сколько человек помещается в спейс. Данные помещения, а не настройка — как адрес и правила. */
export const SPACE_CAPACITY = 15

/** Потолок вводимого значения: защита от опечатки, а не осмысленный предел. */
export const MAX_DAY_CAP = 200

/** Своя вместимость этого дня. null — действует общая. */
export const dayCapOverride = (storage: Storage, dateKey: string): DayCap | null =>
    own(storage.get().hostingDayCaps, dateKey) ?? null

/** Сколько человек помещается в этот день: переопределение либо общая вместимость. */
export const dayCapFor = (storage: Storage, dateKey: string): number =>
    dayCapOverride(storage, dateKey)?.cap ?? SPACE_CAPACITY

/**
 * Занятые места дня и сколько заявок ещё ждут ответа.
 *
 * Занято = резиденты «я приду» + подтверждённые гости + принятые заявители ивентов,
 * по головам (один человек мог и отметиться, и оставить заявку). Заявки без хоста в
 * это число НЕ входят: подтвердится из них не всё, и считать их занятыми значит
 * упираться в потолок раньше времени — предупреждение тогда врёт. Их показываем
 * отдельным числом: «12 из 15, ещё 3 ждут ответа».
 */
export const dayOccupancy = (
    storage: Storage,
    dateKey: string,
): { occupied: number; pending: number; cap: number } => {
    const ids = new Set<number>(residentsAttendingDay(storage, dateKey).map((a) => a.user.userId))
    let pending = 0
    for (const r of requestsForDay(storage, dateKey)) {
        if (r.status === 'approved') ids.add(r.guest.userId)
        else pending++
    }
    for (const a of eventApplicantsForDay(storage, dateKey)) ids.add(a.userId)
    return { occupied: ids.size, pending, cap: dayCapFor(storage, dateKey) }
}

/**
 * Меняет вместимость дня. `cap = null` — вернуть общую. Окно то же, что у замков дня
 * (сегодня..+6), прошедшие переопределения чистим при каждой записи: ключ дневной,
 * руками их никто не уберёт.
 */
export const setDayCap = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    cap: number | null,
    by: HostingUser,
): Promise<{ ok: true; cap: DayCap | null } | { ok: false; error: 'bad_date' | 'bad_cap' }> => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < today || dateKey > maxDay) return { ok: false, error: 'bad_date' }
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > MAX_DAY_CAP)) return { ok: false, error: 'bad_cap' }
    await storage.update((s) => {
        for (const key of Object.keys(s.hostingDayCaps)) {
            if (key < today) delete s.hostingDayCaps[key]
        }
        if (cap === null) delete s.hostingDayCaps[dateKey]
        else s.hostingDayCaps[dateKey] = { dateKey, cap, by, at: new Date().toISOString() }
    })
    return { ok: true, cap: dayCapOverride(storage, dateKey) }
}

/**
 * Недели, в которых были заявки или гости без заявки: ключ понедельника + счётчики
 * заявок. Включая текущую — обзор показывает скользящие 7 дней и «понедельник этой
 * недели» из него уже выпал, так что без неё начало текущей недели было бы не
 * посмотреть нигде. Сортировка — от свежих к старым.
 *
 * `days`: гости по дням с понедельника, ровно те, кого неделя покажет в «Кто пришёл»:
 * заявки из отметок (`inVisitList`) и гости без заявки. Столбики в строке недели
 * показывают загруженный день до того, как неделю открыли.
 */
export const archiveWeeks = (
    storage: Storage,
    tzOffsetMinutes: number,
): { weekStart: string; total: number; approved: number; days: number[] }[] => {
    const currentWeek = weekStartOf(todayKey(tzOffsetMinutes))
    const byWeek = new Map<string, { total: number; approved: number; days: number[] }>()
    const weekOf = (week: string) => {
        let agg = byWeek.get(week)
        if (!agg) {
            agg = { total: 0, approved: 0, days: [0, 0, 0, 0, 0, 0, 0] }
            byWeek.set(week, agg)
        }
        return agg
    }
    for (const r of Object.values(storage.get().hostingRequests)) {
        const week = weekStartOf(r.dateKey)
        if (week > currentWeek) continue
        const agg = weekOf(week)
        agg.total += 1
        if (r.status === 'approved') agg.approved += 1
        if (inVisitList(r)) agg.days[weekdayOfKey(r.dateKey)]! += 1
    }
    for (const w of Object.values(storage.get().hostingWalkIns)) {
        const week = weekStartOf(w.dateKey)
        if (week <= currentWeek) weekOf(week).days[weekdayOfKey(w.dateKey)]! += 1
    }
    // Вчерашний вечер до утра отмечают из архива, в том числе гостей без заявки в день,
    // на который заявок не было: его неделя нужна в списке и пустой.
    const grace = visitGraceDay(tzOffsetMinutes)
    if (grace) weekOf(weekStartOf(grace))
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

/**
 * Невидимые символы, из которых состоит «пустое» имя: форматирующие (zero-width, RTL-марки),
 * управляющие, все виды юникод-пробелов + отдельные «пробельные» буквы и символы, которые
 * unicode-классы не ловят (hangul filler, шрифтовые пустышки, пустой брайль).
 */
const INVISIBLE_RE = /[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/gu

/** Имя без невидимых символов; '' — если после чистки ничего не осталось. */
export const cleanName = (name: string): string => name.replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim()

/**
 * Имя для показа в списках. Имя в Telegram задаёт сам пользователь: пустое или собранное
 * из невидимых символов даёт на вид пустую строку в списке — такие схлопываем в 'n/a'.
 */
export const displayName = (name: string): string => cleanName(name) || 'n/a'

/**
 * Имя человека для сообщения в личку: с ником — имя + @ник, без ника — text-mention
 * (`tg://user?id=`), чтобы получателю было куда тапнуть. Упоминание mtcute перед отправкой
 * резолвит в inputUser, и нерезолвящийся юзер уронил бы всё сообщение — поэтому проверяем
 * заранее и молча откатываемся на простое имя. Отрицательные id — фейки дев-сида.
 */
export const mentionLabel = async (client: TelegramClient, user: HostingUser): Promise<string> => {
    const name = html.escape(displayName(user.name))
    if (user.username) return `${name} (@${user.username})`
    if (user.userId <= 0) return name
    try {
        await client.resolveUser(user.userId)
        return `<a href="tg://user?id=${user.userId}">${name}</a>`
    } catch {
        return name
    }
}

/** Человекочитаемый слот для сообщений: «Пт, 17 июля к 15:00». */
const slotLabel = (dateKey: string, time: string): string => `${formatDayKey(dateKey)} к ${time}`

/** У гостя уже есть другая заявка на этот день (исключая заявку с id). */
const hasOtherRequestOnDay = (storage: Storage, guestUserId: number, dateKey: string, exceptId: string): boolean =>
    Object.values(storage.get().hostingRequests).some(
        (r) => r.id !== exceptId && r.guest.userId === guestUserId && r.dateKey === dateKey,
    )

// ---------------------------------------------------------------------------
// Уведомления
// ---------------------------------------------------------------------------

/**
 * Гости, которых бот вообще знает: авторы заявок (включая архивные — заявки не чистятся)
 * и пришедшие без заявки. Заблокированные, фейки дев-сида (отрицательный id) и люди без
 * аккаунта (id 0) не попадают. Имя берём из самой свежей записи: человек мог сменить
 * его с прошлого визита.
 */
export const listKnownGuests = (storage: Storage): HostingUser[] => {
    const s = storage.get()
    const records = [
        ...Object.values(s.hostingRequests).map((r) => ({ user: r.guest, at: r.createdAt })),
        ...Object.values(s.hostingWalkIns).map((w) => ({ user: w.guest, at: w.at })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    const out = new Map<number, HostingUser>()
    for (const { user } of records) {
        if (user.userId <= 0 || isBlocked(storage, user.userId)) continue
        out.set(user.userId, { ...user, name: displayName(user.name) })
    }
    return [...out.values()]
}

/** Человек в поиске по архиву: кто, сколько раз приходил и когда был в последний раз. */
export type GuestSummary = {
    user: HostingUser
    /** Заявки плюс визиты без заявки. */
    total: number
    /** Засчитанные визиты (см. `countsAsVisit`): то же число, что в профиле. */
    visits: number
    /** День самой поздней записи — по нему же и сортировка. */
    lastDateKey: string
}

const guestMatches = (user: HostingUser, query: string): boolean =>
    displayName(user.name).toLowerCase().includes(query) ||
    (user.username ? user.username.toLowerCase().includes(query) : false) ||
    String(user.userId) === query

/**
 * Поиск по людям из заявок — включая архивные, потому что ради архива он и нужен:
 * «кто это вообще и сколько раз он у нас был». Пустой запрос отдаёт всех, от самых
 * свежих визитов к старым. Фейки дев-сида не прячем: они видны и в самом архиве.
 *
 * Имя и ник берём из самой поздней заявки — человек мог их сменить с прошлого визита.
 */
export const searchGuests = (storage: Storage, query: string, today: string, limit = 40): GuestSummary[] => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    return [...aggregateGuests(storage, today).values()]
        .filter((g) => q.length === 0 || guestMatches(g.user, q))
        .sort((a, b) => b.lastDateKey.localeCompare(a.lastDateKey))
        .slice(0, limit)
}

/**
 * Сколько разных гостей захостил резидент за всё время: подтверждённые заявки, где он
 * значится хостом. Заявки не чистятся, поэтому это полная история. Фейки дев-сида
 * (`userId <= 0`) не в счёт; один гость с несколькими визитами считается один раз.
 */
export const hostedGuestCount = (storage: Storage, userId: number): number => {
    const guests = new Set<number>()
    for (const r of Object.values(storage.get().hostingRequests)) {
        if (r.status === 'approved' && r.approvedBy?.userId === userId && r.guest.userId > 0) {
            guests.add(r.guest.userId)
        }
    }
    return guests.size
}

/**
 * Свод по каждому человеку из заявок и визитов без заявки: сколько всего, сколько
 * засчитано, когда был последний раз. Имя и ник берём из самой поздней записи - человек
 * мог их сменить. Люди без аккаунта (id 0) в свод не идут: различить их нечем.
 */
const aggregateGuests = (storage: Storage, today: string): Map<number, GuestSummary> => {
    const s = storage.get()
    const since = s.hostingVisitsSince
    const byUser = new Map<number, GuestSummary>()
    const add = (user: HostingUser, dateKey: string, visit: boolean): void => {
        const seen = byUser.get(user.userId)
        if (!seen) {
            byUser.set(user.userId, { user: { ...user, name: displayName(user.name) }, total: 1, visits: visit ? 1 : 0, lastDateKey: dateKey })
            return
        }
        seen.total += 1
        if (visit) seen.visits += 1
        if (dateKey >= seen.lastDateKey) {
            seen.lastDateKey = dateKey
            seen.user = { ...user, name: displayName(user.name) }
        }
    }
    for (const r of Object.values(s.hostingRequests)) {
        add(r.guest, r.dateKey, r.dateKey < today && countsAsVisit(visitOutcome(r, since, today)))
    }
    for (const w of Object.values(s.hostingWalkIns)) {
        if (w.guest.userId !== 0) add(w.guest, w.dateKey, w.dateKey < today)
    }
    return byUser
}

/** Счётчик визитов человека для строки заявки: какой это по счёту раз. */
export type GuestVisitStats = {
    /** Засчитанных визитов ДО этого дня (заявка текущего дня в счёт не идёт). */
    past: number
    /** Явных «не пришёл» до этого дня. */
    missed: number
    /** Когда был в последний раз. Пустая строка - не был ни разу. */
    lastDateKey: string
}

/**
 * Сколько раз человек уже приходил и сколько раз не пришёл - для чипов «впервые» /
 * «5-й» / «2 неявки» в строке заявки.
 *
 * Считаем по дням строго раньше сегодняшнего: заявка, ради которой резидент и смотрит
 * на строку, не должна считать саму себя. Визит - по `countsAsVisit` (вместе с «без
 * отметки», чтобы забытая отметка не делала завсегдатая новичком), неявка - только
 * явная отметка.
 *
 * Считается разом на весь bootstrap: иначе на каждую строку шёл бы проход по всем
 * заявкам стейта.
 */
export const guestVisitStats = (storage: Storage, todayDateKey: string): Record<string, GuestVisitStats> => {
    const s = storage.get()
    const since = s.hostingVisitsSince
    const out: Record<string, GuestVisitStats> = {}
    const bump = (userId: number, dateKey: string, missed: boolean): void => {
        const key = String(userId)
        const cur = out[key] ?? (out[key] = { past: 0, missed: 0, lastDateKey: '' })
        if (missed) {
            cur.missed += 1
            return
        }
        cur.past += 1
        if (dateKey > cur.lastDateKey) cur.lastDateKey = dateKey
    }
    for (const r of Object.values(s.hostingRequests)) {
        if (r.dateKey >= todayDateKey) continue
        const o = visitOutcome(r, since, todayDateKey)
        if (o.status === 'missed') bump(r.guest.userId, r.dateKey, true)
        else if (countsAsVisit(o)) bump(r.guest.userId, r.dateKey, false)
    }
    for (const w of Object.values(s.hostingWalkIns)) {
        if (w.guest.userId !== 0 && w.dateKey < todayDateKey) bump(w.guest.userId, w.dateKey, false)
    }
    return out
}

// ---------------------------------------------------------------------------
// «Я на месте»
// ---------------------------------------------------------------------------

/** За сколько до слота кнопка «Я на месте» появляется и сколько живёт после него. */
export const ARRIVAL_EARLY_MS = 30 * 60_000
export const ARRIVAL_LATE_MS = 60 * 60_000
/** Не чаще одного зова в 5 минут: без этого кнопка превращается в способ дёргать резидентов. */
export const ARRIVAL_COOLDOWN_MS = 5 * 60_000

/** Начало слота заявки в UTC (dateKey/time заданы в поясе спейса). */
export const slotStartUtc = (dateKey: string, time: string, tzOffsetMinutes: number): number =>
    Date.parse(`${dateKey}T${time}:00Z`) - tzOffsetMinutes * 60_000

/** Открыто ли окно «я у двери» для этого визита прямо сейчас. */
export const arrivalWindowOpen = (
    request: HostingRequest,
    tzOffsetMinutes: number,
    now: number = Date.now(),
): boolean => {
    const start = slotStartUtc(request.dateKey, request.time, tzOffsetMinutes)
    if (!Number.isFinite(start)) return false
    return now >= start - ARRIVAL_EARLY_MS && now <= start + ARRIVAL_LATE_MS
}

export type ArrivalError = 'not_yours' | 'not_approved' | 'closed' | 'cooldown'

/**
 * Гость сообщает, что он у двери.
 *
 * Гейты: своя заявка, она подтверждена, окно открыто, прошлый зов не ближе
 * `ARRIVAL_COOLDOWN_MS`. Не-подтверждённая заявка сюда не попадает намеренно:
 * звать некого, хоста ещё нет.
 */
export const markArrived = async (
    storage: Storage,
    tzOffsetMinutes: number,
    requestId: string,
    userId: number,
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: ArrivalError }> => {
    const request = own(storage.get().hostingRequests, requestId)
    if (!request || request.guest.userId !== userId) return { ok: false, error: 'not_yours' }
    if (request.status !== 'approved' || !request.approvedBy) return { ok: false, error: 'not_approved' }
    const now = Date.now()
    if (!arrivalWindowOpen(request, tzOffsetMinutes, now)) return { ok: false, error: 'closed' }
    const last = request.arrivedAt ? Date.parse(request.arrivedAt) : 0
    if (Number.isFinite(last) && last > 0 && now - last < ARRIVAL_COOLDOWN_MS) return { ok: false, error: 'cooldown' }
    await storage.update((s) => {
        const cur = s.hostingRequests[requestId]
        if (cur) cur.arrivedAt = new Date(now).toISOString()
    })
    return { ok: true, request }
}

/**
 * DM «гость у двери»: хосту всегда, а если хоста нет внутри - ещё и всем, кто сейчас
 * отмечен в спейсе. Именно они могут открыть, пока хост едет.
 *
 * Гостю в ответ ничего про этот список не говорим (см. `arrived` в webapp.ts): кто
 * внутри - данные о резидентах, а гость их не видит ни в «Активности» (там «кто
 * придёт»), ни в `/inside` (он для участников чатов).
 */
export const notifyArrival = async (
    client: TelegramClient,
    storage: Storage,
    request: HostingRequest,
): Promise<void> => {
    const host = request.approvedBy
    if (!host) return
    const guest = await mentionLabel(client, request.guest)
    const targets = new Set<number>([host.userId])
    const insideHost = storage.get().presence[String(host.userId)] !== undefined
    if (!insideHost) {
        for (const p of Object.values(storage.get().presence)) targets.add(p.userId)
    }
    for (const userId of targets) {
        const forHost = userId === host.userId
        const lines = forHost
            ? [`🚪 <b>${guest} у двери</b> - визит к ${request.time}.`]
            : [
                `🚪 <b>${guest} у двери</b> - визит к ${request.time}, хостит ${html.escape(displayName(host.name))}${host.username ? ` (@${host.username})` : ''}.`,
                'Хоста сейчас нет в спейсе - откройте, если вы рядом.',
            ]
        try {
            await client.sendText(userId, html(lines.join('<br>')), { disableWebPreview: true })
        } catch {
            // личка закрыта - не повод рушить остальных получателей
        }
    }
}

/** Все заявки человека — от свежих к старым, для карточки гостя в архиве. */
export const requestsOfGuest = (storage: Storage, userId: number): HostingRequest[] =>
    Object.values(storage.get().hostingRequests)
        .filter((r) => r.guest.userId === userId)
        .sort((a, b) => (a.dateKey === b.dateKey ? b.time.localeCompare(a.time) : b.dateKey.localeCompare(a.dateKey)))

// ---------------------------------------------------------------------------
// Кто пришёл: отметки резидентов и гости без заявки
// ---------------------------------------------------------------------------

/**
 * До скольки утра ещё можно отметить вчерашний день. Вечер в спейсе переваливает за
 * полночь, а отмечать, кто пришёл, естественно в конце вечера: без этого запаса смена
 * даты закрывала бы отметки ровно тогда, когда до них дошли руки.
 */
export const VISIT_MARK_GRACE_UNTIL = '06:00'

/** Потолок имени гостя без аккаунта: это подпись в списке. */
export const MAX_WALK_IN_NAME_LENGTH = 64

/**
 * Включает отметки: запоминает день запуска. Всё, что подтвердили раньше, отметок не
 * имеет и считается состоявшимся (см. `visitOutcome`).
 */
export const ensureVisitsSince = async (storage: Storage, tzOffsetMinutes: number): Promise<void> => {
    if (storage.get().hostingVisitsSince) return
    const today = todayKey(tzOffsetMinutes)
    await storage.update((s) => {
        if (!s.hostingVisitsSince) s.hostingVisitsSince = today
    })
}

/**
 * Отмечать можно только в день визита и ночью после него. Архив - история, а не
 * черновик: отметка задним числом - это уже воспоминание, а неявку, записанную через
 * неделю, гость не оспорит. Забытый день остаётся «без отметки», и визитом он всё
 * равно засчитан, а не пропуском, так что запрет почти ничего не стоит.
 */
export const isVisitDayEditable = (dateKey: string, tzOffsetMinutes: number, now: Date = new Date()): boolean => {
    const today = dayKeyOf(now, tzOffsetMinutes)
    if (dateKey === today) return true
    return dateKey === addDaysToKey(today, -1) && nowTimeKey(tzOffsetMinutes, now) < VISIT_MARK_GRACE_UNTIL
}

/** Вчерашний день, пока его ещё можно отметить (ночь после него), иначе null. */
export const visitGraceDay = (tzOffsetMinutes: number, now: Date = new Date()): string | null => {
    const yesterday = addDaysToKey(dayKeyOf(now, tzOffsetMinutes), -1)
    return isVisitDayEditable(yesterday, tzOffsetMinutes, now) ? yesterday : null
}

/** Чем закончился визит по заявке и откуда это известно. */
export type VisitOutcome = {
    /** null - исхода нет: визит впереди или идёт сегодня, либо заявку так никто и не взял. */
    status: 'came' | 'missed' | 'unknown' | null
    /**
     * 'mark' - отметил резидент, 'door' - гость сам нажал «Я на месте», 'legacy' - визит
     * был до отметок и засчитан как состоявшийся. null - исхода нет либо он неизвестен.
     */
    source: 'mark' | 'door' | 'legacy' | null
}

/**
 * Исход визита. Проверки идут в порядке доверия: отметка резидента, сигнал гостя у
 * двери, дата до запуска отметок.
 *
 * Пропуск - только явная отметка «не пришёл». Подтверждённый визит без отметки - это
 * «без отметки»: резидент мог просто забыть, и записывать гостю неявку за чужую
 * забывчивость нельзя. Пустой `since` значит, что отметки ещё не включили, и тогда
 * вся история - до отметок.
 */
export const visitOutcome = (r: HostingRequest, since: string, today: string): VisitOutcome => {
    if (r.visit) return { status: r.visit.came ? 'came' : 'missed', source: 'mark' }
    if (r.arrivedAt) return { status: 'came', source: 'door' }
    if (r.status !== 'approved' || r.dateKey >= today) return { status: null, source: null }
    if (!since || r.dateKey < since) return { status: 'came', source: 'legacy' }
    return { status: 'unknown', source: null }
}

/**
 * Визит засчитан: пришёл по любому признаку либо без отметки. Без отметки идёт в счёт
 * по той же причине, по какой не идёт в пропуски: иначе одна забытая отметка делала бы
 * завсегдатая «впервые». Насколько счёт подтверждён, показывает профиль.
 */
const countsAsVisit = (o: VisitOutcome): boolean => o.status === 'came' || o.status === 'unknown'

export type VisitMarkError = 'not_found' | 'bad_day' | 'not_approved' | 'too_early'

/**
 * Заявка в «Кто пришёл»: подтверждённая или уже отмеченная. Ничью заявку никто не обещал
 * принять, поэтому в отметках её нет: пришедшего по ней добавляют гостем без заявки.
 * Отмеченные раньше остаются: это уже история визитов.
 */
export const inVisitList = (r: HostingRequest): boolean => r.status === 'approved' || Boolean(r.visit)

/**
 * Отметка «пришёл / не пришёл» по заявке, `came = null` снимает её.
 *
 * «Не пришёл» - только у подтверждённой заявки и не раньше слота: ничью заявку никто
 * не обещал принять, и неявка по ней не пропуск, а визит, который ещё не начался,
 * пропустить нельзя. «Пришёл» можно и у ничьей: гостя впустили, хотя заявку никто не
 * взял. Статус заявки при этом не меняется: хоста задним числом не назначаем.
 */
export const markVisit = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    came: boolean | null,
    by: HostingUser,
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: VisitMarkError }> => {
    const request = own(storage.get().hostingRequests, id)
    if (!request) return { ok: false, error: 'not_found' }
    if (!isVisitDayEditable(request.dateKey, tzOffsetMinutes)) return { ok: false, error: 'bad_day' }
    // Снять старую отметку с ничьей заявки можно, поставить новую нельзя (inVisitList).
    if (came !== null && request.status !== 'approved') return { ok: false, error: 'not_approved' }
    if (came === false && Date.now() < slotStartUtc(request.dateKey, request.time, tzOffsetMinutes)) {
        return { ok: false, error: 'too_early' }
    }
    await storage.update((s) => {
        const r = own(s.hostingRequests, id)
        if (r) r.visit = came === null ? null : { came, by, at: new Date().toISOString() }
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)! }
}

/**
 * «Все пришли»: отмечает пришедшими подтверждённых гостей дня, о которых ещё ничего не
 * известно. Явную отметку не трогает (руками поставленный «не пришёл» общая кнопка не
 * переписывает), как и «сам у двери»: там исход уже есть.
 */
export const markAllVisits = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    by: HostingUser,
): Promise<{ ok: true; marked: number } | { ok: false; error: 'bad_day' }> => {
    if (!isVisitDayEditable(dateKey, tzOffsetMinutes)) return { ok: false, error: 'bad_day' }
    const ids = requestsForDay(storage, dateKey)
        .filter((r) => r.status === 'approved' && !r.visit && !r.arrivedAt)
        .map((r) => r.id)
    if (ids.length === 0) return { ok: true, marked: 0 }
    const at = new Date().toISOString()
    await storage.update((s) => {
        for (const id of ids) {
            const r = own(s.hostingRequests, id)
            if (r) r.visit = { came: true, by, at }
        }
    })
    return { ok: true, marked: ids.length }
}

/** Гости дня без заявки, в порядке добавления. */
export const walkInsForDay = (storage: Storage, dateKey: string): WalkIn[] =>
    Object.values(storage.get().hostingWalkIns)
        .filter((w) => w.dateKey === dateKey)
        .sort((a, b) => a.at.localeCompare(b.at))

export type WalkInError = 'bad_day' | 'bad_name' | 'has_request' | 'duplicate' | 'blocked'

/**
 * Добавляет в день гостя без заявки. Если заявка на этот день у человека есть и стоит в
 * отметках (inVisitList), его отмечают по ней: иначе один визит считался бы дважды.
 * Ничья заявка не мешает: её в отметках нет. Людей без аккаунта (`userId` 0) различаем
 * только по имени, поэтому и дубль у них по имени.
 */
export const addWalkIn = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
    guest: HostingUser,
    by: HostingUser,
): Promise<{ ok: true; walkIn: WalkIn } | { ok: false; error: WalkInError }> => {
    if (!isVisitDayEditable(dateKey, tzOffsetMinutes)) return { ok: false, error: 'bad_day' }
    const name = cleanName(guest.name).slice(0, MAX_WALK_IN_NAME_LENGTH)
    if (!name) return { ok: false, error: 'bad_name' }
    if (guest.userId !== 0) {
        if (isBlocked(storage, guest.userId)) return { ok: false, error: 'blocked' }
        if (requestsForDay(storage, dateKey).some((r) => r.guest.userId === guest.userId && inVisitList(r))) {
            return { ok: false, error: 'has_request' }
        }
    }
    const lower = name.toLowerCase()
    const duplicate = walkInsForDay(storage, dateKey).some((w) =>
        guest.userId !== 0 ? w.guest.userId === guest.userId : w.guest.userId === 0 && w.guest.name.toLowerCase() === lower)
    if (duplicate) return { ok: false, error: 'duplicate' }
    const walkIn: WalkIn = { id: randomUUID(), dateKey, guest: { ...guest, name }, by, at: new Date().toISOString() }
    await storage.update((s) => {
        s.hostingWalkIns[walkIn.id] = walkIn
    })
    return { ok: true, walkIn }
}

export const removeWalkIn = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
): Promise<{ ok: true; walkIn: WalkIn } | { ok: false; error: 'not_found' | 'bad_day' }> => {
    const walkIn = own(storage.get().hostingWalkIns, id)
    if (!walkIn) return { ok: false, error: 'not_found' }
    if (!isVisitDayEditable(walkIn.dateKey, tzOffsetMinutes)) return { ok: false, error: 'bad_day' }
    await storage.update((s) => {
        delete s.hostingWalkIns[id]
    })
    return { ok: true, walkIn }
}

/** Визиты человека без заявки, от свежих к старым. */
export const walkInsOfGuest = (storage: Storage, userId: number): WalkIn[] =>
    Object.values(storage.get().hostingWalkIns)
        .filter((w) => w.guest.userId === userId)
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey))

/** Сводка визитов человека: сколько засчитано, из них без отметки, и явные пропуски. */
export type GuestVisitTally = { visits: number; unmarked: number; missed: number }

/** Сводка по заявкам и визитам без заявки одного человека. Сегодняшний день ещё идёт и в счёт не входит. */
export const guestVisitTally = (storage: Storage, userId: number, today: string): GuestVisitTally => {
    const since = storage.get().hostingVisitsSince
    const tally: GuestVisitTally = { visits: 0, unmarked: 0, missed: 0 }
    for (const r of requestsOfGuest(storage, userId)) {
        if (r.dateKey >= today) continue
        const o = visitOutcome(r, since, today)
        if (countsAsVisit(o)) tally.visits += 1
        if (o.status === 'unknown') tally.unmarked += 1
        if (o.status === 'missed') tally.missed += 1
    }
    tally.visits += walkInsOfGuest(storage, userId).filter((w) => w.dateKey < today).length
    return tally
}

/** Обычный день недели (0 - понедельник) и время прихода гостя. */
export type GuestUsual = { weekday: number; time: string | null }

/**
 * Профиль гостя для резидентов: кто он и насколько на него можно рассчитывать.
 * null - о человеке нет ни одной записи.
 */
export type GuestProfile = GuestVisitTally & {
    user: HostingUser
    /** Первый и последний засчитанный визит. Пусто - не было ни одного. */
    firstDateKey: string
    lastDateKey: string
    /** Ближайшая заявка начиная с сегодняшнего дня. */
    next: { dateKey: string; time: string; approved: boolean } | null
    /** Обычный день и время: только когда засчитанных визитов хотя бы три и день повторялся. */
    usual: GuestUsual | null
    /** Кто хостил, от самых частых. */
    hosts: { user: HostingUser; count: number }[]
    /** Ивенты, на которые гостя приняли по форме, свежие сверху. */
    events: { id: string; title: string; dateKey: string }[]
}

/** С какого числа визитов имеет смысл называть «обычно»: на двух это совпадение. */
const USUAL_MIN_VISITS = 3

/** Медиана времён прихода, округлённая до четверти часа: «к 19:00», а не «к 18:52». */
const usualTime = (times: string[]): string | null => {
    if (times.length === 0) return null
    const minutes = times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))).sort((a, b) => a - b)
    const mid = minutes[Math.floor(minutes.length / 2)]!
    const rounded = Math.min(23 * 60 + 45, Math.round(mid / 15) * 15)
    return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

export const guestProfile = (storage: Storage, userId: number, today: string): GuestProfile | null => {
    const s = storage.get()
    const since = s.hostingVisitsSince
    const requests = requestsOfGuest(storage, userId)
    const walkIns = walkInsOfGuest(storage, userId)
    if (requests.length === 0 && walkIns.length === 0) return null

    // Имя и ник - из самой свежей записи: человек мог сменить их с прошлого визита.
    const latest = [
        ...requests.map((r) => ({ user: r.guest, at: r.createdAt })),
        ...walkIns.map((w) => ({ user: w.guest, at: w.at })),
    ].sort((a, b) => b.at.localeCompare(a.at))[0]!
    const user = { ...latest.user, name: displayName(latest.user.name) }

    const visitDays: string[] = []
    const visitTimes: string[] = []
    for (const r of requests) {
        if (r.dateKey >= today || !countsAsVisit(visitOutcome(r, since, today))) continue
        visitDays.push(r.dateKey)
        visitTimes.push(r.time)
    }
    for (const w of walkIns) if (w.dateKey < today) visitDays.push(w.dateKey)
    visitDays.sort()

    let usual: GuestUsual | null = null
    if (visitDays.length >= USUAL_MIN_VISITS) {
        const byWeekday = new Map<number, number>()
        for (const d of visitDays) byWeekday.set(weekdayOfKey(d), (byWeekday.get(weekdayOfKey(d)) ?? 0) + 1)
        const [weekday, count] = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0]!
        if (count >= 2) usual = { weekday, time: usualTime(visitTimes) }
    }

    const hostCounts = new Map<number, { user: HostingUser; count: number }>()
    for (const r of requests) {
        if (r.status !== 'approved' || !r.approvedBy) continue
        const cur = hostCounts.get(r.approvedBy.userId)
        if (cur) cur.count += 1
        else hostCounts.set(r.approvedBy.userId, { user: r.approvedBy, count: 1 })
    }

    const upcoming = requests.filter((r) => r.dateKey >= today).sort((a, b) =>
        a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey))[0]

    const events = Object.values(s.eventApplications)
        .filter((a) => a.guest.userId === userId && a.status === 'approved')
        .map((a) => own(s.events, a.eventId))
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
        .map((e) => ({ id: e.id, title: e.title, dateKey: e.dateKey }))

    return {
        user,
        ...guestVisitTally(storage, userId, today),
        firstDateKey: visitDays[0] ?? '',
        lastDateKey: visitDays[visitDays.length - 1] ?? '',
        next: upcoming ? { dateKey: upcoming.dateKey, time: upcoming.time, approved: upcoming.status === 'approved' } : null,
        usual,
        hosts: [...hostCounts.values()].sort((a, b) => b.count - a.count),
        events,
    }
}

/**
 * Рассылает резидентам уведомление о новой заявке — в личку, с учётом настроек
 * (дефолт: включено, только заявки на сегодня). Автора заявки не уведомляем.
 * Ошибки отправки (закрытая личка) не считаем фатальными.
 */
export const notifyResidentsAboutRequest = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    tzOffsetMinutes: number,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const isForToday = request.dateKey === todayKey(tzOffsetMinutes)
    const residents = await directory.listIds()
    const lines = [
        `🚪 Новая заявка на визит: <b>${formatDayKey(request.dateKey)}</b> к ${request.time}${isForToday ? ' (сегодня)' : ''}.`,
        `Гость: ${await mentionLabel(client, request.guest)}.`,
    ]
    if (request.purpose) lines.push(`Цель: ${html.escape(request.purpose)}`)
    const text = lines.join('<br>')
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappAt(webappUrl, requestTarget(request.id)))]])

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

/**
 * Напоминает резиденту про сегодняшние заявки без хоста, когда он появился в
 * спейсе: он уже на месте, а гостей взять некому. Молчим, если брать нечего или
 * резидент выключил уведомления хостинга (`hostingNotify.enabled`); режим
 * 'today' здесь не смотрим — напоминание и так только про сегодня.
 */
export const remindAboutTodayRequests = async (
    client: TelegramClient,
    storage: Storage,
    tzOffsetMinutes: number,
    webappUrl: string,
    userId: number,
): Promise<void> => {
    if (!notifyPrefsFor(storage, userId).enabled) return
    const today = todayKey(tzOffsetMinutes)
    // Один раз за визит: повторный чек-ин или мигание MAC-отметки в тот же день не дублируют напоминание.
    if (storage.get().hostingRemindedDay[String(userId)] === today) return
    const pending = requestsForDay(storage, today)
        .filter((r) => r.status === 'pending' && r.guest.userId !== userId)
    if (pending.length === 0) return
    await storage.update((s) => {
        s.hostingRemindedDay[String(userId)] = today
    })
    const lines = [
        pending.length === 1
            ? '👋 Ты в спейсе — на сегодня есть заявка без хоста:'
            : '👋 Ты в спейсе — на сегодня есть заявки без хоста:',
        ...(await Promise.all(pending.map(async (r) => `• ${r.time} — ${await mentionLabel(client, r.guest)}`))),
    ]
    // Одна заявка: её строка под пальцем, несколько: день, где они все.
    const target = pending.length === 1 ? requestTarget(pending[0]!.id) : dayTarget(today)
    try {
        await client.sendText(userId, html(lines.join('<br>')), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappAt(webappUrl, target))]]),
            disableWebPreview: true,
        })
    } catch {
        // резидент не открывал личку с ботом
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
    const who = await mentionLabel(client, approver)
    const text = `✅ Ваш визит <b>${formatDayKey(request.dateKey)}</b> к ${request.time} подтверждён!<br>Вас хостит ${who}.`
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappAt(webappUrl, requestTarget(request.id)))]]),
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
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
}

/** Потолок комментария к закрытию: это пара фраз гостю, а не переписка. */
export const MAX_CLOSE_COMMENT_LENGTH = 500

/** Комментарий к закрытию как его отправим: без лишних пустых строк по краям и подряд. */
export const cleanCloseComment = (raw: string): string =>
    raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CLOSE_COMMENT_LENGTH)

/**
 * Гостю в личку: резидент закрыл его заявку. true - сообщение ушло.
 *
 * Закрытие — это удаление заявки со стороны спейса: визит не состоится (резидент не
 * может принять, планы поменялись). Раньше такого глагола не было вовсе, и резиденту
 * оставалось либо просить гостя удалить заявку самому, либо звать дева.
 *
 * Комментарий резидента идёт цитатой. С ним фраза «в этот день не получится» уходит:
 * причину объясняет сам комментарий, и додумывать её за резидента нельзя.
 */
export const notifyGuestClosed = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
    by: HostingUser,
    comment: string,
): Promise<boolean> => {
    const who = await mentionLabel(client, by)
    const slot = `<b>${formatDayKey(request.dateKey)}</b> к ${request.time}`
    // `html()` схлопывает `\n` в пробел, поэтому строки комментария склеиваем через `<br>`.
    const lines = comment
        ? [
            `Резидент ${who} закрывает заявку на визит ${slot}:`,
            `<blockquote>${comment.split('\n').map((l) => html.escape(l)).join('<br>')}</blockquote>`,
            'Можно выбрать другой день.',
        ]
        : [`Резидент ${who} закрывает заявку на визит ${slot}: в этот день не получится.`, 'Можно выбрать другой день.']
    try {
        await client.sendText(request.guest.userId, html(lines.join('<br>')), {
            // Тот день только что закрыли, поэтому форма открывается без него.
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Выбрать другой день', webappAt(webappUrl, newRequestTarget()))]]),
            disableWebPreview: true,
        })
        return true
    } catch {
        // гость не открывал личку с ботом
        return false
    }
}

/** Сообщает одобрившему резиденту, что гость отменил визит. */
export const notifyApproverCancelled = async (
    client: TelegramClient,
    request: HostingRequest,
): Promise<void> => {
    const approver = request.approvedBy
    if (!approver) return
    const text = `Гость ${await mentionLabel(client, request.guest)} отменил визит <b>${formatDayKey(request.dateKey)}</b> к ${request.time}.`
    try {
        await client.sendText(approver.userId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
}

// ---------------------------------------------------------------------------
// Уведомления о переносе дня/времени
// ---------------------------------------------------------------------------

/** Гостю в личку: резидент предлагает перенести визит. `request.proposal.by` === 'resident'. */
export const notifyGuestReschedule = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const p = request.proposal
    if (!p) return
    const who = await mentionLabel(client, p.user)
    const text = `🕘 Резидент ${who} предлагает перенести визит на <b>${slotLabel(p.dateKey, p.time)}</b> (сейчас ${slotLabel(request.dateKey, request.time)}).<br>Откройте «Мои визиты», чтобы принять или предложить свой вариант.`
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
}

/** Резиденту-адресату в личку: гость ответил своим слотом. `request.proposal.by` === 'guest'. */
export const notifyResidentRescheduleCountered = async (
    client: TelegramClient,
    recipientId: number,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const p = request.proposal
    if (!p) return
    const text = `🕘 Гость ${await mentionLabel(client, request.guest)} предлагает <b>${slotLabel(p.dateKey, p.time)}</b> (было ${slotLabel(request.dateKey, request.time)}).<br>Открой заявки, чтобы принять или предложить другое.`
    try {
        await client.sendText(recipientId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
    } catch {
        // резидент не открывал личку с ботом
    }
}

/**
 * Предложившей стороне в личку: предложение приняли, действует новый слот `request.dateKey`/`time`.
 * `actor` — кто принял: без имени получателю не видно, чьё это действие.
 */
export const notifyProposalAccepted = async (
    client: TelegramClient,
    targetId: number,
    webappUrl: string,
    request: HostingRequest,
    targetIsGuest: boolean,
    actor: HostingUser,
): Promise<void> => {
    const slot = slotLabel(request.dateKey, request.time)
    const who = await mentionLabel(client, actor)
    const text = targetIsGuest
        ? `✅ Резидент ${who} принимает ваш вариант — визит <b>${slot}</b>.`
        : `✅ Гость ${who} принимает новый слот — визит <b>${slot}</b>.`
    const label = targetIsGuest ? 'Мои визиты' : 'Открыть заявки'
    try {
        await client.sendText(targetId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView(label, webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
    } catch {
        // личка закрыта — не критично
    }
}

/**
 * Второй стороне в личку: предложение о переносе сняли, остаётся прежний слот `request.dateKey`/`time`.
 * `actor` — кто снял: своё предложение (`withdrawn`) или чужое (отклонил). Без этого
 * получателю не видно, чьё это действие, — на pending снять предложение резидента
 * может и другой резидент, поэтому формулировка нейтральна к авторству.
 */
export const notifyProposalCancelled = async (
    client: TelegramClient,
    targetId: number,
    webappUrl: string,
    request: HostingRequest,
    proposed: { dateKey: string; time: string },
    targetIsGuest: boolean,
    actor: { user: HostingUser; isGuest: boolean; withdrawn: boolean },
): Promise<void> => {
    const who = await mentionLabel(client, actor.user)
    const role = actor.isGuest ? 'Гость' : 'Резидент'
    const proposedSlot = slotLabel(proposed.dateKey, proposed.time)
    const staysSlot = slotLabel(request.dateKey, request.time)
    const text = actor.withdrawn
        ? `↩️ ${role} ${who} снимает предложение перенести визит на ${proposedSlot} — остаётся ${staysSlot}.`
        : `↩️ ${role} ${who} отклоняет перенос на ${proposedSlot} — остаётся ${staysSlot}.`
    const label = targetIsGuest ? 'Мои визиты' : 'Открыть заявки'
    try {
        await client.sendText(targetId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView(label, webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
    } catch {
        // личка закрыта — не критично
    }
}

/**
 * Резиденту-автору предложения в личку: гость сам передвинул заявку, и висящее
 * предложение снялось (`editHostingRequest` его обнуляет). Без этого DM предложение
 * пропадало у резидента молча — он видел только, что плашка исчезла.
 */
export const notifyProposalDroppedByEdit = async (
    client: TelegramClient,
    targetId: number,
    webappUrl: string,
    request: HostingRequest,
    proposed: { dateKey: string; time: string },
): Promise<void> => {
    const who = await mentionLabel(client, request.guest)
    const text = `✏️ Гость ${who} переносит заявку на <b>${slotLabel(request.dateKey, request.time)}</b> — предложение перенести на ${slotLabel(proposed.dateKey, proposed.time)} снято.`
    try {
        await client.sendText(targetId, html(text), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappAt(webappUrl, requestTarget(request.id)))]]),
            disableWebPreview: true,
        })
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
    const existing = own(storage.get().hostingRequests, id)
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
        const moved = r.dateKey !== patch.dateKey || r.time !== patch.time
        r.dateKey = patch.dateKey
        r.time = patch.time
        r.purpose = patch.purpose.trim().slice(0, MAX_PURPOSE_LENGTH)
        if (moved && r.remind) r.remind.sentAt = null
        if (moved) r.visit = null
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)! }
}

/** Удаляет заявку. true — если она была. */
export const deleteHostingRequest = async (storage: Storage, id: string): Promise<boolean> => {
    if (!own(storage.get().hostingRequests, id)) return false
    await storage.update((s) => {
        delete s.hostingRequests[id]
    })
    return true
}

/**
 * «Вернуть» после отмены визита гостем (src/undo.ts): заявка встаёт обратно той же, с тем
 * же id, хостом и напоминанием. Нельзя, если за время отсчёта гость завёл другую заявку
 * на этот день, день успел пройти или гостя заблокировали.
 */
export const restoreHostingRequest = async (
    storage: Storage,
    request: HostingRequest,
    tzOffsetMinutes: number,
): Promise<boolean> => {
    if (own(storage.get().hostingRequests, request.id)) return false
    if (request.dateKey < todayKey(tzOffsetMinutes) || isBlocked(storage, request.guest.userId)) return false
    if (hasOtherRequestOnDay(storage, request.guest.userId, request.dateKey, request.id)) return false
    await storage.update((s) => {
        s.hostingRequests[request.id] = request
    })
    return true
}

/** «Вернуть» после снятия своего хостинга: только если за время отсчёта визит никто не взял. */
export const restoreApproval = async (
    storage: Storage,
    id: string,
    prev: Pick<HostingRequest, 'approvedBy' | 'approvedAt' | 'transfer'>,
): Promise<boolean> => {
    const r = own(storage.get().hostingRequests, id)
    if (!r || r.status !== 'pending' || r.approvedBy) return false
    await storage.update((s) => {
        const cur = s.hostingRequests[id]
        if (!cur) return
        cur.status = 'approved'
        cur.approvedBy = prev.approvedBy
        cur.approvedAt = prev.approvedAt
        cur.transfer = prev.transfer ?? null
    })
    return true
}

// ---------------------------------------------------------------------------
// Предложения переноса дня/времени (резидент ↔ гость)
// ---------------------------------------------------------------------------

export type ProposeError = 'not_found' | 'bad_date' | 'bad_time' | 'past_time' | 'duplicate' | 'day_locked'

/**
 * Ставит предложение перенести визит на другой день и/или время — и у pending-заявки,
 * и у уже одобренной (подтверждённый визит тоже иногда надо сдвинуть; сам факт хостинга
 * при этом не отменяется, меняются `dateKey`/`time` после согласия второй стороны).
 * День проверяем как при создании: окно обзора, не в прошлом, без дубля на этот день.
 *
 * `recipientId` — кому уходит уведомление: резидент всегда пишет гостю; гость пишет
 * либо своему хосту (заявка одобрена), либо резиденту, предложившему слот ранее.
 * Для встречного предложения на pending-заявке без прошлого предложения адреса нет.
 */
export const proposeReschedule = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    input: { dateKey: string; time: string; by: 'resident' | 'guest'; user: HostingUser },
): Promise<{ ok: true; request: HostingRequest; recipientId: number | null } | { ok: false; error: ProposeError }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    if (!isValidDayKey(input.dateKey) || input.dateKey < today || input.dateKey > maxDay) {
        return { ok: false, error: 'bad_date' }
    }
    if (!isValidTime(input.time)) return { ok: false, error: 'bad_time' }
    if (isPastSlot(input.dateKey, input.time, tzOffsetMinutes)) return { ok: false, error: 'past_time' }
    if (movesIntoLockedDay(storage, existing.dateKey, input.dateKey)) return { ok: false, error: 'day_locked' }
    if (hasOtherRequestOnDay(storage, existing.guest.userId, input.dateKey, id)) return { ok: false, error: 'duplicate' }
    // Адресат: гостю — если предложил резидент; резиденту — хост, а на pending-заявке
    // автор предложения, на которое гость отвечает. Запоминаем его на самом предложении,
    // иначе после перезаписи `proposal` неизвестно, чьи это переговоры.
    const to: HostingUser | null = input.by === 'resident'
        ? existing.guest
        : existing.approvedBy
            ?? (existing.proposal?.by === 'resident' ? existing.proposal.user : null)
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r) r.proposal = { dateKey: input.dateKey, time: input.time, by: input.by, user: input.user, to, at: new Date().toISOString() }
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)!, recipientId: to?.userId ?? null }
}

export type AcceptError = 'not_found' | 'no_proposal' | 'stale'

/**
 * Принимает активное предложение: согласованным слотом заявки становится предложенный.
 * День перепроверяем на момент принятия (мог выпасть из окна обзора или у гостя
 * появилась другая заявка на этот день) — протухшее предложение снимаем (`stale`).
 */
export const acceptReschedule = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
): Promise<{ ok: true; request: HostingRequest; proposal: RescheduleProposal } | { ok: false; error: AcceptError }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    const proposal = existing.proposal
    if (!proposal) return { ok: false, error: 'no_proposal' }
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    const stale =
        !isValidDayKey(proposal.dateKey) ||
        proposal.dateKey < today ||
        proposal.dateKey > maxDay ||
        // Пока стороны договаривались, день могли закрыть для заявок — переносить визит
        // туда уже нельзя, и предложение протухло ровно как выпавшее из окна обзора.
        movesIntoLockedDay(storage, existing.dateKey, proposal.dateKey) ||
        (proposal.dateKey !== existing.dateKey && hasOtherRequestOnDay(storage, existing.guest.userId, proposal.dateKey, id))
    if (stale) {
        await storage.update((s) => {
            const r = s.hostingRequests[id]
            if (r) r.proposal = null
        })
        return { ok: false, error: 'stale' }
    }
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r?.proposal) {
            const moved = r.dateKey !== r.proposal.dateKey || r.time !== r.proposal.time
            r.dateKey = r.proposal.dateKey
            r.time = r.proposal.time
            r.proposal = null
            // Визит уехал на другой слот — напоминание должно уйти заново, а отметка
            // «пришёл» про старый слот больше ничего не значит.
            if (moved && r.remind) r.remind.sentAt = null
            if (moved) r.visit = null
        }
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)!, proposal }
}

/** Снимает активное предложение без смены слота (отклонили или отозвали). */
export const clearReschedule = async (
    storage: Storage,
    id: string,
): Promise<{ ok: true; request: HostingRequest; proposal: RescheduleProposal } | { ok: false; error: 'not_found' | 'no_proposal' }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    if (!existing.proposal) return { ok: false, error: 'no_proposal' }
    const proposal = existing.proposal
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r) r.proposal = null
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)!, proposal }
}

// ---------------------------------------------------------------------------
// Передача хостинга другому резиденту
// ---------------------------------------------------------------------------

export type TransferError = 'not_found' | 'not_approved' | 'not_host' | 'self' | 'busy'

/**
 * Предлагает другому резиденту взять на себя уже подтверждённый визит.
 *
 * Только у одобренной заявки и только от её хоста: ничью заявку передавать некому,
 * её и так может взять любой. Предложение одно на заявку — второе перезаписало бы
 * первое, а адресат первого остался бы с кнопкой, которая ничего не делает.
 */
export const offerTransfer = async (
    storage: Storage,
    id: string,
    to: HostingUser,
    by: HostingUser,
): Promise<{ ok: true; request: HostingRequest } | { ok: false; error: TransferError }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    if (existing.status !== 'approved' || !existing.approvedBy) return { ok: false, error: 'not_approved' }
    if (existing.approvedBy.userId !== by.userId) return { ok: false, error: 'not_host' }
    if (to.userId === by.userId) return { ok: false, error: 'self' }
    const current = existing.transfer ?? null
    if (current && current.to.userId !== to.userId) return { ok: false, error: 'busy' }
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r) r.transfer = { to, by, at: new Date().toISOString() }
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)! }
}

/**
 * Адресат берёт визит: хостом становится он. Висящее предложение переноса остаётся,
 * но переговоры переезжают на нового хоста вместе с визитом: он становится адресатом
 * предложения гостя и автором предложения прежнего хоста. Иначе права на переговоры и
 * ответ гостя оставались бы у того, кто визит больше не ведёт.
 */
export const acceptTransfer = async (
    storage: Storage,
    id: string,
    user: HostingUser,
): Promise<{ ok: true; request: HostingRequest; from: HostingUser } | { ok: false; error: 'not_found' | 'no_transfer' | 'not_yours' }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    const transfer = existing.transfer ?? null
    if (!transfer) return { ok: false, error: 'no_transfer' }
    if (transfer.to.userId !== user.userId) return { ok: false, error: 'not_yours' }
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (!r) return
        r.approvedBy = user
        r.approvedAt = new Date().toISOString()
        r.transfer = null
        if (r.proposal && r.proposal.to && r.proposal.to.userId === transfer.by.userId) r.proposal.to = user
        if (r.proposal && r.proposal.by === 'resident' && r.proposal.user.userId === transfer.by.userId) r.proposal.user = user
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)!, from: transfer.by }
}

/** Снимает предложение передачи: адресат отказался либо автор отозвал. */
export const clearTransfer = async (
    storage: Storage,
    id: string,
): Promise<{ ok: true; request: HostingRequest; transfer: HostTransfer } | { ok: false; error: 'not_found' | 'no_transfer' }> => {
    const existing = own(storage.get().hostingRequests, id)
    if (!existing) return { ok: false, error: 'not_found' }
    const transfer = existing.transfer ?? null
    if (!transfer) return { ok: false, error: 'no_transfer' }
    await storage.update((s) => {
        const r = s.hostingRequests[id]
        if (r) r.transfer = null
    })
    return { ok: true, request: own(storage.get().hostingRequests, id)!, transfer }
}

// ---------------------------------------------------------------------------
// Правила спейса: согласие перед первой заявкой на визит
// ---------------------------------------------------------------------------

/**
 * Версия текста правил. Текст живёт во фронте (`webapp/src/screens/Rules.tsx`), сюда
 * едет только версия: поднимаем её вместе с правкой текста — и согласие спрашивается
 * заново у всех, кто соглашался со старой редакцией.
 */
export const HOSTING_RULES_VERSION = 2

/** Гость уже согласился с актуальной редакцией правил. */
export const hasAcceptedRules = (storage: Storage, userId: number): boolean =>
    (storage.get().hostingRules[String(userId)]?.version ?? 0) >= HOSTING_RULES_VERSION

export const acceptRules = async (storage: Storage, userId: number): Promise<void> => {
    await storage.update((s) => {
        s.hostingRules[String(userId)] = { userId, version: HOSTING_RULES_VERSION, at: new Date().toISOString() }
    })
}

// ---------------------------------------------------------------------------
// Заметки резидентов о гостях
// ---------------------------------------------------------------------------

/** Потолок длины заметки: это поле в миниаппе, а не файл — держим в разумных рамках. */
export const MAX_NOTE_LENGTH = 1000

export const guestNoteFor = (storage: Storage, userId: number): GuestNote | null =>
    storage.get().guestNotes[String(userId)] ?? null

/** «Вернуть» после удаления: та же заметка с тем же автором, если новую за отсчёт не написали. */
export const restoreGuestNote = async (storage: Storage, note: GuestNote): Promise<boolean> => {
    if (guestNoteFor(storage, note.userId)) return false
    await storage.update((s) => {
        s.guestNotes[String(note.userId)] = note
    })
    return true
}

/** Все заметки, от свежих к старым. */
export const listGuestNotes = (storage: Storage): GuestNote[] =>
    Object.values(storage.get().guestNotes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

/**
 * Пишет заметку о госте. Заметка одна на человека и общая для резидентов: тот, кто
 * правил последним, становится её `by`. Пустой текст = удалить заметку (так же, как
 * очистка поля в миниаппе).
 */
export const setGuestNote = async (
    storage: Storage,
    targetUserId: number,
    text: string,
    by: HostingUser,
): Promise<GuestNote | null> => {
    const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH)
    await storage.update((s) => {
        if (!trimmed) {
            delete s.guestNotes[String(targetUserId)]
            return
        }
        s.guestNotes[String(targetUserId)] = {
            userId: targetUserId,
            text: trimmed,
            by,
            updatedAt: new Date().toISOString(),
        }
    })
    return guestNoteFor(storage, targetUserId)
}

// ---------------------------------------------------------------------------
// Блокировка участников (бан во всех allowlist-чатах + отказ в миниаппе)
// ---------------------------------------------------------------------------

export const isBlocked = (storage: Storage, userId: number): boolean =>
    Boolean(storage.get().blockedUsers[String(userId)])

/** Заблокированные участники, от свежих к старым. */
export const listBlockedUsers = (storage: Storage): BlockedUser[] =>
    Object.values(storage.get().blockedUsers).sort((a, b) => b.at.localeCompare(a.at))

/**
 * Блокирует участника: пишет запись в стейт, стирает все его заявки/отметки/визиты без
 * заявки/присутствие/подписку на отметки резидентов и банит во всех allowlist-чатах. Бан по чатам
 * fire-and-safe: недоступный/уже вышедший участник просто логируется и не роняет
 * остальные чаты.
 */
export const blockUser = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    target: HostingUser,
    by: HostingUser,
): Promise<void> => {
    await storage.update((s) => {
        s.blockedUsers[String(target.userId)] = {
            userId: target.userId,
            username: target.username,
            name: target.name,
            by,
            at: new Date().toISOString(),
        }
        for (const [id, r] of Object.entries(s.hostingRequests)) {
            if (r.guest.userId === target.userId) delete s.hostingRequests[id]
        }
        for (const [k, a] of Object.entries(s.hostingAttendance)) {
            if (a.user.userId === target.userId) delete s.hostingAttendance[k]
        }
        for (const [k, w] of Object.entries(s.hostingWalkIns)) {
            if (w.guest.userId === target.userId) delete s.hostingWalkIns[k]
        }
        // Заметку о госте намеренно оставляем: она объясняет резидентам, почему он в блоке.
        delete s.presence[String(target.userId)]
        delete s.guestAttendNotify[String(target.userId)]
    })
    for (const chatId of allowedChats) {
        try {
            await client.banChatMember({ chatId, participantId: target.userId })
        } catch (err) {
            console.warn(`[hosting] не удалось забанить ${target.userId} в чате ${chatId}:`, err)
        }
    }
}

/** Снимает блокировку: убирает запись из стейта и разбанивает во всех allowlist-чатах. */
export const unblockUser = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    userId: number,
): Promise<boolean> => {
    const existed = isBlocked(storage, userId)
    await storage.update((s) => {
        delete s.blockedUsers[String(userId)]
    })
    for (const chatId of allowedChats) {
        try {
            await client.unbanChatMember({ chatId, participantId: userId })
        } catch (err) {
            console.warn(`[hosting] не удалось разбанить ${userId} в чате ${chatId}:`, err)
        }
    }
    return existed
}

// ---------------------------------------------------------------------------
// Экспорт визита в календарь (.ics, RFC 5545)
// ---------------------------------------------------------------------------

/** Заявка задаёт только начало визита — длительность в календаре берём фиксированную. */
export const ICS_EVENT_HOURS = 2

export const icsEscape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** '2026-07-17T12:00:00.000Z' -> '20260717T120000Z'. */
export const icsStamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/**
 * Складывание строк по RFC 5545: строка длиннее 75 октетов продолжается на
 * следующей, начинающейся с пробела. Режем по символам, а не по байтам, —
 * иначе многобайтная кириллица развалится пополам.
 */
export const icsFold = (line: string): string => {
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

/**
 * Свои одобренные визиты человека для подписки календаря: только где он гость.
 * Сегодняшние и будущие, как ивенты в той же подписке.
 */
export const feedVisits = (storage: Storage, userId: number, tzOffsetMinutes: number): HostingRequest[] => {
    const today = todayKey(tzOffsetMinutes)
    return Object.values(storage.get().hostingRequests)
        .filter((r) => r.status === 'approved' && r.dateKey >= today && r.guest.userId === userId)
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))
}

/**
 * Свой визит в подписке календаря: время и кто хостит. Ссылку подписки календарь хранит
 * годами и может отдать кому угодно, поэтому цели визита здесь нет, в отличие от
 * разового `.ics`. UID тот же, что у него.
 */
export const visitFeedVevent = (request: HostingRequest, tzOffsetMinutes: number, now: Date): string[] => {
    const startUtc = new Date(slotStartUtc(request.dateKey, request.time, tzOffsetMinutes))
    const endUtc = new Date(startUtc.getTime() + ICS_EVENT_HOURS * 3600_000)
    const host = request.approvedBy
    return [
        'BEGIN:VEVENT',
        `UID:${request.id}@endpoint-hosting`,
        `DTSTAMP:${icsStamp(now)}`,
        `DTSTART:${icsStamp(startUtc)}`,
        `DTEND:${icsStamp(endUtc)}`,
        `SUMMARY:${icsEscape('Визит в хакспейс')}`,
        ...(host ? [`DESCRIPTION:${icsEscape(`Хостит: ${displayName(host.name)}${host.username ? ` (@${host.username})` : ''}`)}`] : []),
        'STATUS:CONFIRMED',
        'END:VEVENT',
    ]
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
        description.push(`Хостит: ${displayName(a.name)}${a.username ? ` (@${a.username})` : ''}`)
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
