/**
 * Пульс подсистем: живой ли поллер MAC, крутится ли шедулер взносов, пишется ли стейт.
 *
 * Реестр держится в памяти процесса, а не в `State`: отметка в стейте означала бы полную
 * перезапись JSON на каждый тик каждого шедулера. Отсюда же следствие - после рестарта
 * всё считается «ещё не билось», пока не пройдёт первый тик.
 *
 * Наружу это выходит двумя способами: `/healthz` (для healthcheck докера - только
 * ok/degraded, без имён и счётчиков: ручка смотрит в интернет) и дев-команда /status
 * в личке, где видно, что именно отвалилось.
 */

/** Во сколько своих интервалов компонент должен уложиться, прежде чем считаться отвалившимся. */
const STALE_FACTOR = 3

type Component = {
    name: string
    /** Ожидаемый период между отметками (мс). */
    everyMs: number
    /** Когда последний раз отмечался (мс epoch). 0 - ещё ни разу. */
    lastAt: number
    /** Когда последний раз отмечался успешно. */
    lastOkAt: number
    ok: boolean
    note: string | null
}

const components = new Map<string, Component>()
const startedAt = Date.now()

/** Объявляет компонент до первого тика: иначе выключенный поллер не отличить от упавшего. */
export const trackComponent = (name: string, everyMs: number): void => {
    const existing = components.get(name)
    if (existing) {
        existing.everyMs = everyMs
        return
    }
    components.set(name, { name, everyMs, lastAt: 0, lastOkAt: 0, ok: true, note: null })
}

/** Отметка «я отработал». `ok: false` - тик прошёл, но с ошибкой (роутер молчит, принтер недоступен). */
export const beat = (name: string, ok = true, note?: string): void => {
    const now = Date.now()
    const existing = components.get(name)
    if (!existing) {
        components.set(name, { name, everyMs: 60_000, lastAt: now, lastOkAt: ok ? now : 0, ok, note: note ?? null })
        return
    }
    existing.lastAt = now
    if (ok) existing.lastOkAt = now
    existing.ok = ok
    existing.note = note ?? null
}

/**
 * Тело `setInterval` для шедулера: тик, пульс, единый лог падения.
 *
 * Отдельная обёртка, а не beat() руками в каждом тике: восемь шедулеров с одинаковым
 * `void tick().catch(console.error)` рано или поздно разъехались бы, и половина
 * компонентов молча перестала бы отмечаться, оставаясь «здоровой».
 */
export const startHeartbeatInterval = (
    name: string,
    everyMs: number,
    tick: () => Promise<void>,
    logPrefix: string,
): { stop: () => void } => {
    trackComponent(name, everyMs)
    const handle = setInterval(() => {
        void (async () => {
            try {
                await tick()
                beat(name)
            } catch (err) {
                beat(name, false, err instanceof Error ? err.message : String(err))
                console.error(`${logPrefix} tick error:`, err)
            }
        })()
    }, everyMs)
    return { stop: () => clearInterval(handle) }
}

export type ComponentHealth = {
    name: string
    /** Компонент отметился не позже трёх своих интервалов и без ошибки. */
    healthy: boolean
    /** Сколько прошло с последней отметки (мс). null - не отмечался ни разу. */
    ageMs: number | null
    ok: boolean
    note: string | null
}

export type HealthSnapshot = {
    ok: boolean
    uptimeMs: number
    components: ComponentHealth[]
}

/**
 * Свежесть считаем по `lastAt`, а не по `lastOkAt`: тик, который отработал и честно
 * сказал «роутер не отвечает», это живой шедулер с внешней проблемой - разные диагнозы,
 * и лечатся они по-разному. Оба случая роняют `healthy`, но в /status видно, какой из них.
 */
export const healthSnapshot = (): HealthSnapshot => {
    const now = Date.now()
    const list: ComponentHealth[] = [...components.values()].map((c) => {
        const ageMs = c.lastAt === 0 ? null : now - c.lastAt
        // До первого тика даём компоненту его окно: сразу после старта «не бился» - норма.
        const deadline = c.everyMs * STALE_FACTOR
        const fresh = ageMs === null ? now - startedAt < deadline : ageMs < deadline
        return { name: c.name, healthy: fresh && c.ok, ageMs, ok: c.ok, note: c.note }
    })
    return { ok: list.every((c) => c.healthy), uptimeMs: now - startedAt, components: list }
}
