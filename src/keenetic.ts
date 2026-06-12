import { createHash } from 'node:crypto'

/**
 * Минимальный клиент RCI-API Keenetic для одной задачи — получить список
 * MAC-адресов устройств, которые сейчас активны (онлайн) в сети.
 *
 * Авторизация — фирменная схема challenge-response Keenetic:
 *  1. GET /auth → 401 с заголовками `X-NDM-Realm` и `X-NDM-Challenge`, в ответе ставится session-cookie.
 *  2. md5 = MD5(`login:realm:password`), затем sha = SHA256(`challenge + md5`).
 *  3. POST /auth `{ login, password: sha }` с той же cookie → 200 = успех.
 *  4. Дальнейшие /rci/* запросы идут с той же session-cookie.
 *
 * Сессия живёт в cookie; при 401 повторно проходим auth. Cookie держим в памяти инстанса.
 */

const FETCH_TIMEOUT_MS = 8000

export type KeeneticConfig = {
    /** Базовый URL панели, без хвостового слэша. */
    baseUrl: string
    login: string
    password: string
    /** Путь RCI-команды, отдающей список хостов. По умолчанию `show/ip/hotspot`. */
    rciDevicePath: string
}

export const parseKeeneticConfig = (env: {
    url: string | undefined
    login: string | undefined
    password: string | undefined
    rciPath: string | undefined
}): KeeneticConfig | null => {
    const rawUrl = env.url?.trim()
    const login = env.login?.trim()
    const password = env.password
    if (!rawUrl || !login || !password) return null
    let baseUrl = rawUrl
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`
    baseUrl = baseUrl.replace(/\/+$/, '')
    const rciDevicePath = (env.rciPath?.trim() || 'show/ip/hotspot').replace(/^\/+|\/+$/g, '')
    return { baseUrl, login, password, rciDevicePath }
}

const md5Hex = (s: string): string => createHash('md5').update(s).digest('hex')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

export class KeeneticClient {
    /** Текущая session-cookie (значение заголовка Cookie), либо null если ещё не авторизованы. */
    private cookie: string | null = null

    constructor(private readonly cfg: KeeneticConfig) {}

    private url(path: string): string {
        return `${this.cfg.baseUrl}/${path.replace(/^\/+/, '')}`
    }

    private cookieHeader(): Record<string, string> {
        return this.cookie ? { Cookie: this.cookie } : {}
    }

    /** Запоминает session-cookie из ответа (если сервер прислал Set-Cookie). */
    private rememberCookie(res: Response): void {
        const setCookie = res.headers.get('set-cookie')
        if (!setCookie) return
        // Берём только пару name=value до первой `;` — атрибуты (Path, HttpOnly) не нужны.
        const pair = setCookie.split(';', 1)[0]
        if (pair) this.cookie = pair
    }

    /** Проходит challenge-response авторизацию. Бросает, если не удалось. */
    private async authenticate(): Promise<void> {
        const authUrl = this.url('auth')
        const probe = await fetch(authUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: this.cookieHeader(),
        })
        this.rememberCookie(probe)
        // Уже авторизованы (cookie ещё жива) — 200 на GET /auth.
        if (probe.status === 200) return
        if (probe.status !== 401) {
            throw new Error(`Keenetic auth: неожиданный статус ${probe.status}`)
        }
        const realm = probe.headers.get('x-ndm-realm')
        const challenge = probe.headers.get('x-ndm-challenge')
        if (!realm || !challenge) {
            throw new Error('Keenetic auth: нет заголовков X-NDM-Realm/Challenge (KeenDNS не поддерживается, нужен локальный адрес)')
        }
        const md5 = md5Hex(`${this.cfg.login}:${realm}:${this.cfg.password}`)
        const password = sha256Hex(`${challenge}${md5}`)
        const res = await fetch(authUrl, {
            method: 'POST',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json', ...this.cookieHeader() },
            body: JSON.stringify({ login: this.cfg.login, password }),
        })
        this.rememberCookie(res)
        if (res.status !== 200) {
            throw new Error(`Keenetic auth: вход не удался (статус ${res.status})`)
        }
    }

    /** GET по RCI-пути с авто-переавторизацией при 401. */
    private async rciGet(path: string): Promise<unknown> {
        if (this.cookie === null) await this.authenticate()
        let res = await fetch(this.url(`rci/${path}`), {
            method: 'GET',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: this.cookieHeader(),
        })
        if (res.status === 401) {
            // cookie протухла — переавторизуемся и повторяем один раз.
            this.cookie = null
            await this.authenticate()
            res = await fetch(this.url(`rci/${path}`), {
                method: 'GET',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: this.cookieHeader(),
            })
        }
        if (!res.ok) throw new Error(`Keenetic RCI ${path}: статус ${res.status}`)
        return res.json()
    }

    /**
     * Возвращает множество MAC-адресов (lower-case, разделитель `:`) устройств,
     * которые сейчас активны в сети. Опирается на поле `active` в ответе hotspot.
     */
    async fetchActiveMacs(): Promise<Set<string>> {
        const data = (await this.rciGet(this.cfg.rciDevicePath)) as {
            host?: { mac?: string; active?: boolean; link?: string }[]
        }
        const hosts = Array.isArray(data.host) ? data.host : []
        const out = new Set<string>()
        for (const h of hosts) {
            if (!h.mac) continue
            // `active` — основной признак; некоторые прошивки отдают link === 'up'.
            const online = h.active === true || h.link === 'up'
            if (online) out.add(normalizeMac(h.mac))
        }
        return out
    }
}

/** Приводит MAC к каноничному виду: lower-case, разделитель `:`. Возвращает '' для мусора. */
export const normalizeMac = (raw: string): string => {
    const hex = raw.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
    if (hex.length !== 12) return ''
    return hex.match(/.{2}/g)!.join(':')
}

/** Валиден ли MAC после нормализации. */
export const isValidMac = (raw: string): boolean => normalizeMac(raw) !== ''
