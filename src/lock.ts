/**
 * Умный замок двери спейса через Home Assistant (REST API, long-lived токен).
 * Открывают резиденты из миниаппа, кто открыл и закрыл - в журнал действий.
 */

const FETCH_TIMEOUT_MS = 8_000
/** bootstrap ждёт состояние не дольше этого: открытие миниаппа важнее строки замка. */
const STATE_WAIT_MS = 1_500
/** Состояние свежее этого берётся из памяти: bootstrap собирается на каждую мутацию. */
const STATE_TTL_MS = 15_000

/**
 * Состояния сущности `lock` в Home Assistant. `unavailable` - замок или интеграция
 * не на связи, `unknown` - ещё не ответили ни разу; во фронт оба уходят как есть.
 */
export type LockState = 'locked' | 'unlocked' | 'locking' | 'unlocking' | 'open' | 'opening' | 'jammed' | 'unavailable' | 'unknown'

const KNOWN_STATES: ReadonlySet<string> = new Set<LockState>([
    'locked', 'unlocked', 'locking', 'unlocking', 'open', 'opening', 'jammed', 'unavailable', 'unknown',
])

export type LockConfig = {
    /** База Home Assistant без слэша на конце. */
    baseUrl: string
    token: string
    /** `lock.<что-то>` из Home Assistant. */
    entityId: string
}

export const parseLockConfig = (env: {
    url: string | undefined
    token: string | undefined
    entity: string | undefined
}): LockConfig | null => {
    const url = env.url?.trim()
    const token = env.token?.trim()
    const entityId = env.entity?.trim()
    if (!url || !token || !entityId) return null
    if (!/^lock\.[a-z0-9_]+$/.test(entityId)) {
        console.warn(`[warn] HASS_LOCK_ENTITY="${entityId}" не похож на сущность замка (lock.<имя>) - замок выключен.`)
        return null
    }
    return { baseUrl: url.replace(/\/+$/, ''), token, entityId }
}

const toState = (raw: unknown): LockState => (typeof raw === 'string' && KNOWN_STATES.has(raw) ? (raw as LockState) : 'unknown')

export class LockClient {
    private cached: { state: LockState; at: number } | null = null
    private inflight: Promise<LockState> | null = null

    constructor(private readonly config: LockConfig) {}

    private async request(path: string, body?: unknown): Promise<Response> {
        const res = await fetch(this.config.baseUrl + path, {
            method: body === undefined ? 'GET' : 'POST',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${this.config.token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (!res.ok) throw new Error(`Home Assistant: HTTP ${res.status} на ${path}`)
        return res
    }

    private async fetchState(): Promise<LockState> {
        const res = await this.request(`/api/states/${this.config.entityId}`)
        const data = (await res.json()) as { state?: unknown }
        return toState(data.state)
    }

    /** Последнее известное состояние без похода в Home Assistant. */
    get known(): LockState {
        return this.cached?.state ?? 'unknown'
    }

    /**
     * Свежее состояние для bootstrap: из памяти, если оно моложе TTL, иначе ждём ответ
     * не дольше `STATE_WAIT_MS` и отдаём что есть. Ошибку не бросает: строка замка
     * покажет «нет связи», а миниапп откроется.
     */
    async refresh(): Promise<LockState> {
        if (this.cached && Date.now() - this.cached.at < STATE_TTL_MS) return this.cached.state
        this.inflight ??= (async () => {
            try {
                const state = await this.fetchState()
                this.cached = { state, at: Date.now() }
                return state
            } catch (err) {
                console.warn('[lock] не удалось прочитать состояние замка:', err instanceof Error ? err.message : err)
                this.cached = { state: 'unavailable', at: Date.now() }
                return 'unavailable' as const
            } finally {
                this.inflight = null
            }
        })()
        const timeout = new Promise<LockState>((resolve) => setTimeout(() => resolve(this.known), STATE_WAIT_MS).unref())
        return Promise.race([this.inflight, timeout])
    }

    /**
     * `lock.unlock` / `lock.lock`. Home Assistant отвечает списком изменившихся
     * состояний; замок по радио доходит не сразу, и в ответе бывает `unlocking` или
     * ещё прежнее состояние - тогда ставим ожидаемое, следующий bootstrap поправит.
     */
    async set(target: 'unlocked' | 'locked', by: { name: string; username: string | null }): Promise<LockState> {
        const service = target === 'unlocked' ? 'unlock' : 'lock'
        const res = await this.request(`/api/services/lock/${service}`, { entity_id: this.config.entityId })
        let state: LockState = target
        try {
            const changed = (await res.json()) as unknown
            const own = Array.isArray(changed)
                ? (changed as { entity_id?: unknown; state?: unknown }[]).find((s) => s.entity_id === this.config.entityId)
                : undefined
            const reported = own ? toState(own.state) : 'unknown'
            if (reported === 'jammed' || reported === target) state = reported
        } catch {
            // тело не JSON - сам вызов прошёл, этого достаточно
        }
        this.cached = { state, at: Date.now() }
        void this.note(by, target === 'unlocked' ? 'открыл замок из миниаппа' : 'закрыл замок из миниаппа')
        return state
    }

    /**
     * Запись в журнал Home Assistant рядом с замком: сам HA пишет действие на владельца
     * токена (сервисную учётку), а кто нажал кнопку, знает только бот.
     */
    private async note(by: { name: string; username: string | null }, message: string): Promise<void> {
        try {
            await this.request('/api/services/logbook/log', {
                name: by.username ? `${by.name} (@${by.username})` : by.name,
                message,
                entity_id: this.config.entityId,
            })
        } catch (err) {
            console.warn('[lock] не удалось записать в журнал Home Assistant:', err instanceof Error ? err.message : err)
        }
    }
}
