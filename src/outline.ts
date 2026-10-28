/**
 * Клиент API Outline (вики спейса) для одной задачи - отключать и возвращать людей.
 *
 * Выключенный аккаунт Authentik вики замечает сама, но поздно: Outline сверяет токен
 * только на загрузке и только если вход был больше часа назад, а открытая вкладка живёт
 * без сверки вовсе. Отключённого (suspend) Outline не пускает уже на следующем запросе.
 * Человека ищем по email: другого общего ключа у вики и Authentik нет, `sub` из
 * Authentik наружу Outline не отдаёт.
 */

const FETCH_TIMEOUT_MS = 10_000

export type OutlineConfig = {
    /** Адрес вики без хвостового слэша. */
    baseUrl: string
    /** API-ключ админа: отключать людей может только он. */
    token: string
}

export const parseOutlineConfig = (env: { url: string | undefined; token: string | undefined }): OutlineConfig | null => {
    const rawUrl = env.url?.trim()
    const token = env.token?.trim()
    if (!rawUrl || !token) return null
    const baseUrl = (/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/+$/, '')
    return { baseUrl, token }
}

export type OutlineUser = { id: string; email: string; suspended: boolean }

export class OutlineError extends Error {
    constructor(
        readonly status: number,
        detail: string,
    ) {
        super(`Outline ${status}: ${detail}`)
    }
}

export class OutlineClient {
    constructor(private readonly cfg: OutlineConfig) {}

    private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
        const res = await fetch(`${this.cfg.baseUrl}/api/${method}`, {
            method: 'POST',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${this.cfg.token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            const text = (await res.text().catch(() => '')).slice(0, 300)
            throw new OutlineError(res.status, text || res.statusText)
        }
        return res.json()
    }

    async findByEmail(email: string): Promise<OutlineUser | null> {
        // `filter: 'all'`: по умолчанию список прячет отключённых, а возвращать доступ
        // приходится как раз им.
        const res = (await this.call('users.list', { emails: [email], filter: 'all', limit: 5 })) as {
            data?: { id: string; email?: string; isSuspended?: boolean }[]
        }
        const wanted = email.toLowerCase()
        const found = res.data?.find((u) => (u.email ?? '').toLowerCase() === wanted)
        return found ? { id: found.id, email: found.email ?? '', suspended: found.isSuspended === true } : null
    }

    async suspend(id: string): Promise<void> {
        await this.call('users.suspend', { id })
    }

    async activate(id: string): Promise<void> {
        await this.call('users.activate', { id })
    }
}
