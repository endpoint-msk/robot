import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { html, InputMedia, type TelegramClient } from '@mtcute/node'
import {
    acceptReschedule,
    acceptRules,
    addDaysToKey,
    archiveWeeks,
    attendeesForDay,
    blockUser,
    buildVisitIcs,
    cleanName,
    clearReschedule,
    createHostingRequest,
    deleteHostingRequest,
    displayName,
    editHostingRequest,
    hasAcceptedRules,
    HOSTING_DAYS_AHEAD,
    isBlocked,
    isFakeUserId,
    isValidDayKey,
    listBlockedUsers,
    listGuestNotes,
    MAX_NOTE_LENGTH,
    nowTimeKey,
    notifyApproverCancelled,
    notifyGuestApproved,
    notifyGuestClosed,
    notifyGuestUnapproved,
    notifyGuestReschedule,
    notifyPrefsFor,
    notifyProposalAccepted,
    notifyProposalCancelled,
    notifyProposalDroppedByEdit,
    notifyResidentsAboutRequest,
    notifyResidentRescheduleCountered,
    proposeReschedule,
    requestsForDay,
    requestsOfGuest,
    searchGuests,
    setGuestNote,
    setResidentAttendance,
    todayKey,
    unblockUser,
    updateHostingRequest,
    weekStartOf,
} from './hosting.js'
import { listInviteCandidates, sendHostingInvite } from './hosting-invite.js'
import {
    canEditEvent,
    clearEventDraft,
    createEvent,
    deleteEvent,
    draftPhotoId,
    eventDraftFor,
    eventForPhoto,
    eventNotifyPrefsFor,
    eventPhotoIds,
    eventsForDay,
    isStagedPhotoOf,
    notifyResidentsAboutEvent,
    MAX_EVENT_PHOTO_BYTES,
    MAX_EVENT_PHOTOS,
    readEventPhoto,
    saveEventPhoto,
    stagedPhotoId,
    syncEventPhotos,
    updateEvent,
    type EventError,
    type EventInput,
} from './events.js'
import { syncHostingBoard } from './hosting-board.js'
import {
    activeDuesPeriod,
    buildDuesCsv,
    claimDues,
    clearDuesMark,
    confirmDues,
    duesOf,
    duesPeriodLabel,
    duesRows,
    isPaid,
    MAX_DUES_DAY,
    MIN_DUES_DAY,
    missedPeriods,
    notifyDevsAboutClaim,
    periodKeysOf,
    rateFor,
    setDuesNotify,
    setDuesRate,
    syncDuesRoster,
    updateDuesSettings,
} from './dues.js'
import { announceTargets, broadcastAnnouncement, buildDefaultAnnouncement, fetchLatestRelease } from './announce.js'
import { isValidMac, normalizeMac } from './keenetic.js'
import { currentPeriodLabel, periodKeyOf, renderBoardExport, type BoardRequest, type BoardRequests } from './fundraiser.js'
import { ANON_LABEL, removePresence } from './presence.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { HostingRequest, HostingUser, RescheduleProposal, SpaceEvent } from './types.js'

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
        // Имя чистим от невидимых символов сразу на входе: имя из одних zero-width/юникод-пробелов
        // выглядит в любом списке как пустое место. Не осталось ничего — берём ник, потом id.
        const name = cleanName([user.first_name, user.last_name].filter(Boolean).join(' ')) || (user.username ?? String(user.id))
        return { userId: user.id, username: user.username ?? null, name }
    } catch {
        return null
    }
}

// ---------------------------------------------------------------------------
// HTTP-сервер: статика миниаппа + JSON API
// ---------------------------------------------------------------------------

// Миниапп теперь React + Vite: сервер раздаёт готовую сборку из webapp/dist
// (`npm --prefix webapp run build`), а не сырые исходники.
const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp', 'dist')

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    // Фото двери и иконки метро на экране «Как пройти» лежат в webapp/public.
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
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
                // Не рвём сокет: он общий с ответом, иначе 413 не дойдёт до клиента.
                // Останавливаем чтение и отдаём тегированную ошибку — 413 шлёт вызывающий.
                req.pause()
                reject(Object.assign(new Error('body too large'), { code: 'body_too_large' }))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })

/** Тело-картинка: свой потолок, тот же приём с `pause()`, что и у `readBody`. */
const readBinaryBody = (req: IncomingMessage, maxBytes: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) {
                req.pause()
                reject(Object.assign(new Error('body too large'), { code: 'body_too_large' }))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
    })

/**
 * JPEG ли это. Файлы афиш лежат на том же origin, что и миниапп, и отдаются с
 * `image/jpeg` — пустить туда произвольные байты (SVG, HTML) значит пустить чужой
 * скрипт в своё же происхождение. Редактор шлёт результат canvas, так что проверка
 * магии ничего рабочего не отсекает.
 */
const isJpeg = (bytes: Buffer): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

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
    /** GitHub-репо 'owner/name' для чтения релизов в дев-анонсах. */
    githubRepo: string
    /** Токен табло донатов (BOARD_TOKEN). null — ручка GET /board выключена. */
    boardToken: string | null
}

type ApiContext = WebappDeps & {
    user: WebappUser
    resident: boolean
    body: Record<string, unknown>
    res: ServerResponse
}

/** Потолок реестра «кого бот уже показывал»: людей вокруг спейса на порядки меньше. */
const DISCLOSED_LIMIT = 5000

/**
 * userId, которых сервер сам отдал клиенту в каком-либо ответе.
 *
 * Это whitelist для `/avatar.jpg`: аватарку можно попросить только у того, кого бот
 * и так назвал. Без него `id` в query не сверялся ни с чем, и перебор диапазона
 * заставлял бота дёргать `getUsers` + `downloadAsBuffer` на каждый холодный id —
 * то есть усилитель флуда в Telegram поверх общего mtcute-клиента.
 *
 * Реестр в памяти и переживает только процесс: после рестарта он наполнится заново
 * первым же bootstrap'ом, а до тех пор фронт покажет градиентную заглушку с буквой.
 */
const disclosedUserIds = new Set<number>()

const discloseUser = (userId: number): void => {
    if (!Number.isSafeInteger(userId) || userId <= 0) return
    if (disclosedUserIds.has(userId)) return
    // Set перебирается в порядке вставки, поэтому первый ключ — самый старый.
    if (disclosedUserIds.size >= DISCLOSED_LIMIT) {
        const oldest = disclosedUserIds.values().next().value
        if (oldest !== undefined) disclosedUserIds.delete(oldest)
    }
    disclosedUserIds.add(userId)
}

/**
 * Имена чистим на выдаче, а не только на входе (см. cleanName в validateInitData):
 * в стейте лежат заявки, заведённые до этой чистки, — иначе гость с именем из невидимых
 * символов так и останется пустой строкой в списке.
 *
 * Заодно это единственная воронка карточек участников наружу, поэтому тут же
 * отмечаем id как «показанный» (см. `disclosedUserIds`).
 */
const userView = <T extends { userId: number; name: string }>(u: T): T => {
    discloseUser(u.userId)
    return { ...u, name: displayName(u.name) }
}

const requestsView = (list: HostingRequest[]) =>
    list.map((r) => ({
        id: r.id,
        dateKey: r.dateKey,
        time: r.time,
        purpose: r.purpose,
        status: r.status,
        createdAt: r.createdAt,
        guest: userView(r.guest),
        approvedBy: r.approvedBy ? userView(r.approvedBy) : null,
        proposal: r.proposal ? { ...r.proposal, user: userView(r.proposal.user) } : null,
        anon: r.anon === true,
    }))

/**
 * Стороны переговоров о переносе: кто предложил и кому.
 *
 * Принять предложение вправе только адресат, снять — адресат (отказ) или автор (отзыв).
 * До появления `proposal.to` адресат со стороны резидентов выводился из `approvedBy`,
 * которого у pending-заявки нет, — и в чужие переговоры влезал любой резидент.
 * Для старых записей без `to` оставлено прежнее поведение.
 */
const proposalSides = (
    request: HostingRequest,
    proposal: RescheduleProposal,
    userId: number,
    isResident: boolean,
): { isAuthor: boolean; isAddressee: boolean; counterpartId: number | null } => {
    const isGuest = request.guest.userId === userId
    const isAuthor = proposal.user.userId === userId
    const addressee = proposal.to ?? null
    const isAddressee = proposal.by === 'resident'
        ? isGuest
        : addressee
            ? addressee.userId === userId
            : !isGuest && isResident && (!request.approvedBy || request.approvedBy.userId === userId)
    const counterpartId = isAuthor
        ? addressee?.userId ?? (proposal.by === 'resident' ? request.guest.userId : request.approvedBy?.userId ?? null)
        : proposal.user.userId
    return { isAuthor, isAddressee, counterpartId }
}

/**
 * Карточка ивента для фронта: имя автора чистим тем же `userView`, что и остальных,
 * а афиши отдаём готовым списком — легаси-флаг `hasPhoto` фронт знать не должен.
 */
const eventView = (e: SpaceEvent) => ({ ...e, photos: eventPhotoIds(e), host: userView(e.host) })

const EVENT_ERRORS: Record<EventError, string> = {
    not_found: 'Ивент не найден — обнови экран.',
    bad_date: 'Выбери день в пределах ближайшей недели.',
    bad_time: 'Укажи время в формате ЧЧ:ММ.',
    past_time: 'Это время уже прошло.',
    bad_title: 'Без названия ивент не понять — впиши его.',
    not_yours: 'Править ивент может тот, кто его завёл.',
}

/** Список афиш из тела: редактор присылает желаемый порядок целиком (см. `syncEventPhotos`). */
const photosFrom = (body: Record<string, unknown>): string[] =>
    Array.isArray(body.photos)
        ? body.photos.filter((id): id is string => typeof id === 'string').slice(0, MAX_EVENT_PHOTOS)
        : []

const eventInputFrom = (body: Record<string, unknown>): EventInput => ({
    dateKey: typeof body.dateKey === 'string' ? body.dateKey : '',
    time: typeof body.time === 'string' ? body.time : '',
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : '',
    residentsOnly: body.residentsOnly === true,
})

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

/**
 * Снимок взносов за период (по умолчанию активный). null — подсистема выключена или
 * сборов ещё не было. Отдаётся только резидентам: кто сколько должен, это не витрина.
 */
const duesSnapshot = (ctx: ApiContext, periodKey?: string) => {
    const { storage, user } = ctx
    const dues = duesOf(storage)
    const dev = isDevUser(ctx)
    const period = periodKey ? dues.periods[periodKey] : activeDuesPeriod(dues)
    // Выключенный сбор (и включённый, но ещё без периодов) для обычного резидента
    // это пустое место, а dev'у нужен вход в настройки — иначе, выключив сбор, он
    // остался бы без способа включить его обратно.
    if ((!dues.enabled || !period) && !dev) return null
    if (!period) {
        return {
            enabled: dues.enabled,
            periodKey: '',
            periodLabel: '',
            isCurrent: true,
            day: dues.day,
            amount: dues.amount,
            studentAmount: dues.studentAmount,
            currency: dues.currency,
            requisites: dues.requisites,
            canEdit: dev,
            notify: !dues.notifyOff[String(user.userId)],
            me: { inRoster: false, amount: rateFor(dues, user.userId), status: 'none' as const, at: null },
            summary: { total: 0, paid: 0, claimed: 0, collected: 0, expected: 0 },
            rows: [],
        }
    }
    const keys = periodKeysOf(dues)
    const rows = duesRows(dues, period).map((row) => {
        const confirmedBy = row.mark?.by !== null && row.mark?.by !== undefined
            ? period.roster[String(row.mark.by)] ?? null
            : null
        discloseUser(row.member.userId)
        return {
            userId: row.member.userId,
            username: row.member.username,
            name: displayName(row.member.name),
            amount: row.member.amount,
            status: (isPaid(row.mark) ? 'paid' : row.mark ? 'claimed' : 'none') as 'paid' | 'claimed' | 'none',
            at: row.mark?.paidAt ?? row.mark?.claimedAt ?? null,
            by: confirmedBy ? { username: confirmedBy.username, name: displayName(confirmedBy.name) } : null,
            missed: row.missed.length,
            rate: (dues.rates[String(row.member.userId)] === 'student'
                ? 'student'
                : typeof dues.rates[String(row.member.userId)] === 'number'
                    ? 'custom'
                    : 'common') as 'student' | 'custom' | 'common',
        }
    })
    const paid = rows.filter((r) => r.status === 'paid')
    const mine = period.marks[String(user.userId)]
    return {
        enabled: dues.enabled,
        periodKey: period.periodKey,
        periodLabel: duesPeriodLabel(period.periodKey),
        // Прошлый период открывается из истории: отмечать в нём можно, но подписи другие.
        isCurrent: period.periodKey === keys[keys.length - 1],
        day: dues.day,
        amount: dues.amount,
        studentAmount: dues.studentAmount,
        currency: dues.currency,
        requisites: dues.requisites,
        canEdit: isDevUser(ctx),
        notify: !dues.notifyOff[String(user.userId)],
        me: {
            inRoster: Boolean(period.roster[String(user.userId)]),
            amount: period.roster[String(user.userId)]?.amount ?? rateFor(dues, user.userId),
            status: (isPaid(mine) ? 'paid' : mine ? 'claimed' : 'none') as 'paid' | 'claimed' | 'none',
            at: mine?.paidAt ?? mine?.claimedAt ?? null,
        },
        summary: {
            // Освобождённые (ставка 0) в счётчик «внесли N из M» не попадают: спрашивать
            // с них нечего, а в знаменателе они портили бы картину собираемости.
            total: rows.filter((r) => r.amount > 0).length,
            paid: paid.filter((r) => r.amount > 0).length,
            claimed: rows.filter((r) => r.status === 'claimed' && r.amount > 0).length,
            collected: paid.reduce((sum, r) => sum + r.amount, 0),
            expected: rows.reduce((sum, r) => sum + r.amount, 0),
        },
        rows,
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
            // Публичный список «кто придёт» — виден всем.
            attendees: attendeesForDay(storage, dateKey).map(userView),
            // Ивенты дня: гостю — только открытые, резиденту — все.
            events: eventsForDay(storage, dateKey, resident).map(eventView),
        })
    }
    const myRequests = Object.values(storage.get().hostingRequests)
        .filter((r) => r.guest.userId === user.userId && r.dateKey >= today)
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))

    const binding = storage.get().macBindings[String(user.userId)]
    const settings = resident
        ? {
            notify: notifyPrefsFor(storage, user.userId),
            eventNotify: eventNotifyPrefsFor(storage, user.userId),
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
            // Правила спейса гость принимает один раз, перед первой заявкой (см. `rules.accept`).
            acceptedRules: hasAcceptedRules(storage, user.userId),
        },
        todayKey: today,
        nowTime: nowTimeKey(tzOffsetMinutes),
        days,
        myRequests: requestsView(myRequests),
        settings,
        // Заметки о гостях — общая память резидентов, гостю их не показываем (в т.ч.
        // заметку о нём самом). Отдаём разом все: их единицы, а строка заявки с иконкой
        // «есть заметка» встречается и в архиве, который грузится отдельным запросом.
        ...(resident ? { notes: listGuestNotes(storage).map((n) => ({ ...n, by: userView(n.by) })) } : {}),
        // Список заблокированных с разблокировкой — только в дев-меню.
        ...(isDevUser(ctx) ? { blocked: listBlockedUsers(storage).map(userView) } : {}),
        // Заготовка ивента из пересланного поста канала: миниапп открывает по ней
        // редактор, если пришёл по кнопке из лички (?draft=1).
        ...(resident ? { eventDraft: eventDraftFor(storage, user.userId) } : {}),
        // Взносы текущего периода: раздел резидентский, гостю его нет вовсе. Список
        // короткий (десяток человек), поэтому едет в bootstrap, а не отдельной ручкой —
        // так все мутации обновляют экран одним ответом, как везде.
        ...(resident ? { dues: duesSnapshot(ctx) } : {}),
    }
}

const handleApi = async (ctx: ApiContext, method: string): Promise<void> => {
    const { client, storage, allowedChats, residents, tzOffsetMinutes, config, githubRepo, user, resident, body, res } = ctx

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
    // Любая мутация заявок/отметок могла изменить доску «кто сегодня в спейсе» — сверяем её
    // в фоне (fire-and-forget), чтобы не задерживать ответ миниаппу.
    const syncBoard = (): void => {
        void syncHostingBoard(client, storage, allowedChats, tzOffsetMinutes).catch((err) =>
            console.error('[hosting-board] не удалось обновить доску:', err),
        )
    }

    switch (method) {
        case 'bootstrap': {
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Согласие с правилами спейса. Идемпотентно: повторный вызов просто обновляет запись.
        case 'rules.accept': {
            await acceptRules(storage, user.userId)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'create': {
            // Гейт правил стоит на сервере, а не только в навигации миниаппа: экран согласия
            // фронт может и обойти, а заявка без принятых правил не должна заводиться.
            if (!hasAcceptedRules(storage, user.userId)) {
                sendError(res, 403, 'rules_required', 'Сначала примите правила спейса.')
                return
            }
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const time = typeof body.time === 'string' ? body.time : ''
            const purpose = typeof body.purpose === 'string' ? body.purpose : ''
            const anon = body.anon === true
            const created = await createHostingRequest(storage, tzOffsetMinutes, { guest: user, dateKey, time, purpose, anon })
            if (!created.ok) {
                const messages = {
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время прихода в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У тебя уже есть заявка на этот день.',
                } as const
                sendError(res, 400, created.error, messages[created.error])
                return
            }
            // Рассылка резидентам — в фоне, чтобы не держать ответ гостю.
            void notifyResidentsAboutRequest(client, storage, residents, tzOffsetMinutes, config.publicUrl, created.request)
                .catch((err) => console.error('[hosting] не удалось разослать уведомления о заявке:', err))
            syncBoard()
            sendJson(res, 200, { request: requestsView([created.request])[0], ...buildBootstrap(ctx) })
            return
        }

        // Гость правит свою заявку: день/время/цель/анонимность (пока она без хоста).
        case 'edit': {
            const request = findRequest()
            if (!request) return
            if (request.guest.userId !== user.userId) {
                sendError(res, 403, 'not_yours', 'Редактировать можно только свою заявку.')
                return
            }
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const time = typeof body.time === 'string' ? body.time : ''
            const purpose = typeof body.purpose === 'string' ? body.purpose : ''
            const anon = body.anon === true
            // Снимок предложения ДО правки: editHostingRequest его обнуляет, а `request` —
            // живая ссылка на объект в стейте.
            const dropped = request.proposal && request.proposal.by === 'resident'
                ? {
                    dateKey: request.proposal.dateKey,
                    time: request.proposal.time,
                    residentId: request.proposal.user.userId,
                }
                : null
            const edited = await editHostingRequest(storage, tzOffsetMinutes, request.id, user.userId, { dateKey, time, purpose, anon })
            if (!edited.ok) {
                const messages = {
                    not_found: 'Заявка не найдена — возможно, её уже отменили.',
                    not_pending: 'Заявку уже одобрили — измени её через отмену и новую заявку.',
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время прихода в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У тебя уже есть заявка на этот день.',
                } as const
                const status = edited.error === 'not_found' ? 404 : edited.error === 'not_pending' ? 409 : 400
                sendError(res, status, edited.error, messages[edited.error])
                return
            }
            // Правка гостя снимает висящее предложение резидента — сообщаем автору.
            // Гость выставил ровно предложенный слот — это по сути согласие, а не отказ.
            if (dropped) {
                const agreed = dropped.dateKey === edited.request.dateKey && dropped.time === edited.request.time
                const notify = agreed
                    ? notifyProposalAccepted(client, dropped.residentId, config.publicUrl, edited.request, false, user)
                    : notifyProposalDroppedByEdit(client, dropped.residentId, config.publicUrl, edited.request, dropped)
                void notify.catch((err) => console.error('[hosting] не удалось уведомить резидента о правке заявки:', err))
            }
            syncBoard()
            sendJson(res, 200, { request: requestsView([edited.request])[0], ...buildBootstrap(ctx) })
            return
        }

        // Резидент отмечает «я приду» / снимает отметку на день (без заявки).
        case 'attend': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const coming = body.coming === true
            const result = await setResidentAttendance(storage, tzOffsetMinutes, dateKey, user, coming)
            if (!result.ok) {
                sendError(res, 400, result.error, 'Выбери день в пределах ближайшей недели.')
                return
            }
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Кого можно позвать в спейс на день: резиденты + гости из заявок.
        case 'invite.list': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const people = await listInviteCandidates(client, storage, residents, dateKey, user.userId)
            // Резиденты сюда попадают живым getChatMembers, а не из стейта, поэтому в
            // реестре показанных их может не быть — иначе аватарки в списке зова отвалятся.
            sendJson(res, 200, { people: people.map(userView) })
            return
        }

        // Зов в личку. Стейт не меняется — отвечаем коротким ok, а не bootstrap'ом.
        case 'invite': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const targetId = typeof body.userId === 'number' ? body.userId : 0
            const candidates = await listInviteCandidates(client, storage, residents, dateKey, user.userId)
            const target = candidates.find((c) => c.userId === targetId)
            if (!target) {
                sendError(res, 404, 'not_found', 'Этого человека больше нет в списке — обнови экран.')
                return
            }
            const sent = await sendHostingInvite(
                client, storage, residents, tzOffsetMinutes, config.publicUrl, dateKey, target, user,
            )
            if (!sent.ok) {
                const messages = {
                    bad_date: 'Позвать можно только на ближайшую неделю.',
                    blocked: 'Этот участник заблокирован.',
                    self: 'Себя звать не нужно — просто отметься «я приду».',
                    dm_closed: 'Не смог написать ему в личку: он не открывал чат с ботом.',
                } as const
                sendError(res, sent.error === 'dm_closed' ? 409 : 400, sent.error, messages[sent.error])
                return
            }
            sendJson(res, 200, { ok: true })
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
                    past_time: 'Это время уже прошло.',
                    duplicate: 'У этого фейкового гостя уже есть заявка на день.',
                } as const
                sendError(res, 400, created.error, messages[created.error])
                return
            }
            syncBoard()
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
            syncBoard()
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
            syncBoard()
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
                    // Захостил при текущем слоте — незакрытое предложение переноса больше не актуально.
                    r.proposal = null
                }
            })
            const updated = storage.get().hostingRequests[request.id]
            if (updated) {
                void notifyGuestApproved(client, config.publicUrl, updated)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя об одобрении:', err))
            }
            syncBoard()
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
            syncBoard()
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
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // --- Ивенты спейса ---------------------------------------------------
        //
        // Заводит и правит только резидент: ивент — это то, что спейс обещает людям,
        // и отвечает за него автор. Гость их только видит (открытые) в «Активности».
        case 'event.create': {
            if (!requireResident()) return
            // Ссылку на исходный пост берём из заготовки, а не из тела запроса: в чате
            // она уходит в доску гиперссылкой, и клиент не должен решать, куда та ведёт.
            const draft = body.fromDraft === true ? eventDraftFor(storage, user.userId) : null
            const created = await createEvent(storage, tzOffsetMinutes, user, {
                ...eventInputFrom(body),
                ...(draft?.postUrl ? { sourceUrl: draft.postUrl } : {}),
            })
            if (!created.ok) {
                sendError(res, 400, created.error, EVENT_ERRORS[created.error])
                return
            }
            // Залитые в редакторе картинки (и афиша заготовки) переезжают под id ивента.
            await syncEventPhotos(storage, storage.path(), created.event.id, photosFrom(body), user.userId)
            // Заготовка отработала — снимаем, иначе миниапп предложил бы завести тот же
            // ивент второй раз. Её афишу к этому моменту уже забрал syncEventPhotos.
            if (body.fromDraft === true) await clearEventDraft(storage, storage.path(), user.userId)
            // Рассылка резидентам — в фоне, чтобы не держать ответ автору.
            void notifyResidentsAboutEvent(client, storage, residents, tzOffsetMinutes, config.publicUrl, created.event)
                .catch((err) => console.error('[events] не удалось разослать уведомления об ивенте:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'event.update': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const existing = storage.get().events[id]
            if (!existing) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обнови экран.')
                return
            }
            if (!canEditEvent(existing, user.userId, isDevUser(ctx))) {
                sendError(res, 403, 'not_yours', 'Править ивент может тот, кто его завёл.')
                return
            }
            const updated = await updateEvent(storage, tzOffsetMinutes, id, eventInputFrom(body))
            if (!updated.ok) {
                sendError(res, 400, updated.error, EVENT_ERRORS[updated.error])
                return
            }
            await syncEventPhotos(storage, storage.path(), id, photosFrom(body), user.userId)
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'event.delete': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const existing = storage.get().events[id]
            if (!existing) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обнови экран.')
                return
            }
            if (!canEditEvent(existing, user.userId, isDevUser(ctx))) {
                sendError(res, 403, 'not_yours', 'Удалить ивент может тот, кто его завёл.')
                return
            }
            await deleteEvent(storage, storage.path(), id)
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Отказаться от заготовки, не заводя ивент: иначе она висела бы до следующей пересылки.
        case 'event.draft.drop': {
            if (!requireResident()) return
            await clearEventDraft(storage, storage.path(), user.userId)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Закрыть заявку со стороны спейса: визит не состоится. Заявка удаляется (как при
        // отмене гостем), гостю уходит DM с предложением выбрать другой день.
        //
        // Отдельный глагол нужен потому, что удалить заявку мог только сам гость: резиденту,
        // который не может принять, оставалось уговаривать его или идти к деву. Блокировка
        // для этого не годится — она банит человека во всех чатах.
        case 'close': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            // Подтверждённый визит закрывает тот, кто его ведёт: остальные к нему не
            // прикасаются, как и в переносе. Ничей (pending) — любой резидент.
            if (request.approvedBy && request.approvedBy.userId !== user.userId) {
                sendError(res, 403, 'not_allowed', 'Этот визит ведёт другой резидент — закрыть может только он.')
                return
            }
            await deleteHostingRequest(storage, request.id)
            void notifyGuestClosed(client, config.publicUrl, request, user)
                .catch((err) => console.error('[hosting] не удалось уведомить гостя о закрытии заявки:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Предложить перенос дня/времени. На pending-заявке: резидент — любой, гость — только
        // в ответ на предложение резидента. На одобренной: обе стороны могут начать сами,
        // но со стороны резидентов — только тот, кто хостит (чужой визит не двигаем).
        case 'propose': {
            const request = findRequest()
            if (!request) return
            const isGuest = request.guest.userId === user.userId
            const by: 'resident' | 'guest' | null = isGuest ? 'guest' : resident ? 'resident' : null
            if (!by) {
                sendError(res, 403, 'not_allowed', 'Предлагать перенос может гость заявки или резидент.')
                return
            }
            if (by === 'resident' && request.approvedBy && request.approvedBy.userId !== user.userId) {
                sendError(res, 403, 'not_allowed', 'Перенести подтверждённый визит может только тот, кто его хостит.')
                return
            }
            if (by === 'guest' && request.status !== 'approved' && request.proposal?.by !== 'resident') {
                sendError(res, 409, 'no_proposal', 'Отвечать своим вариантом можно только на предложение резидента.')
                return
            }
            // Пока висит живое предложение, встревать в переговоры посторонний резидент не
            // может: перебить чужой вариант или ответить на адресованное другому — значит
            // стереть предложение, о снятии которого его автор даже не узнает.
            if (by === 'resident' && request.proposal) {
                const sides = proposalSides(request, request.proposal, user.userId, resident)
                if (!sides.isAuthor && !sides.isAddressee) {
                    sendError(res, 403, 'not_allowed', 'Перенос по этой заявке обсуждает другой резидент.')
                    return
                }
            }
            // Гость дефолтит день на текущий день заявки: он свой день двигать не просит, только время.
            const dateKey = typeof body.dateKey === 'string' && body.dateKey ? body.dateKey : request.dateKey
            const time = typeof body.time === 'string' ? body.time : ''
            const sameSlot = (d: string, t: string): boolean => d === dateKey && t === time
            // Встречное предложение ровно того же слота — это согласие, а не новый раунд:
            // иначе стороны пингуют друг друга одинаковым слотом и никто не «принял».
            const counter = request.proposal
            if (counter && counter.by !== by && sameSlot(counter.dateKey, counter.time)) {
                const accepted = await acceptReschedule(storage, tzOffsetMinutes, request.id)
                if (!accepted.ok) {
                    const status = accepted.error === 'not_found' ? 404 : 409
                    sendError(res, status, accepted.error,
                        accepted.error === 'not_found' ? 'Заявка не найдена.' : 'Предложение уже неактуально.')
                    return
                }
                if (counter.by === 'resident') {
                    void notifyProposalAccepted(client, counter.user.userId, config.publicUrl, accepted.request, false, user)
                        .catch((err) => console.error('[hosting] не удалось уведомить резидента о принятии переноса:', err))
                } else {
                    void notifyProposalAccepted(client, accepted.request.guest.userId, config.publicUrl, accepted.request, true, user)
                        .catch((err) => console.error('[hosting] не удалось уведомить гостя о принятии переноса:', err))
                }
                syncBoard()
                sendJson(res, 200, buildBootstrap(ctx))
                return
            }
            // Предложить ровно тот слот, что и так согласован, — не событие. Молча отдаём
            // текущее состояние: иначе заводится пустое предложение при неизменном слоте и
            // второй стороне летит бессмысленный DM. Проверка после встречного согласия.
            if (sameSlot(request.dateKey, request.time)) {
                sendJson(res, 200, buildBootstrap(ctx))
                return
            }
            // Повторно предложить свой же уже висящий слот — не событие: предложение не
            // меняется, а второй стороне иначе улетает дубль-DM.
            if (counter && counter.by === by && sameSlot(counter.dateKey, counter.time)) {
                sendJson(res, 200, buildBootstrap(ctx))
                return
            }
            const result = await proposeReschedule(storage, tzOffsetMinutes, request.id, { dateKey, time, by, user })
            if (!result.ok) {
                const messages = {
                    not_found: 'Заявка не найдена — возможно, её уже отменили.',
                    bad_date: 'Выбери день в пределах ближайшей недели.',
                    bad_time: 'Укажи время в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У гостя уже есть заявка на этот день.',
                } as const
                sendError(res, result.error === 'not_found' ? 404 : 400, result.error, messages[result.error])
                return
            }
            if (by === 'resident') {
                void notifyGuestReschedule(client, config.publicUrl, result.request)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя о предложении переноса:', err))
            } else if (result.recipientId != null) {
                void notifyResidentRescheduleCountered(client, result.recipientId, config.publicUrl, result.request)
                    .catch((err) => console.error('[hosting] не удалось уведомить резидента о встречном переносе:', err))
            }
            // Доску не трогаем: предложение меняет только `proposal`, а `dateKey`/`time`
            // применяются лишь при accept (там syncBoard и стоит).
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Принять активное предложение: принять может только сторона-адресат.
        case 'proposal.accept': {
            const request = findRequest()
            if (!request) return
            const proposal = request.proposal
            if (!proposal) {
                sendError(res, 409, 'no_proposal', 'Предложение уже неактуально.')
                return
            }
            // Принимает только адресат: у предложения резидента это гость, у предложения
            // гостя — конкретный резидент (хост либо автор предыдущего предложения).
            if (!proposalSides(request, proposal, user.userId, resident).isAddressee) {
                sendError(res, 403, 'not_allowed', 'Это предложение адресовано другой стороне.')
                return
            }
            const result = await acceptReschedule(storage, tzOffsetMinutes, request.id)
            if (!result.ok) {
                const status = result.error === 'not_found' ? 404 : 409
                const message = result.error === 'not_found'
                    ? 'Заявка не найдена.'
                    : result.error === 'stale'
                        ? 'Предложенный день уже недоступен — предложение снято.'
                        : 'Предложение уже неактуально.'
                sendError(res, status, result.error, message)
                return
            }
            if (proposal.by === 'resident') {
                void notifyProposalAccepted(client, proposal.user.userId, config.publicUrl, result.request, false, user)
                    .catch((err) => console.error('[hosting] не удалось уведомить резидента о принятии переноса:', err))
            } else {
                void notifyProposalAccepted(client, result.request.guest.userId, config.publicUrl, result.request, true, user)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя о принятии переноса:', err))
            }
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Снять предложение: отклонить (сторона-адресат) или отозвать (автор). Слот не меняется.
        case 'proposal.decline': {
            const request = findRequest()
            if (!request) return
            const proposal = request.proposal
            if (!proposal) {
                sendError(res, 409, 'no_proposal', 'Предложение уже неактуально.')
                return
            }
            const isGuest = request.guest.userId === user.userId
            if (!isGuest && !resident) {
                sendError(res, 403, 'not_allowed', 'Недоступно.')
                return
            }
            // Снять предложение вправе его автор (отзыв) и адресат (отказ). Посторонний
            // резидент — нет: раньше на pending-заявке он гасил чужое предложение, автору
            // ничего не приходило, а гость читал «снимает своё предложение» про не того.
            const sides = proposalSides(request, proposal, user.userId, resident)
            if (!sides.isAuthor && !sides.isAddressee) {
                sendError(res, 403, 'not_allowed', 'Перенос по этой заявке обсуждает другой резидент.')
                return
            }
            const result = await clearReschedule(storage, request.id)
            if (!result.ok) {
                sendError(res, result.error === 'not_found' ? 404 : 409, result.error,
                    result.error === 'not_found' ? 'Заявка не найдена.' : 'Предложение уже неактуально.')
                return
            }
            const proposed = { dateKey: proposal.dateKey, time: proposal.time }
            // Своё предложение отозвали или чужое отклонили — от этого зависит формулировка DM.
            const actor = { user, isGuest, withdrawn: sides.isAuthor }
            // Пишем противоположной стороне. Адресат лежит на самом предложении, поэтому
            // отзыв гостя доходит и на pending-заявке — раньше там адреса не было и DM молчал.
            if (sides.counterpartId !== null) {
                void notifyProposalCancelled(
                    client, sides.counterpartId, config.publicUrl, result.request, proposed,
                    sides.counterpartId === result.request.guest.userId, actor,
                ).catch((err) => console.error('[hosting] не удалось уведомить о снятии предложения:', err))
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Заблокировать гостя заявки: любой резидент. Бан во всех allowlist-чатах, чистка
        // его заявок/отметок и отказ в миниаппе (см. гейт blocked ниже).
        case 'block': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            if (request.guest.userId === user.userId) {
                sendError(res, 400, 'self', 'Себя блокировать нельзя.')
                return
            }
            // Резидента заблокировать нельзя. Заявку он завести может (гейта резидентства
            // на `create` нет, да и в резиденты повышают уже после визита), а вот бан во
            // всех чатах по свайпу — с откатом только через дева — это не тот вес.
            if (await residents.isResident(request.guest.userId)) {
                sendError(res, 400, 'resident', 'Это резидент — блокировка не для своих. Разбирайтесь в чате.')
                return
            }
            await blockUser(client, storage, allowedChats, request.guest, user)
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Заметка о госте: одна на человека, общая для резидентов. Пустой текст стирает её.
        case 'note.set': {
            if (!requireResident()) return
            const targetId = typeof body.userId === 'number' ? body.userId : Number(body.userId)
            const text = typeof body.text === 'string' ? body.text : ''
            if (!Number.isSafeInteger(targetId) || targetId === 0) {
                sendError(res, 400, 'bad_user', 'Некорректный участник.')
                return
            }
            if (text.length > MAX_NOTE_LENGTH) {
                sendError(res, 400, 'too_long', `Заметка не должна быть длиннее ${MAX_NOTE_LENGTH} символов.`)
                return
            }
            await setGuestNote(storage, targetId, text, user)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Разблокировать участника: только dev. Разбан во всех allowlist-чатах.
        case 'unblock': {
            if (!requireDev()) return
            const targetId = typeof body.userId === 'number' ? body.userId : Number(body.userId)
            if (!Number.isSafeInteger(targetId)) {
                sendError(res, 400, 'bad_user', 'Некорректный участник.')
                return
            }
            await unblockUser(client, storage, allowedChats, targetId)
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

        // Уведомления об ивентах — отдельный тумблер от заявок (см. DEFAULT_EVENT_NOTIFY).
        case 'notify.events': {
            if (!requireResident()) return
            const enabled = body.enabled === true
            const mode = body.mode === 'today' ? 'today' : 'all'
            await storage.update((s) => {
                s.eventNotify[String(user.userId)] = { enabled, mode }
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
                syncBoard()
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'archive': {
            if (!requireResident()) return
            sendJson(res, 200, { weeks: archiveWeeks(storage, tzOffsetMinutes) })
            return
        }

        // --- Резидентские взносы ------------------------------------------------
        // Читают все резиденты, меняют только dev: отметку ставит человек сам, а
        // подтверждает её сверяющий с выпиской.

        // Свой взнос: «я внёс». Только за себя и только в текущем периоде.
        case 'dues.claim': {
            if (!requireResident()) return
            const dues = duesOf(storage)
            const period = activeDuesPeriod(dues)
            if (!dues.enabled || !period) {
                sendError(res, 400, 'no_period', 'Сбор сейчас не идёт.')
                return
            }
            // Ростер освежаем: резидентом могли сделать уже после открытия сбора.
            await syncDuesRoster(storage, residents, period.periodKey)
            const claimed = await claimDues(storage, period.periodKey, user.userId)
            if (!claimed.ok) {
                const messages = {
                    already: 'Взнос за этот месяц уже отмечен.',
                    not_member: 'Тебя нет в списке плательщиков этого месяца.',
                    no_period: 'Сбор сейчас не идёт.',
                    no_mark: 'Отметки нет.',
                    disabled: 'Взносы выключены.',
                } as const
                sendError(res, 400, claimed.error, messages[claimed.error])
                return
            }
            void notifyDevsAboutClaim(client, ctx.devUserIds, duesOf(storage), period.periodKey, claimed.member)
                .catch((err) => console.error('[dues] не удалось уведомить дева о заявке:', err))
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Подтверждение взноса. Без заявки тоже работает: наличные приносят на месте.
        case 'dues.confirm':
        case 'dues.clear': {
            if (!requireDev()) return
            const dues = duesOf(storage)
            const periodKey = typeof body.periodKey === 'string' && body.periodKey ? body.periodKey : activeDuesPeriod(dues)?.periodKey
            const targetId = Number(body.userId)
            if (!periodKey || !dues.periods[periodKey] || !Number.isFinite(targetId)) {
                sendError(res, 400, 'no_period', 'Период не найден.')
                return
            }
            const result = method === 'dues.confirm'
                ? await confirmDues(storage, periodKey, targetId, user.userId)
                : await clearDuesMark(storage, periodKey, targetId)
            if (!result.ok) {
                sendError(res, 400, result.error, result.error === 'no_mark' ? 'Отметки и так нет.' : 'Человека нет в списке этого месяца.')
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Персональная ставка: общая, студенческая или своя по договорённости.
        case 'dues.rate': {
            if (!requireDev()) return
            const targetId = Number(body.userId)
            const kind = body.kind
            if (!Number.isFinite(targetId) || (kind !== 'common' && kind !== 'student' && kind !== 'custom')) {
                sendError(res, 400, 'bad_request', 'Не понял ставку.')
                return
            }
            if (kind === 'custom') {
                const amount = Number(body.amount)
                if (!Number.isFinite(amount) || amount < 0) {
                    sendError(res, 400, 'bad_amount', 'Сумма должна быть неотрицательным числом.')
                    return
                }
                await setDuesRate(storage, targetId, Math.round(amount))
            } else {
                await setDuesRate(storage, targetId, kind === 'student' ? 'student' : null)
            }
            // Ставка периода это снимок: пересобираем ростер, иначе в текущем месяце
            // с человека продолжат спрашивать по старой.
            const active = activeDuesPeriod(duesOf(storage))
            if (active) await syncDuesRoster(storage, residents, active.periodKey)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'dues.settings': {
            if (!requireDev()) return
            const day = body.day === undefined ? undefined : Number(body.day)
            if (day !== undefined && (!Number.isInteger(day) || day < MIN_DUES_DAY || day > MAX_DUES_DAY)) {
                sendError(res, 400, 'bad_day', `День сбора это число от ${MIN_DUES_DAY} до ${MAX_DUES_DAY}.`)
                return
            }
            const amount = body.amount === undefined ? undefined : Number(body.amount)
            const studentAmount = body.studentAmount === undefined ? undefined : Number(body.studentAmount)
            for (const value of [amount, studentAmount]) {
                if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
                    sendError(res, 400, 'bad_amount', 'Ставка должна быть неотрицательным числом.')
                    return
                }
            }
            const wasEnabled = duesOf(storage).enabled
            await updateDuesSettings(storage, {
                ...(body.enabled === undefined ? {} : { enabled: body.enabled === true }),
                ...(day === undefined ? {} : { day }),
                ...(amount === undefined ? {} : { amount: Math.round(amount) }),
                ...(studentAmount === undefined ? {} : { studentAmount: Math.round(studentAmount) }),
                ...(typeof body.requisites === 'string' ? { requisites: body.requisites } : {}),
            })
            // Ставки и реквизиты видны в текущем списке — перерисовываем. Первое включение
            // период не открывает: этим занимается шедулер, на ближайшем тике.
            const active = activeDuesPeriod(duesOf(storage))
            if (active && wasEnabled) await syncDuesRoster(storage, residents, active.periodKey)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Свой тумблер DM про сбор. Настройка личная, поэтому доступна любому резиденту.
        case 'dues.notify': {
            if (!requireResident()) return
            await setDuesNotify(storage, user.userId, body.enabled === true)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Список за конкретный (обычно прошлый) период — из истории.
        case 'dues.period': {
            if (!requireResident()) return
            const periodKey = typeof body.periodKey === 'string' ? body.periodKey : ''
            const snapshot = duesSnapshot(ctx, periodKey)
            if (!snapshot) {
                sendError(res, 404, 'not_found', 'Такого периода нет.')
                return
            }
            sendJson(res, 200, snapshot)
            return
        }

        case 'dues.history': {
            if (!requireResident()) return
            const dues = duesOf(storage)
            const keys = periodKeysOf(dues).reverse()
            const periods = keys.map((key) => {
                const period = dues.periods[key]!
                const marks = Object.values(period.marks).filter((m) => m.status === 'paid')
                const total = Object.keys(period.roster).length
                return {
                    periodKey: key,
                    label: duesPeriodLabel(key),
                    paid: marks.length,
                    total,
                    collected: marks.reduce((sum, m) => sum + m.amount, 0),
                    expected: Object.values(period.roster).reduce((sum, m) => sum + m.amount, 0),
                }
            })
            const collected = periods.reduce((sum, p) => sum + p.collected, 0)
            const expected = periods.reduce((sum, p) => sum + p.expected, 0)
            sendJson(res, 200, {
                periods,
                collected,
                expected,
                // Собираемость за всё время: доля закрытых взносов, а не собранных денег —
                // ставки у людей разные, и по деньгам картина смещалась бы в пользу дорогих.
                rate: expected > 0 ? Math.round((periods.reduce((s, p) => s + p.paid, 0) /
                    Math.max(1, periods.reduce((s, p) => s + p.total, 0))) * 100) : 0,
                currency: dues.currency,
            })
            return
        }

        // Карточка человека: вся его история по месяцам в одном месте.
        case 'dues.person': {
            if (!requireResident()) return
            const dues = duesOf(storage)
            const targetId = Number(body.userId)
            const keys = periodKeysOf(dues).reverse()
            let member = null
            for (const key of keys) {
                const found = dues.periods[key]!.roster[String(targetId)]
                if (found) {
                    member = found
                    break
                }
            }
            if (!member) {
                sendError(res, 404, 'not_found', 'Человека нет ни в одном периоде.')
                return
            }
            discloseUser(member.userId)
            const activeKey = periodKeysOf(dues).pop() ?? ''
            const rateValue = dues.rates[String(targetId)]
            const months = keys
                .filter((key) => dues.periods[key]!.roster[String(targetId)])
                .map((key) => {
                    const period = dues.periods[key]!
                    const mark = period.marks[String(targetId)]
                    const confirmedBy = mark?.by !== null && mark?.by !== undefined
                        ? period.roster[String(mark.by)] ?? null
                        : null
                    return {
                        periodKey: key,
                        label: duesPeriodLabel(key),
                        amount: period.roster[String(targetId)]!.amount,
                        status: (isPaid(mark) ? 'paid' : mark ? 'claimed' : 'none') as 'paid' | 'claimed' | 'none',
                        at: mark?.paidAt ?? mark?.claimedAt ?? null,
                        by: confirmedBy ? { username: confirmedBy.username, name: displayName(confirmedBy.name) } : null,
                    }
                })
            const missed = missedPeriods(dues, activeKey, targetId)
            sendJson(res, 200, {
                user: { userId: member.userId, username: member.username, name: displayName(member.name) },
                rate: {
                    kind: rateValue === 'student' ? 'student' : typeof rateValue === 'number' ? 'custom' : 'common',
                    amount: rateFor(dues, targetId),
                },
                amount: dues.amount,
                studentAmount: dues.studentAmount,
                currency: dues.currency,
                canEdit: isDevUser(ctx),
                months,
                missed: missed.length,
                // Долг с учётом прошлых: сумма незакрытых взносов подряд плюс текущий.
                debt: [...missed, ...(months[0] && months[0].status !== 'paid' ? [months[0].periodKey] : [])]
                    .reduce((sum, key) => sum + (dues.periods[key]?.roster[String(targetId)]?.amount ?? 0), 0),
            })
            return
        }

        // Выгрузка: файл уходит в личку от бота, а не скачивается из вебвью — в
        // Telegram-клиенте скачанный из мини-аппа файл ещё надо суметь найти.
        case 'dues.export': {
            if (!requireResident()) return
            const dues = duesOf(storage)
            if (periodKeysOf(dues).length === 0) {
                sendError(res, 400, 'empty', 'Выгружать нечего: сборов ещё не было.')
                return
            }
            // BOM (U+FEFF) — чтобы Excel открыл кириллицу в UTF-8 без «крякозябр» (как в /export).
            const csv = Buffer.from(String.fromCharCode(0xfeff) + buildDuesCsv(dues), 'utf8')
            try {
                await client.sendMedia(user.userId, InputMedia.document(csv, {
                    fileName: 'dues.csv',
                    fileMime: 'text/csv',
                    caption: html(`Взносы за ${periodKeysOf(dues).length} ${periodKeysOf(dues).length === 1 ? 'период' : 'периодов'}.`),
                }))
            } catch {
                sendError(res, 409, 'dm_closed', 'Не могу написать в личку. Открой чат с ботом и нажми /start.')
                return
            }
            sendJson(res, 200, { ok: true })
            return
        }

        // Поиск по людям и карточка человека: архив по неделям отвечает на «что было
        // в тот вторник», а этот вход — на «кто такой N и сколько раз он у нас был».
        case 'guests.search': {
            if (!requireResident()) return
            const query = typeof body.query === 'string' ? body.query : ''
            sendJson(res, 200, {
                guests: searchGuests(storage, query).map((g) => ({ ...g, user: userView(g.user) })),
            })
            return
        }

        case 'guest.requests': {
            if (!requireResident()) return
            const userId = typeof body.userId === 'number' ? body.userId : 0
            const requests = requestsOfGuest(storage, userId)
            const guest = requests[0]?.guest
            if (!guest) {
                sendError(res, 404, 'not_found', 'Заявок этого человека уже нет.')
                return
            }
            sendJson(res, 200, { user: userView(guest), requests: requestsView(requests) })
            return
        }

        case 'archive.week': {
            if (!requireResident()) return
            const weekStart = typeof body.weekStart === 'string' ? body.weekStart : ''
            const currentWeek = weekStartOf(todayKey(tzOffsetMinutes))
            if (!isValidDayKey(weekStart) || weekStartOf(weekStart) !== weekStart || weekStart > currentWeek) {
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

        // Дев-анонсы: снапшот для экрана рассылки — последний релиз, дефолтный текст,
        // до какой версии уже анонсили, сколько чатов получат (allowlist минус мьют).
        case 'announce.latest': {
            if (!requireDev()) return
            const release = await fetchLatestRelease(githubRepo)
            sendJson(res, 200, {
                release: release
                    ? { version: release.version, name: release.name, url: release.url, publishedAt: release.publishedAt }
                    : null,
                defaultText: release ? buildDefaultAnnouncement(release, githubRepo) : '',
                lastAnnouncedVersion: storage.get().lastAnnouncedVersion || '',
                targetChats: announceTargets(storage, allowedChats).length,
            })
            return
        }

        // Дев-рассылка: произвольный текст во все allowlist-чаты (минус замьюченные).
        // version — маркер «до какой версии анонсили» (пусто для обычной рассылки).
        case 'announce.send': {
            if (!requireDev()) return
            const text = (typeof body.text === 'string' ? body.text : '').trim()
            const version = typeof body.version === 'string' ? body.version : ''
            if (!text) {
                sendError(res, 400, 'empty_text', 'Текст анонса пуст.')
                return
            }
            if (announceTargets(storage, allowedChats).length === 0) {
                sendError(res, 400, 'no_targets', 'Нет чатов для рассылки (все замьючены или ALLOWED_CHATS пуст).')
                return
            }
            const result = await broadcastAnnouncement(client, storage, allowedChats, text)
            if (version) {
                await storage.update((s) => {
                    s.lastAnnouncedVersion = version
                })
            }
            sendJson(res, 200, { sent: result.sent, failed: result.failed })
            return
        }

        default:
            sendError(res, 404, 'unknown_method', 'Неизвестный метод API.')
    }
}

/** Сколько держим фото профиля в памяти: аватарки меняются редко, а рендер списка просит их пачками. */
const AVATAR_TTL_MS = 6 * 60 * 60 * 1000

/** Потолок кэша аватарок: без него Map растёт на каждый новый id и никогда не чистится. */
const AVATAR_CACHE_LIMIT = 512

const avatarCache = new Map<number, { photo: Uint8Array | null; at: number }>()

/** Кладёт фото в кэш, вытесняя самое старое по вставке, если упёрлись в потолок. */
const putAvatar = (userId: number, photo: Uint8Array | null): void => {
    // delete+set поднимает существующий ключ в конец, чтобы вытеснялся действительно старый.
    avatarCache.delete(userId)
    while (avatarCache.size >= AVATAR_CACHE_LIMIT) {
        const oldest = avatarCache.keys().next().value
        if (oldest === undefined) break
        avatarCache.delete(oldest)
    }
    avatarCache.set(userId, { photo, at: Date.now() })
}

/** Скачивания в полёте: без этого пачка <img> на один рендер качает одно фото N раз. */
const avatarInflight = new Set<number>()

const cachedAvatar = (userId: number): { photo: Uint8Array | null } | null => {
    const hit = avatarCache.get(userId)
    return hit && Date.now() - hit.at < AVATAR_TTL_MS ? hit : null
}

/**
 * Скачивает фото профиля в кэш. Отрицательный ответ (нет фото, скрыто приватностью,
 * юзер боту незнаком) кэшируем тоже — иначе каждый рендер списка бьёт в Telegram за
 * теми же «пустыми» аватарками.
 *
 * Запускается только фоном: клиент mtcute один на весь бот, и `downloadAsBuffer` с
 * файлового DC — это секунды. Если ждать его в HTTP-хендлере, следующий запрос к API
 * встаёт в очередь за пачкой аватарок (там `isResident` → `getChatMember` идёт через
 * тот же клиент) и миниапп ловит таймаут.
 */
const warmAvatar = async (client: TelegramClient, userId: number): Promise<void> => {
    if (avatarInflight.has(userId)) return
    avatarInflight.add(userId)
    let photo: Uint8Array | null = null
    try {
        const [user] = await client.getUsers(userId)
        if (user?.photo) photo = await client.downloadAsBuffer(user.photo.small)
    } catch (err) {
        console.warn(`[webapp] не удалось получить аватарку ${userId}:`, err)
    } finally {
        // Ошибку кэшируем как «фото нет»: иначе битый юзер перезапрашивается на каждый рендер.
        putAvatar(userId, photo)
        avatarInflight.delete(userId)
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
        // Телеграм-webview агрессивно кэширует; разметку и скрипты отдаём без кэша,
        // чтобы после деплоя не ловить смесь старого JS и нового API. Картинки —
        // наоборот, кэшируем: они не меняются, а фото двери весит сотню килобайт.
        const immutable = ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.svg'
        res.writeHead(200, {
            'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': immutable ? 'public, max-age=86400' : 'no-store',
        })
        res.end(data)
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
    }
}

// ---------------------------------------------------------------------------
// GET /board — табло донатов (e-paper на микроконтроллере)
// ---------------------------------------------------------------------------

/**
 * Сравнение секретов за постоянное время. Сравниваем не сами строки, а их SHA-256:
 * `timingSafeEqual` бросает исключение на буферах разной длины, и такая проверка
 * сливала бы длину токена; у дайджестов длина всегда одна.
 */
const secretEquals = (a: string, b: string): boolean =>
    timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

/** Токен из `Authorization: Bearer <token>` либо из `?token=` — прошивке проще query. */
const boardTokenOf = (req: IncomingMessage, url: URL): string => {
    const header = req.headers.authorization ?? ''
    const bearer = /^Bearer\s+(.+)$/i.exec(header.trim())
    return bearer?.[1]?.trim() ?? url.searchParams.get('token')?.trim() ?? ''
}

/** Совпал ли ETag с любым из If-None-Match (список через запятую, возможен префикс W/). */
const etagMatches = (header: string | undefined, etag: string): boolean =>
    (header ?? '').split(',').some((raw) => raw.trim().replace(/^W\//, '') === etag)

const WEEKDAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const

/**
 * Подпись дня для табло: «сегодня», «завтра» или сокращённый день недели.
 * День недели берём из самого ключа 'YYYY-MM-DD' через UTC — ключ уже посчитан в
 * поясе спейса, и повторный сдвиг сместил бы его на сутки.
 */
const dayLabelFor = (dateKey: string, offset: number): string => {
    if (offset === 0) return 'сегодня'
    if (offset === 1) return 'завтра'
    const [y, m, d] = dateKey.split('-').map(Number)
    const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
    return WEEKDAYS_RU[weekday] ?? '?'
}

/**
 * Блок «ждут ответа» для табло: ближайший день, где есть непринятые заявки, и общий
 * счётчик по всему горизонту хостинга.
 *
 * Ближайший день, а не строго сегодняшний: отвечать на заявку надо заранее, и до дня
 * визита блок бы просто не показывался. Счётчик при этом общий — резиденту важен
 * объём необработанного, а не только ближайшая заявка.
 *
 * Только `pending`: у согласованного визита действия не требуется. Анонимные заявки и
 * фейки дев-сида не выходят на публичные поверхности (тот же инвариант, что у
 * `attendeesForDay`), табло — как раз такая. Цель визита не отдаём: она бывает личной,
 * а на стене висит всё время.
 */
const boardRequests = (deps: WebappDeps): BoardRequests => {
    const today = todayKey(deps.tzOffsetMinutes)
    let nearest: { dayLabel: string; items: BoardRequest[] } | null = null
    let total = 0
    for (let offset = 0; offset < HOSTING_DAYS_AHEAD; offset++) {
        const dateKey = addDaysToKey(today, offset)
        const items = requestsForDay(deps.storage, dateKey)
            .filter((r) => r.status === 'pending' && !r.anon && !isFakeUserId(r.guest.userId))
            .map((r) => ({ time: r.time, name: displayName(r.guest.name) }))
        total += items.length
        if (items.length > 0 && nearest === null) {
            nearest = { dayLabel: dayLabelFor(dateKey, offset), items }
        }
    }
    return { dayLabel: nearest?.dayLabel ?? '', total, items: nearest?.items ?? [] }
}

/**
 * Отвечает табло текущим сбором.
 *
 * Сбор берётся строго по ключу текущего периода и НЕ создаётся, если его ещё нет
 * (в отличие от `ensureCurrentFundraiser` в handlers.ts): GET не должен писать стейт,
 * иначе опрос табло каждые несколько минут плодил бы пустые сборы и дисковые записи.
 *
 * ETag здесь не про трафик, а про ресурс панели: полное обновление e-paper — пара
 * секунд мигания, поэтому на неизменившиеся данные отвечаем 304, и прошивка не
 * перерисовывает экран.
 */
const serveBoard = (deps: WebappDeps, req: IncomingMessage, url: URL, res: ServerResponse): void => {
    if (deps.boardToken === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found\n')
        return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
    }
    const token = boardTokenOf(req, url)
    if (token === '' || !secretEquals(token, deps.boardToken)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('unauthorized\n')
        return
    }
    const state = deps.storage.get()
    const now = new Date()
    const fundraiser = state.fundraisers[periodKeyOf(now, state.resetDay)]
    const body = renderBoardExport(fundraiser, currentPeriodLabel(now, state.resetDay), boardRequests(deps))
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
    if (etagMatches(req.headers['if-none-match'], etag)) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end()
        return
    }
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'Cache-Control': 'no-cache',
        ETag: etag,
    })
    // На HEAD тело не пишем, но Content-Length выше уже объявлен — прошивка может
    // спросить размер заранее, если решит читать в буфер фиксированной длины.
    res.end(req.method === 'HEAD' ? undefined : body)
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

            // Табло донатов. Гейт — статический BOARD_TOKEN, а не initData: у железки
            // нет Telegram-сессии, подписать initData ей нечем.
            if (pathname === '/board') {
                serveBoard(deps, req, url, res)
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
                if (isBlocked(deps.storage, user.userId) || (await deps.residents.access(user.userId)).banned) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Доступ закрыт.')
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

            // Афиша ивента: тоже <img>, поэтому GET и initData в query, как у аватарок.
            // Файл лежит рядом со стейтом (см. events.ts), в JSON его нет.
            if (pathname === '/event-photo.jpg') {
                if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
                    res.writeHead(405).end()
                    return
                }
                const viewer = validateInitData(url.searchParams.get('initData') ?? '', deps.botToken)
                if (!viewer) {
                    res.writeHead(401).end()
                    return
                }
                const access = await deps.residents.access(viewer.userId)
                if (isBlocked(deps.storage, viewer.userId) || access.banned) {
                    res.writeHead(403).end()
                    return
                }
                // Заливка афиши из редактора. Тело — картинка, поэтому не /api/ (там JSON
                // и потолок в 64 КБ): подпись и проверки те же, id файла возвращаем в JSON.
                if (req.method === 'POST') {
                    if (!access.resident) {
                        sendError(res, 403, 'not_resident', 'Заводить ивенты могут резиденты.')
                        return
                    }
                    let bytes: Buffer
                    try {
                        bytes = await readBinaryBody(req, MAX_EVENT_PHOTO_BYTES)
                    } catch {
                        sendError(res, 413, 'too_large', 'Картинка слишком большая.')
                        return
                    }
                    if (!isJpeg(bytes)) {
                        sendError(res, 400, 'bad_image', 'Не получилось прочитать картинку — попробуй другую.')
                        return
                    }
                    const photoId = stagedPhotoId(viewer.userId)
                    await saveEventPhoto(deps.storage.path(), photoId, bytes)
                    sendJson(res, 200, { id: photoId })
                    return
                }
                const id = url.searchParams.get('id') ?? ''
                // Заготовку и только что залитое видит только владелец: это ещё не
                // опубликованный ивент.
                const isOwnDraft = access.resident && (id === draftPhotoId(viewer.userId) || isStagedPhotoOf(id, viewer.userId))
                const event = eventForPhoto(deps.storage, id)
                // Резидентский ивент гостю не показываем — иначе афиша выдаёт то,
                // что скрыто галочкой «только резидентам».
                const visible = event ? access.resident || !event.residentsOnly : false
                if (!isOwnDraft && !visible) {
                    res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
                    return
                }
                const bytes = await readEventPhoto(deps.storage.path(), id)
                if (!bytes) {
                    res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
                    return
                }
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'private, max-age=3600',
                }).end(bytes)
                return
            }

            // Аватарки — тоже GET вне /api/: их грузит <img>, тело не отправить,
            // поэтому initData едет в query (как в /visit.ics). Нет фото — 404,
            // фронт остаётся на градиентной заглушке с буквой.
            if (pathname === '/avatar.jpg') {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405).end()
                    return
                }
                const viewer = validateInitData(url.searchParams.get('initData') ?? '', deps.botToken)
                if (!viewer) {
                    res.writeHead(401).end()
                    return
                }
                // Гейт blocked — тот же, что у /visit.ics выше. Живой `access` (бан в чате)
                // тут намеренно не зовём: это getChatMember на каждый <img>, а список
                // рендерится пачками. Данные всё равно закрыты в /api/*, где access есть.
                if (isBlocked(deps.storage, viewer.userId)) {
                    res.writeHead(403).end()
                    return
                }
                const id = Number(url.searchParams.get('id'))
                if (!Number.isSafeInteger(id) || id <= 0) {
                    res.writeHead(400).end()
                    return
                }
                // Просить можно себя и тех, кого бот сам показал (см. `disclosedUserIds`).
                // Иначе перебором id качается чужое фото и греется очередь mtcute.
                if (id !== viewer.userId && !disclosedUserIds.has(id)) {
                    res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
                    return
                }
                const hit = cachedAvatar(id)
                if (!hit) {
                    // Холодный промах: греем фоном и отвечаем сразу, чтобы не занимать
                    // mtcute-клиент под HTTP-запросом. no-store — чтобы браузер спросил
                    // снова на следующем рендере, когда фото уже будет в кэше.
                    void warmAvatar(deps.client, id)
                    res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
                    return
                }
                if (!hit.photo) {
                    // Знаем наверняка, что фото нет — пусть браузер не спрашивает час.
                    res.writeHead(404, { 'Cache-Control': 'private, max-age=3600' }).end()
                    return
                }
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'private, max-age=3600',
                }).end(hit.photo)
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
                } catch (err) {
                    if ((err as { code?: string }).code === 'body_too_large') {
                        sendError(res, 413, 'too_large', 'Тело запроса слишком большое.')
                    } else {
                        sendError(res, 400, 'bad_json', 'Некорректное тело запроса.')
                    }
                    return
                }
                const initData = typeof body.initData === 'string' ? body.initData : ''
                const user = validateInitData(initData, deps.botToken)
                if (!user) {
                    sendError(res, 401, 'bad_init_data', 'Открой миниапп заново — сессия устарела.')
                    return
                }
                // Заблокированный участник не имеет доступа к миниаппу — глухой отказ.
                // Источников бана два: своя запись в blockedUsers (блокировка из миниаппа)
                // и живой статус в allowlist-чатах — забаненного руками в Телеграме, минуя
                // миниапп, в blockedUsers нет, но внутрь его пускать всё равно нельзя.
                const { resident, banned } = await deps.residents.access(user.userId)
                if (banned || isBlocked(deps.storage, user.userId)) {
                    sendError(res, 403, 'blocked', 'Доступ закрыт.')
                    return
                }
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
