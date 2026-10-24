// Итоги месяца: история «Ваш октябрь в спейсе» из журнала присутствия.
//
// Считается за прошлый календарный месяц в поясе спейса, и только свои числа: мест,
// рейтингов и чужих часов в ней нет, а из людей назван один - тот, с кем вы чаще
// всего были в спейсе в одно время. Кто выключил журнал (`presenceNoLog`), итогов не
// получает и в чужие не попадает.
//
// Часы берутся из дневных итогов, как у остальной статистики, а вечера, время прихода
// и пересечения - из сырых визитов: в дневных итогах визит через полночь делится на два
// дня, и хвост после полуночи выглядел бы отдельным вечером.

import { addDaysToKey, cleanName, dayKeyOf, todayKey, weekdayOfKey } from './hosting.js'
import { BUCKETS_PER_DAY, BUCKET_MINUTES, isPresenceLogged, sessionsInRange, toVisits, type PresenceVisit } from './presence-log.js'
import type { Storage } from './storage.js'
import { own } from './types.js'

/** Меньше стольких вечеров итогов нет: история из пары визитов читается как упрёк, а не как итог. */
export const WRAP_MIN_EVENINGS = 3
/** С кем «вместе»: меньше этого общего времени - разминулись в дверях, а не провели вечер. */
const COMPANION_MIN_MINUTES = 30
/** Двухчасовой интервал засчитывается вечеру, если в нём пробыли хотя бы столько. */
const HEAT_MIN_MINUTES = 15
/** Сколько вечеров «открыли спейс» рисуем полосами и сколько чужих полос в каждой. */
const MAX_STRIPS = 5
const MAX_STRIP_OTHERS = 2
/**
 * Сколько живёт кэш месяца. Прошлый месяц дописывается и после своего конца: визит
 * через полночь последнего числа и mac-отметка попадают в журнал только на снятии, а
 * это бывает и через полсуток. Пересчёт - чтение пары месячных файлов.
 */
const CACHE_TTL_MS = 10 * 60_000

const DAY_MS = 24 * 60 * 60_000

const shiftMonth = (month: string, delta: number): string => {
    const d = new Date(`${month}-01T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + delta)
    return d.toISOString().slice(0, 7)
}

/** Месяц итогов: прошлый календарный относительно «сегодня» в поясе спейса. */
export const wrapMonthOf = (today: string): string => shiftMonth(today.slice(0, 7), -1)

const monthRange = (month: string): { from: string; to: string } => ({
    from: `${month}-01`,
    to: addDaysToKey(`${shiftMonth(month, 1)}-01`, -1),
})

const daysOf = (month: string): string[] => {
    const { from, to } = monthRange(month)
    const out: string[] = []
    for (let key = from; key <= to; key = addDaysToKey(key, 1)) out.push(key)
    return out
}

const dayStartMs = (dateKey: string, tz: number): number => Date.parse(`${dateKey}T00:00:00Z`) - tz * 60_000

const hhmm = (minutes: number): string => {
    const m = Math.round(minutes)
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Медиана, а не среднее: один ночной заход не должен сдвигать «обычно» на полдня. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

const quarter = (minutes: number): number => Math.round(minutes / 15) * 15

// ---------------------------------------------------------------------------
// Кэш месяца
// ---------------------------------------------------------------------------

type MonthCache = {
    month: string
    at: number
    /** Склеенные визиты всех, кто в журнале, задевающие месяц и сутки после него. */
    visits: PresenceVisit[]
    /** Вечера по людям: дни месяца, в которые начался хоть один визит. Ключ - userId. */
    evenings: Map<number, Set<string>>
}

let cache: MonthCache | null = null
let loading: { month: string; promise: Promise<MonthCache> } | null = null

const loadMonth = async (storage: Storage, month: string, tz: number): Promise<MonthCache> => {
    const { from, to } = monthRange(month)
    // Сутки сверх месяца: кто остался в спейсе в ночь на первое число, тоже решает,
    // закрыли ли вы дверь последним.
    const visits = toVisits(await sessionsInRange(storage, from, addDaysToKey(to, 1)))
    const evenings = new Map<number, Set<string>>()
    for (const v of visits) {
        const key = dayKeyOf(new Date(v.from), tz)
        if (key < from || key > to) continue
        const set = evenings.get(v.userId) ?? new Set<string>()
        set.add(key)
        evenings.set(v.userId, set)
    }
    return { month, at: Date.now(), visits, evenings }
}

const monthData = async (storage: Storage, tz: number): Promise<MonthCache> => {
    const month = wrapMonthOf(todayKey(tz))
    if (cache && cache.month === month && Date.now() - cache.at < CACHE_TTL_MS) return cache
    if (loading && loading.month === month) return loading.promise
    const promise = loadMonth(storage, month, tz)
    loading = { month, promise }
    try {
        cache = await promise
        return cache
    } finally {
        if (loading?.promise === promise) loading = null
    }
}

/**
 * Освежает кэш месяца итогов. bootstrap собирается синхронно и читает только кэш, а
 * греют его ручки, которым подождать чтение файла не страшно. Ошибку не пробрасываем:
 * из-за итогов месяца не должен падать весь bootstrap.
 */
export const refreshWrapCache = async (storage: Storage, tz: number): Promise<void> => {
    try {
        await monthData(storage, tz)
    } catch (err) {
        console.warn('[wrap] не удалось прочитать журнал за прошлый месяц:', err)
    }
}

// ---------------------------------------------------------------------------
// Строка в статистике
// ---------------------------------------------------------------------------

const userMinutes = (storage: Storage, userId: number, month: string): number => {
    const days = storage.get().presenceStats.days
    let sum = 0
    for (const key of daysOf(month)) sum += days[key]?.users[String(userId)] ?? 0
    return Math.round(sum)
}

export type WrapBrief = {
    month: string
    evenings: number
    minutes: number
    /** Числа месяца, в которые человек приходил: значок строки рисует по ним месяц точками. */
    days: number[]
}

/** Итоги для bootstrap. null - итогов нет либо кэш ещё не прогрет. */
export const wrapBrief = (storage: Storage, userId: number, tz: number): WrapBrief | null => {
    const month = wrapMonthOf(todayKey(tz))
    if (!cache || cache.month !== month || !isPresenceLogged(storage, userId)) return null
    const days = [...(cache.evenings.get(userId) ?? [])].sort()
    if (days.length < WRAP_MIN_EVENINGS) return null
    return {
        month,
        evenings: days.length,
        minutes: userMinutes(storage, userId, month),
        days: days.map((key) => Number(key.slice(8, 10))),
    }
}

// ---------------------------------------------------------------------------
// История
// ---------------------------------------------------------------------------

export type WrapStrip = {
    dateKey: string
    /** Минуты от полуночи дня прихода; конец бывает больше суток, если ушли за полночь. */
    me: [number, number]
    /** Кто был в спейсе вместе с вами в этот вечер: только интервалы, без имён. */
    others: [number, number][]
}

export type WrapView = {
    month: string
    /** Ваши минуты в спейсе за месяц, по дневным итогам. */
    minutes: number
    /** Ваши минуты месяцем раньше: «на 6 часов больше, чем в сентябре». */
    prevMinutes: number
    /** Вечера по дням прихода и сколько в каждом пробыли. */
    evenings: { dateKey: string; minutes: number }[]
    /** Дни месяца, когда роутер не отвечал: календарь штрихует их неделю. */
    gapDays: string[]
    longest: { dateKey: string; minutes: number }
    /** 7×12: в скольких вечерах вы были в спейсе в этот день недели и двухчасовой интервал. */
    heat: number[][]
    usual: {
        /** Обычный день недели (0 - понедельник). null - день не повторялся. */
        dow: number | null
        /** Сколько раз пришли в этот день недели и сколько таких дней было в месяце. */
        count: number
        of: number
        /** Обычный приход, 'HH:MM'. */
        arrival: string
        /** Обычный уход, минуты от полуночи дня прихода: за полночь - больше суток. */
        leave: number
        /** Клетка карты, которую обвести: день и интервал прихода. */
        ring: { dow: number; bucket: number }
    }
    /** Вечера, когда до вас внутри никого не было, и когда после вас - тоже. */
    opened: { count: number; closed: number; strips: WrapStrip[] }
    companion: { userId: number; username: string | null; label: string; minutes: number } | null
    /** Со сколькими людьми пересеклись хотя бы на `COMPANION_MIN_MINUTES`. */
    companions: number
}

/** Ник по журналу: последний непустой, который человек показывал. */
const journalNick = (visits: PresenceVisit[], userId: number): string | null => {
    let nick: string | null = null
    for (const v of visits) if (v.userId === userId && v.username) nick = v.username
    return nick
}

/**
 * Имя человека без ника. В журнале имён нет, поэтому ищем там, где бот их видел:
 * снимки резидентов во взносах и отметки «я приду».
 */
const knownName = (storage: Storage, userId: number): string | null => {
    const s = storage.get()
    const periods = Object.values(s.dues.periods).sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    for (const period of periods) {
        const name = cleanName(own(period.roster, String(userId))?.name ?? '')
        if (name) return name
    }
    for (const a of Object.values(s.hostingAttendance)) {
        const name = a.user.userId === userId ? cleanName(a.user.name) : ''
        if (name) return name
    }
    return null
}

export const buildWrapView = async (storage: Storage, userId: number, tz: number): Promise<WrapView | null> => {
    const data = await monthData(storage, tz)
    const month = data.month
    if (!isPresenceLogged(storage, userId)) return null
    if ((data.evenings.get(userId)?.size ?? 0) < WRAP_MIN_EVENINGS) return null

    const { from, to } = monthRange(month)
    const monthStart = dayStartMs(from, tz)
    const monthEnd = dayStartMs(addDaysToKey(to, 1), tz)
    const mine = data.visits.filter((v) => v.userId === userId)
    const others = data.visits.filter((v) => v.userId !== userId)
    const startKey = (v: PresenceVisit): string => dayKeyOf(new Date(v.from), tz)
    const inMonth = (key: string): boolean => key >= from && key <= to

    // Вечер - день, в который визит начался; визиты одного дня складываются.
    const byDay = new Map<string, PresenceVisit[]>()
    for (const v of mine) {
        const key = startKey(v)
        if (!inMonth(key)) continue
        const list = byDay.get(key)
        if (list) list.push(v)
        else byDay.set(key, [v])
    }
    const nights = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateKey, list]) => {
            const start = dayStartMs(dateKey, tz)
            return {
                dateKey,
                dow: weekdayOfKey(dateKey),
                minutes: Math.round(list.reduce((sum, v) => sum + (v.to - v.from), 0) / 60_000),
                arrive: (Math.min(...list.map((v) => v.from)) - start) / 60_000,
                leave: (Math.max(...list.map((v) => v.to)) - start) / 60_000,
            }
        })
    const longest = nights.reduce((a, b) => (b.minutes > a.minutes ? b : a), nights[0]!)

    // Провал считается тем же критерием, что у тепловой карты: только если в интервале
    // и правда пусто. Метка ставится в момент провала, а сессии за то же время могли
    // дописаться позже.
    const stored = storage.get().presenceStats.days
    const gapDays = daysOf(month).filter((key) => {
        const day = stored[key]
        return (day?.gaps ?? []).some((b) => (day?.buckets[b] ?? 0) <= 0)
    })

    // Когда вы в спейсе: интервалы суток по дням недели. Визит через полночь честно
    // попадает в оба дня.
    const cells = new Set<string>()
    for (const v of mine) {
        let cursor = Math.max(v.from, monthStart)
        const end = Math.min(v.to, monthEnd)
        while (cursor < end) {
            const key = dayKeyOf(new Date(cursor), tz)
            const start = dayStartMs(key, tz)
            const until = Math.min(end, start + DAY_MS)
            for (let b = 0; b < BUCKETS_PER_DAY; b++) {
                const bucketFrom = start + b * BUCKET_MINUTES * 60_000
                const overlap = Math.min(until, bucketFrom + BUCKET_MINUTES * 60_000) - Math.max(cursor, bucketFrom)
                if (overlap >= HEAT_MIN_MINUTES * 60_000) cells.add(`${key}#${b}`)
            }
            cursor = until
        }
    }
    const heat = Array.from({ length: 7 }, () => new Array<number>(BUCKETS_PER_DAY).fill(0))
    for (const cell of cells) {
        const [key, bucket] = cell.split('#')
        const row = heat[weekdayOfKey(key!)]!
        row[Number(bucket)] = (row[Number(bucket)] ?? 0) + 1
    }

    // Обычный день: чаще других, а при равенстве - где пробыли дольше. Назвать его можно,
    // только если он повторился: один четверг из трёх вечеров - не «ваш день».
    const byDow = new Map<number, { count: number; minutes: number }>()
    for (const night of nights) {
        const cur = byDow.get(night.dow) ?? { count: 0, minutes: 0 }
        cur.count += 1
        cur.minutes += night.minutes
        byDow.set(night.dow, cur)
    }
    const [topDow, top] = [...byDow.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].minutes - a[1].minutes || a[0] - b[0],
    )[0]!
    const dow = top.count >= 2 ? topDow : null
    const arrival = Math.min(23 * 60 + 45, quarter(median((dow === null ? nights : nights.filter((n) => n.dow === dow)).map((n) => n.arrive))))
    const usual = {
        dow,
        count: top.count,
        of: daysOf(month).filter((key) => weekdayOfKey(key) === topDow).length,
        arrival: hhmm(arrival),
        leave: quarter(median(nights.map((n) => n.leave))),
        ring: { dow: topDow, bucket: Math.min(BUCKETS_PER_DAY - 1, Math.floor(arrival / BUCKET_MINUTES)) },
    }

    // Открыли спейс: в момент прихода внутри никого. Закрыли: после ухода - тоже.
    const insideAt = (at: number): boolean => others.some((w) => w.from < at && w.to > at)
    const opened = new Map<string, PresenceVisit>()
    const closed = new Set<string>()
    for (const v of [...mine].sort((a, b) => a.from - b.from)) {
        const key = startKey(v)
        if (!inMonth(key)) continue
        if (!opened.has(key) && !insideAt(v.from)) opened.set(key, v)
        if (!insideAt(v.to)) closed.add(key)
    }
    // Полосами - вечера, куда после вас пришло больше всего людей: в этом и смысл
    // открыть спейс. Показываем по порядку дат.
    const strips: WrapStrip[] = [...opened.entries()]
        .map(([dateKey, v]) => ({
            dateKey,
            v,
            with: others.filter((w) => w.from < v.to && w.to > v.from).sort((a, b) => a.from - b.from),
        }))
        .sort((a, b) => b.with.length - a.with.length || b.v.to - b.v.from - (a.v.to - a.v.from))
        .slice(0, MAX_STRIPS)
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
        .map(({ dateKey, v, with: together }): WrapStrip => {
            const start = dayStartMs(dateKey, tz)
            const rel = (ms: number): number => Math.round((ms - start) / 60_000)
            return {
                dateKey,
                me: [rel(v.from), rel(v.to)],
                others: together.slice(0, MAX_STRIP_OTHERS).map((w): [number, number] => [rel(w.from), rel(w.to)]),
            }
        })

    // С кем вместе: пересечение интервалов внутри месяца.
    const clip = (v: PresenceVisit): [number, number] => [Math.max(v.from, monthStart), Math.min(v.to, monthEnd)]
    const myIntervals = mine.map(clip).filter(([a, b]) => b > a)
    const together = new Map<number, number>()
    for (const w of others) {
        const [wa, wb] = clip(w)
        if (wb <= wa) continue
        let ms = 0
        for (const [a, b] of myIntervals) ms += Math.max(0, Math.min(b, wb) - Math.max(a, wa))
        if (ms > 0) together.set(w.userId, (together.get(w.userId) ?? 0) + ms)
    }
    const people = [...together.entries()]
        .map(([id, ms]) => ({ userId: id, minutes: Math.round(ms / 60_000) }))
        // Кто выключил журнал, в чужие итоги не попадает - ни именем, ни счётом.
        .filter((p) => p.minutes >= COMPANION_MIN_MINUTES && isPresenceLogged(storage, p.userId))
        .sort((a, b) => b.minutes - a.minutes)
    let companion: WrapView['companion'] = null
    const first = people[0]
    if (first) {
        const nick = journalNick(data.visits, first.userId) ?? storage.get().macBindings[String(first.userId)]?.username ?? null
        const label = nick ? `@${nick}` : knownName(storage, first.userId)
        if (label) companion = { userId: first.userId, username: nick, label, minutes: first.minutes }
    }

    return {
        month,
        minutes: userMinutes(storage, userId, month),
        prevMinutes: userMinutes(storage, userId, shiftMonth(month, -1)),
        evenings: nights.map((n) => ({ dateKey: n.dateKey, minutes: n.minutes })),
        gapDays,
        longest: { dateKey: longest.dateKey, minutes: longest.minutes },
        heat,
        usual,
        opened: { count: opened.size, closed: closed.size, strips },
        companion,
        companions: people.length,
    }
}
