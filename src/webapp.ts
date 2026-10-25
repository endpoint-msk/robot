import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'
import { html, InputMedia, type TelegramClient, type User } from '@mtcute/node'
import {
    acceptReschedule,
    acceptRules,
    acceptTransfer,
    addDaysToKey,
    addWalkIn,
    archiveWeeks,
    ARRIVAL_COOLDOWN_MS,
    attendeesForDay,
    dayKeyOf,
    blockUser,
    buildVisitIcs,
    cleanCloseComment,
    cleanName,
    clearReschedule,
    clearTransfer,
    createHostingRequest,
    dayAgendaFor,
    dayCapOverride,
    dayLockFor,
    dayOccupancy,
    deleteHostingRequest,
    displayName,
    editHostingRequest,
    feedVisits,
    guestProfile,
    guestVisitStats,
    guestVisitTally,
    hasAcceptedRules,
    HOSTING_DAYS_AHEAD,
    isBlocked,
    isFakeUserId,
    isPastSlot,
    isValidDayKey,
    isVisitDayEditable,
    listBlockedUsers,
    listGuestNotes,
    listKnownGuests,
    markAllVisits,
    markArrived,
    markVisit,
    MAX_AGENDA_LENGTH,
    MAX_CLOSE_COMMENT_LENGTH,
    MAX_DAY_CAP,
    MAX_LOCK_REASON_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_WALK_IN_NAME_LENGTH,
    notifyArrival,
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
    notifySubsHosted,
    notifySubsAttending,
    notifySubsRescheduled,
    isDaySubscribed,
    setDaySubscription,
    offerTransfer,
    proposeReschedule,
    guestNoteFor,
    inVisitList,
    removeWalkIn,
    requestsForDay,
    restoreApproval,
    restoreGuestNote,
    restoreHostingRequest,
    requestsOfGuest,
    searchGuests,
    setDayAgenda,
    setDayCap,
    setDayLock,
    SPACE_CAPACITY,
    setGuestNote,
    setResidentAttendance,
    todayKey,
    unblockUser,
    updateHostingRequest,
    VISIT_MARK_GRACE_UNTIL,
    visitGraceDay,
    visitOutcome,
    walkInsForDay,
    walkInsOfGuest,
    weekStartOf,
} from './hosting.js'
import { guestAttendPrefsFor } from './attend-alerts.js'
import { listInviteCandidates, prepareDayShare, sendHostingInvite } from './hosting-invite.js'
import {
    notifyGuestHostChanged,
    notifyTransferAccepted,
    notifyTransferCancelled,
    notifyTransferOffer,
} from './hosting-transfer.js'
import { isReminderChoice, mergeReminder, reminderFits, setVisitReminder } from './visit-reminder.js'
import {
    announceEventToChats,
    buildEventIcs,
    applicationOf,
    applicationsForEvent,
    approveApplication,
    approvedApplicants,
    buildEventsFeedIcs,
    canEditEvent,
    canReviewEvent,
    cancelApplication,
    clearEventDraft,
    createApplication,
    createEvent,
    declineApplication,
    deleteEvent,
    editApplication,
    normalizeEventForm,
    notifyApplicantApproved,
    notifyReviewersNewApplication,
    botLinkBase,
    draftPhotoId,
    ensureEventFeedToken,
    eventDraftFor,
    eventForPhoto,
    eventNotifyPrefsFor,
    eventPhotoIds,
    eventsForDay,
    eventsLater,
    feedEvents,
    isStagedPhotoOf,
    listResponsibleCandidates,
    resolveResponsibles,
    restoreApplication,
    notifyEventCancelled,
    notifyEventMoved,
    notifyResidentsAboutEvent,
    prepareEventShare,
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
import { healthSnapshot } from './health.js'
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
    plural,
    rateFor,
    setDuesNotify,
    setDuesRate,
    syncDuesRoster,
    updateDuesSettings,
} from './dues.js'
import { announceTargets, broadcastAnnouncement, buildDefaultAnnouncement, fetchLatestRelease } from './announce.js'
import { buildCommit } from './build-info.js'
import { isValidMac, normalizeMac } from './keenetic.js'
import { isPresenceLogged, setPresenceNoLog } from './presence-log.js'
import {
    buildStatsDay,
    buildStatsDays,
    buildStatsOverview,
    buildStatsPerson,
    RESIDENT_SINCE_ORIGIN,
    setResidentSince,
    type StatsPeriod,
} from './stats.js'
import { buildWrapView, refreshWrapCache, wrapBrief } from './wrap.js'
import { currentPeriodLabel, periodKeyOf, renderBoardExport, type BoardRequest, type BoardRequests } from './fundraiser.js'
import { audit } from './audit.js'
import { holdUndo, takeUndo, undoLabel } from './undo.js'
import {
    doorCodeOf,
    isValidDoorCode,
    MAX_DOOR_NOTE_LENGTH,
    normalizeDoorCode,
    setDoorCode,
} from './door.js'
import { markOnboardingDone, onboardingOf, shouldShowOnboarding } from './onboarding.js'
import { rateLimit, retryAfterSeconds, type RateRule } from './ratelimit.js'
import { ANON_LABEL, isMacOnline, removePresence } from './presence.js'
import type { ResidentDirectory } from './residents.js'
import {
    RESIDENT_TAG,
    grantAdmin,
    readMemberState,
    revokeAdmin,
    setMemberTag,
    type AdminTarget,
    type AdminTargetKind,
} from './resident-admin.js'
import type { Storage } from './storage.js'
import type { DayAgenda, EventApplication, HostingRequest, HostingUser, RescheduleProposal, ResidentMacs, SpaceEvent, WalkIn } from './types.js'
import { own } from './types.js'

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
// Токены ссылок для GET-ручек (.ics, картинки)
// ---------------------------------------------------------------------------

/**
 * initData в URL класть нельзя: адрес оседает в истории системного браузера, в логах
 * туннеля и уходит целиком, если ссылку переслать, а подпись initData открывает весь
 * `/api/*` на сутки. Поэтому у GET-ссылок свой токен: подписан сервером, привязан к
 * области (`scope`) и живёт недолго. Ключ выведен из токена бота, но отличается от
 * ключа initData — подпись ссылки нельзя выдать за подпись Telegram и наоборот.
 */
const linkKey = (botToken: string): Buffer => createHmac('sha256', 'RobotLink').update(botToken).digest()

const linkSig = (botToken: string, scope: string, userId: number, exp: number): string =>
    createHmac('sha256', linkKey(botToken)).update(`${scope}|${userId}|${exp}`).digest('hex')

export const signLink = (botToken: string, scope: string, userId: number, exp: number): string =>
    `${userId}.${exp}.${linkSig(botToken, scope, userId, exp)}`

/** Чей это токен в области `scope`. null — подделан, протух или из другой области. */
export const verifyLink = (botToken: string, scope: string, token: string, now: Date = new Date()): number | null => {
    const m = /^(\d{1,16})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(token)
    if (!m) return null
    const userId = Number(m[1])
    const exp = Number(m[2])
    const expected = Buffer.from(linkSig(botToken, scope, userId, exp), 'hex')
    if (!timingSafeEqual(expected, Buffer.from(m[3]!, 'hex'))) return null
    if (now.getTime() / 1000 > exp) return null
    return userId
}

/** `.ics` открывают сразу после выдачи ссылки; запас — на экран, который держат открытым. */
const ICS_LINK_TTL_SEC = 15 * 60
/**
 * Токен картинок едет в bootstrap и сидит в `src` у каждой аватарки. Срок квантуем
 * окном: внутри окна URL не меняется и браузерный кэш картинок работает, а каждый
 * свежий bootstrap с новым сроком перекачивал бы все аватарки заново.
 */
const MEDIA_LINK_WINDOW_SEC = 6 * 60 * 60

export const mediaLinkToken = (botToken: string, userId: number, now: Date = new Date()): string => {
    const slot = Math.floor(now.getTime() / 1000 / MEDIA_LINK_WINDOW_SEC)
    return signLink(botToken, 'media', userId, (slot + 2) * MEDIA_LINK_WINDOW_SEC)
}

const icsScope = (kind: 'visit' | 'event', id: string): string => `ics:${kind}:${id}`

/** Заливка афиши — запись, поэтому полный initData, но в заголовке, а не в URL. */
const initDataFromHeader = (req: IncomingMessage): string => {
    const header = req.headers.authorization ?? ''
    const m = /^tma\s+(.+)$/i.exec(header.trim())
    return m?.[1] ?? ''
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

/**
 * Код последней ошибки, отданной этому ответу. Нужен журналу действий: статус говорит
 * «отказали», а причину («not_yours», «day_locked») знает только сам обработчик.
 */
const lastApiError = new WeakMap<ServerResponse, string>()

/** Ошибка API с человекочитаемым (русским) текстом — фронт показывает message как есть. */
const sendError = (res: ServerResponse, status: number, error: string, message: string): void => {
    lastApiError.set(res, error)
    sendJson(res, status, { error, message })
}

/** Срок антиспама «Я на месте» словами: хардкод в тексте разъехался бы с ARRIVAL_COOLDOWN_MS. */
const ARRIVAL_COOLDOWN_MINUTES = Math.round(ARRIVAL_COOLDOWN_MS / 60_000)
const ARRIVAL_COOLDOWN_LABEL = `${ARRIVAL_COOLDOWN_MINUTES} ${plural(ARRIVAL_COOLDOWN_MINUTES, ['минуту', 'минуты', 'минут'])}`

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Сколько ручка `close` ждёт DM гостю, прежде чем ответить «доставку не знаем». */
const CLOSE_DM_WAIT_MS = 5000

const VISIT_DAY_CLOSED = `Отмечать, кто пришёл, можно только в день визита и ночью после него, до ${VISIT_MARK_GRACE_UNTIL}.`

/**
 * Полки лимитов вне `/api/*`. Ключ у всех, кроме `ip`/`board`/`authFail`, — userId из
 * подписанного initData: подпись живёт сутки, и это единственная устойчивая личность
 * запроса (адрес за туннелем у всех общий, см. `clientIp`).
 */
const LIMITS = {
    /** Грубая сетка до аутентификации: сюда попадает всё, включая статику. Одна холодная
        загрузка миниаппа — это десятки запросов (бандл, картинки, аватарки), а без
        `CF-Connecting-IP` весь спейс приходит с одного адреса прокси — отсюда высокая полка. */
    ip: { limit: 1200, windowMs: MINUTE },
    /** Неудачные проверки подписи и токена табло. Дорого не само сравнение, а то, что за
        ним: без этой полки перебор initData/токена ничем не ограничен. */
    authFail: { limit: 60, windowMs: MINUTE },
    /** Общий потолок на человека по всем `/api/*` поверх классовых полок ниже. */
    user: { limit: 240, windowMs: MINUTE },
    /** Опрос табло: прошивка ходит раз в несколько минут, запас — на ретраи и отладку. */
    board: { limit: 60, windowMs: MINUTE },
    /** Файлы календаря: их открывает системный браузер, по одному на тап. */
    ics: { limit: 30, windowMs: MINUTE },
    /** Подписка календаря: клиент ходит раз в час сам, запас — на ручные обновления. */
    feed: { limit: 20, windowMs: MINUTE },
    /** Афиши ивентов: `<img>` на экране дня и в карточке. */
    photo: { limit: 120, windowMs: MINUTE },
    /** Заливка афиши: до 4 МБ на файл, каждая — запись на диск рядом со стейтом. */
    photoUpload: { limit: 12, windowMs: HOUR },
    /** Аватарки: список людей просит их пачкой, дальше работает кэш браузера. */
    avatar: { limit: 300, windowMs: MINUTE },
    /** Холодные промахи аватарок — единственная их часть, которая дёргает Telegram
        (`getUsers` + `downloadAsBuffer`). Ответ от полки не меняется (404 без кэша),
        меняется только то, греем ли мы кэш: очередь mtcute дороже пустой картинки. */
    avatarWarm: { limit: 40, windowMs: MINUTE },
} as const satisfies Record<string, RateRule>

/**
 * Класс метода API — по цене одного вызова, а не по важности.
 *
 * `dm` и `heavy` вынесены отдельно потому, что за ними стоит не наш процесс, а Telegram:
 * рассылка резидентам, бан во всех чатах, живой `getChatMembers`. Упереться там во
 * FLOOD_WAIT значит положить бота целиком — клиент mtcute на процесс один.
 */
type RateClass = 'read' | 'write' | 'dm' | 'heavy' | 'broadcast'

const CLASS_LIMITS: Record<RateClass, RateRule> = {
    /** Чтение: bootstrap, витрины журнала, взносы, архив. Ходит только в память и файлы. */
    read: { limit: 120, windowMs: MINUTE },
    /** Мутация стейта: каждая — перезапись всего JSON (записи коалесятся, но не бесплатны). */
    write: { limit: 40, windowMs: MINUTE },
    /** Всё, за чем уходит сообщение живому человеку. */
    dm: { limit: 15, windowMs: MINUTE },
    /** Поход в Telegram/GitHub/на диск за пределы обычной мутации. */
    heavy: { limit: 10, windowMs: MINUTE },
    /** Рассылка во все чаты сразу. */
    broadcast: { limit: 5, windowMs: HOUR },
}

/**
 * Классы методов. Неизвестный метод (в том числе перебор имён) считается `write` —
 * до `default: unknown_method` в `handleApi` он всё равно доходит через общий потолок.
 */
const METHOD_CLASS: Record<string, RateClass> = {
    bootstrap: 'read',
    archive: 'read',
    'archive.week': 'read',
    'guests.search': 'read',
    'guest.requests': 'read',
    'stats.overview': 'read',
    'stats.days': 'read',
    'stats.day': 'read',
    'stats.person': 'read',
    'wrap.month': 'read',
    'visits.day': 'read',
    'dues.period': 'read',
    'dues.history': 'read',
    'dues.person': 'read',
    'event.apps': 'read',
    'onboarding.done': 'write',
    'door.set': 'write',

    'rules.accept': 'write',
    'event.apply.edit': 'write',
    'event.apply.cancel': 'write',
    'day.lock': 'write',
    'day.cap': 'write',
    'day.agenda': 'write',
    'day.subscribe': 'write',
    edit: 'write',
    'remind.set': 'write',
    attend: 'write',
    'dev.update': 'write',
    'dev.delete': 'write',
    'event.draft.drop': 'write',
    'note.set': 'write',
    notify: 'write',
    'notify.events': 'write',
    'notify.attend': 'write',
    'calendar.link': 'write',
    'ics.link': 'read',
    'presence.log': 'write',
    'stats.residentSince': 'write',
    'mac.add': 'write',
    'mac.remove': 'write',
    'mac.anon': 'write',
    'dues.confirm': 'write',
    'dues.clear': 'write',
    'dues.rate': 'write',
    'dues.settings': 'write',
    'dues.notify': 'write',
    'visit.mark': 'write',
    'visit.markAll': 'write',
    'walkin.remove': 'write',
    undo: 'write',

    create: 'dm',
    invite: 'dm',
    approve: 'dm',
    unapprove: 'dm',
    cancel: 'dm',
    close: 'dm',
    arrived: 'dm',
    propose: 'dm',
    'proposal.accept': 'dm',
    'proposal.decline': 'dm',
    'transfer.offer': 'dm',
    'transfer.accept': 'dm',
    'transfer.decline': 'dm',
    'event.create': 'dm',
    'event.update': 'dm',
    'event.delete': 'dm',
    'event.apply': 'dm',
    'event.app.approve': 'dm',
    'event.app.decline': 'dm',
    'dues.claim': 'dm',
    // Карточка для выбора чата: вызов Telegram, а за ивентом с афишей ещё и заливка картинки.
    'share.prepare': 'dm',

    'invite.list': 'heavy',
    'dev.seed': 'heavy',
    block: 'heavy',
    unblock: 'heavy',
    'dues.export': 'heavy',
    'announce.latest': 'heavy',
    reviewers: 'heavy',
    'event.people': 'heavy',
    'admin.residents': 'heavy',
    'onboarding.people': 'heavy',
    'admin.status': 'heavy',
    'admin.grant': 'heavy',
    'admin.revoke': 'heavy',
    'admin.tag': 'heavy',
    // Кандидаты сверяются с составом резидентов, а добавление по @нику идёт в Telegram.
    'walkin.candidates': 'heavy',
    'walkin.add': 'heavy',

    'announce.send': 'broadcast',
}

/**
 * Персональные полки поверх классовой — там, где важна не скорость, а количество за
 * долгий срок: один вызов порождает событие в чужой личке или в общем чате.
 */
const METHOD_LIMITS: Record<string, RateRule> = {
    // Заявка = DM всем резидентам. Легальный всплеск — заявки на разные дни подряд.
    create: { limit: 12, windowMs: HOUR },
    // Зов = DM конкретному человеку; на день их зовут пачкой, отсюда запас.
    invite: { limit: 30, windowMs: HOUR },
    // Передача = DM конкретному резиденту; предлагать одну и ту же заявку по кругу незачем.
    'transfer.offer': { limit: 20, windowMs: HOUR },
    // Ивент = DM всем резидентам, как и заявка.
    'event.create': { limit: 10, windowMs: HOUR },
    // Бан во всех allowlist-чатах, откат — только через дева.
    block: { limit: 10, windowMs: HOUR },
    // Выгрузка = файл со всей таблицей взносов в личку.
    'dues.export': { limit: 6, windowMs: HOUR },
    // Пересылка ивентов и зова: живому человеку столько за час не нужно.
    'share.prepare': { limit: 30, windowMs: HOUR },
}

/**
 * Отдельная полка на пару «кто зовёт → кого зовут»: общего лимита на зовы мало, он не
 * мешает 30 раз подряд написать в личку одному и тому же человеку.
 */
const INVITE_TARGET_LIMIT: RateRule = { limit: 3, windowMs: HOUR }

const waitLabel = (seconds: number): string => {
    if (seconds < 60) return `${seconds} ${plural(seconds, ['секунду', 'секунды', 'секунд'])}`
    const minutes = Math.ceil(seconds / 60)
    return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`
}

/**
 * Отказ по лимиту. `Retry-After` — не украшение: миниапп показывает `message`, а вот
 * прошивка табло и браузер читают заголовок.
 *
 * `json: false` — для ручек, которые открывает браузер или `<img>`: тело там всё равно
 * никто не прочитает.
 */
const sendRateLimited = (res: ServerResponse, retryAfterMs: number, json = true): void => {
    const seconds = retryAfterSeconds(retryAfterMs)
    if (!json) {
        res.writeHead(429, { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' }).end()
        return
    }
    res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(seconds),
    })
    res.end(JSON.stringify({
        error: 'rate_limited',
        message: `Слишком часто. Попробуйте через ${waitLabel(seconds)}.`,
    }))
}

/** Гейт: списывает токен и, если не хватило, сам отвечает 429. `true` — можно продолжать. */
const allow = (res: ServerResponse, scope: string, key: string | number, rule: RateRule, json = true): boolean => {
    const verdict = rateLimit(scope, String(key), rule)
    if (verdict.ok) return true
    sendRateLimited(res, verdict.retryAfterMs, json)
    return false
}

const headerValue = (raw: string | string[] | undefined): string =>
    (Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim()

const stripV4Prefix = (ip: string): string => ip.replace(/^::ffff:/i, '')

/** Приватный ли адрес — то есть может ли он быть нашим же прокси, а не клиентом из интернета. */
const isPrivateAddr = (ip: string): boolean =>
    ip === '::1'
    || /^127\./.test(ip)
    || /^10\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || /^f[cd][0-9a-f]{2}:/i.test(ip)

/**
 * Адрес клиента для лимитов.
 *
 * Наружу миниапп смотрит через туннель, а порт контейнера не опубликован (см.
 * docker-compose): `remoteAddress` — это всегда сосед по докер-сети, один на всех.
 * Поэтому реальный адрес берём из заголовков, но **только** когда сокет действительно
 * пришёл из приватной сети: иначе любой клиент выписывал бы себе свежий бакет одним
 * заголовком.
 *
 * `CF-Connecting-IP` предпочтительнее `X-Forwarded-For`: Cloudflare перезаписывает его
 * на краю, и клиентское значение туда не проникает. XFF — фолбэк для другого прокси, и
 * он подделываем; отсюда и роли слоёв: IP — грубая сетка до аутентификации, настоящий
 * учёт идёт по userId из подписанного initData.
 */
const clientIp = (req: IncomingMessage): string => {
    const peer = stripV4Prefix(req.socket.remoteAddress ?? '')
    if (peer === '' || !isPrivateAddr(peer)) return peer || 'unknown'
    const cf = headerValue(req.headers['cf-connecting-ip'])
    if (cf) return stripV4Prefix(cf)
    const forwarded = headerValue(req.headers['x-forwarded-for']).split(',')[0]?.trim() ?? ''
    return forwarded ? stripV4Prefix(forwarded) : peer
}

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
    /** Цели выдачи прав резиденту (dev): «чат», канал анонсов, лайв-канал. Пусто — раздел скрыт. */
    adminTargets: AdminTarget[]
    /** Подключён ли принтер (PRINTER_URL): без него знакомство не зовёт в /printer. */
    hasPrinter: boolean
    /** Бот, как его видят в чатах: ник для диплинков из знакомства, имя для сцен в нём. */
    bot: { username: string | null; name: string }
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

/** Сколько прошедших визитов гостя отдаём в «Были раньше»: это напоминание, а не журнал. */
const MY_PAST_LIMIT = 3

/** От каких дат считается исход визита (см. `visitOutcome`): день запуска отметок и сегодня. */
type VisitDates = { since: string; today: string }

const visitDates = (ctx: ApiContext): VisitDates => ({
    since: ctx.storage.get().hostingVisitsSince,
    today: todayKey(ctx.tzOffsetMinutes),
})

/**
 * Исход визита для фронта. Кто и когда отметил - только резидентам: гость свой исход
 * видит, а кто из резидентов его отметил, ему знать незачем.
 */
const visitView = (r: HostingRequest, dates: VisitDates, withAuthor: boolean) => ({
    ...visitOutcome(r, dates.since, dates.today),
    by: withAuthor && r.visit ? userView(r.visit.by) : null,
    at: withAuthor && r.visit ? r.visit.at : null,
})

/**
 * Заявки для фронта. `viewerId` — кому мы их показываем: напоминание о визите это
 * личная настройка гостя, и в резидентских списках (дни, архив, карточка гостя) ему
 * делать нечего, поэтому поле едет только в своих заявках. `forResidents` — наоборот,
 * резидентские списки: передача хостинга гостя не касается, а исход визита в них идёт
 * с автором отметки.
 */
const requestsView = (
    list: HostingRequest[],
    dates: VisitDates,
    opts: { viewerId?: number; forResidents?: boolean } = {},
) => {
    const { viewerId, forResidents = false } = opts
    return list.map((r) => ({
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
        arrivedAt: r.arrivedAt ?? null,
        // Передача хостинга — внутренняя кухня резидентов: гостю незачем видеть, что
        // его визит пытаются передать. Поэтому поле едет только в резидентские списки.
        ...(forResidents && r.transfer ? { transfer: { ...r.transfer, to: userView(r.transfer.to), by: userView(r.transfer.by) } } : {}),
        ...(viewerId !== undefined && r.guest.userId === viewerId ? { remind: r.remind ?? null } : {}),
        ...(forResidents || (viewerId !== undefined && r.guest.userId === viewerId)
            ? { visit: visitView(r, dates, forResidents) }
            : {}),
    }))
}

const walkInView = (w: WalkIn) => ({
    id: w.id,
    dateKey: w.dateKey,
    guest: userView(w.guest),
    by: userView(w.by),
    at: w.at,
})

/**
 * «Кто пришёл» за день: заявки с исходом визита и гости без заявки. Отдельной ручкой,
 * а не только в bootstrap: прошедших дней в bootstrap нет, а отмечать их можно.
 */
const visitsDayView = (ctx: ApiContext, dateKey: string) => ({
    dateKey,
    editable: isVisitDayEditable(dateKey, ctx.tzOffsetMinutes),
    requests: requestsView(requestsForDay(ctx.storage, dateKey).filter(inVisitList), visitDates(ctx), { forResidents: true }),
    walkIns: walkInsForDay(ctx.storage, dateKey).map(walkInView),
})

/**
 * Кого можно добавить в день как пришедшего без заявки: принятые заявители ивентов
 * этого дня (их визит - ивент, заявки на визит у них обычно нет, поэтому они первые
 * кандидаты) и остальные известные боту гости. Без резидентов (их визиты видны по
 * присутствию), без заблокированных и без тех, кто на этот день уже есть.
 */
const walkInCandidates = async (ctx: ApiContext, dateKey: string) => {
    const { storage } = ctx
    const s = storage.get()
    const busy = new Set<number>([
        ...requestsForDay(storage, dateKey).filter(inVisitList).map((r) => r.guest.userId),
        ...walkInsForDay(storage, dateKey).map((w) => w.guest.userId),
    ])
    const residentIds = await ctx.residents.listIds()
    const keep = (u: HostingUser): boolean =>
        u.userId > 0 && !busy.has(u.userId) && !residentIds.has(u.userId) && !isBlocked(storage, u.userId)
    const eventIds = new Set(eventsForDay(storage, dateKey, true).map((e) => e.id))
    const fromEvents = new Map<number, HostingUser>()
    for (const a of Object.values(s.eventApplications)) {
        if (a.status === 'approved' && eventIds.has(a.eventId) && keep(a.guest)) fromEvents.set(a.guest.userId, a.guest)
    }
    const byName = (a: HostingUser, b: HostingUser): number => a.name.localeCompare(b.name, 'ru')
    return [
        ...[...fromEvents.values()]
            .map((u) => ({ ...u, name: displayName(u.name) }))
            .sort(byName)
            .map((u) => ({ ...u, fromEvent: true })),
        ...listKnownGuests(storage)
            .filter((u) => keep(u) && !fromEvents.has(u.userId))
            .sort(byName)
            .map((u) => ({ ...u, fromEvent: false })),
    ]
}

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
/**
 * Карточка ивента для миниаппа. Поля под зрителя:
 * - `form` — есть ли форма-заявка; гостю отдаём только блоки для заполнения, рецензенту
 *   вдобавок `reviewers` (кому её править/видеть настройку).
 * - `myApplication` — своя заявка (со снимком ответов для правки).
 * - `approvedAttendees`/`approvedCount` — публичный «кто придёт» по принятым заявкам.
 * - `canReview`/`applicationsPending` — только рецензенту: кнопка «Заявки · N».
 */
const eventView = (e: SpaceEvent, ctx: ApiContext) => {
    const base = {
        ...e,
        photos: eventPhotoIds(e),
        host: userView(e.host),
        // Ответственные — резидентское поле: гостю не отдаём вовсе (undefined выпадает из JSON).
        responsibles: ctx.resident ? (e.responsibles ?? []).map(userView) : undefined,
    }
    if (!e.form) return { ...base, form: null }
    const canReview = canReviewEvent(e, ctx.user.userId, ctx.resident, isDevUser(ctx))
    const mine = applicationOf(ctx.storage, e.id, ctx.user.userId)
    const approved = approvedApplicants(ctx.storage, e.id).filter((u) => !isFakeUserId(u.userId))
    return {
        ...base,
        form: { fields: e.form.fields, ...(canReview ? { reviewers: e.form.reviewers } : {}) },
        canReview,
        myApplication: mine ? { id: mine.id, status: mine.status, answers: mine.answers } : null,
        approvedAttendees: approved.map(userView),
        approvedCount: approved.length,
        ...(canReview
            ? { applicationsPending: applicationsForEvent(ctx.storage, e.id).filter((a) => a.status === 'pending').length }
            : {}),
    }
}

const EVENT_ERRORS: Record<EventError, string> = {
    not_found: 'Ивент не найден — обновите экран.',
    bad_date: 'Выберите день в пределах ближайшей недели.',
    bad_time: 'Укажите время в формате ЧЧ:ММ.',
    past_time: 'Это время уже прошло.',
    bad_title: 'Без названия ивент не понять — впиши его.',
    not_yours: 'Править ивент может тот, кто его завёл.',
}

/** Список афиш из тела: редактор присылает желаемый порядок целиком (см. `syncEventPhotos`). */
const photosFrom = (body: Record<string, unknown>): string[] =>
    Array.isArray(body.photos)
        ? body.photos.filter((id): id is string => typeof id === 'string').slice(0, MAX_EVENT_PHOTOS)
        : []

/**
 * Тон первой афиши из тела (см. `SpaceEvent.tone`). Строку получит каждый, кто откроет
 * ивент, и из неё считаются цвета его экрана, поэтому кладём только `#rrggbb`, а не то,
 * что прислали.
 */
const toneFrom = (body: Record<string, unknown>): string | null => {
    const tone = typeof body.tone === 'string' ? body.tone.trim().toLowerCase() : ''
    return /^#[0-9a-f]{6}$/.test(tone) ? tone : null
}

/** id ответственных из тела: сервер сам разрешит их в `HostingUser` (`resolveResponsibles`). */
const responsibleIdsFrom = (body: Record<string, unknown>): number[] =>
    Array.isArray(body.responsibles)
        ? body.responsibles.filter((id): id is number => Number.isInteger(id))
        : []

const eventInputFrom = (body: Record<string, unknown>): EventInput => ({
    dateKey: typeof body.dateKey === 'string' ? body.dateKey : '',
    time: typeof body.time === 'string' ? body.time : '',
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : '',
    residentsOnly: body.residentsOnly === true,
    form: normalizeEventForm(body.form),
})

/** Сообщения об ошибках заявки на ивент + HTTP-статусы. */
const APP_ERRORS = {
    not_found: 'Заявка не найдена — обновите экран.',
    no_form: 'На этот ивент заявки не принимаются.',
    not_visible: 'Ивент недоступен.',
    past: 'Ивент уже прошёл.',
    duplicate: 'Вы уже подали заявку на этот ивент.',
    required: 'Заполните обязательные поля.',
    not_pending: 'Заявку уже рассмотрели — правка недоступна.',
} as const
const APP_ERR_STATUS: Record<keyof typeof APP_ERRORS, number> = {
    not_found: 404,
    no_form: 400,
    not_visible: 403,
    past: 400,
    duplicate: 400,
    required: 400,
    not_pending: 400,
}

/** Дев-аккаунт из DEV_USER_IDS: переключатель перспективы и сид фейковых заявок. */
const isDevUser = (ctx: ApiContext): boolean => ctx.devUserIds.has(ctx.user.userId)

const statsPeriodOf = (raw: unknown): StatsPeriod =>
    raw === 'month' || raw === 'all' ? raw : 'quarter'

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
    const period = periodKey ? own(dues.periods, periodKey) : activeDuesPeriod(dues)
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

/** Статус одной цели для карточки резидента: где он состоит, где админ, стоит ли тег. */
type AdminTargetStatus = {
    key: string
    label: string
    kind: AdminTargetKind
    present: boolean
    creator: boolean
    admin: boolean
    canEdit: boolean
    canTag: boolean
    tag: string | null
    error: string | null
}

/**
 * Статус человека по всем целям выдачи прав. Дёргает Telegram (`getChatMember` на каждую
 * цель), поэтому метод отнесён к классу `heavy`. Заодно раскрываем userId для `/avatar.jpg`,
 * чтобы карточка нарисовалась с аватаркой.
 */
const adminStatusPayload = async (
    ctx: ApiContext,
    userId: number,
): Promise<{ userId: number; targets: AdminTargetStatus[] }> => {
    discloseUser(userId)
    const targets = await Promise.all(
        ctx.adminTargets.map(async (t): Promise<AdminTargetStatus> => {
            const s = await readMemberState(ctx.client, t.chatId, userId)
            return { key: t.key, label: t.label, kind: t.kind, canTag: t.canTag, ...s }
        }),
    )
    return { userId, targets }
}

/** Общий снапшот для фронта: 7 дней обзора, свои заявки, настройки (резиденту). */
const buildBootstrap = (ctx: ApiContext) => {
    const { storage, tzOffsetMinutes, user, resident } = ctx
    const today = todayKey(tzOffsetMinutes)
    const dates = visitDates(ctx)
    const myTally = guestVisitTally(storage, user.userId, today)
    const days = []
    for (let i = 0; i < HOSTING_DAYS_AHEAD; i++) {
        const dateKey = addDaysToKey(today, i)
        const requests = requestsForDay(storage, dateKey)
        const lock = dayLockFor(storage, dateKey)
        const agenda = dayAgendaFor(storage, dateKey)
        days.push({
            dateKey,
            total: requests.length,
            // Закрытый день виден всем: гость должен понимать, почему день не выбрать.
            // Кто именно закрыл — только резидентам: это внутренняя кухня спейса.
            lock: lock
                ? { reason: lock.reason, ...(resident ? { by: userView(lock.by), at: lock.at } : {}) }
                : null,
            // Повестку видят все, автора - по тому же правилу, что у замка.
            agenda: agenda
                ? { text: agenda.text, ...(resident ? { by: userView(agenda.by), at: agenda.at } : {}) }
                : null,
            approved: requests.filter((r) => r.status === 'approved').length,
            // Детали заявок видят резиденты и dev-аккаунты (последним они нужны для
            // дев-меню — правка и удаление). Гостям — только счётчики.
            ...(resident || isDevUser(ctx) ? { requests: requestsView(requests, dates, { forResidents: true }) } : {}),
            // Мягкий лимит вместимости — резидентам: решение «брать или не брать» за
            // ними, а «осталось два места» у гостя превратило бы заявку в гонку.
            ...(resident
                ? {
                    capacity: {
                        ...dayOccupancy(storage, dateKey),
                        custom: dayCapOverride(storage, dateKey) !== null,
                        // Общая вместимость едет рядом с дневной: подсказка «рекомендуем 15»
                        // должна называть её и тогда, когда у дня стоит своё число.
                        defaultCap: SPACE_CAPACITY,
                    },
                    // Подписан ли резидент на события этого дня — резидентская фича.
                    subscribed: isDaySubscribed(storage, dateKey, user.userId),
                    // Пришедшие без заявки бывают только сегодня: будущего дня ещё не было.
                    walkIns: walkInsForDay(storage, dateKey).map(walkInView),
                }
                : {}),
            // Публичный список «кто придёт» — виден всем.
            attendees: attendeesForDay(storage, dateKey).map(userView),
            // Ивенты дня: гостю — только открытые, резиденту — все.
            events: eventsForDay(storage, dateKey, resident).map((e) => eventView(e, ctx)),
        })
    }
    const myRequests = Object.values(storage.get().hostingRequests)
        .filter((r) => r.guest.userId === user.userId && r.dateKey >= today)
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))
    // Свои прошедшие визиты: наутро после визита экран гостя иначе пуст - он видел
    // только заявки с датой ≥ сегодня. Последние MY_PAST_LIMIT, свежие сверху.
    const myPast = Object.values(storage.get().hostingRequests)
        .filter((r) => r.guest.userId === user.userId && r.dateKey < today)
        .sort((a, b) => (a.dateKey === b.dateKey ? b.time.localeCompare(a.time) : b.dateKey.localeCompare(a.dateKey)))
        .slice(0, MY_PAST_LIMIT)

    const binding = storage.get().macBindings[String(user.userId)]
    const settings = resident
        ? {
            notify: notifyPrefsFor(storage, user.userId),
            eventNotify: eventNotifyPrefsFor(storage, user.userId),
            macs: binding
                ? [...binding.macs].sort((a, b) => a.mac.localeCompare(b.mac)).map((m) => ({ ...m, online: isMacOnline(m.mac) }))
                : [],
            macAnon: binding?.anon ?? false,
            macPresenceActive: storage.get().presence[String(user.userId)]?.source === 'mac',
            logVisits: isPresenceLogged(storage, user.userId),
        }
        : null

    // Подпись «now running <коммит>» внизу настроек: ссылка ведёт на сам коммит в GitHub.
    // Ссылку собирает сервер — только он знает и репо, и на чём собран.
    const commit = buildCommit()

    return {
        build: commit
            ? { commit: commit.slice(0, 7), url: `https://github.com/${ctx.githubRepo}/commit/${commit}` }
            : null,
        mediaToken: mediaLinkToken(ctx.botToken, user.userId),
        // Ник бота для ссылки t.me на ивент: ею «Переслать» делится на клиентах старше Bot API 8.0.
        bot: ctx.bot.username,
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
        // Ивенты дальше окна обзора: их день в `days` не попадает, а показать их надо —
        // и автору (иначе он не поправит собственный анонс), и всем остальным.
        laterEvents: eventsLater(storage, tzOffsetMinutes, resident).map((e) => eventView(e, ctx)),
        myRequests: requestsView(myRequests, dates, { viewerId: user.userId }),
        myPast: requestsView(myPast, dates, { viewerId: user.userId }),
        // Гостю только сколько раз он был. Число неявок резиденты видят в его профиле, а
        // ему самому оно читалось бы упрёком.
        myVisits: { visits: myTally.visits },
        settings,
        // Гостевая настройка, но едет всем: перспектива «гость» у дева читает этот же
        // bootstrap, а сервер про перспективу не знает.
        attendNotify: guestAttendPrefsFor(storage, user.userId),
        // Какой это по счёту визит человека - резидентская информация: она отвечает на
        // вопрос «кого я пускаю», а гостю чужая история визитов не полагается.
        ...(resident ? { guestStats: guestVisitStats(storage, today) } : {}),
        // Вчерашний день, пока его ещё можно отметить: после полуночи экран дня уже про
        // новую дату, и без отдельного входа отметить вечер было бы неоткуда, кроме архива.
        ...(resident ? { visitGraceDay: visitGraceDay(tzOffsetMinutes) } : {}),
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
        // Знакомство с ботом: открыть ли его само и что показывать в его шагах.
        ...(resident
            ? {
                onboarding: {
                    show: shouldShowOnboarding(storage, user.userId),
                    joinedAt: onboardingOf(storage, user.userId)?.joinedAt ?? null,
                    printer: ctx.hasPrinter,
                    bot: ctx.bot.username,
                    botName: ctx.bot.name,
                },
            }
            : {}),
        // Итоги прошлого месяца: плашка на главной и строка в статистике. Только кэш, без
        // чтения журнала: bootstrap собирается на каждую мутацию.
        ...(resident ? { wrap: wrapBrief(storage, user.userId, tzOffsetMinutes) } : {}),
        // Код домофона - ключ от подъезда: только резидентам и дев-аккаунтам, которые
        // его правят. Гостю не уходит никогда.
        ...(resident || isDevUser(ctx) ? { door: doorView(ctx) } : {}),
    }
}

const doorView = (ctx: ApiContext) => {
    const door = doorCodeOf(ctx.storage)
    return door ? { code: door.code, note: door.note } : null
}

// ---------------------------------------------------------------------------
// Журнал действий (см. src/audit.ts)
// ---------------------------------------------------------------------------

/**
 * Методы, которые попадают в журнал: только значимые мутации. Чтения не пишем вовсе —
 * каждая мутация возвращает bootstrap, и без этого фильтра журнал на четыре пятых
 * состоял бы из него.
 */
const AUDITED = new Set([
    'create', 'edit', 'cancel', 'approve', 'unapprove', 'close',
    'propose', 'proposal.accept', 'proposal.decline',
    'transfer.offer', 'transfer.accept', 'transfer.decline',
    'day.lock', 'day.cap', 'day.agenda', 'block', 'unblock', 'note.set',
    'visit.mark', 'visit.markAll', 'walkin.add', 'walkin.remove',
    'event.create', 'event.update', 'event.delete',
    'event.app.approve', 'event.app.decline',
    'dues.claim', 'dues.confirm', 'dues.clear', 'dues.rate', 'dues.settings',
    'announce.send', 'stats.residentSince',
    'admin.grant', 'admin.revoke', 'admin.tag',
    'dev.seed', 'dev.update', 'dev.delete',
    'onboarding.done', 'door.set', 'undo',
])

/** Снимок объектов, которых после вызова может уже не быть либо они изменятся. */
type AuditBefore = {
    request: HostingRequest | null
    event: SpaceEvent | null
    application: EventApplication | null
    agenda: DayAgenda | null
    walkIn: WalkIn | null
    undo: string | null
}

/**
 * Снимок берётся ДО `handleApi`: `close`, `cancel`, `dev.delete` и `event.delete`
 * стирают объект из стейта, а `approve`/`edit`/`proposal.*` переписывают ровно те
 * поля, о которых потом и надо рассказать. Копия поверхностная — вложенные объекты
 * (`proposal`, `approvedBy`) обработчики заменяют целиком, а не правят на месте.
 */
const auditBefore = (ctx: ApiContext, method: string): AuditBefore | null => {
    if (!AUDITED.has(method)) return null
    const id = typeof ctx.body.id === 'string' ? ctx.body.id : ''
    const state = ctx.storage.get()
    const request = own(state.hostingRequests, id)
    const event = own(state.events, id)
    // Для методов разбора заявок `body.id` — id заявки на ивент (её decline удаляет).
    const application = own(state.eventApplications, id)
    // Правка повестки перезаписывает `by`, а снятие стирает запись целиком: кто ставил
    // её до этого, знает только снимок.
    const dateKey = typeof ctx.body.dateKey === 'string' ? ctx.body.dateKey : ''
    const agenda = method === 'day.agenda' ? own(state.hostingDayAgenda, dateKey) : undefined
    // `walkin.remove` стирает запись: кого убрали, знает только снимок.
    const walkIn = own(state.hostingWalkIns, id)
    return {
        request: request ? { ...request } : null,
        event: event ? { ...event } : null,
        application: application ? { ...application } : null,
        agenda: agenda ? { ...agenda } : null,
        walkIn: walkIn ? { ...walkIn } : null,
        undo: method === 'undo' ? undoLabel(strOf(ctx.body.token)) : null,
    }
}

const slotOf = (dateKey: string, time: string): string => `${dateKey} ${time}`.trim()
const whoOf = (u: HostingUser): string => (u.username ? `@${u.username}` : displayName(u.name))
const strOf = (v: unknown): string => (typeof v === 'string' ? v : '')
const idOf = (v: unknown): string => `id ${typeof v === 'number' ? v : Number(v)}`
/** Анонс уходит во все чаты, так что его текст не тайна — но и целиком в строке журнала не нужен. */
const excerpt = (text: string, limit = 120): string =>
    text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text

/** Какие поля настроек взносов трогали. Значения не пишем: среди них реквизиты. */
const duesSettingsFields = (body: Record<string, unknown>): string =>
    ['enabled', 'day', 'amount', 'studentAmount', 'requisites'].filter((k) => body[k] !== undefined).join(', ')

/**
 * Фраза для журнала. Пишет, что человек сделал, а не какие поля пришли в теле:
 * заявка к моменту чтения журнала может быть давно удалена, и один только её id
 * ничего не расскажет.
 *
 * Цель визита и текст заметки сюда не попадают — это содержимое, а не действие.
 */
const describeAudit = (ctx: ApiContext, method: string, before: AuditBefore): string | null => {
    const { body, storage, user } = ctx
    const id = strOf(body.id)
    const req = before.request
    const ev = before.event
    const target = req ? ` заявки ${whoOf(req.guest)}` : ` заявки ${id}`
    const reqSlot = req ? slotOf(req.dateKey, req.time) : '?'
    switch (method) {
        case 'create':
            return `оставил заявку на ${slotOf(strOf(body.dateKey), strOf(body.time))}`
        case 'edit': {
            if (!req) return `поправил заявку ${id}`
            const now = own(storage.get().hostingRequests, id)
            const to = now ? slotOf(now.dateKey, now.time) : slotOf(strOf(body.dateKey), strOf(body.time))
            return to === reqSlot ? `поправил свою заявку на ${to}` : `перенёс свою заявку ${reqSlot} → ${to}`
        }
        case 'cancel':
            return `отменил свою заявку на ${reqSlot}`
        case 'approve':
            return `захостил${target} на ${reqSlot}`
        case 'unapprove':
            return `снял хостинг с${target} на ${reqSlot}`
        // Сам комментарий не пишем: это сообщение гостю, то есть содержимое, а не действие.
        case 'close':
            return `закрыл${target} на ${reqSlot}${strOf(body.comment).trim() ? ' (с комментарием)' : ''}`
        case 'propose': {
            const asked = slotOf(strOf(body.dateKey) || (req?.dateKey ?? ''), strOf(body.time))
            const now = own(storage.get().hostingRequests, id)
            // Встречное предложение тем же слотом сервер засчитывает как согласие:
            // предложения после вызова уже нет, а слот заявки стал предложенным.
            if (req?.proposal && now && !now.proposal) return `принял перенос${target}: ${slotOf(now.dateKey, now.time)}`
            return `предложил перенос${target}: ${asked}`
        }
        case 'proposal.accept': {
            const p = req?.proposal
            return `принял перенос${target}: ${p ? slotOf(p.dateKey, p.time) : '?'}`
        }
        case 'proposal.decline': {
            const p = req?.proposal
            // Своё снял или чужое отклонил — для читателя журнала это разные события.
            const verb = p && p.user.userId === user.userId ? 'отозвал' : 'отклонил'
            return `${verb} перенос${target}${p ? `: ${slotOf(p.dateKey, p.time)}` : ''}`
        }
        case 'transfer.offer':
            return `предложил передать${target} на ${reqSlot} резиденту ${idOf(body.userId)}`
        case 'transfer.accept': {
            const t = req?.transfer
            return `взял${target} на ${reqSlot} на себя${t ? ` (от ${whoOf(t.by)})` : ''}`
        }
        case 'transfer.decline': {
            const t = req?.transfer
            // Автор отзывает своё предложение, адресат отказывается — события разные.
            const verb = t && t.by.userId === user.userId ? 'отозвал передачу' : 'отказался подхватить'
            return `${verb}${target} на ${reqSlot}`
        }
        case 'day.cap': {
            const day = strOf(body.dateKey)
            return typeof body.cap === 'number'
                ? `поставил вместимость ${body.cap} на ${day}`
                : `вернул общую вместимость на ${day}`
        }
        case 'day.lock': {
            const reason = strOf(body.reason).trim()
            const day = strOf(body.dateKey)
            return body.locked === true
                ? `закрыл день ${day} для заявок${reason ? ` (${reason})` : ''}`
                : `открыл день ${day} для заявок`
        }
        case 'day.agenda': {
            // Текст повестки публичный (его видят гости и доска), поэтому он здесь
            // уместен, как причина закрытия дня.
            const text = strOf(body.text).trim()
            const day = strOf(body.dateKey)
            const prev = before.agenda
            const prevAuthor = prev && prev.by.userId !== user.userId ? ` (ставил ${whoOf(prev.by)})` : ''
            if (!text) return `убрал повестку на ${day}${prevAuthor}`
            return `${prev ? 'изменил' : 'поставил'} повестку на ${day}: «${excerpt(text)}»${prevAuthor}`
        }
        case 'block':
            return req ? `заблокировал ${whoOf(req.guest)} (${idOf(req.guest.userId)})` : `заблокировал гостя заявки ${id}`
        case 'unblock':
            return `разблокировал ${idOf(body.userId)}`
        case 'note.set':
            return `${strOf(body.text).trim() ? 'изменил' : 'удалил'} заметку о ${idOf(body.userId)}`
        case 'visit.mark': {
            const what = body.came === true ? 'отметил, что пришёл' : body.came === false ? 'отметил неявку' : 'снял отметку визита'
            // Перезаписанную чужую отметку видно только по снимку: после вызова в заявке уже своя.
            const prev = req?.visit && req.visit.by.userId !== user.userId ? ` (была отметка ${whoOf(req.visit.by)})` : ''
            return `${what}: ${req ? whoOf(req.guest) : id} на ${reqSlot}${prev}`
        }
        case 'visit.markAll':
            return `отметил пришедшими всех подтверждённых гостей ${strOf(body.dateKey)}`
        case 'walkin.add': {
            const who = typeof body.userId === 'number'
                ? idOf(body.userId)
                : strOf(body.username).trim()
                    ? `@${strOf(body.username).trim().replace(/^@/, '')}`
                    : `«${strOf(body.name).trim()}» (без аккаунта)`
            return `добавил гостя без заявки на ${strOf(body.dateKey)}: ${who}`
        }
        case 'walkin.remove': {
            const w = before.walkIn
            return w ? `убрал гостя без заявки ${whoOf(w.guest)} с ${w.dateKey}` : `убрал гостя без заявки ${id}`
        }
        case 'event.create':
            return `завёл ивент «${strOf(body.title)}» на ${slotOf(strOf(body.dateKey), strOf(body.time))}`
        case 'event.update': {
            if (!ev) return `поправил ивент ${id}`
            const now = own(storage.get().events, id)
            const from = slotOf(ev.dateKey, ev.time)
            const to = now ? slotOf(now.dateKey, now.time) : from
            return to !== from
                ? `перенёс ивент «${ev.title}» ${from} → ${to}`
                : `поправил ивент «${now?.title ?? ev.title}» на ${from}`
        }
        case 'event.delete':
            return ev ? `удалил ивент «${ev.title}» на ${slotOf(ev.dateKey, ev.time)}` : `удалил ивент ${id}`
        case 'event.app.approve':
        case 'event.app.decline': {
            const app = before.application
            if (!app) return method === 'event.app.approve' ? `принял заявку на ивент ${id}` : `отклонил заявку на ивент ${id}`
            const evt = own(storage.get().events, app.eventId)
            const title = evt ? `«${evt.title}»` : `ивент ${app.eventId}`
            const verb = method === 'event.app.approve' ? 'принял' : 'отклонил'
            return `${verb} заявку ${whoOf(app.guest)} на ${title}`
        }
        case 'dues.claim':
            return 'отметил свой взнос'
        case 'dues.confirm':
            return `подтвердил взнос ${idOf(body.userId)} за ${strOf(body.periodKey) || 'текущий период'}`
        case 'dues.clear':
            return `снял отметку о взносе ${idOf(body.userId)} за ${strOf(body.periodKey) || 'текущий период'}`
        case 'dues.rate': {
            const kind = strOf(body.kind)
            return `поставил ставку «${kind}»${kind === 'custom' ? ` ${Number(body.amount)}` : ''} для ${idOf(body.userId)}`
        }
        case 'dues.settings':
            return `изменил настройки взносов (${duesSettingsFields(body) || 'без изменений'})`
        case 'announce.send':
            return `разослал анонс${strOf(body.version) ? ` ${strOf(body.version)}` : ''}: ${excerpt(strOf(body.text))}`
        case 'stats.residentSince':
            return `поставил «резидент с» ${strOf(body.dateKey) || '(сброс)'} для ${idOf(body.userId)}`
        case 'dev.seed':
            return `[dev] создал фейковую заявку на ${slotOf(strOf(body.dateKey), strOf(body.time))}`
        case 'dev.update':
            return `[dev] поправил${target}: ${reqSlot} → ${slotOf(strOf(body.dateKey), strOf(body.time))}`
        case 'dev.delete':
            return `[dev] удалил${target} на ${reqSlot}`
        case 'admin.grant':
        case 'admin.revoke': {
            const label = ctx.adminTargets.find((t) => t.key === strOf(body.target))?.label ?? strOf(body.target)
            return `${method === 'admin.grant' ? 'выдал админку' : 'снял админку'} «${label}» — ${idOf(body.userId)}`
        }
        case 'admin.tag':
            return `${body.on === true ? 'поставил' : 'снял'} тег резидента — ${idOf(body.userId)}`
        case 'onboarding.done':
            return 'прошёл знакомство с ботом'
        // Сам код в журнал не пишем: ключ от подъезда не должен оседать в файлах на сервере.
        case 'door.set':
            return strOf(body.code).trim() ? 'поменял код домофона' : 'убрал код домофона'
        // Сам токен ничего не скажет: что вернули, знает только снимок до вызова.
        case 'undo':
            return before.undo ? `вернул: ${before.undo}` : 'нажал «Вернуть»'
        default:
            return null
    }
}

/**
 * Пишет строку журнала уже после обработчика: статус ответа известен только там.
 * Отказы попадают в журнал вместе с успехами — «резидент попытался закрыть чужой
 * визит, 403» это ровно то, от чего в стейте не остаётся никакого следа.
 */
const logApiAudit = (ctx: ApiContext, method: string, before: AuditBefore): void => {
    const { res, user } = ctx
    const text = describeAudit(ctx, method, before)
    if (text === null) return
    // Заголовков нет — обработчик бросил исключение, 500 напишет внешний catch уже после нас.
    const status = res.headersSent ? res.statusCode : 500
    const ok = status < 400
    const error = ok ? undefined : `${status} ${lastApiError.get(res) ?? ''}`.trim()
    const id = strOf(ctx.body.id)
    audit({
        action: method,
        actor: { id: user.userId, username: user.username, name: user.name },
        ok,
        ...(error ? { error } : {}),
        text: ok ? text : `${text} — отказ (${error})`,
        ...(id ? { meta: { id } } : {}),
    })
}

/**
 * «Вернуть» после отвязки устройства (src/undo.ts): запись встаёт на прежнее место в
 * списке. Нельзя, если за время отсчёта этот MAC привязал кто-то, в том числе сам человек.
 */
const restoreMacBinding = async (storage: Storage, before: ResidentMacs, mac: string): Promise<boolean> => {
    const index = before.macs.findIndex((e) => e.mac === mac)
    const entry = before.macs[index]
    if (!entry) return false
    if (Object.values(storage.get().macBindings).some((b) => b.macs.some((e) => e.mac === mac))) return false
    await storage.update((s) => {
        const key = String(before.userId)
        const cur = s.macBindings[key]
        if (!cur) {
            // Остальные устройства могли уйти своей отвязкой: возвращаем только это.
            s.macBindings[key] = { ...before, macs: [entry] }
            return
        }
        cur.macs.splice(Math.min(index, cur.macs.length), 0, entry)
        cur.updatedAt = new Date().toISOString()
    })
    return true
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
        const request = own(storage.get().hostingRequests, id)
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
            // Плашка итогов месяца читает кэш журнала, а сам bootstrap синхронный: кэш
            // освежаем здесь, где подождать чтение файла не страшно.
            if (resident) await refreshWrapCache(storage, tzOffsetMinutes)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // «Вернуть» после обратимого действия (src/undo.ts): объект встаёт тем же, а
        // отложенная личка не уходит. Отсчёт кончился или за это время что-то изменилось -
        // действие остаётся в силе.
        case 'undo': {
            const token = typeof body.token === 'string' ? body.token : ''
            const result = await takeUndo(token, user.userId)
            if (result === 'gone') {
                sendError(res, 410, 'undo_gone', 'Уже не вернуть: время вышло.')
                return
            }
            if (result === 'stale') {
                sendError(res, 409, 'undo_stale', 'Уже не вернуть: за это время всё изменилось.')
                return
            }
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
            // Срок, который к моменту отправки уже не успевает (гость держал форму открытой),
            // молча гасим: отказывать в самой заявке из-за необязательного напоминания нельзя.
            const remind = isReminderChoice(body.remind) && reminderFits(dateKey, time, body.remind, tzOffsetMinutes)
                ? mergeReminder(null, body.remind, true)
                : null
            const created = await createHostingRequest(storage, tzOffsetMinutes, { guest: user, dateKey, time, purpose, anon, remind })
            if (!created.ok) {
                const messages = {
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время прихода в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У вас уже есть заявка на этот день.',
                    day_locked: 'В этот день спейс закрыт для гостей — выберите другой.',
                } as const
                sendError(res, 400, created.error, messages[created.error])
                return
            }
            // Рассылка резидентам — в фоне, чтобы не держать ответ гостю.
            void notifyResidentsAboutRequest(client, storage, residents, tzOffsetMinutes, config.publicUrl, created.request)
                .catch((err) => console.error('[hosting] не удалось разослать уведомления о заявке:', err))
            syncBoard()
            sendJson(res, 200, { request: requestsView([created.request], visitDates(ctx), { viewerId: user.userId })[0], ...buildBootstrap(ctx) })
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
            // Слот сравниваем до правки: от этого зависит, переживёт ли её отметка
            // «напоминание уже отправлено» (см. mergeReminder).
            const slotChanged = dateKey !== request.dateKey || time !== request.time
            const choice = isReminderChoice(body.remind) && reminderFits(dateKey, time, body.remind, tzOffsetMinutes)
                ? body.remind
                : null
            const remind = mergeReminder(request.remind, choice, slotChanged)
            const edited = await editHostingRequest(storage, tzOffsetMinutes, request.id, user.userId, { dateKey, time, purpose, anon, remind })
            if (!edited.ok) {
                const messages = {
                    not_found: 'Заявка не найдена — возможно, её уже отменили.',
                    not_pending: 'Заявку уже одобрили — измени её через отмену и новую заявку.',
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время прихода в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У вас уже есть заявка на этот день.',
                    day_locked: 'В этот день спейс закрыт для гостей — выберите другой.',
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
            sendJson(res, 200, { request: requestsView([edited.request], visitDates(ctx), { viewerId: user.userId })[0], ...buildBootstrap(ctx) })
            return
        }

        // Напоминание о своём визите: включить, поменять срок или выключить уже после
        // создания заявки. Стоит отдельным глаголом, потому что менять его можно и у
        // подтверждённого визита, а правка заявки (`edit`) доступна только пока она pending.
        case 'remind.set': {
            const raw = body.choice
            const choice = raw === null || raw === 'off' ? null : isReminderChoice(raw) ? raw : undefined
            if (choice === undefined) {
                sendError(res, 400, 'bad_choice', 'Не понял, за сколько напомнить.')
                return
            }
            const result = await setVisitReminder(storage, tzOffsetMinutes, typeof body.id === 'string' ? body.id : '', user.userId, choice)
            if (!result.ok) {
                const messages = {
                    not_found: [404, 'Заявка не найдена — возможно, её уже отменили.'],
                    not_yours: [403, 'Напоминание можно настроить только по своей заявке.'],
                    too_late: [400, 'До визита осталось меньше этого срока — напоминание не успеет.'],
                } as const
                const [status, message] = messages[result.error]
                sendError(res, status, result.error, message)
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Резидент отмечает «я приду» / снимает отметку на день (без заявки). Время
        // необязательно: не пришло - остаётся прежнее, null - снять.
        case 'attend': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const coming = body.coming === true
            const time = body.time === null ? null : typeof body.time === 'string' ? body.time : undefined
            const result = await setResidentAttendance(storage, tzOffsetMinutes, dateKey, user, coming, time)
            if (!result.ok) {
                const messages = {
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло, выберите позже.',
                } as const
                sendError(res, 400, result.error, messages[result.error])
                return
            }
            // Только на реальный приход (не на повторный тап, не на смену времени и не на снятие отметки).
            if (coming && result.changed) {
                void notifySubsAttending(client, storage, config.publicUrl, dateKey, user, typeof time === 'string' ? time : null)
                    .catch((err) => console.error('[hosting] не удалось уведомить подписчиков дня:', err))
            }
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Закрыть/открыть день для гостевых заявок: любой резидент, это оперативное решение
        // («сегодня никого не будет»), а не настройка спейса. Существующие заявки закрытие
        // НЕ трогает — удалять чужой согласованный визит тумблером нельзя, для этого есть
        // «Закрыть заявку» с DM гостю.
        case 'day.lock': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const locked = body.locked === true
            const reason = typeof body.reason === 'string' ? body.reason : ''
            if (reason.length > MAX_LOCK_REASON_LENGTH) {
                sendError(res, 400, 'too_long', `Причина не длиннее ${MAX_LOCK_REASON_LENGTH} символов.`)
                return
            }
            const result = await setDayLock(storage, tzOffsetMinutes, dateKey, locked, reason, user)
            if (!result.ok) {
                sendError(res, 400, result.error, 'Закрыть можно только день из ближайшей недели.')
                return
            }
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Повестка дня: ставит и правит любой резидент, как и замок. Пустой текст снимает её.
        case 'day.agenda': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const text = typeof body.text === 'string' ? body.text : ''
            if (text.length > MAX_AGENDA_LENGTH) {
                sendError(res, 400, 'too_long', `Повестка не длиннее ${MAX_AGENDA_LENGTH} символов.`)
                return
            }
            const result = await setDayAgenda(storage, tzOffsetMinutes, dateKey, text, user)
            if (!result.ok) {
                sendError(res, 400, result.error, 'Повестку можно поставить только на день из ближайшей недели.')
                return
            }
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Вместимость дня: мягкий лимит, сервер по нему ничего не запрещает — он только
        // считает занятые места, а предупреждает о превышении миниапп при «Захостить».
        case 'day.cap': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            // null — вернуть общую вместимость спейса.
            const cap = typeof body.cap === 'number' ? body.cap : null
            const result = await setDayCap(storage, tzOffsetMinutes, dateKey, cap, user)
            if (!result.ok) {
                sendError(res, 400, result.error, result.error === 'bad_cap'
                    ? `Вместимость — целое число от 1 до ${MAX_DAY_CAP}.`
                    : 'Менять вместимость можно только у дня из ближайшей недели.')
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Подписка резидента на события дня: DM о хостинге, отметках «я приду» и переносах.
        case 'day.subscribe': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const on = body.on === true
            const result = await setDaySubscription(storage, tzOffsetMinutes, dateKey, user.userId, on)
            if (!result.ok) {
                sendError(res, 400, result.error, 'Подписаться можно только на день из ближайшей недели.')
                return
            }
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
                sendError(res, 404, 'not_found', 'Этого человека больше нет в списке — обновите экран.')
                return
            }
            // Полка на пару «кто зовёт → кого зовут»: общего лимита на зовы мало, он не
            // мешает написать одному и тому же человеку тридцать раз подряд.
            if (!allow(res, 'invite.target', `${user.userId}>${targetId}`, INVITE_TARGET_LIMIT)) return
            const sent = await sendHostingInvite(
                client, storage, residents, tzOffsetMinutes, config.publicUrl, dateKey, target, user,
            )
            if (!sent.ok) {
                const messages = {
                    bad_date: 'Позвать можно только на ближайшую неделю.',
                    blocked: 'Этот участник заблокирован.',
                    self: 'Себя звать не нужно — просто отметься «я приду».',
                    dm_closed: 'Не смог написать ему в личку: он не открывал чат с ботом.',
                    day_locked: 'В этот день спейс закрыт для гостей — звать их некуда.',
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
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло.',
                    duplicate: 'У этого фейкового гостя уже есть заявка на день.',
                    day_locked: 'Этот день закрыт для заявок — открой его или выбери другой.',
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
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время в формате ЧЧ:ММ.',
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
            const updated = own(storage.get().hostingRequests, request.id)
            if (updated) {
                void notifyGuestApproved(client, config.publicUrl, updated)
                    .catch((err) => console.error('[hosting] не удалось уведомить гостя об одобрении:', err))
                void notifySubsHosted(client, storage, config.publicUrl, updated, user)
                    .catch((err) => console.error('[hosting] не удалось уведомить подписчиков дня:', err))
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
            // Хоста больше нет — висящая просьба подхватить визит теряет смысл вместе с ним.
            const pendingTransfer = request.transfer ?? null
            const prev = { approvedBy: request.approvedBy, approvedAt: request.approvedAt, transfer: pendingTransfer }
            await storage.update((s) => {
                const r = s.hostingRequests[request.id]
                if (r) {
                    r.status = 'pending'
                    r.approvedBy = null
                    r.approvedAt = null
                    r.transfer = null
                }
            })
            // Гостю и адресату передачи пишем по концу отсчёта «Вернуть» и только если визит за
            // это время снова никто не взял: иначе «хоста больше нет» пришло бы гостю уже после
            // «визит подтверждён».
            const undo = holdUndo(
                user.userId,
                `снял хостинг с заявки ${whoOf(request.guest)} на ${slotOf(request.dateKey, request.time)}`,
                async () => {
                    const ok = await restoreApproval(storage, request.id, prev)
                    if (ok) syncBoard()
                    return ok
                },
                async () => {
                    const now = own(storage.get().hostingRequests, request.id)
                    if (!now || now.status !== 'pending') return
                    if (pendingTransfer) {
                        await notifyTransferCancelled(client, now, pendingTransfer, true)
                            .catch((err) => console.error('[hosting] не удалось уведомить о снятии передачи:', err))
                    }
                    await notifyGuestUnapproved(client, config.publicUrl, now)
                        .catch((err) => console.error('[hosting] не удалось уведомить гостя об отмене хостинга:', err))
                },
            )
            syncBoard()
            sendJson(res, 200, { ...buildBootstrap(ctx), undo })
            return
        }

        case 'cancel': {
            const request = findRequest()
            if (!request) return
            if (request.guest.userId !== user.userId) {
                sendError(res, 403, 'not_yours', 'Отменить можно только свою заявку.')
                return
            }
            // Отмена удаляет заявку, а вместе с ней и историю визита. Прошедший визит и
            // визит, который резидент уже отметил, - история: иначе неявку стирали бы
            // отменой задним числом.
            if (request.dateKey < todayKey(tzOffsetMinutes)) {
                sendError(res, 409, 'past', 'Визит уже прошёл, отменять нечего.')
                return
            }
            if (request.visit) {
                sendError(res, 409, 'visit_marked', 'Резидент уже отметил этот визит, отменить его нельзя.')
                return
            }
            const snapshot = structuredClone(request)
            await storage.update((s) => {
                delete s.hostingRequests[request.id]
            })
            // Хосту пишем по концу отсчёта: «Вернуть» отменяет и само сообщение.
            const undo = holdUndo(
                user.userId,
                `отменил свою заявку на ${slotOf(request.dateKey, request.time)}`,
                async () => {
                    const ok = await restoreHostingRequest(storage, snapshot, tzOffsetMinutes)
                    if (ok) syncBoard()
                    return ok
                },
                request.status === 'approved'
                    ? () =>
                          notifyApproverCancelled(client, request).catch((err) =>
                              console.error('[hosting] не удалось уведомить резидента об отмене визита:', err),
                          )
                    : undefined,
            )
            syncBoard()
            sendJson(res, 200, { ...buildBootstrap(ctx), undo })
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
            const responsibles = await resolveResponsibles(storage, residents, responsibleIdsFrom(body))
            const created = await createEvent(storage, tzOffsetMinutes, user, {
                ...eventInputFrom(body),
                ...(draft?.postUrl ? { sourceUrl: draft.postUrl } : {}),
                responsibles,
            })
            if (!created.ok) {
                sendError(res, 400, created.error, EVENT_ERRORS[created.error])
                return
            }
            // Залитые в редакторе картинки (и афиша заготовки) переезжают под id ивента.
            await syncEventPhotos(storage, storage.path(), created.event.id, photosFrom(body), user.userId, toneFrom(body))
            // Заготовка отработала — снимаем, иначе миниапп предложил бы завести тот же
            // ивент второй раз. Её афишу к этому моменту уже забрал syncEventPhotos.
            if (body.fromDraft === true) await clearEventDraft(storage, storage.path(), user.userId)
            // Рассылка резидентам — в фоне, чтобы не держать ответ автору.
            void notifyResidentsAboutEvent(client, storage, residents, tzOffsetMinutes, config.publicUrl, created.event)
                .catch((err) => console.error('[events] не удалось разослать уведомления об ивенте:', err))
            // И анонс в общие чаты — там сидят те, кто в миниапп не заходит. Афишу берём
            // с диска уже после syncEventPhotos, иначе картинки ивента ещё нет.
            void announceEventToChats(client, storage, allowedChats, tzOffsetMinutes, storage.path(), created.event)
                .catch((err) => console.error('[events] не удалось анонсировать ивент в чаты:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'event.update': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const existing = own(storage.get().events, id)
            if (!existing) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обновите экран.')
                return
            }
            if (!canEditEvent(existing, user.userId, isDevUser(ctx))) {
                sendError(res, 403, 'not_yours', 'Править ивент может тот, кто его завёл.')
                return
            }
            // Слот снимаем ДО правки: `existing` - живая ссылка на объект стейта, после
            // updateEvent старых значений в ней уже нет (тот же приём, что с proposal).
            const before = { dateKey: existing.dateKey, time: existing.time }
            const responsibles = await resolveResponsibles(
                storage, residents, responsibleIdsFrom(body), existing.responsibles ?? [],
            )
            const updated = await updateEvent(storage, tzOffsetMinutes, id, { ...eventInputFrom(body), responsibles })
            if (!updated.ok) {
                sendError(res, 400, updated.error, EVENT_ERRORS[updated.error])
                return
            }
            await syncEventPhotos(storage, storage.path(), id, photosFrom(body), user.userId, toneFrom(body))
            // Перенос - в фоне и только если слот реально сменился (проверка внутри).
            void notifyEventMoved(client, storage, residents, tzOffsetMinutes, config.publicUrl, existing, before, user.userId)
                .catch((err) => console.error('[events] не удалось разослать перенос ивента:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        case 'event.delete': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const existing = own(storage.get().events, id)
            if (!existing) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обновите экран.')
                return
            }
            if (!canEditEvent(existing, user.userId, isDevUser(ctx))) {
                sendError(res, 403, 'not_yours', 'Удалить ивент может тот, кто его завёл.')
                return
            }
            // Снимок до удаления: после deleteEvent объекта в стейте уже нет.
            const cancelled = { ...existing }
            await deleteEvent(storage, storage.path(), id)
            void notifyEventCancelled(client, storage, residents, tzOffsetMinutes, config.publicUrl, cancelled, user.userId)
                .catch((err) => console.error('[events] не удалось разослать отмену ивента:', err))
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

        // Список резидентов для выбора круга рецензентов в редакторе ивента.
        case 'reviewers': {
            if (!requireResident()) return
            const { users } = await residents.list()
            sendJson(res, 200, { people: users.map(userView) })
            return
        }

        // Кандидаты в ответственные за ивент: резиденты + известные боту гости.
        case 'event.people': {
            if (!requireResident()) return
            const people = await listResponsibleCandidates(storage, residents)
            sendJson(res, 200, { people: people.map((u) => ({ ...userView(u), resident: u.resident })) })
            return
        }

        // Гость (или резидент) подаёт заявку на ивент по его форме.
        case 'event.apply': {
            const id = typeof body.eventId === 'string' ? body.eventId : ''
            const event = own(storage.get().events, id)
            if (!event) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обновите экран.')
                return
            }
            const result = await createApplication(storage, tzOffsetMinutes, event, user, body.answers, resident)
            if (!result.ok) {
                sendError(res, APP_ERR_STATUS[result.error], result.error, APP_ERRORS[result.error])
                return
            }
            // DM рецензентам — в фоне, чтобы не держать ответ гостю.
            void notifyReviewersNewApplication(client, storage, residents, config.publicUrl, event, result.app)
                .catch((err) => console.error('[events] не удалось уведомить о заявке на ивент:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Правка своей заявки, пока она на рассмотрении.
        case 'event.apply.edit': {
            const id = typeof body.id === 'string' ? body.id : ''
            const result = await editApplication(storage, id, user.userId, body.answers)
            if (!result.ok) {
                sendError(res, APP_ERR_STATUS[result.error], result.error, APP_ERRORS[result.error])
                return
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Отмена своей заявки (удаление).
        case 'event.apply.cancel': {
            const id = typeof body.id === 'string' ? body.id : ''
            const app = await cancelApplication(storage, id, user.userId)
            if (!app) {
                sendError(res, 404, 'not_found', 'Заявка не найдена — обновите экран.')
                return
            }
            const event = own(storage.get().events, app.eventId)
            const undo = holdUndo(user.userId, `отменил свою заявку на ивент «${event?.title ?? app.eventId}»`, async () => {
                const ok = await restoreApplication(storage, app)
                if (ok) syncBoard()
                return ok
            })
            syncBoard()
            sendJson(res, 200, { ...buildBootstrap(ctx), undo })
            return
        }

        // Рецензент принимает или отклоняет заявку на ивент.
        case 'event.app.approve':
        case 'event.app.decline': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const app = own(storage.get().eventApplications, id)
            if (!app) {
                sendError(res, 404, 'not_found', 'Заявка не найдена — обновите экран.')
                return
            }
            const event = own(storage.get().events, app.eventId)
            if (!event) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обновите экран.')
                return
            }
            if (!canReviewEvent(event, user.userId, resident, isDevUser(ctx))) {
                sendError(res, 403, 'not_reviewer', 'Рассматривать заявки этого ивента вам нельзя.')
                return
            }
            let undo: string | null = null
            if (method === 'event.app.approve') {
                const guest = app.guest
                await approveApplication(storage, id, user)
                void notifyApplicantApproved(client, config.publicUrl, event, guest).catch((err) =>
                    console.error('[events] не удалось уведомить о принятии заявки:', err),
                )
            } else {
                // Отклонение тихое: гостю ничего не шлём, заявка просто удаляется.
                await declineApplication(storage, id)
                undo = holdUndo(user.userId, `отклонил заявку ${whoOf(app.guest)} на ивент «${event.title}»`, async () => {
                    const ok = await restoreApplication(storage, app)
                    if (ok) syncBoard()
                    return ok
                })
            }
            syncBoard()
            sendJson(res, 200, { ...buildBootstrap(ctx), ...(undo ? { undo } : {}) })
            return
        }

        // Список заявок ивента с ответами — только рецензенту (отдельной ручкой: ответы объёмные).
        case 'event.apps': {
            if (!requireResident()) return
            const id = typeof body.eventId === 'string' ? body.eventId : ''
            const event = own(storage.get().events, id)
            if (!event) {
                sendError(res, 404, 'not_found', 'Ивент не найден — обновите экран.')
                return
            }
            if (!canReviewEvent(event, user.userId, resident, isDevUser(ctx))) {
                sendError(res, 403, 'not_reviewer', 'Заявки этого ивента вам недоступны.')
                return
            }
            const applications = applicationsForEvent(storage, id).map((a) => ({
                ...a,
                guest: userView(a.guest),
                approvedBy: a.approvedBy ? userView(a.approvedBy) : null,
            }))
            sendJson(res, 200, { applications })
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
            // Закрытие удаляет заявку, поэтому прошедший или уже отмеченный визит не
            // закрывается: это история, а не планы (тот же довод, что у отмены гостем).
            if (request.dateKey < todayKey(tzOffsetMinutes)) {
                sendError(res, 409, 'past', 'Визит уже прошёл, закрывать нечего.')
                return
            }
            if (request.visit) {
                sendError(res, 409, 'visit_marked', 'Визит уже отмечен, закрывать его поздно.')
                return
            }
            const raw = typeof body.comment === 'string' ? body.comment : ''
            if (raw.length > MAX_CLOSE_COMMENT_LENGTH) {
                sendError(res, 400, 'too_long', `Комментарий не длиннее ${MAX_CLOSE_COMMENT_LENGTH} символов.`)
                return
            }
            await deleteHostingRequest(storage, request.id)
            syncBoard()
            // DM здесь ждём, а не пускаем в фон: комментарий - это то, ради чего резидент
            // и писал, и про закрытую личку гостя он должен узнать сразу, а не никогда.
            // Telegram может задержать отправку надолго (FLOOD_WAIT), поэтому ждём не
            // дольше CLOSE_DM_WAIT_MS: дальше ответ «не знаем», а отправка доедет сама.
            const delivered = await Promise.race([
                notifyGuestClosed(client, config.publicUrl, request, user, cleanCloseComment(raw)).catch((err) => {
                    console.error('[hosting] не удалось уведомить гостя о закрытии заявки:', err)
                    return false
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), CLOSE_DM_WAIT_MS).unref()),
            ])
            sendJson(res, 200, { delivered, ...buildBootstrap(ctx) })
            return
        }

        // «Я на месте»: гость доехал и стоит у двери. Пишем хосту, а если хоста в спейсе
        // нет - ещё и всем, кто сейчас отмечен внутри: именно они могут открыть.
        //
        // В ответ гостю ничего про этот список не сообщаем. Кто физически внутри - данные
        // о резидентах: в «Активности» гость видит «кто придёт» (планы), а `/inside` открыт
        // только участникам чатов, так что узнать состав спейса ему больше неоткуда.
        case 'arrived': {
            const id = typeof body.id === 'string' ? body.id : ''
            const marked = await markArrived(storage, tzOffsetMinutes, id, user.userId)
            if (!marked.ok) {
                const messages: Record<string, [number, string]> = {
                    not_yours: [404, 'Заявка не найдена - обновите экран.'],
                    not_approved: [409, 'Визит ещё не подтверждён - сообщать некому.'],
                    closed: [409, 'Сообщить о приходе можно за полчаса до визита и час после.'],
                    cooldown: [429, `Резиденты уже знают. Сообщить ещё раз можно через ${ARRIVAL_COOLDOWN_LABEL} после первого сигнала.`],
                }
                const [status, message] = messages[marked.error] ?? [400, 'Не получилось.']
                sendError(res, status, marked.error, message)
                return
            }
            void notifyArrival(client, storage, marked.request)
                .catch((err) => console.error('[hosting] не удалось сообщить о приходе гостя:', err))
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
                    bad_date: 'Выберите день в пределах ближайшей недели.',
                    bad_time: 'Укажите время в формате ЧЧ:ММ.',
                    past_time: 'Это время уже прошло — выбери время позже текущего.',
                    duplicate: 'У гостя уже есть заявка на этот день.',
                    day_locked: 'Этот день закрыт для гостей — перенести визит туда нельзя.',
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
            // Слот до переноса: request — живая ссылка, acceptReschedule перезапишет его поля.
            const prevDateKey = request.dateKey
            const prevTime = request.time
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
            if (result.request.dateKey !== prevDateKey || result.request.time !== prevTime) {
                void notifySubsRescheduled(client, storage, config.publicUrl, result.request, prevDateKey, prevTime, user.userId)
                    .catch((err) => console.error('[hosting] не удалось уведомить подписчиков дня о переносе:', err))
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

        // Передать хостинг другому резиденту: хост просит подхватить свой подтверждённый
        // визит. Именно просит — назначить вместо себя нельзя, адресат отвечает сам.
        case 'transfer.offer': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            const targetId = typeof body.userId === 'number' ? body.userId : Number(body.userId)
            // Карточку берём из ростера: передавать можно только резиденту, и его имя
            // должно быть тем же, что видит адресат в своих списках.
            const target = (await residents.list()).users.find((u) => u.userId === targetId)
            if (!target) {
                sendError(res, 404, 'not_found', 'Передать визит можно только резиденту.')
                return
            }
            const result = await offerTransfer(storage, request.id, target, user)
            if (!result.ok) {
                const messages = {
                    not_found: 'Заявка не найдена.',
                    not_approved: 'Передать можно только подтверждённый визит.',
                    not_host: 'Передать визит может только его хост.',
                    self: 'Этот визит и так на вас.',
                    busy: 'По этой заявке уже ждём ответа другого резидента.',
                } as const
                const status = result.error === 'not_found' ? 404 : result.error === 'not_host' ? 403 : result.error === 'self' ? 400 : 409
                sendError(res, status, result.error, messages[result.error])
                return
            }
            const offered = result.request.transfer
            if (offered) {
                void notifyTransferOffer(client, config.publicUrl, result.request, offered)
                    .catch((err) => console.error('[hosting] не удалось отправить просьбу о передаче:', err))
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Адресат берёт визит на себя: хостом становится он.
        case 'transfer.accept': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            const transfer = request.transfer ?? null
            if (!transfer) {
                sendError(res, 409, 'no_transfer', 'Эта просьба уже неактуальна.')
                return
            }
            if (transfer.to.userId !== user.userId) {
                sendError(res, 403, 'not_allowed', 'Эта просьба адресована другому резиденту.')
                return
            }
            const result = await acceptTransfer(storage, request.id, user)
            if (!result.ok) {
                sendError(res, result.error === 'not_found' ? 404 : 409, result.error, 'Эта просьба уже неактуальна.')
                return
            }
            void notifyTransferAccepted(client, result.request, user, result.from.userId)
                .catch((err) => console.error('[hosting] не удалось уведомить прежнего хоста о передаче:', err))
            void notifyGuestHostChanged(client, config.publicUrl, result.request)
                .catch((err) => console.error('[hosting] не удалось уведомить гостя о смене хоста:', err))
            syncBoard()
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Снять просьбу: отказался адресат либо отозвал автор. Хостинг остаётся как был.
        case 'transfer.decline': {
            if (!requireResident()) return
            const request = findRequest()
            if (!request) return
            const transfer = request.transfer ?? null
            if (!transfer) {
                sendError(res, 409, 'no_transfer', 'Эта просьба уже неактуальна.')
                return
            }
            const withdrawn = transfer.by.userId === user.userId
            if (!withdrawn && transfer.to.userId !== user.userId) {
                sendError(res, 403, 'not_allowed', 'Эту передачу обсуждают два других резидента.')
                return
            }
            const result = await clearTransfer(storage, request.id)
            if (!result.ok) {
                sendError(res, result.error === 'not_found' ? 404 : 409, result.error, 'Эта просьба уже неактуальна.')
                return
            }
            void notifyTransferCancelled(client, result.request, result.transfer, withdrawn)
                .catch((err) => console.error('[hosting] не удалось уведомить о снятии передачи:', err))
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
            // Ответы про участие кэшируются на минуту - заблокированный столько бы ещё
            // ходил по API. Права меняем мы сами, значит и кэш сбрасываем сами.
            residents.invalidate(request.guest.userId)
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
            const prev = guestNoteFor(storage, targetId)
            await setGuestNote(storage, targetId, text, user)
            // Удаление обратимо: «Вернуть» кладёт ту же заметку с тем же автором.
            const undo =
                prev && !text.trim()
                    ? holdUndo(user.userId, `удалил заметку о ${idOf(targetId)}`, () => restoreGuestNote(storage, prev))
                    : null
            sendJson(res, 200, { ...buildBootstrap(ctx), ...(undo ? { undo } : {}) })
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
            residents.invalidate(targetId)
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
        case 'calendar.link': {
            // Гейта резидентства нет намеренно: в фиде ивенты, которые и так видит любой
            // гость в миниаппе, и свои визиты человека. Ответ — не bootstrap: ссылка нужна
            // разово, на тап по строке, и в стейт фронта ей не место.
            const token = await ensureEventFeedToken(storage, user.userId)
            sendJson(res, 200, { token })
            return
        }

        // Ссылка на .ics визита или ивента. Права проверяются здесь и ещё раз на самой
        // GET-ручке: токен лишь говорит, кто и что попросил.
        case 'ics.link': {
            const kind = body.kind === 'visit' || body.kind === 'event' ? body.kind : null
            const id = typeof body.id === 'string' ? body.id : ''
            const state = storage.get()
            const visible =
                kind === 'visit'
                    ? Object.hasOwn(state.hostingRequests, id) && own(state.hostingRequests, id)!.guest.userId === user.userId
                    : kind === 'event'
                      ? Object.hasOwn(state.events, id) && (resident || !own(state.events, id)!.residentsOnly)
                      : false
            if (!kind || !visible) {
                sendError(res, 404, 'not_found', kind === 'event' ? 'Ивент не найден.' : 'Заявка не найдена.')
                return
            }
            const exp = Math.floor(Date.now() / 1000) + ICS_LINK_TTL_SEC
            const token = signLink(ctx.botToken, icsScope(kind, id), user.userId, exp)
            sendJson(res, 200, { url: `/${kind}.ics?id=${encodeURIComponent(id)}&t=${token}`, exp })
            return
        }

        // «Переслать»: карточка для выбора чата Telegram (WebApp.shareMessage, Bot API 8.0).
        // Миниапп готовит её на касании кнопки, а не на входе в экран: за каждой стоит
        // вызов Telegram, а у ивента с афишей при первой пересылке ещё и заливка картинки.
        case 'share.prepare': {
            try {
                if (body.kind === 'event') {
                    const id = typeof body.id === 'string' ? body.id : ''
                    const state = storage.get()
                    const event = Object.hasOwn(state.events, id) ? own(state.events, id)! : null
                    // Ивент «только резидентам» не пересылается и резидентом: карточка уходит в
                    // чаты, где её читают гости, по тому же правилу, что анонс и доска.
                    if (!event || event.residentsOnly) {
                        sendError(res, 404, 'not_found', 'Этот ивент нельзя переслать.')
                        return
                    }
                    if (isPastSlot(event.dateKey, event.time, tzOffsetMinutes)) {
                        sendError(res, 400, 'past', 'Ивент уже прошёл.')
                        return
                    }
                    sendJson(res, 200, await prepareEventShare(client, storage.path(), tzOffsetMinutes, event, user.userId))
                    return
                }
                if (body.kind === 'day') {
                    if (!requireResident()) return
                    const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
                    const prepared = await prepareDayShare(client, storage, tzOffsetMinutes, botLinkBase(), dateKey, user.userId)
                    if (!prepared.ok) {
                        const messages = {
                            bad_date: 'Позвать можно только на ближайшую неделю.',
                            day_locked: 'В этот день спейс закрыт для гостей: звать их некуда.',
                        } as const
                        sendError(res, 400, prepared.error, messages[prepared.error])
                        return
                    }
                    sendJson(res, 200, { id: prepared.id, expireDate: prepared.expireDate })
                    return
                }
            } catch (err) {
                console.error('[webapp] не удалось подготовить карточку для пересылки:', err)
                sendError(res, 502, 'share_failed', 'Telegram не принял карточку. Попробуйте ещё раз.')
                return
            }
            sendError(res, 400, 'bad_kind', 'Непонятно, что пересылать.')
            return
        }

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

        // Подписка гостя на отметки резидентов «я приду». Гейта резидентства нет: это
        // гостевая настройка, рассылкой занимается attend-alerts.ts.
        case 'notify.attend': {
            const enabled = body.enabled === true
            const mode = body.mode === 'week' ? 'week' : 'near'
            await storage.update((s) => {
                s.guestAttendNotify[String(user.userId)] = { enabled, mode }
            })
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // --- Журнал присутствия ---------------------------------------------
        // Всё это резидентское и только резидентское: «кто когда был в спейсе» за
        // полгода — данные о людях, а не витрина. Гейт стоит на каждой ручке.

        case 'stats.overview': {
            if (!requireResident()) return
            const view = await buildStatsOverview(storage, tzOffsetMinutes, statsPeriodOf(body.period), user.userId)
            // Люди журнала идут мимо `userView` (в нём только карточки участников),
            // поэтому whitelist `/avatar.jpg` пополняем тут — иначе аватарки в
            // статистике вечно отбивались бы 404-кой.
            for (const p of view.top) discloseUser(p.userId)
            sendJson(res, 200, view)
            return
        }

        case 'stats.days': {
            if (!requireResident()) return
            sendJson(res, 200, await buildStatsDays(storage, tzOffsetMinutes))
            return
        }

        case 'stats.day': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            if (!isValidDayKey(dateKey)) {
                sendError(res, 400, 'bad_date', 'Непонятный день.')
                return
            }
            const view = await buildStatsDay(storage, tzOffsetMinutes, dateKey)
            for (const row of view.rows) discloseUser(row.userId)
            sendJson(res, 200, view)
            return
        }

        case 'stats.person': {
            if (!requireResident()) return
            const userId = typeof body.userId === 'number' ? body.userId : 0
            if (!Number.isFinite(userId) || userId === 0) {
                sendError(res, 400, 'bad_user', 'Непонятно, о ком спрашиваешь.')
                return
            }
            const view = await buildStatsPerson(
                storage,
                tzOffsetMinutes,
                userId,
                statsPeriodOf(body.period),
                await residents.joinedAt(userId),
            )
            discloseUser(view.user.userId)
            sendJson(res, 200, view)
            return
        }

        // Ручная дата «резидент с» — только dev: она ничего не считает, а объявляет,
        // и правка чужой карточки задним числом это не то, что раздают всем резидентам.
        case 'stats.residentSince': {
            if (!requireDev()) return
            const userId = typeof body.userId === 'number' ? body.userId : 0
            if (!Number.isFinite(userId) || userId === 0) {
                sendError(res, 400, 'bad_user', 'Непонятно, о ком речь.')
                return
            }
            const raw = typeof body.dateKey === 'string' ? body.dateKey : ''
            // Пусто — сброс к расчёту по журналу; дата из будущего это опечатка.
            if (raw && raw !== RESIDENT_SINCE_ORIGIN && (!isValidDayKey(raw) || raw > todayKey(tzOffsetMinutes))) {
                sendError(res, 400, 'bad_date', 'Дата должна быть сегодняшней или прошедшей.')
                return
            }
            await setResidentSince(storage, userId, raw || null)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Итоги прошлого месяца. Резидентские, как и весь журнал: «с кем вы были» - это
        // данные о людях.
        case 'wrap.month': {
            if (!requireResident()) return
            const view = await buildWrapView(storage, user.userId, tzOffsetMinutes)
            if (!view) {
                sendError(res, 404, 'no_wrap', 'За прошлый месяц итогов нет.')
                return
            }
            if (view.companion) discloseUser(view.companion.userId)
            sendJson(res, 200, view)
            return
        }

        // Отказ от журнала: отметки продолжают работать, история не пишется.
        case 'presence.log': {
            if (!requireResident()) return
            await setPresenceNoLog(storage, user.userId, body.enabled !== true)
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
                sendError(res, 409, 'duplicate', 'Этот MAC уже привязан к вам.')
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
                        suppressedAt: null,
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
                sendError(res, 404, 'not_found', 'Такой MAC к вам не привязан.')
                return
            }
            const before = structuredClone(cur)
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
            // Но по концу отсчёта «Вернуть»: возврат устройства иначе рвал бы визит в журнале на два.
            const uid = String(user.userId)
            const undo = holdUndo(
                user.userId,
                'отвязал своё устройство',
                () => restoreMacBinding(storage, before, mac),
                async () => {
                    const state = storage.get()
                    if (leftEmpty && !state.macBindings[uid] && state.presence[uid]?.source === 'mac') {
                        await removePresence(client, storage, residents, user.userId, 'manual')
                    }
                },
            )
            sendJson(res, 200, { ...buildBootstrap(ctx), undo })
            return
        }

        case 'mac.anon': {
            if (!requireResident()) return
            const anon = body.anon === true
            if (!storage.get().macBindings[String(user.userId)]) {
                sendError(res, 400, 'no_macs', 'Сначала привяжите хотя бы один MAC.')
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
                        p.realUsername = username
                    }
                })
                syncBoard()
            }
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // --- Знакомство с ботом ---------------------------------------------------

        // Люди для сот на обложке: все резиденты, кроме самого человека. «В спейсе» -
        // только у отметившихся с ником: отметка «без ника» прячет, кто внутри, и
        // подпись в сотах не должна её раскрывать.
        case 'onboarding.people': {
            if (!requireResident()) return
            const { users } = await residents.list()
            const presence = storage.get().presence
            const people = users
                .filter((u) => u.userId !== user.userId)
                .map((u) => ({ ...userView(u), inside: (presence[String(u.userId)]?.username ?? null) !== null }))
            // Сколько внутри всего, вместе с отметками «без ника»: это число и так
            // стоит на доске в чате, а сцена знакомства повторяет доску.
            sendJson(res, 200, { people, insideTotal: Object.keys(presence).length })
            return
        }

        case 'onboarding.done': {
            if (!requireResident()) return
            await markOnboardingDone(storage, user.userId)
            sendJson(res, 200, buildBootstrap(ctx))
            return
        }

        // Код домофона правит только dev: это ключ от подъезда, и право его менять
        // незачем раздавать всем резидентам. Пустой код снимает строку совсем.
        case 'door.set': {
            if (!requireDev()) return
            const code = normalizeDoorCode(typeof body.code === 'string' ? body.code : '')
            const note = (typeof body.note === 'string' ? body.note : '').replace(/\s+/g, ' ').trim()
            if (code && !isValidDoorCode(code)) {
                sendError(res, 400, 'bad_code', 'Код: цифры и буквы клавиш панели, до 16 символов.')
                return
            }
            if (note.length > MAX_DOOR_NOTE_LENGTH) {
                sendError(res, 400, 'bad_note', `Подсказка: не длиннее ${MAX_DOOR_NOTE_LENGTH} символов.`)
                return
            }
            await setDoorCode(storage, code, note, user)
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
            if (!periodKey || !own(dues.periods, periodKey) || !Number.isFinite(targetId)) {
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
                    caption: html(
                        `Взносы за ${periodKeysOf(dues).length} ${plural(periodKeysOf(dues).length, ['период', 'периода', 'периодов'])}.`,
                    ),
                }))
            } catch {
                sendError(res, 409, 'dm_closed', 'Не могу написать в личку. Откройте чат с ботом и нажмите /start.')
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
                guests: searchGuests(storage, query, todayKey(tzOffsetMinutes)).map((g) => ({ ...g, user: userView(g.user) })),
            })
            return
        }

        // Профиль гостя: сводка визитов, кто хостил, ивенты и вся история - заявки и
        // визиты без заявки. Работает и для того, кто заявок не оставлял ни разу.
        case 'guest.requests': {
            if (!requireResident()) return
            const userId = typeof body.userId === 'number' ? body.userId : 0
            const profile = userId > 0 || isFakeUserId(userId) ? guestProfile(storage, userId, todayKey(tzOffsetMinutes)) : null
            if (!profile) {
                sendError(res, 404, 'not_found', 'Об этом человеке записей уже нет.')
                return
            }
            sendJson(res, 200, {
                user: userView(profile.user),
                requests: requestsView(requestsOfGuest(storage, userId), visitDates(ctx), { forResidents: true }),
                walkIns: walkInsOfGuest(storage, userId).map(walkInView),
                profile: {
                    ...profile,
                    user: userView(profile.user),
                    hosts: profile.hosts.map((h) => ({ user: userView(h.user), count: h.count })),
                },
            })
            return
        }

        // --- Кто пришёл ------------------------------------------------------
        // Отмечает любой резидент: дверь открывает тот, кто внутри, а не обязательно
        // хост. Гостю ничего не уходит: это учёт, а не разговор с ним.

        case 'visits.day': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            if (!isValidDayKey(dateKey) || dateKey > todayKey(tzOffsetMinutes)) {
                sendError(res, 400, 'bad_date', 'Кто пришёл, видно только за сегодня и прошедшие дни.')
                return
            }
            sendJson(res, 200, visitsDayView(ctx, dateKey))
            return
        }

        case 'visit.mark': {
            if (!requireResident()) return
            const id = typeof body.id === 'string' ? body.id : ''
            const came = body.came === true ? true : body.came === false ? false : body.came === null ? null : undefined
            if (came === undefined) {
                sendError(res, 400, 'bad_mark', 'Не понял отметку.')
                return
            }
            const marked = await markVisit(storage, tzOffsetMinutes, id, came, user)
            if (!marked.ok) {
                const messages = {
                    not_found: [404, 'Заявка не найдена, возможно, её уже отменили.'],
                    bad_day: [400, VISIT_DAY_CLOSED],
                    not_approved: [409, 'Эту заявку никто не брал: если гость пришёл, добавьте его гостем без заявки.'],
                    too_early: [409, 'Визит ещё не начался: неявку можно отметить после его времени.'],
                } as const
                const [status, message] = messages[marked.error]
                sendError(res, status, marked.error, message)
                return
            }
            sendJson(res, 200, { ...buildBootstrap(ctx), visitsDay: visitsDayView(ctx, marked.request.dateKey) })
            return
        }

        case 'visit.markAll': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            const marked = await markAllVisits(storage, tzOffsetMinutes, dateKey, user)
            if (!marked.ok) {
                sendError(res, 400, marked.error, VISIT_DAY_CLOSED)
                return
            }
            sendJson(res, 200, { ...buildBootstrap(ctx), visitsDay: visitsDayView(ctx, dateKey) })
            return
        }

        case 'walkin.candidates': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            if (!isVisitDayEditable(dateKey, tzOffsetMinutes)) {
                sendError(res, 400, 'bad_day', VISIT_DAY_CLOSED)
                return
            }
            const people = await walkInCandidates(ctx, dateKey)
            sendJson(res, 200, { people: people.map((p) => ({ ...userView(p), fromEvent: p.fromEvent })) })
            return
        }

        // Пришёл без заявки: человек из списка кандидатов (`userId`), любой по @нику
        // (`username`, ищем в Telegram) или просто имя (`name`), если аккаунта не знаем.
        case 'walkin.add': {
            if (!requireResident()) return
            const dateKey = typeof body.dateKey === 'string' ? body.dateKey : ''
            let guest: HostingUser
            if (typeof body.userId === 'number') {
                const found = (await walkInCandidates(ctx, dateKey)).find((p) => p.userId === body.userId)
                if (!found) {
                    sendError(res, 404, 'not_found', 'Этого человека больше нет в списке, обновите экран.')
                    return
                }
                guest = { userId: found.userId, username: found.username, name: found.name }
            } else if (typeof body.username === 'string') {
                const username = body.username.trim().replace(/^@/, '')
                if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username)) {
                    sendError(res, 400, 'bad_username', 'Ник: от 4 до 32 латинских букв, цифр и _.')
                    return
                }
                let found: User | null = null
                try {
                    found = (await client.getUsers(username))[0] ?? null
                } catch {
                    // ник не занят или не разбирается: для резидента это одно «не нашёл»
                }
                if (!found || found.isBot) {
                    sendError(res, 404, 'no_user', `Не нашёл @${username} в Telegram.`)
                    return
                }
                if (await residents.isResident(found.id)) {
                    sendError(res, 400, 'resident', 'Это резидент: его визиты видны по отметкам присутствия.')
                    return
                }
                guest = { userId: found.id, username: found.username, name: cleanName(found.displayName) || found.username || String(found.id) }
            } else {
                const name = typeof body.name === 'string' ? cleanName(body.name) : ''
                if (name.length > MAX_WALK_IN_NAME_LENGTH) {
                    sendError(res, 400, 'too_long', `Имя не длиннее ${MAX_WALK_IN_NAME_LENGTH} символов.`)
                    return
                }
                guest = { userId: 0, username: null, name }
            }
            const added = await addWalkIn(storage, tzOffsetMinutes, dateKey, guest, user)
            if (!added.ok) {
                const messages = {
                    bad_day: [400, VISIT_DAY_CLOSED],
                    bad_name: [400, 'Впишите имя.'],
                    has_request: [409, 'У него есть заявка на этот день: отметьте её в списке.'],
                    duplicate: [409, 'Он уже в списке этого дня.'],
                    blocked: [403, 'Этот участник заблокирован.'],
                } as const
                const [status, message] = messages[added.error]
                sendError(res, status, added.error, message)
                return
            }
            sendJson(res, 200, { ...buildBootstrap(ctx), visitsDay: visitsDayView(ctx, dateKey) })
            return
        }

        case 'walkin.remove': {
            if (!requireResident()) return
            const removed = await removeWalkIn(storage, tzOffsetMinutes, typeof body.id === 'string' ? body.id : '')
            if (!removed.ok) {
                sendError(res, removed.error === 'not_found' ? 404 : 400, removed.error, removed.error === 'not_found'
                    ? 'Этой записи уже нет, обновите экран.'
                    : VISIT_DAY_CLOSED)
                return
            }
            sendJson(res, 200, { ...buildBootstrap(ctx), visitsDay: visitsDayView(ctx, removed.walkIn.dateKey) })
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
                // Та же форма, что у `visits.day`: день из недели открывается «Кто пришёл»
                // сразу, не дожидаясь своего запроса.
                days.push(visitsDayView(ctx, dateKey))
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

        // --- Права резидента (dev) -----------------------------------------------
        // Выдача админки в «чате»/каналах и member tag «resident». По умолчанию ничего не
        // выдаётся: только этими ручками и только dev. Всё идёт через общий mtcute-клиент
        // (класс 'heavy' в METHOD_CLASS), поэтому вызовы гейтятся рейтлимитом.

        // Ростер резидентов для дев-списка «Резиденты» → карточка человека.
        case 'admin.residents': {
            if (!requireDev()) return
            const { users } = await residents.list()
            sendJson(res, 200, { people: users.map(userView) })
            return
        }

        // Статус человека по всем целям: где состоит, где админ, стоит ли тег.
        case 'admin.status': {
            if (!requireDev()) return
            const targetUser = Number(body.userId)
            if (!Number.isSafeInteger(targetUser) || targetUser <= 0) {
                sendError(res, 400, 'bad_user', 'Не указан пользователь.')
                return
            }
            sendJson(res, 200, await adminStatusPayload(ctx, targetUser))
            return
        }

        // Выдать/снять админку в одной цели. Нет в чате — 409, чтобы фронт попросил зайти.
        case 'admin.grant':
        case 'admin.revoke': {
            if (!requireDev()) return
            const targetUser = Number(body.userId)
            const targetKey = typeof body.target === 'string' ? body.target : ''
            const target = ctx.adminTargets.find((t) => t.key === targetKey)
            if (!Number.isSafeInteger(targetUser) || targetUser <= 0 || !target) {
                sendError(res, 400, 'bad_target', 'Неизвестная цель или пользователь.')
                return
            }
            const state = await readMemberState(client, target.chatId, targetUser)
            if (state.error) {
                sendError(res, 502, 'telegram_error', `Не удалось узнать статус в «${target.label}» (${state.error}). Бот должен быть админом цели.`)
                return
            }
            if (!state.present) {
                sendError(res, 409, 'not_in_chat', `Резидента нет в «${target.label}» — попросите его зайти и повторите.`)
                return
            }
            if (state.creator) {
                sendError(res, 409, 'is_creator', 'Это владелец чата — его права меняет только Telegram.')
                return
            }
            if (!state.canEdit) {
                sendError(res, 409, 'not_editable', `Админку в «${target.label}» выдал не бот — поменять её может только тот, кто выдал, или владелец.`)
                return
            }
            try {
                if (method === 'admin.grant') await grantAdmin(client, target, targetUser, state.tag)
                else await revokeAdmin(client, target, targetUser)
            } catch (err) {
                console.error('[admin] не удалось изменить права:', err)
                sendError(res, 502, 'telegram_error', 'Telegram отклонил операцию. Бот должен быть админом цели с правом добавлять админов.')
                return
            }
            sendJson(res, 200, await adminStatusPayload(ctx, targetUser))
            return
        }

        // Поставить/снять member tag «resident». Только в «чате» (единственная цель с canTag).
        case 'admin.tag': {
            if (!requireDev()) return
            const targetUser = Number(body.userId)
            const target = ctx.adminTargets.find((t) => t.canTag)
            if (!Number.isSafeInteger(targetUser) || targetUser <= 0 || !target) {
                sendError(res, 400, 'bad_target', 'Тег ставить некуда: не задан MAIN_CHAT_ID.')
                return
            }
            const state = await readMemberState(client, target.chatId, targetUser)
            if (state.error) {
                sendError(res, 502, 'telegram_error', `Не удалось узнать статус в «${target.label}» (${state.error}). Бот должен быть админом цели.`)
                return
            }
            if (!state.present) {
                sendError(res, 409, 'not_in_chat', `Резидента нет в «${target.label}» — попросите его зайти и повторите.`)
                return
            }
            try {
                await setMemberTag(client, target.chatId, targetUser, body.on === true ? RESIDENT_TAG : null)
            } catch (err) {
                console.error('[admin] не удалось изменить тег:', err)
                sendError(res, 502, 'telegram_error', 'Telegram отклонил операцию. Боту нужно право «изменение тегов участников».')
                return
            }
            sendJson(res, 200, await adminStatusPayload(ctx, targetUser))
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

// ---------------------------------------------------------------------------
// Статика миниаппа: кэш и сжатие
// ---------------------------------------------------------------------------

/**
 * Имя с хэшем содержимого, которое пишет Vite (`assets/index-BYNWcz-C.js`): под этим
 * именем файл не изменится никогда, новая сборка даёт новое имя. Проверяем именно имя,
 * а не папку: файл из `webapp/public/assets` попал бы туда же без хэша.
 */
const HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico'])
const COMPRESSIBLE_EXTS = new Set(['.html', '.css', '.js', '.svg', '.json'])

type StaticFile = {
    mtimeMs: number
    size: number
    data: Buffer
    hash: string
    br: Promise<Buffer> | null
    gzip: Promise<Buffer> | null
}

/**
 * Файлы сборки в памяти вместе со сжатыми копиями: сжимаем один раз на процесс, а
 * процесс и так перезапускается на каждом деплое. Сверка по mtime и размеру ловит
 * сборку, подложенную рядом без перезапуска (`npm run build` у работающего бота).
 */
const staticFiles = new Map<string, StaticFile>()

const brotliAsync = (data: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) =>
        brotliCompress(
            data,
            {
                params: {
                    [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
                    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
                    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length,
                },
            },
            (err, out) => (err ? reject(err) : resolve(out)),
        ),
    )
const gzipAsync = (data: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => gzip(data, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out))))

const loadStatic = async (target: string): Promise<StaticFile | null> => {
    let stat
    try {
        stat = await fs.stat(target)
    } catch {
        return null
    }
    if (!stat.isFile()) return null
    const hit = staticFiles.get(target)
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit
    const data = await fs.readFile(target)
    const file: StaticFile = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        data,
        hash: createHash('sha256').update(data).digest('hex').slice(0, 20),
        br: null,
        gzip: null,
    }
    staticFiles.set(target, file)
    return file
}

/** Сжатая копия; не сжалось (или не стоит того) - null, и уходит исходник. */
const compressedStatic = async (file: StaticFile, encoding: 'br' | 'gzip'): Promise<Buffer | null> => {
    if (file.data.length < 1024) return null
    const job = encoding === 'br' ? (file.br ??= brotliAsync(file.data)) : (file.gzip ??= gzipAsync(file.data))
    try {
        const out = await job
        return out.length < file.data.length ? out : null
    } catch (err) {
        console.error(`[webapp] не удалось сжать статику (${encoding}):`, err)
        return null
    }
}

/**
 * Сжимаем сборку сразу на старте, в пуле потоков zlib, а не на первом запросе: brotli
 * на максимальном уровне жмёт бандл около секунды, и платил бы за неё первый же человек,
 * открывший миниапп после деплоя.
 */
const warmStatic = async (dir = STATIC_DIR): Promise<void> => {
    let entries
    try {
        entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
        return
    }
    for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
            await warmStatic(full)
            continue
        }
        if (!COMPRESSIBLE_EXTS.has(path.extname(e.name).toLowerCase())) continue
        const file = await loadStatic(full)
        if (file) await Promise.all([compressedStatic(file, 'br'), compressedStatic(file, 'gzip')])
    }
}

/** Какое сжатие примет клиент: brotli лучше, gzip - запасной. `q=0` значит «нельзя». */
const acceptedEncoding = (header: string | undefined): 'br' | 'gzip' | null => {
    const allowed = new Set<string>()
    for (const part of (header ?? '').toLowerCase().split(',')) {
        const [name, ...params] = part.trim().split(';')
        if (!name) continue
        const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
        if (q && Number(q.slice(2)) <= 0) continue
        allowed.add(name)
    }
    if (allowed.has('br')) return 'br'
    if (allowed.has('gzip')) return 'gzip'
    return null
}

/**
 * Хэшированные файлы сборки кэшируются навсегда (`immutable`): после деплоя index.html
 * ведёт на новые имена, и смеси старого JS с новым API не будет. Сам index.html и
 * telegram-web-app.js (имя у него постоянное, а копию обновляет воркфлоу) телефон
 * сверяет с сервером на каждом открытии по ETag: в ответ приходит пустой 304, если
 * ничего не менялось. Картинки из `public` без хэша, но меняются редко: сутки.
 */
const serveStatic = async (req: IncomingMessage, pathname: string, res: ServerResponse): Promise<void> => {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const target = path.normalize(path.join(STATIC_DIR, rel))
    if (!target.startsWith(STATIC_DIR + path.sep) && target !== path.join(STATIC_DIR, 'index.html')) {
        res.writeHead(403).end('forbidden')
        return
    }
    const file = await loadStatic(target)
    if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
        return
    }
    const ext = path.extname(target).toLowerCase()
    const relPath = path.relative(STATIC_DIR, target).split(path.sep).join('/')
    const compressible = COMPRESSIBLE_EXTS.has(ext)
    const encoding = compressible ? acceptedEncoding(req.headers['accept-encoding']) : null
    const body = encoding ? await compressedStatic(file, encoding) : null
    // У сжатой копии свой ETag: это другое тело, и сильный валидатор у них общим быть не может.
    const etag = `"${file.hash}${body ? `-${encoding}` : ''}"`
    const headers: Record<string, string> = {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': HASHED_ASSET.test(relPath)
            ? 'public, max-age=31536000, immutable'
            : IMAGE_EXTS.has(ext)
              ? 'public, max-age=86400'
              : 'no-cache',
        ETag: etag,
    }
    if (compressible) headers.Vary = 'Accept-Encoding'
    if (etagMatches(req.headers['if-none-match'], etag)) {
        res.writeHead(304, headers).end()
        return
    }
    if (body && encoding) headers['Content-Encoding'] = encoding
    const payload = body ?? file.data
    headers['Content-Length'] = String(payload.length)
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : payload)
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

/**
 * Чей это токен подписки на календарь. null — такого нет.
 *
 * Ищем перебором, а не словарём с ключом-токеном: ключ пришёл бы из query, и
 * `tokens['__proto__']` вернул бы прототип вместо undefined. Записей тут столько,
 * сколько людей нажало «Подписаться», — перебор дешевле этой ловушки.
 */
const feedUserId = (storage: Storage, token: string): number | null => {
    if (token === '') return null
    for (const [userId, value] of Object.entries(storage.get().eventFeedTokens)) {
        if (secretEquals(value, token)) return Number(userId)
    }
    return null
}

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
const serveBoard = (deps: WebappDeps, req: IncomingMessage, url: URL, res: ServerResponse, ip: string): void => {
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
        // Перебор токена считаем там же, где и перебор подписи initData: полка `board`
        // выше пропускает штатный опрос прошивки, а гадать токен даёт всего десяток
        // попыток в минуту с адреса.
        if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
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

            // Первый слой лимитов — до всякой аутентификации: сюда попадает и статика, и
            // мусорные запросы с неподписанным initData. Дальше по каждой ручке идёт свой
            // счёт по userId (см. LIMITS).
            const ip = clientIp(req)
            if (!allow(res, 'ip', ip, LIMITS.ip, pathname.startsWith('/api/'))) return

            // Healthcheck докера. Ручка смотрит наружу без токена, поэтому наружу идёт
            // только вердикт: имена компонентов и счётчики рассказали бы о внутреннем
            // устройстве спейса больше, чем нужно. Подробности - дев-команда /status.
            if (pathname === '/healthz') {
                const health = healthSnapshot()
                const ok = health.ok && deps.storage.writeHealth().lastError === null
                res.writeHead(ok ? 200 : 503, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                }).end(ok ? 'ok\n' : 'degraded\n')
                return
            }

            // Табло донатов. Гейт — статический BOARD_TOKEN, а не initData: у железки
            // нет Telegram-сессии, подписать initData ей нечем.
            if (pathname === '/board') {
                if (!allow(res, 'board', ip, LIMITS.board, false)) return
                serveBoard(deps, req, url, res, ip)
                return
            }

            // Файл календаря отдаём отдельным GET-путём (не под /api/, там только POST):
            // ссылку открывает системный браузер, поэтому гейт едет в query. Не initData,
            // а токен ссылки из `ics.link` (см. signLink): он открывает только этот файл.
            if (pathname === '/visit.ics') {
                if (req.method !== 'GET') {
                    res.writeHead(405).end()
                    return
                }
                const id = url.searchParams.get('id') ?? ''
                const userId = verifyLink(deps.botToken, icsScope('visit', id), url.searchParams.get('t') ?? '')
                if (userId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
                    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
                        .end('Ссылка устарела — открой миниапп заново.')
                    return
                }
                // Полка до `residents.access`: на холодном кэше он ходит в Telegram.
                if (!allow(res, 'ics', userId, LIMITS.ics, false)) return
                if (isBlocked(deps.storage, userId) || (await deps.residents.access(userId)).banned) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Доступ закрыт.')
                    return
                }
                const requests = deps.storage.get().hostingRequests
                const request = Object.hasOwn(requests, id) ? requests[id] : undefined
                // Только свой визит: в файле цель визита и кто хостит.
                if (!request || request.guest.userId !== userId) {
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

            // Ивент в календарь - тот же приём, что у визита: GET вне /api/, токен ссылки
            // в query. Гейт видимости свой: резидентский ивент гостю не отдаём и по
            // прямой ссылке (мимо handleApi этот путь не проходит).
            if (pathname === '/event.ics') {
                if (req.method !== 'GET') {
                    res.writeHead(405).end()
                    return
                }
                const id = url.searchParams.get('id') ?? ''
                const userId = verifyLink(deps.botToken, icsScope('event', id), url.searchParams.get('t') ?? '')
                if (userId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
                    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
                        .end('Ссылка устарела - открой миниапп заново.')
                    return
                }
                if (!allow(res, 'ics', userId, LIMITS.ics, false)) return
                const access = await deps.residents.access(userId)
                if (isBlocked(deps.storage, userId) || access.banned) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Доступ закрыт.')
                    return
                }
                const events = deps.storage.get().events
                const event = Object.hasOwn(events, id) ? events[id] : undefined
                if (!event || (event.residentsOnly && !access.resident)) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ивент не найден.')
                    return
                }
                res.writeHead(200, {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="event.ics"',
                    'Cache-Control': 'no-store',
                }).end(buildEventIcs(event, deps.tzOffsetMinutes))
                return
            }

            // Вход в подписку: 302 на ту же ссылку, но схемой `webcal://`.
            //
            // Без этого перехода ничего не работает: по https календарь получает файл и
            // разово импортирует ближайшие ивенты, а подписку (календарь, который сам
            // перечитывается) заводит только `webcal://`. Открыть эту схему из миниаппа
            // нельзя — `openLink` берёт только http/https, — поэтому наружу уходит
            // обычная https-ссылка, а схему подменяет уже редирект в системном браузере.
            if (pathname === '/events-subscribe') {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405).end()
                    return
                }
                const token = url.searchParams.get('token')?.trim() ?? ''
                const userId = feedUserId(deps.storage, token)
                if (userId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ссылка не найдена.')
                    return
                }
                if (!allow(res, 'feed', userId, LIMITS.feed, false)) return
                // Хост берём из запроса (наружу ходят через туннель, своего адреса
                // процесс не знает), но в Location его пускаем только отфильтрованным:
                // заголовок подделывается кем угодно, а перенос строки в нём — это
                // инъекция в ответ.
                const host = (req.headers.host ?? '').trim()
                if (!/^[A-Za-z0-9.\-]+(:\d+)?$/.test(host)) {
                    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Неизвестный адрес.')
                    return
                }
                res.writeHead(302, {
                    Location: `webcal://${host}/events.ics?token=${encodeURIComponent(token)}`,
                    'Cache-Control': 'no-store',
                }).end()
                return
            }

            // Подписка календаря на ивенты и свои визиты. Вторая после /board ручка без
            // initData: фид дёргает календарь месяцами и в фоне, а подпись живёт сутки.
            // Гейт — личный токен из ссылки; за ним ивенты, которые видит в миниаппе любой
            // гость (резидентские в фид не попадают, см. feedEvents), и свои одобренные
            // визиты владельца токена без цели визита (см. visitFeedVevent).
            if (pathname === '/events.ics') {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405).end()
                    return
                }
                const token = url.searchParams.get('token')?.trim() ?? ''
                const userId = feedUserId(deps.storage, token)
                if (userId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ссылка не найдена.')
                    return
                }
                if (!allow(res, 'feed', userId, LIMITS.feed, false)) return
                // Живой бан в чате здесь не перепроверяем, в отличие от /visit.ics:
                // `access` на холодном кэше ходит в Telegram по всем allowlist-чатам, а
                // календарь стучится сам и по расписанию. Своей записи в blockedUsers
                // хватает — публичных ивентов заблокированный и так не лишён.
                if (isBlocked(deps.storage, userId)) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Доступ закрыт.')
                    return
                }
                res.writeHead(200, {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Cache-Control': 'no-store',
                }).end(
                    buildEventsFeedIcs(
                        feedEvents(deps.storage, deps.tzOffsetMinutes),
                        feedVisits(deps.storage, userId, deps.tzOffsetMinutes),
                        deps.tzOffsetMinutes,
                    ),
                )
                return
            }

            // Афиша ивента: тоже <img>, поэтому GET и токен картинок в query, как у
            // аватарок. Файл лежит рядом со стейтом (см. events.ts), в JSON его нет.
            if (pathname === '/event-photo.jpg') {
                if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
                    res.writeHead(405).end()
                    return
                }
                // Заливка (POST) считается отдельно от показа: она пишет до 4 МБ на диск.
                const uploading = req.method === 'POST'
                const viewerId = uploading
                    ? (validateInitData(initDataFromHeader(req), deps.botToken)?.userId ?? null)
                    : verifyLink(deps.botToken, 'media', url.searchParams.get('t') ?? '')
                if (viewerId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, uploading)) return
                    res.writeHead(401).end()
                    return
                }
                const viewer = { userId: viewerId }
                const photoRule = uploading ? LIMITS.photoUpload : LIMITS.photo
                if (!allow(res, uploading ? 'photo.upload' : 'photo', viewer.userId, photoRule, uploading)) return
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
                        sendError(res, 400, 'bad_image', 'Не получилось прочитать картинку — попробуйте другую.')
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
            // поэтому гейт едет в query — токен картинок из bootstrap, не initData.
            // Нет фото — 404, фронт остаётся на градиентной заглушке с буквой.
            if (pathname === '/avatar.jpg') {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405).end()
                    return
                }
                const viewerId = verifyLink(deps.botToken, 'media', url.searchParams.get('t') ?? '')
                if (viewerId === null) {
                    if (!allow(res, 'authFail', ip, LIMITS.authFail, false)) return
                    res.writeHead(401).end()
                    return
                }
                const viewer = { userId: viewerId }
                if (!allow(res, 'avatar', viewer.userId, LIMITS.avatar, false)) return
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
                    //
                    // Прогрев — единственная часть ручки, которая ходит в Telegram, поэтому
                    // у него своя полка. Исчерпал — не 429, а тот же 404: ответ клиенту от
                    // этого не меняется (он и так получал бы заглушку), а очередь mtcute
                    // важнее пары аватарок в списке.
                    if (rateLimit('avatar.warm', String(viewer.userId), LIMITS.avatarWarm).ok) {
                        void warmAvatar(deps.client, id)
                    }
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
                    if (!allow(res, 'authFail', ip, LIMITS.authFail)) return
                    sendError(res, 401, 'bad_init_data', 'Откройте миниапп заново — сессия устарела.')
                    return
                }
                const method = pathname.slice('/api/'.length).replace(/\/+$/, '').replaceAll('/', '.')
                // Три полки подряд: общий потолок на человека, полка класса метода и
                // персональная полка самых дорогих методов. Всё до `residents.access` —
                // на холодном кэше он сам ходит в Telegram по всем allowlist-чатам.
                if (!allow(res, 'api', user.userId, LIMITS.user)) return
                const rateClass = METHOD_CLASS[method] ?? 'write'
                if (!allow(res, `api.${rateClass}`, user.userId, CLASS_LIMITS[rateClass])) return
                const methodLimit = METHOD_LIMITS[method]
                if (methodLimit && !allow(res, `api.${method}`, user.userId, methodLimit)) return
                // Заблокированный участник не имеет доступа к миниаппу — глухой отказ.
                // Источников бана два: своя запись в blockedUsers (блокировка из миниаппа)
                // и живой статус в allowlist-чатах — забаненного руками в Телеграме, минуя
                // миниапп, в blockedUsers нет, но внутрь его пускать всё равно нельзя.
                const { resident, banned } = await deps.residents.access(user.userId)
                if (banned || isBlocked(deps.storage, user.userId)) {
                    sendError(res, 403, 'blocked', 'Доступ закрыт.')
                    return
                }
                const apiCtx: ApiContext = { ...deps, user, resident, body, res }
                // Снимок для журнала — до вызова: close/cancel/event.delete стирают объект.
                const before = auditBefore(apiCtx, method)
                try {
                    await handleApi(apiCtx, method)
                } finally {
                    if (before) logApiAudit(apiCtx, method, before)
                }
                return
            }

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405).end()
                return
            }
            await serveStatic(req, pathname, res)
        })().catch((err) => {
            console.error('[webapp] ошибка обработки запроса:', err)
            if (!res.headersSent) sendError(res, 500, 'internal', 'Внутренняя ошибка сервера.')
            else res.end()
        })
    })
    // Плашка итогов месяца читает кэш журнала: прогреваем его сразу, иначе первая же
    // мутация после рестарта ответила бы bootstrap'ом без неё.
    void refreshWrapCache(deps.storage, deps.tzOffsetMinutes)
    void warmStatic()
    server.listen(deps.config.port, deps.config.host, () => {
        console.log(`[webapp] miniapp server on http://${deps.config.host}:${deps.config.port} (public: ${deps.config.publicUrl})`)
        console.log(`[webapp] dev-аккаунты (DEV_USER_IDS): ${deps.devUserIds.size > 0 ? [...deps.devUserIds].join(', ') : '— пусто, дев-меню и переключателя перспективы не будет'}`)
    })
    return { server, stop: () => server.close() }
}
