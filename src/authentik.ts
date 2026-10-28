/**
 * Клиент API Authentik для одной задачи - вести аккаунты резидентов.
 *
 * Аккаунт резидента узнаётся по атрибуту `telegram_id`, а не по логину: логин - ник из
 * Telegram, а ник человек меняет, и освободившийся занимает другой. Привязать заведённый
 * аккаунт ко входу через Telegram бот не может: поле `user` у связи с источником в API
 * только для чтения (goauthentik/authentik#25673), а `sub`, по которому источник узнаёт
 * человека, у Telegram не равен его id. Поэтому связывает сам Authentik: у источника
 * режим «Link to a user with identical username», а маппинг подставляет логин аккаунта,
 * найденного по `telegram_id` из подписанного Telegram id_token.
 */

const FETCH_TIMEOUT_MS = 10_000

export type AuthentikConfig = {
    /** Адрес Authentik без хвостового слэша. */
    baseUrl: string
    token: string
    /** Группа, которая открывает резиденту сервисы спейса. */
    group: string
    /** Домен почты новых аккаунтов: Outline без email не пускает, а Telegram его не отдаёт. */
    emailDomain: string
}

export const parseAuthentikConfig = (env: {
    url: string | undefined
    token: string | undefined
    group: string | undefined
    emailDomain: string | undefined
}): AuthentikConfig | null => {
    const rawUrl = env.url?.trim()
    const token = env.token?.trim()
    if (!rawUrl || !token) return null
    const baseUrl = (/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/+$/, '')
    return {
        baseUrl,
        token,
        group: env.group?.trim() || 'Residents',
        emailDomain: env.emailDomain?.trim().replace(/^@/, '') || 'endpoint.moscow',
    }
}

export type AuthentikUser = {
    pk: number
    username: string
    name: string
    email: string
    active: boolean
    /** pk групп (uuid). */
    groups: string[]
    /** Из атрибута `telegram_id`. null - аккаунт не привязан к Telegram этим правилом. */
    telegramId: number | null
}

/** Отказ API: статус и текст ответа, чтобы девам было видно, чего не хватило токену. */
export class AuthentikError extends Error {
    constructor(
        readonly status: number,
        detail: string,
    ) {
        super(`Authentik ${status}: ${detail}`)
    }
}

type RawUser = {
    pk: number
    username: string
    name?: string
    email?: string
    is_active?: boolean
    groups?: string[]
    attributes?: Record<string, unknown>
}

type Page<T> = { pagination?: { next?: number }; results?: T[] }

/** Атрибут бывает и строкой, и числом: руками в YAML его чаще пишут без кавычек. */
const telegramIdOf = (attributes: Record<string, unknown> | undefined): number | null => {
    const raw = attributes?.telegram_id
    const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

const toUser = (u: RawUser): AuthentikUser => ({
    pk: u.pk,
    username: u.username,
    name: u.name ?? '',
    email: u.email ?? '',
    active: u.is_active !== false,
    groups: Array.isArray(u.groups) ? u.groups : [],
    telegramId: telegramIdOf(u.attributes),
})

/** Логин нового аккаунта: ник из Telegram, у кого его нет - `tg<id>`. Строчными: ник в Telegram от регистра не зависит. */
export const loginFor = (telegramId: number, nick: string | null): string => (nick || `tg${telegramId}`).toLowerCase()

export class AuthentikClient {
    /** pk группы ищется по имени один раз: переименование группы требует рестарта. */
    private groupPk: string | null = null

    constructor(private readonly cfg: AuthentikConfig) {}

    /** Личный кабинет: приложения, к которым есть доступ, и настройки аккаунта. */
    get accountUrl(): string {
        return `${this.cfg.baseUrl}/if/user/`
    }

    get groupName(): string {
        return this.cfg.group
    }

    emailFor(login: string): string {
        return `${login}@${this.cfg.emailDomain}`
    }

    private async request(method: string, path: string, body?: unknown): Promise<unknown> {
        const res = await fetch(`${this.cfg.baseUrl}/api/v3/${path}`, {
            method,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${this.cfg.token}`,
                Accept: 'application/json',
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (!res.ok) {
            const text = (await res.text().catch(() => '')).slice(0, 300)
            throw new AuthentikError(res.status, text || res.statusText)
        }
        if (res.status === 204) return null
        const text = await res.text()
        return text ? JSON.parse(text) : null
    }

    private async users(query: string): Promise<AuthentikUser[]> {
        const page = (await this.request('GET', `core/users/?include_groups=false&${query}`)) as Page<RawUser>
        return (page.results ?? []).map(toUser)
    }

    private async resolveGroup(): Promise<string> {
        if (this.groupPk !== null) return this.groupPk
        const page = (await this.request('GET', `core/groups/?name=${encodeURIComponent(this.cfg.group)}&include_users=false`)) as Page<{
            pk: string
        }>
        const pk = page.results?.[0]?.pk
        if (!pk) throw new AuthentikError(404, `группа «${this.cfg.group}» не найдена`)
        this.groupPk = pk
        return pk
    }

    async inGroup(user: AuthentikUser): Promise<boolean> {
        return user.groups.includes(await this.resolveGroup())
    }

    /**
     * Аккаунт резидента. Ответ сверяем сами: фильтр по атрибутам на ошибке разбора отдаёт
     * всех пользователей подряд.
     */
    async findByTelegramId(telegramId: number): Promise<AuthentikUser | null> {
        for (const value of [String(telegramId), telegramId]) {
            const filter = encodeURIComponent(JSON.stringify({ telegram_id: value }))
            const found = (await this.users(`attributes=${filter}`)).find((u) => u.telegramId === telegramId)
            if (found) return found
        }
        return null
    }

    /** Занят ли логин. Без учёта регистра: старые аккаунты Authentik заводил с ником как есть. */
    async loginTaken(login: string): Promise<boolean> {
        const found = await this.users(`search=${encodeURIComponent(login)}&page_size=100`)
        return found.some((u) => u.username.toLowerCase() === login)
    }

    async createUser(input: { username: string; name: string; email: string; telegramId: number }): Promise<AuthentikUser> {
        const group = await this.resolveGroup()
        const created = (await this.request('POST', 'core/users/', {
            username: input.username,
            name: input.name,
            email: input.email,
            is_active: true,
            groups: [group],
            attributes: { telegram_id: String(input.telegramId) },
        })) as RawUser
        return toUser(created)
    }

    /**
     * Выключение аккаунта Authentik доводит сам: тот же вызов удаляет сессии человека
     * (а с ними выходит из приложений с back-channel logout и из прокси-аутпостов), а
     * сигнал на сохранение стирает его OAuth-токены. Приложение со своей сессией узнаёт
     * об этом, когда сверяет токен: Outline - на следующем открытии вики.
     */
    async setActive(pk: number, active: boolean): Promise<void> {
        await this.request('PATCH', `core/users/${pk}/`, { is_active: active })
    }

    async deleteUser(pk: number): Promise<void> {
        await this.request('DELETE', `core/users/${pk}/`)
    }

    async addToGroup(pk: number): Promise<void> {
        await this.request('POST', `core/groups/${await this.resolveGroup()}/add_user/`, { pk })
    }

    async removeFromGroup(pk: number): Promise<void> {
        await this.request('POST', `core/groups/${await this.resolveGroup()}/remove_user/`, { pk })
    }

    /** Все участники группы, включая выключенных: по ним идёт сверка с составом резидентов. */
    async groupMembers(): Promise<AuthentikUser[]> {
        const out: AuthentikUser[] = []
        const name = encodeURIComponent(this.cfg.group)
        for (let page = 1; page > 0; ) {
            const res = (await this.request('GET', `core/users/?groups_by_name=${name}&include_groups=false&page_size=100&page=${page}`)) as Page<RawUser>
            for (const u of res.results ?? []) out.push(toUser(u))
            page = res.pagination?.next ?? 0
        }
        return out
    }
}
