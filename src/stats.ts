// Витрины журнала присутствия для миниаппа: сводка, день, список дней, человек.
//
// Считают по дневным агрегатам из стейта (они живут вечно) и по сырым сессиям
// (они живут год — из них строятся таймлайн дня и список визитов человека).
// Сегодняшний день всегда пересчитывается на лету с учётом тех, кто внутри прямо
// сейчас: их сессии ещё не закрыты и в журнал не попали.

import { addDaysToKey, dayKeyOf, todayKey, weekdayOfKey } from './hosting.js'
import {
    BUCKETS_PER_DAY,
    BUCKET_MINUTES,
    computeDay,
    openSessionsNow,
    presenceLogTz,
    sessionsForDay,
    sessionsInRange,
    toVisits,
    type PresenceVisit,
} from './presence-log.js'
import type { Storage } from './storage.js'
import type { PresenceDay } from './types.js'

const MONTHS_NOM = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_ABBR = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Сколько столбиков «часы по месяцам» отдаём. */
const MONTH_BARS = 9
/** Недель в точечной сетке на карточке человека. */
const DOT_WEEKS = 12
/** Сколько последних визитов человека показываем списком. */
const LAST_VISITS = 8
/** Сколько дней отдаём в «Историю по дням». */
const DAYS_LIMIT = 120

export type StatsPeriod = 'month' | 'quarter' | 'all'

export type StatsHeatCell = { v: number; noData: boolean }
export type StatsTopPerson = { userId: number; label: string; username: string | null; minutes: number; visits: number }

export type StatsOverview = {
    period: StatsPeriod
    periodLabel: string
    openMinutes: number
    manMinutes: number
    /** Среднее число людей внутри, пока спейс открыт (человекоминуты / минуты работы). */
    avgInside: number
    /** Тот же показатель за предыдущее окно такой же длины. null — сравнивать не с чем. */
    prevOpenMinutes: number | null
    heat: { max: number; rows: { dow: number; cells: StatsHeatCell[] }[] }
    months: { key: string; label: string; minutes: number }[]
    top: StatsTopPerson[]
    daysCount: number
    /** Свои минуты за окно — строка «Мои визиты» показывает их без отдельного запроса. */
    myMinutes: number
    hasData: boolean
}

export type StatsDayRow = {
    userId: number
    label: string
    username: string | null
    /** Минуты от полуночи в поясе спейса. */
    fromMin: number
    toMin: number
    source: 'manual' | 'mac'
}

export type StatsDayView = {
    dateKey: string
    openMinutes: number
    manMinutes: number
    peak: number
    from: string
    to: string
    people: number
    rows: StatsDayRow[]
    gaps: number[]
}

export type StatsDaysView = {
    days: { dateKey: string; openMinutes: number; from: string; to: string; people: number; peak: number }[]
}

export type StatsPersonView = {
    user: { userId: number; label: string; username: string | null }
    period: StatsPeriod
    periodLabel: string
    visits: number
    minutes: number
    avgMinutes: number
    /** Типичное время прихода 'HH:MM'. Пусто — визитов не было. */
    favArrival: string
    /** Первый визит в журнале ('YYYY-MM-DD'). Пусто — визитов не было. */
    firstDateKey: string
    /**
     * Вступление в чат резидентов ('YYYY-MM-DD') — точный ответ «с какого числа он
     * резидент», в отличие от первого визита. Пусто — Telegram даты не отдал
     * (создатель чата, не резидент, нет доступа).
     */
    joinedSince: string
    /**
     * Дата вступления, выставленная руками, либо `RESIDENT_SINCE_ORIGIN`.
     * Пусто — считаем по журналу.
     */
    manualSince: string
    /** 12 недель × 7 дней, минуты. Порядок — по столбцам-неделям, как в сетке. */
    dots: number[]
    dotsFrom: string
    lastVisits: { dateKey: string; from: string; to: string; minutes: number; source: 'manual' | 'mac' }[]
}

// ---------------------------------------------------------------------------

const hhmm = (minutes: number): string => {
    const m = Math.max(0, Math.round(minutes))
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const monthLabelOf = (monthKey: string): string => {
    const idx = Number(monthKey.slice(5, 7)) - 1
    return MONTHS_ABBR[idx] ?? monthKey
}

const periodLabelOf = (period: StatsPeriod, from: string, to: string): string => {
    if (period === 'month') return `${MONTHS_NOM[Number(to.slice(5, 7)) - 1] ?? ''} ${to.slice(0, 4)}`.trim()
    if (period === 'quarter') return 'За 3 месяца'
    return from ? `С ${Number(from.slice(8, 10))} ${MONTHS_ABBR[Number(from.slice(5, 7)) - 1] ?? ''} ${from.slice(0, 4)}` : 'За всё время'
}

/** Границы окна. `from` пустой — данных нет вовсе. */
const rangeOf = (storage: Storage, period: StatsPeriod, today: string): { from: string; to: string } => {
    if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
    if (period === 'quarter') return { from: addDaysToKey(today, -89), to: today }
    const keys = Object.keys(storage.get().presenceStats.days).sort()
    return { from: keys[0] ?? today, to: today }
}

const daysBetween = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/**
 * Дневные итоги за окно. Сегодня всегда пересчитывается с живыми отметками: их
 * сессии ещё открыты, а без них сегодняшний день выглядел бы пустым до первого ухода.
 */
const daysOfRange = async (
    storage: Storage,
    from: string,
    to: string,
    today: string,
): Promise<Map<string, PresenceDay>> => {
    const out = new Map<string, PresenceDay>()
    const stored = storage.get().presenceStats.days
    for (let key = from; key <= to; key = addDaysToKey(key, 1)) {
        const day = stored[key]
        if (day) out.set(key, day)
    }
    if (today >= from && today <= to) {
        const live = computeDay([...(await sessionsForDay(storage, today)), ...openSessionsNow(storage)], today)
        const gaps = stored[today]?.gaps
        if (live.openMinutes > 0 || gaps?.length) out.set(today, gaps?.length ? { ...live, gaps } : live)
        else out.delete(today)
    }
    return out
}

/** Ник по журналу: последний непустой, который человек показывал. Иначе «Без ника». */
const labelsFromVisits = (visits: PresenceVisit[]): Map<number, string | null> => {
    const out = new Map<number, string | null>()
    for (const v of visits) {
        if (v.username) out.set(v.userId, v.username)
        else if (!out.has(v.userId)) out.set(v.userId, null)
    }
    return out
}

const labelOf = (username: string | null | undefined): string => (username ? `@${username}` : 'Без ника')

// ---------------------------------------------------------------------------

export const buildStatsOverview = async (
    storage: Storage,
    tzOffsetMinutes: number,
    period: StatsPeriod,
    meId: number,
): Promise<StatsOverview> => {
    const today = todayKey(tzOffsetMinutes)
    const { from, to } = rangeOf(storage, period, today)
    const days = await daysOfRange(storage, from, to, today)

    let openMinutes = 0
    let manMinutes = 0
    const userMinutes = new Map<number, number>()
    for (const day of days.values()) {
        openMinutes += day.openMinutes
        manMinutes += day.manMinutes
        for (const [key, minutes] of Object.entries(day.users)) {
            const id = Number(key)
            userMinutes.set(id, (userMinutes.get(id) ?? 0) + minutes)
        }
    }

    // Предыдущее окно той же длины: «на 12 часов больше, чем в прошлом месяце».
    const span = daysBetween(from, to)
    const prevTo = addDaysToKey(from, -1)
    const prevFrom = addDaysToKey(prevTo, -span)
    const stored = storage.get().presenceStats.days
    let prevOpenMinutes: number | null = null
    if (period !== 'all') {
        let sum = 0
        let any = false
        for (let key = prevFrom; key <= prevTo; key = addDaysToKey(key, 1)) {
            const day = stored[key]
            if (!day) continue
            any = true
            sum += day.openMinutes
        }
        if (any) prevOpenMinutes = sum
    }

    // Тепловая карта: среднее число людей в двухчасовом интервале по дню недели.
    // Считаем по всем календарным дням окна, а не только по «активным» — иначе пустые
    // вторники просто не попадали бы в среднее и карта врала бы в большую сторону.
    // Сегодня в выборку не берём: день ещё не кончился, и его вечерние интервалы
    // тянули бы среднее вниз.
    const sums: number[][] = Array.from({ length: 7 }, () => new Array<number>(BUCKETS_PER_DAY).fill(0))
    const counts: number[][] = Array.from({ length: 7 }, () => new Array<number>(BUCKETS_PER_DAY).fill(0))
    for (let key = from; key <= to; key = addDaysToKey(key, 1)) {
        if (key >= today) continue
        const dow = weekdayOfKey(key)
        const day = days.get(key)
        const gaps = new Set(day?.gaps ?? [])
        for (let b = 0; b < BUCKETS_PER_DAY; b++) {
            if (gaps.has(b)) continue
            sums[dow]![b] = (sums[dow]![b] ?? 0) + (day?.buckets[b] ?? 0) / BUCKET_MINUTES
            counts[dow]![b] = (counts[dow]![b] ?? 0) + 1
        }
    }
    let max = 0
    const rows = sums.map((row, dow) => ({
        dow,
        cells: row.map((sum, b) => {
            const n = counts[dow]![b] ?? 0
            const v = n > 0 ? sum / n : 0
            if (v > max) max = v
            return { v: Math.round(v * 100) / 100, noData: n === 0 }
        }),
    }))

    // Столбики по месяцам — по долгой памяти, окно на них не влияет.
    const months: { key: string; label: string; minutes: number }[] = []
    for (let i = MONTH_BARS - 1; i >= 0; i--) {
        const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
        d.setUTCMonth(d.getUTCMonth() - i)
        const key = d.toISOString().slice(0, 7)
        let minutes = 0
        for (const [dateKey, day] of days) if (dateKey.startsWith(key)) minutes += day.openMinutes
        for (const [dateKey, day] of Object.entries(stored)) {
            if (dateKey.startsWith(key) && !days.has(dateKey)) minutes += day.openMinutes
        }
        months.push({ key, label: monthLabelOf(key), minutes })
    }

    // Ники берём из сырых сессий окна: в агрегате дня только userId и минуты.
    const visits = toVisits(await sessionsInRange(storage, from, to))
    const labels = labelsFromVisits([...visits, ...toVisits(openSessionsNow(storage))])
    const visitCount = new Map<number, number>()
    for (const v of visits) visitCount.set(v.userId, (visitCount.get(v.userId) ?? 0) + 1)

    const top = [...userMinutes.entries()]
        .map(([userId, minutes]) => ({
            userId,
            username: labels.get(userId) ?? null,
            label: labelOf(labels.get(userId)),
            minutes: Math.round(minutes),
            visits: visitCount.get(userId) ?? 0,
        }))
        .sort((a, b) => b.minutes - a.minutes)

    return {
        period,
        periodLabel: periodLabelOf(period, from, to),
        openMinutes: Math.round(openMinutes),
        manMinutes: Math.round(manMinutes),
        avgInside: openMinutes > 0 ? Math.round((manMinutes / openMinutes) * 10) / 10 : 0,
        prevOpenMinutes,
        heat: { max: Math.round(max * 100) / 100, rows },
        months,
        top,
        daysCount: [...days.values()].filter((d) => d.openMinutes > 0).length,
        myMinutes: Math.round(userMinutes.get(meId) ?? 0),
        hasData: openMinutes > 0,
    }
}

export const buildStatsDay = async (
    storage: Storage,
    tzOffsetMinutes: number,
    dateKey: string,
): Promise<StatsDayView> => {
    const today = todayKey(tzOffsetMinutes)
    const sessions = [
        ...(await sessionsForDay(storage, dateKey)),
        ...(dateKey === today ? openSessionsNow(storage) : []),
    ]
    const day = computeDay(sessions, dateKey)
    const start = Date.parse(`${dateKey}T00:00:00Z`) - presenceLogTz() * 60_000
    const rows: StatsDayRow[] = toVisits(sessions)
        .map((v) => ({
            userId: v.userId,
            username: v.username,
            label: labelOf(v.username),
            fromMin: Math.max(0, Math.round((v.from - start) / 60_000)),
            toMin: Math.min(24 * 60, Math.round((v.to - start) / 60_000)),
            source: v.source,
        }))
        .filter((r) => r.toMin > r.fromMin)
        .sort((a, b) => a.fromMin - b.fromMin)

    return {
        dateKey,
        openMinutes: day.openMinutes,
        manMinutes: day.manMinutes,
        peak: day.peak,
        from: day.from,
        to: day.to,
        people: new Set(rows.map((r) => r.userId)).size,
        rows,
        gaps: storage.get().presenceStats.days[dateKey]?.gaps ?? [],
    }
}

export const buildStatsDays = async (storage: Storage, tzOffsetMinutes: number): Promise<StatsDaysView> => {
    const today = todayKey(tzOffsetMinutes)
    const stored = storage.get().presenceStats.days
    const keys = Object.keys(stored).sort().reverse().slice(0, DAYS_LIMIT)
    const live = computeDay([...(await sessionsForDay(storage, today)), ...openSessionsNow(storage)], today)
    const days = keys
        .filter((key) => key !== today)
        .map((key) => stored[key]!)
    if (live.openMinutes > 0) days.unshift(live)
    return {
        days: days
            .filter((d) => d.openMinutes > 0)
            .map((d) => ({
                dateKey: d.dateKey,
                openMinutes: d.openMinutes,
                from: d.from,
                to: d.to,
                people: Object.keys(d.users).length,
                peak: d.peak,
            })),
    }
}

export const buildStatsPerson = async (
    storage: Storage,
    tzOffsetMinutes: number,
    userId: number,
    period: StatsPeriod,
    /** Вступление в чат резидентов (`ResidentDirectory.joinedAt`); null — даты нет. */
    joinedAt: Date | null = null,
): Promise<StatsPersonView> => {
    const today = todayKey(tzOffsetMinutes)
    const { from, to } = rangeOf(storage, period, today)
    // Точечная сетка живёт своим окном в 12 недель — оно может быть шире выбранного.
    const dotsFrom = addDaysToKey(addDaysToKey(today, -weekdayOfKey(today)), -(DOT_WEEKS - 1) * 7)
    const readFrom = dotsFrom < from ? dotsFrom : from

    const sessions = (await sessionsInRange(storage, readFrom, to)).filter((s) => s.userId === userId)
    const open = openSessionsNow(storage).filter((s) => s.userId === userId)
    const visits = toVisits([...sessions, ...open])

    const inWindow = visits.filter((v) => {
        const key = dayKeyOf(new Date(v.from), tzOffsetMinutes)
        return key >= from && key <= to
    })
    const minutes = inWindow.reduce((sum, v) => sum + (v.to - v.from) / 60_000, 0)

    // Точки: 12 недель по столбцам, внутри столбца — дни с понедельника.
    const dots = new Array<number>(DOT_WEEKS * 7).fill(0)
    for (const v of visits) {
        const key = dayKeyOf(new Date(v.from), tzOffsetMinutes)
        const offset = daysBetween(dotsFrom, key)
        if (offset < 0 || offset >= DOT_WEEKS * 7) continue
        const idx = Math.floor(offset / 7) * 7 + (offset % 7)
        dots[idx] = (dots[idx] ?? 0) + Math.round((v.to - v.from) / 60_000)
    }

    // Типичное время прихода: медиана, а не среднее — один ночной заход не должен
    // сдвигать «обычно приходит вечером» на середину дня.
    const arrivals = inWindow
        .map((v) => {
            const key = dayKeyOf(new Date(v.from), tzOffsetMinutes)
            return (v.from - (Date.parse(`${key}T00:00:00Z`) - tzOffsetMinutes * 60_000)) / 60_000
        })
        .sort((a, b) => a - b)
    const favArrival = arrivals.length > 0 ? hhmm(Math.round((arrivals[Math.floor(arrivals.length / 2)] ?? 0) / 30) * 30) : ''

    const allKeys = Object.entries(storage.get().presenceStats.days)
        .filter(([, day]) => day.users[String(userId)] !== undefined)
        .map(([key]) => key)
        .sort()

    const labels = labelsFromVisits(visits)
    return {
        user: { userId, username: labels.get(userId) ?? null, label: labelOf(labels.get(userId)) },
        period,
        periodLabel: periodLabelOf(period, from, to),
        visits: inWindow.length,
        minutes: Math.round(minutes),
        avgMinutes: inWindow.length > 0 ? Math.round(minutes / inWindow.length) : 0,
        favArrival,
        firstDateKey: allKeys[0] ?? '',
        joinedSince: joinedAt ? dayKeyOf(joinedAt, tzOffsetMinutes) : '',
        manualSince: storage.get().residentSince[String(userId)] ?? '',
        dots,
        dotsFrom,
        lastVisits: [...visits]
            .sort((a, b) => b.from - a.from)
            .slice(0, LAST_VISITS)
            .map((v) => ({
                dateKey: dayKeyOf(new Date(v.from), tzOffsetMinutes),
                from: new Date(v.from + tzOffsetMinutes * 60_000).toISOString().slice(11, 16),
                to: new Date(v.to + tzOffsetMinutes * 60_000).toISOString().slice(11, 16),
                minutes: Math.round((v.to - v.from) / 60_000),
                source: v.source,
            })),
    }
}

/**
 * «Резидент с самого начала»: у части людей даты нет вовсе — спейс начинался с них,
 * и любое конкретное число было бы выдумкой. Хранится вместо ключа дня, отсюда
 * значение, которым `YYYY-MM-DD` быть не может.
 */
export const RESIDENT_SINCE_ORIGIN = 'origin'

/** Ручная дата «резидент с». null — снять и снова считать по первому визиту. */
export const setResidentSince = async (storage: Storage, userId: number, dateKey: string | null): Promise<void> => {
    await storage.update((s) => {
        if (dateKey) s.residentSince[String(userId)] = dateKey
        else delete s.residentSince[String(userId)]
    })
}
