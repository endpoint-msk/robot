// Журнал присутствия: закрытые сессии на диске + дневные агрегаты в стейте.
//
// Разделение важное. Сырых сессий набегает тысячи в год, а `data.json` переписывается
// целиком на каждую мутацию — поэтому они лежат месячными ndjson-файлами рядом со
// стейтом (тот же приём, что у афиш ивентов), дозаписью, без переписывания. В стейт
// попадают только посчитанные по ним итоги дня: их вес не зависит от числа визитов,
// и по ним считается вся статистика «за всё время», когда старые файлы уже удалены.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dayKeyOf } from './hosting.js'
import type { Storage } from './storage.js'
import type { PresenceDay, PresenceEndReason, PresenceSession, ResidentPresence } from './types.js'

/** Сколько месячных файлов сырых сессий держим: год плюс текущий месяц. */
export const RAW_RETENTION_MONTHS = 13
/**
 * Разрыв, короче которого две сессии одного человека считаются одним визитом.
 * Телефон отваливается от Wi-Fi и возвращается — без склейки один вечер выглядел
 * как пять визитов. Склеиваем на чтении, файл остаётся тупым и дозаписываемым.
 */
export const GLUE_GAP_MS = 15 * 60_000
/** Короче этого сессия не пишется вовсе: это дребезг сети, а не визит. */
export const MIN_SESSION_MS = 5 * 60_000
/**
 * Нижняя оценка визита, оборванного таймаутом пинга. Про такой визит точно известно
 * лишь время последнего подтверждения; закрывать сессию им же значит записать нулевую
 * длительность тому, кто отметился и просто не нажал кнопку, а это самый частый сценарий.
 */
export const TIMEOUT_MIN_SESSION_MS = 30 * 60_000

export const BUCKET_MINUTES = 120
export const BUCKETS_PER_DAY = 24 * 60 / BUCKET_MINUTES
const DAY_MINUTES = 24 * 60

/**
 * Сколько минут ячейки должен занять провал, чтобы её вообще списали в «данных нет».
 *
 * Раньше засчитывалось любое пересечение, и одна неудачная минута опроса вычёркивала
 * все два часа: на карте это выглядело случайной штриховкой, а хуже того — день с
 * такой ячейкой выпадал из среднего целиком, унося с собой реальные отметки.
 */
const GAP_MIN_MINUTES = BUCKET_MINUTES / 4

/**
 * Пояс спейса для нарезки суток. Ставится на старте (`setPresenceLogTz`) — модулю
 * нужен он один, а тащить его параметром пришлось бы через поллер MAC и все снятия
 * отметок. Дефолт совпадает с `parseHostingTzOffset`.
 */
let tzOffsetMinutes = 180

export const setPresenceLogTz = (offset: number): void => {
    tzOffsetMinutes = offset
}

export const presenceLogTz = (): number => tzOffsetMinutes

const logDir = (storage: Storage): string => path.join(path.dirname(storage.path()), 'presence-log')
const monthKeyOf = (dateKey: string): string => dateKey.slice(0, 7)
const monthFile = (storage: Storage, month: string): string => path.join(logDir(storage), `${month}.ndjson`)

/** Полночь дня в поясе спейса, в мс epoch. */
const dayStartMs = (dateKey: string): number => Date.parse(`${dateKey}T00:00:00Z`) - tzOffsetMinutes * 60_000

const prevMonth = (month: string): string => {
    const d = new Date(`${month}-01T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 7)
}

const hhmm = (minutes: number): string => {
    const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)))
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Файлы сессий
// ---------------------------------------------------------------------------

/**
 * Дозаписывает сессию в файл её месяца.
 *
 * Именно append, а не «прочитать-изменить-записать»: файл растёт весь год, и обрыв
 * питания посреди записи испортит максимум последнюю строку — её отбросит парсер.
 */
const appendSession = async (storage: Storage, session: PresenceSession): Promise<void> => {
    const month = monthKeyOf(dayKeyOf(new Date(session.from), tzOffsetMinutes))
    const file = monthFile(storage, month)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(session)}\n`, 'utf8')
}

/** Читает месячный файл. Битые строки пропускаются: важнее отдать остальные. */
const readMonth = async (storage: Storage, month: string): Promise<PresenceSession[]> => {
    let raw: string
    try {
        raw = await fs.readFile(monthFile(storage, month), 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`[presence-log] не удалось прочитать журнал за ${month}:`, err)
        }
        return []
    }
    const out: PresenceSession[] = []
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
            const parsed = JSON.parse(line) as PresenceSession
            if (parsed && typeof parsed.from === 'string' && typeof parsed.to === 'string') out.push(parsed)
        } catch {
            // Оборванная последняя строка — норма для append-only файла.
        }
    }
    return out
}

/**
 * Сессии, пересекающие день. Читаем файл месяца, а на первое число — ещё и прошлый:
 * визит, начавшийся 31-го вечером, лежит в файле января, но пересекает 1 февраля.
 */
export const sessionsForDay = async (storage: Storage, dateKey: string): Promise<PresenceSession[]> => {
    const months = [monthKeyOf(dateKey)]
    if (dateKey.endsWith('-01')) months.push(prevMonth(months[0]!))
    const start = dayStartMs(dateKey)
    const end = start + DAY_MINUTES * 60_000
    const all: PresenceSession[] = []
    for (const month of months) all.push(...(await readMonth(storage, month)))
    return all.filter((s) => Date.parse(s.to) > start && Date.parse(s.from) < end)
}

/** Сессии за диапазон дней включительно. */
export const sessionsInRange = async (storage: Storage, fromKey: string, toKey: string): Promise<PresenceSession[]> => {
    const months: string[] = []
    let cursor = prevMonth(monthKeyOf(fromKey))
    const last = monthKeyOf(toKey)
    for (let i = 0; i < RAW_RETENTION_MONTHS + 2 && cursor <= last; i++) {
        months.push(cursor)
        const d = new Date(`${cursor}-01T12:00:00Z`)
        d.setUTCMonth(d.getUTCMonth() + 1)
        cursor = d.toISOString().slice(0, 7)
    }
    const start = dayStartMs(fromKey)
    const end = dayStartMs(toKey) + DAY_MINUTES * 60_000
    const all: PresenceSession[] = []
    for (const month of months) all.push(...(await readMonth(storage, month)))
    return all.filter((s) => Date.parse(s.to) > start && Date.parse(s.from) < end)
}

/** Удаляет месячные файлы старше `RAW_RETENTION_MONTHS`. Агрегаты дней остаются навсегда. */
export const pruneRawLog = async (storage: Storage, today: string): Promise<void> => {
    let oldest = monthKeyOf(today)
    for (let i = 0; i < RAW_RETENTION_MONTHS; i++) oldest = prevMonth(oldest)
    let names: string[]
    try {
        names = await fs.readdir(logDir(storage))
    } catch {
        return
    }
    for (const name of names) {
        const month = name.replace(/\.ndjson$/, '')
        if (name === month || month >= oldest) continue
        await fs.rm(path.join(logDir(storage), name)).catch(() => {})
    }
}

// ---------------------------------------------------------------------------
// Склейка и расчёт дня
// ---------------------------------------------------------------------------

/** Визит: склеенная цепочка сессий одного человека. */
export type PresenceVisit = {
    userId: number
    username: string | null
    /** Границы в мс epoch. */
    from: number
    to: number
    /** 'mac', если хоть одна из склеенных сессий была авто-отметкой. */
    source: 'manual' | 'mac'
}

/**
 * Склеивает сессии в визиты: подряд идущие интервалы одного человека с разрывом
 * меньше `GLUE_GAP_MS` — это один визит, а не несколько.
 */
export const toVisits = (sessions: PresenceSession[]): PresenceVisit[] => {
    const byUser = new Map<number, PresenceSession[]>()
    for (const s of sessions) {
        const list = byUser.get(s.userId)
        if (list) list.push(s)
        else byUser.set(s.userId, [s])
    }
    const out: PresenceVisit[] = []
    for (const [userId, list] of byUser) {
        list.sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
        let current: PresenceVisit | null = null
        for (const s of list) {
            const from = Date.parse(s.from)
            const to = Date.parse(s.to)
            if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
            if (current && from - current.to <= GLUE_GAP_MS) {
                current.to = Math.max(current.to, to)
                if (s.username) current.username = s.username
                if (s.source === 'mac') current.source = 'mac'
                continue
            }
            current = { userId, username: s.username, from, to, source: s.source }
            out.push(current)
        }
    }
    return out.sort((a, b) => a.from - b.from)
}

/**
 * Итоги дня по сессиям. Чистая функция: ей всё равно, пришли сессии из файла или
 * это живые отметки, дотянутые до «сейчас» (так считается сегодняшний день).
 */
export const computeDay = (sessions: PresenceSession[], dateKey: string): PresenceDay => {
    const start = dayStartMs(dateKey)
    const end = start + DAY_MINUTES * 60_000
    const spans: { userId: number; from: number; to: number }[] = []
    for (const visit of toVisits(sessions)) {
        const from = Math.max(visit.from, start)
        const to = Math.min(visit.to, end)
        if (to <= from) continue
        spans.push({ userId: visit.userId, from: (from - start) / 60_000, to: (to - start) / 60_000 })
    }

    const day: PresenceDay = {
        dateKey,
        openMinutes: 0,
        manMinutes: 0,
        peak: 0,
        from: '',
        to: '',
        users: {},
        buckets: new Array<number>(BUCKETS_PER_DAY).fill(0),
    }
    if (spans.length === 0) return day

    for (const span of spans) {
        const length = span.to - span.from
        day.manMinutes += length
        const key = String(span.userId)
        day.users[key] = (day.users[key] ?? 0) + length
        for (let b = 0; b < BUCKETS_PER_DAY; b++) {
            const overlap = Math.min(span.to, (b + 1) * BUCKET_MINUTES) - Math.max(span.from, b * BUCKET_MINUTES)
            if (overlap > 0) day.buckets[b] = (day.buckets[b] ?? 0) + overlap
        }
    }

    // Объединение интервалов: «спейс был открыт», а не сумма человекоминут.
    const sorted = [...spans].sort((a, b) => a.from - b.from)
    let openFrom = sorted[0]!.from
    let openTo = sorted[0]!.to
    for (const span of sorted.slice(1)) {
        if (span.from > openTo) {
            day.openMinutes += openTo - openFrom
            openFrom = span.from
            openTo = span.to
        } else if (span.to > openTo) {
            openTo = span.to
        }
    }
    day.openMinutes += openTo - openFrom

    // Пик одновременных: разметка входов/выходов и бегущий счётчик.
    const events = spans.flatMap((s) => [{ at: s.from, d: 1 }, { at: s.to, d: -1 }])
    events.sort((a, b) => (a.at === b.at ? a.d - b.d : a.at - b.at))
    let inside = 0
    for (const e of events) {
        inside += e.d
        if (inside > day.peak) day.peak = inside
    }

    day.from = hhmm(Math.min(...spans.map((s) => s.from)))
    day.to = hhmm(Math.max(...spans.map((s) => s.to)))
    for (const key of Object.keys(day.users)) day.users[key] = Math.round(day.users[key]!)
    day.openMinutes = Math.round(day.openMinutes)
    day.manMinutes = Math.round(day.manMinutes)
    day.buckets = day.buckets.map((b) => Math.round(b))
    return day
}

/**
 * Пересчитывает день целиком из сессий и кладёт в стейт.
 *
 * Именно пересчёт, а не накопление по частям: объединение интервалов и пик
 * одновременных нельзя досчитать по одной новой сессии, не храня все остальные.
 * Сессий за день десятки, файл месяца читается за миллисекунды.
 */
export const recomputeDay = async (storage: Storage, dateKey: string): Promise<void> => {
    const day = computeDay(await sessionsForDay(storage, dateKey), dateKey)
    const gaps = storage.get().presenceStats.days[dateKey]?.gaps
    await storage.update((s) => {
        if (day.openMinutes <= 0 && !gaps?.length) {
            delete s.presenceStats.days[dateKey]
            return
        }
        s.presenceStats.days[dateKey] = gaps?.length ? { ...day, gaps } : day
    })
}

// ---------------------------------------------------------------------------
// Запись сессий
// ---------------------------------------------------------------------------

/** Журнал ведётся не для всех: человек мог отказаться от истории своих визитов. */
export const isPresenceLogged = (storage: Storage, userId: number): boolean =>
    storage.get().presenceNoLog[String(userId)] !== true

export const setPresenceNoLog = async (storage: Storage, userId: number, noLog: boolean): Promise<void> => {
    await storage.update((s) => {
        if (noLog) s.presenceNoLog[String(userId)] = true
        else delete s.presenceNoLog[String(userId)]
    })
}

/**
 * Момент, до которого человек точно был внутри.
 *
 * У каждого способа снятия отметки своя правда о конце визита, и брать «сейчас»
 * во всех случаях значит завышать: mac-отметка снимается через 10 минут после ухода
 * устройства, а таймаут пинга — через 3 с лишним часа после последнего подтверждения.
 */
const endOf = (present: ResidentPresence, reason: PresenceEndReason, now: number): number => {
    const from = Date.parse(present.checkedInAt)
    if (reason === 'timeout') {
        const confirmed = Date.parse(present.lastConfirmedAt)
        return Math.max(Number.isFinite(confirmed) ? confirmed : from, from + TIMEOUT_MIN_SESSION_MS)
    }
    const seen = present.lastSeenOnlineAt ? Date.parse(present.lastSeenOnlineAt) : NaN
    if (present.source === 'mac' && Number.isFinite(seen)) return seen
    return now
}

/**
 * Ник для журнала: настоящий, а не тот, что показан в публичном списке.
 *
 * Режим «без ника» скрывает человека в чате и на доске, а журнал резидентский и всё
 * равно хранит userId (по нему миниапп рисует аватарку) — «Без ника» в нём никого не
 * прятало, только делало строку нечитаемой. Отказ от журнала — отдельный тумблер.
 * `?? username` — для отметок, поставленных до появления поля.
 */
const logNick = (p: ResidentPresence): string | null => p.realUsername ?? p.username

/**
 * Закрывает сессию присутствия и обновляет итоги дня. Вызывается из единственной
 * точки снятия отметки (`removePresence`), поэтому в журнал попадают все способы
 * ухода — и кнопка, и уход устройства из сети, и таймаут.
 */
export const closePresenceSession = async (
    storage: Storage,
    present: ResidentPresence,
    reason: PresenceEndReason,
): Promise<void> => {
    if (!isPresenceLogged(storage, present.userId)) return
    const from = Date.parse(present.checkedInAt)
    if (!Number.isFinite(from)) return
    const to = endOf(present, reason, Date.now())
    if (!Number.isFinite(to) || to - from < MIN_SESSION_MS) return

    const session: PresenceSession = {
        userId: present.userId,
        username: logNick(present),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        source: present.source,
        endReason: reason,
    }
    try {
        await appendSession(storage, session)
    } catch (err) {
        console.error('[presence-log] не удалось записать сессию:', err)
        return
    }
    // Визит через полночь принадлежит обоим дням — пересчитываем каждый задетый.
    const firstDay = dayKeyOf(new Date(from), tzOffsetMinutes)
    const lastDay = dayKeyOf(new Date(to), tzOffsetMinutes)
    await recomputeDay(storage, firstDay)
    if (lastDay !== firstDay) await recomputeDay(storage, lastDay)
    await pruneRawLog(storage, lastDay)
}

/**
 * Отмечает интервал, про который данных не было: роутер не отвечал.
 *
 * Без этого «никого не было» и «мы не видели» сливаются в одну пустую ячейку карты,
 * и лежавший полдня роутер выглядит как мёртвый спейс. Пишем только когда появились
 * новые интервалы — тик поллера идёт раз в минуту, а стейт переписывается целиком.
 */
export const markRouterGap = async (storage: Storage, fromMs: number, toMs: number): Promise<void> => {
    if (!(toMs > fromMs)) return
    const touched = new Map<string, Set<number>>()
    let cursor = fromMs
    while (cursor < toMs) {
        const dateKey = dayKeyOf(new Date(cursor), tzOffsetMinutes)
        const start = dayStartMs(dateKey)
        const dayEnd = start + DAY_MINUTES * 60_000
        const until = Math.min(toMs, dayEnd)
        const set = touched.get(dateKey) ?? new Set<number>()
        const fromBucket = Math.floor((cursor - start) / 60_000 / BUCKET_MINUTES)
        const toBucket = Math.floor((until - 1 - start) / 60_000 / BUCKET_MINUTES)
        for (let b = Math.max(0, fromBucket); b <= Math.min(BUCKETS_PER_DAY - 1, toBucket); b++) {
            const bucketFrom = start + b * BUCKET_MINUTES * 60_000
            const overlap = Math.min(until, bucketFrom + BUCKET_MINUTES * 60_000) - Math.max(cursor, bucketFrom)
            if (overlap >= GAP_MIN_MINUTES * 60_000) set.add(b)
        }
        // Пустой набор в карту не кладём: короткий провал не должен заводить день
        // в стейте только ради `gaps: []`.
        if (set.size > 0) touched.set(dateKey, set)
        cursor = until
    }
    if (touched.size === 0) return

    const days = storage.get().presenceStats.days
    let changed = false
    for (const [dateKey, buckets] of touched) {
        const known = new Set(days[dateKey]?.gaps ?? [])
        for (const b of buckets) if (!known.has(b)) changed = true
    }
    if (!changed) return

    await storage.update((s) => {
        for (const [dateKey, buckets] of touched) {
            const existing = s.presenceStats.days[dateKey]
            const merged = [...new Set([...(existing?.gaps ?? []), ...buckets])].sort((a, b) => a - b)
            if (existing) {
                existing.gaps = merged
            } else {
                s.presenceStats.days[dateKey] = {
                    dateKey,
                    openMinutes: 0,
                    manMinutes: 0,
                    peak: 0,
                    from: '',
                    to: '',
                    users: {},
                    buckets: new Array<number>(BUCKETS_PER_DAY).fill(0),
                    gaps: merged,
                }
            }
        }
    })
}

/**
 * Живые отметки как сессии: сегодняшний день считается по журналу плюс те, кто
 * прямо сейчас внутри. Иначе до первого чек-аута сегодня выглядело бы пустым.
 */
export const openSessionsNow = (storage: Storage, now: number = Date.now()): PresenceSession[] => {
    const out: PresenceSession[] = []
    for (const p of Object.values(storage.get().presence)) {
        if (!isPresenceLogged(storage, p.userId)) continue
        const from = Date.parse(p.checkedInAt)
        if (!Number.isFinite(from) || from >= now) continue
        out.push({
            userId: p.userId,
            username: logNick(p),
            from: new Date(from).toISOString(),
            to: new Date(now).toISOString(),
            source: p.source,
            endReason: 'checkout',
        })
    }
    return out
}
