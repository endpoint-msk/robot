/**
 * Рейтлимиты HTTP-ручек миниаппа: общий движок, политика лежит в `webapp.ts`.
 *
 * Зачем вообще: почти каждый POST /api/* умеет дёргать Telegram - уведомить резидентов
 * о заявке, позвать человека в личку, забанить во всех чатах, выгрузить взносы файлом.
 * Клиент миниаппа наш, но подписанный `initData` живёт сутки, и его достаточно, чтобы
 * молотить по ручке из curl. Упереться во FLOOD_WAIT там значит положить не эндпоинт,
 * а бота целиком: клиент mtcute у чата, шедулеров и вебапа один на процесс.
 *
 * Модель - token bucket: `limit` токенов на `windowMs`, докапываются непрерывно. Он
 * прощает нормальный всплеск (открыл миниапп - пачка запросов сразу) и при этом держит
 * среднюю скорость, в отличие от счётчика на фиксированном окне, где на стыке окон
 * проходит двойная порция.
 *
 * Состояние - только в памяти процесса, как кэш `residents.ts` и реестр показанных
 * userId: в `State` оно означало бы перезапись всего JSON на каждый запрос.
 */

/** Полка: сколько запросов (`limit`) на какое окно (`windowMs`). */
export type RateRule = { limit: number; windowMs: number }

export type RateVerdict = { ok: true } | { ok: false; retryAfterMs: number }

type Bucket = {
    tokens: number
    /** Когда бакет последний раз трогали (мс epoch). */
    at: number
    /** Через сколько простоя бакет заведомо полон и его можно забыть. */
    ttlMs: number
}

/**
 * Потолок числа бакетов. Ключей у нас единицы на человека, но ключ по IP приходит
 * снаружи, и без потолка Map росла бы на каждый новый адрес - то есть сама была бы
 * вектором исчерпания памяти.
 */
const MAX_BUCKETS = 20_000

/** Как часто подметаем протухшие бакеты (лениво, на входящем запросе). */
const SWEEP_EVERY_MS = 60_000

const buckets = new Map<string, Bucket>()
let lastSweepAt = Date.now()

/** Счётчики отказов по областям - для дев-команды /status. */
const throttled = new Map<string, number>()
let lastThrottleAt = 0

const sweep = (now: number): void => {
    if (now - lastSweepAt < SWEEP_EVERY_MS && buckets.size < MAX_BUCKETS) return
    lastSweepAt = now
    for (const [key, bucket] of buckets) {
        // Простоявший дольше своего окна бакет уже долился до полного, то есть
        // неотличим от отсутствующего.
        if (now - bucket.at >= bucket.ttlMs) buckets.delete(key)
    }
    if (buckets.size <= MAX_BUCKETS) return
    // Всё ещё выше потолка - вытесняем самые старые: они ближе всех к полному,
    // и забыть их дешевле всего по смыслу лимита.
    const byAge = [...buckets.entries()].sort((a, b) => a[1].at - b[1].at)
    const excess = buckets.size - Math.floor(MAX_BUCKETS * 0.9)
    for (let i = 0; i < excess; i++) {
        const entry = byAge[i]
        if (entry) buckets.delete(entry[0])
    }
}

/**
 * Списывает `cost` токенов с бакета `scope:key`.
 *
 * На отказе токены НЕ списываются: иначе клиент, долбящий в ручку без остановки,
 * держал бы собственный бакет пустым вечно и не выбирался бы из отказа даже после
 * того, как утихнет. Здесь же отказ стоит ровно ничего, а `retryAfterMs` показывает
 * честный момент, когда попытка пройдёт.
 */
export const rateLimit = (scope: string, key: string, rule: RateRule, cost = 1): RateVerdict => {
    const now = Date.now()
    sweep(now)
    const id = `${scope}:${key}`
    const perMs = rule.limit / rule.windowMs
    const previous = buckets.get(id)
    const tokens = previous
        ? Math.min(rule.limit, previous.tokens + (now - previous.at) * perMs)
        : rule.limit
    if (tokens < cost) {
        buckets.set(id, { tokens, at: now, ttlMs: rule.windowMs })
        throttled.set(scope, (throttled.get(scope) ?? 0) + 1)
        lastThrottleAt = now
        return { ok: false, retryAfterMs: Math.ceil((cost - tokens) / perMs) }
    }
    buckets.set(id, { tokens: tokens - cost, at: now, ttlMs: rule.windowMs })
    return { ok: true }
}

/** Секунды для заголовка `Retry-After`: он целочисленный, а ноль означал бы «уже можно». */
export const retryAfterSeconds = (retryAfterMs: number): number => Math.max(1, Math.ceil(retryAfterMs / 1000))

export type RateLimitStats = {
    buckets: number
    /** Сколько отказов с момента старта, по областям. */
    throttled: { scope: string; count: number }[]
    /** Когда последний раз кого-то притормозили (мс epoch). 0 - ни разу. */
    lastAt: number
}

export const rateLimitStats = (): RateLimitStats => ({
    buckets: buckets.size,
    throttled: [...throttled.entries()]
        .map(([scope, count]) => ({ scope, count }))
        .sort((a, b) => b.count - a.count),
    lastAt: lastThrottleAt,
})
