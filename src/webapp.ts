import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TelegramClient } from '@mtcute/node'
import {
    addDaysToKey,
    archiveWeeks,
    buildVisitIcs,
    createHostingRequest,
    deleteHostingRequest,
    HOSTING_DAYS_AHEAD,
    isValidDayKey,
    notifyApproverCancelled,
    notifyGuestApproved,
    notifyGuestUnapproved,
    notifyPrefsFor,
    notifyResidentsAboutRequest,
    requestsForDay,
    todayKey,
    updateHostingRequest,
    weekStartOf,
} from './hosting.js'
import { isValidMac, normalizeMac } from './keenetic.js'
import { ANON_LABEL, removePresence, upsertPresenceListInChat } from './presence.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { HostingRequest, HostingUser } from './types.js'

/** Сколько живёт initData с момента auth_date (защита от реплеев старых подписей). */
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60
const MAX_BODY_BYTES = 64 * 1024

export type WebappConfig = {
    /** Публичный HTTPS-адрес миниаппа (для кнопок и BotFather). Без хвостового слэша. */
    publicUrl: string
    port: number
    host: string
}

export const parseWebappConfig = (env: {
    url: string | undefined
    port: string | undefined
    host: string | undefined
}): WebappConfig | null => {
    const raw = env.url?.trim()
    if (!raw) return null
    const publicUrl = raw.replace(/\/+$/, '')
    const port = Number(env.port ?? '') || 8080
    const host = env.host?.trim() || '0.0.0.0'
    return { publicUrl, port, host }
}

// ---------------------------------------------------------------------------
// Валидация initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// ---------------------------------------------------------------------------

export type WebappUser = HostingUser

/**
 * Проверяет подпись initData миниаппа и возвращает пользователя. null — подпись
 * невалидна/протухла. secret = HMAC_SHA256(botToken, key='WebAppData'),
 * hash = HMAC_SHA256(data_check_string, secret).
 */
export const validateInitData = (initData: string, botToken: string, now: Date = new Date()): WebappUser | null => {
    let params: URLSearchParams
    try {
        params = new URLSearchParams(initData)
    } catch {
        return null
    }
    const hash = params.get('hash')
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null
    params.delete('hash')
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = createHmac('sha256', secret).update(dataCheckString).digest()
    const provided = Buffer.from(hash, 'hex')
    if (computed.length !== provided.length || !timingSafeEqual(computed, provided)) return null

    const authDate = Number(params.get('auth_date'))
    if (!Number.isFinite(authDate) || now.getTime() / 1000 - authDate > INIT_DATA_MAX_AGE_SEC) return null

    const userRaw = params.get('user')
    if (!userRaw) return null
    try {
        const user = JSON.parse(userRaw) as { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
        if (typeof user.id !== 'number' || user.is_bot === true) return null
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || (user.username ?? String(user.id))
        return { userId: user.id, username: user.username ?? null, name }
    } catch {
        return null
    }
}

// ---------------------------------------------------------------------------
// HTTP-сервер: статика миниаппа + JSON API
// ---------------------------------------------------------------------------

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp')

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    })
    res.end(payload)
}

/** Ошибка API с человекочитаемым (русским) текстом — фронт показывает message как есть. */
const sendError = (res: ServerResponse, status: number, error: string, message: string): void =>
    sendJson(res, status, { error, message })

const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_BODY_BYTES) {
                reject(new Error('body too large'))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })

export type WebappDeps = {
    client: TelegramClient
    storage: Storage
    /** Нужен только для рассылки уведомлений (перечисление админов чатов). */
    allowedChats: ReadonlySet<number>
    residents: ResidentDirectory
    botToken: string
    config: WebappConfig
    /** userId дев-аккаунтов (DEV_USER_IDS): дев-меню и переключатель перспективы. */
    devUserIds: ReadonlySet<number>
    tzOffsetMinutes: number
}

type ApiContext = WebappDeps & {
    user: WebappUser
    resident: boolean
    body: Record<string, unknown>
    res: ServerResponse
}

const requestsView = (list: HostingRequest[]) =>
    list.map((r) => ({
        id: r.id,
        dateKey: r.dateKey,
        time: r.time,
        purpose: r.purpose,
        status: r.status,
        createdAt: r.createdAt,
        guest: r.guest,
        approvedBy: r.approvedBy,
    }))

/** Дев-аккаунт из DEV_USER_IDS: переключатель перспективы и сид фейковых заявок. */
const isDevUser = (ctx: ApiContext): boolean => ctx.devUserIds.has(ctx.user.userId)

/**
 * Фейковый гость для дев-заявок. userId отрицательный — так он гарантированно не
 * столкнётся с реальным Telegram-id (те всегда положительные), а рассылка/уведомления
 * такому «гостю» просто молча не доедут (sendText обёрнут в try/catch).
 */
const makeFakeGuest = (): HostingUser => {
    const names = ['Тестовый Гость', 'Гриша Тестов', 'Аня Пробная', 'Пётр Фейков', 'Лена Черновик']
    const n = Math.floor(Math.random() * names.length)
    return {
        userId: -(1_000_000 + Math.floor(Math.random() * 1_000_000)),
        username: null,
        name: names[n] ?? 'Тестовый Гость',
    }
}

/** Общий снапшот для фронта: 7 дней обзора, свои заявки, настройки (резиденту). */
const buildBootstrap = (ctx: ApiContext) => {
    const { storage, tzOffsetMinutes, user, resident } = ctx
    const today = todayKey(tzOffsetMinutes)
    const days = []
    for (let i = 0; i < HOSTING_DAYS_AHEAD; i++) {
        const dateKey = addDaysToKey(today, i)
        const requests = requestsForDay(storage, dateKey)
        days.push({
            dateKey,
            total: requests.length,
            approved: requests.filter((r) => r.status === 'approved').length,
            // Детали заявок видят резиденты и dev-аккаунты (последним они нужны для
            // дев-меню — правка и удаление). Гостям — только счётчики.
            ...(resident || isDevUser(ctx) ? { requests: requestsView(requests) } : {}),
        })
    }
    const myRequests = Object.values(storage.get().hostingRequests)
        .filter((r) => r.guest.userId === user.userId && r.dateKey >= today)
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))

    const binding = storage.get().macBindings[String(user.userId)]
    const settings = resident
        ? {
            notify: notifyPrefsFor(storage, user.userId),
            macs: binding ? [...binding.macs].sort((a, b) => a.mac.localeCompare(b.mac)) : [],
            macAnon: binding?.anon ?? false,
            macPresenceActive: storage.get().presence[String(user.userId)]?.source === 'mac',
        }
        : null

    return {
        me: {
            id: user.userId,
            username: user.username,
            name: user.name,
            isResident: resident,
            isDev: isDevUser(ctx),
        },
        todayKey: today,
        days,
        myRequests: requestsView(myRequests),
        settings,
    }
}

const handleApi = async (ctx: ApiContext, method: string): Promise<void> => {
    const { client, storage, allowedChats, residents, tzOffsetMinutes, config, user, resident, body, res } = ctx

    const requireResident = (): boolean => {
        if (!resident) sendError(res, 403, 'not_resident', 'Доступно только резидентам.')
        return resident
    }
    const requireDev = (): boolean => {
        const dev = isDevUser(ctx)
        if (!dev) sendError(res, 403, 'not_dev', 'Доступно только dev-аккаунтам из DEV_USER_IDS.')
        return dev
    }
    const findRequest = (): HostingRequest | null => {
        const id = typeof body.id === 'string' ? body.id : ''
        const request = storage.get().hostingRequests[id]
        if (!request) sendError(res, 404, 'not_found', 'Заявка не найдена — возможно, её уже отменили.')
        return request ?? null
    }

    switch (method) {
        case 'bootstrap': {
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'create': {
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const time = typeof body.time === 'string' ? body.time : ''
            const purpose = typeof body.purpose === 'string' ? body.purpose : ''
            const created = await createHostingRequest(storage, tzOffsetMinutes, { guest: user, dateKey, time, purpose })
            if (!created.ok) {
                const messages = {
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время прихода в формате ЧЧ:ММ.',
                    duplicate: 'У тебя уже есть заявка на этот день.',
                } as const
                sendError(res, 400, created.error, messages[created.error])
                return
            }
            // Рассылка резидентам — в фоне, чтобы не держать ответ гостю.
            void notifyResidentsAboutRequest(client, storage, allowedChats, tzOffsetMinutes, config.publicUrl, created.request)
                .catch((err) => console.error('[hosting] не удалось разослать уведомления о заявке:', err))
            sendJson(res, 200, { request: requestsView([created.request])[0], ...buildBootstrap(ctx) })
            return
        }

        // Дев-сид: заявка от фейкового гостя на произвольный день/время из ближайших 7.
        // Резидентов не уведомляем — это тестовые данные, а не реальный визит.
        case 'dev.seed': {
            if (!requireDev()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const time = typeof body.time === 'string' ? body.time : ''
            const purpose = typeof body.purpose === 'string' && body.purpose.trim()
                ? body.purpose
                : 'Фейковая заявка (dev)'
            const created = await createHostingRequest(storage, tzOffsetMinutes, {
                guest: makeFakeGuest(),
                dateKey,
                time,
                purpose,
            })
            if (!created.ok) {
                const messages = {
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время в формате ЧЧ:ММ.',
                    duplicate: 'У этого фейкового гостя уже есть заявка на день.',
                } as const
                sendError(res, 400, created.error, messages[created.error])
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Дев-правка чужой заявки: день/время/цель. Гостя не трогаем и не уведомляем —
        // инструмент для отладки, а не пользовательский поток.
        case 'dev.update': {
            if (!requireDev()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const time = typeof body.time === 'string' ? body.time : ''
            const purpose = typeof body.purpose === 'string' ? body.purpose : ''
            const updated = await updateHostingRequest(storage, tzOffsetMinutes, id, { dateKey, time, purpose })
            if (!updated.ok) {
                const messages = {
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время в формате ЧЧ:ММ.',
                    not_found: 'Заявка не найдена — возможно, её уже удалили.',
                } as const
                sendError(res, updated.error === 'not_found' ? 404 : 400, updated.error, messages[updated.error])
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'dev.delete': {
            if (!requireDev()) return
            const id = typeof body.id === 'string' ? body.id : ''
            if (!(await deleteHostingRequest(storage, id))) {
                sendError(res, 404, 'not_found', 'Заявка не найдена — возможно, её уже удалили.')
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'approve': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            if (request.status === 'approved' && request.approvedBy) {
                const label = request.approvedBy.username ? `@${request.approvedBy.username}` : request.approvedBy.name
                sendError(res, 409, 'already_approved', `Уже захостил ${label}.`)
                return
            }
            await storage.update((s) => {
                const r = s.hostingRequests[request.id]
                if (r) {
                    r.status = 'approved'
                    r.approvedBy = user
                    r.approvedAt = new Date().toISOString()
                }
            })
            const updated = storage.get().hostingRequests[request.id]
            if (updated) {
                void notifyGuestApproved(client, config.publicUrl, updated)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя об одобрении:', err))
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'unapprove': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            if (request.status !== 'approved' || !request.approvedBy) {
                sendError(res, 409, 'not_approved', 'Заявка и так ждёт ответа.')
                return
            }
            if (request.approvedBy.userId !== user.userId) {
                sendError(res, 403, 'not_yours', 'Отменить хостинг может только тот, кто его одобрил.')
                return
            }
            await storage.update((s) => {
                const r = s.hostingRequests[request.id]
                if (r) {
                    r.status = 'pending'
                    r.approvedBy = null
                    r.approvedAt = null
                }
            })
            const updated = storage.get().hostingRequests[request.id]
            if (updated) {
                void notifyGuestUnapproved(client, config.publicUrl, updated)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя об отмене хостинга:', err))
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'cancel': {
            const request = findRequest()
            if (!request) return
            if (request.guest.userId !== user.userId) {
                sendError(res, 403, 'not_yours', 'Отменить можно только свою заявку.')
                return
            }
            await storage.update((s) => {
                delete s.hostingRequests[request.id]
            })
            if (request.status === 'approved') {
                void notifyApproverCancelled(client, request)
                    .catch((err) => console.error('[hosting] не удалось уведомить резидента об отмене визита:', err))
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'notify': {
            if (!requireResident()) return
            const enabled = body.enabled === true
            const mode = body.mode === 'all' ? 'all' : 'today'
            await storage.update((s) => {
                s.hostingNotify[String(user.userId)] = { enabled, mode }
            })
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'mac.add': {
            if (!requireResident()) return
            const rawMac = typeof body.mac === 'string' ? body.mac : ''
            const label = (typeof body.label === 'string' ? body.label : '').trim().slice(0, 50)
            if (!isValidMac(rawMac)) {
                sendError(res, 400, 'invalid_mac', 'Это не похоже на MAC-адрес. Формат: AA:BB:CC:DD:EE:FF.')
                return
            }
            const mac = normalizeMac(rawMac)
            const owner = Object.values(storage.get().macBindings).find(
                (b) => b.userId !== user.userId && b.macs.some((e) => e.mac === mac),
            )
            if (owner) {
                sendError(res, 409, 'taken', 'Этот MAC уже привязан к другому резиденту.')
                return
            }
            if (storage.get().macBindings[String(user.userId)]?.macs.some((e) => e.mac === mac)) {
                sendError(res, 409, 'duplicate', 'Этот MAC уже привязан к тебе.')
                return
            }
            await storage.update((s) => {
                const now = new Date().toISOString()
                const cur = s.macBindings[String(user.userId)]
                if (cur) {
                    cur.macs.push({ mac, label })
                    cur.username = user.username
                    cur.updatedAt = now
                } else {
                    s.macBindings[String(user.userId)] = {
                        userId: user.userId,
                        username: user.username,
                        macs: [{ mac, label }],
                        anon: false,
                        updatedAt: now,
                    }
                }
            })
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'mac.remove': {
            if (!requireResident()) return
            const rawMac = typeof body.mac === 'string' ? body.mac : ''
            const mac = normalizeMac(rawMac)
            const cur = storage.get().macBindings[String(user.userId)]
            if (!cur || !cur.macs.some((e) => e.mac === mac)) {
                sendError(res, 404, 'not_found', 'Такой MAC к тебе не привязан.')
                return
            }
            let leftEmpty = false
            await storage.update((s) => {
                const b = s.macBindings[String(user.userId)]
                if (!b) return
                b.macs = b.macs.filter((e) => e.mac !== mac)
                b.updatedAt = new Date().toISOString()
                if (b.macs.length === 0) {
                    delete s.macBindings[String(user.userId)]
                    leftEmpty = true
                }
            })
            // Как и в /unbindmac: убрали последний MAC при активной авто-отметке — снимаем её.
            if (leftEmpty && storage.get().presence[String(user.userId)]?.source === 'mac') {
                await removePresence(client, storage, residents, user.userId, 'manual')
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'mac.anon': {
            if (!requireResident()) return
            const anon = body.anon === true
            if (!storage.get().macBindings[String(user.userId)]) {
                sendError(res, 400, 'no_macs', 'Сначала привяжи хотя бы один MAC.')
                return
            }
            await storage.update((s) => {
                const b = s.macBindings[String(user.userId)]
                if (b) {
                    b.anon = anon
                    b.updatedAt = new Date().toISOString()
                }
            })
            // Зеркалим поведение /settings: активную MAC-отметку переключаем на лету.
            if (storage.get().presence[String(user.userId)]?.source === 'mac') {
                await storage.update((s) => {
                    const p = s.presence[String(user.userId)]
                    if (p) {
                        const username = s.macBindings[String(user.userId)]?.username ?? null
                        p.displayLabel = anon ? ANON_LABEL : (username ? `@${username}` : ANON_LABEL)
                        p.username = anon ? null : username
                    }
                })
                for (const chatId of await residents.presenceChats(user.userId)) {
                    await upsertPresenceListInChat(client, storage, chatId)
                }
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'archive': {
            if (!requireResident()) return
            sendJson(res, 200, { weeks: archiveWeeks(storage, tzOffsetMinutes) })
            return
        }

        case 'archive.week': {
            if (!requireResident()) return
            const weekStart = typeof body.weekStart === 'string' ? body.weekStart : ''
            const currentWeek = weekStartOf(todayKey(tzOffsetMinutes))
            if (!isValidDayKey(weekStart) || weekStartOf(weekStart) !== weekStart || weekStart >= currentWeek) {
                sendError(res, 400, 'bad_week', 'Неделя недоступна в архиве.')
                return
            }
            const days = []
            for (let i = 0; i < 7; i++) {
                const dateKey = addDaysToKey(weekStart, i)
                days.push({ dateKey, requests: requestsView(requestsForDay(storage, dateKey)) })
            }
            sendJson(res, 200, { weekStart, days })
            return
        }

        default:
            sendError(res, 404, 'unknown_method', 'Неизвестный метод API.')
    }
}

const serveStatic = async (pathname: string, res: ServerResponse): Promise<void> => {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const target = path.normalize(path.join(STATIC_DIR, rel))
    if (!target.startsWith(STATIC_DIR + path.sep) && target !== path.join(STATIC_DIR, 'index.html')) {
        res.writeHead(403).end('forbidden')
        return
    }
    try {
        const data = await fs.readFile(target)
        const ext = path.extname(target).toLowerCase()
        res.writeHead(200, {
            'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
            // Телеграм-webview агрессивно кэширует; статика мелкая — отдаём без кэша,
            // чтобы после деплоя не ловить смесь старого JS и нового API.
            'Cache-Control': 'no-store',
        })
        res.end(data)
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
    }
}

/** Поднимает HTTP-сервер миниаппа. Останавливать через .stop(). */
export const startWebappServer = (deps: WebappDeps): { server: Server; stop: () => void } => {
    const server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const pathname = url.pathname

            if (pathname === '/healthz') {
                res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
                return
            }

            // Файл календаря отдаём отдельным GET-путём (не под /api/, там только POST):
            // ссылку открывает системный браузер, поэтому initData едет в query, а не в
            // теле. Подпись и срок жизни проверяем ровно так же, как в API.
            if (pathname === '/visit.ics') {
                if (req.method !== 'GET') {
                    res.writeHead(405).end()
                    return
                }
                const user = validateInitData(url.searchParams.get('initData') ?? '', deps.botToken)
                if (!user) {
                    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
                        .end('Ссылка устарела — открой миниапп заново.')
                    return
                }
                const request = deps.storage.get().hostingRequests[url.searchParams.get('id') ?? '']
                // Только свой визит: в файле цель визита и кто хостит.
                if (!request || request.guest.userId !== user.userId) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Заявка не найдена.')
                    return
                }
                res.writeHead(200, {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="visit.ics"',
                    'Cache-Control': 'no-store',
                }).end(buildVisitIcs(request, deps.tzOffsetMinutes))
                return
            }

            if (pathname.startsWith('/api/')) {
                if (req.method !== 'POST') {
                    sendError(res, 405, 'method_not_allowed', 'Только POST.')
                    return
                }
                let body: Record<string, unknown>
                try {
                    const raw = await readBody(req)
                    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
                } catch {
                    sendError(res, 400, 'bad_json', 'Некорректное тело запроса.')
                    return
                }
                const initData = typeof body.initData === 'string' ? body.initData : ''
                const user = validateInitData(initData, deps.botToken)
                if (!user) {
                    sendError(res, 401, 'bad_init_data', 'Открой миниапп заново — сессия устарела.')
                    return
                }
                const resident = await deps.residents.isResident(user.userId)
                const method = pathname.slice('/api/'.length).replace(/\/+$/, '').replaceAll('/', '.')
                await handleApi({ ...deps, user, resident, body, res }, method)
                return
            }

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405).end()
                return
            }
            await serveStatic(pathname, res)
        })().catch((err) => {
            console.error('[webapp] ошибка обработки запроса:', err)
            if (!res.headersSent) sendError(res, 500, 'internal', 'Внутренняя ошибка сервера.')
            else res.end()
        })
    })
    server.listen(deps.config.port, deps.config.host, () => {
        console.log(`[webapp] miniapp server on http://${deps.config.host}:${deps.config.port} (public: ${deps.config.publicUrl})`)
        console.log(`[webapp] dev-аккаунты (DEV_USER_IDS): ${deps.devUserIds.size > 0 ? [...deps.devUserIds].join(', ') : '— пусто, дев-меню и переключателя перспективы не будет'}`)
    })
    return { server, stop: () => server.close() }
}
