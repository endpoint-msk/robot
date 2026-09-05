import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import {
    addDaysToKey,
    displayName,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    ICS_EVENT_HOURS,
    icsEscape,
    icsFold,
    icsStamp,
    isPastSlot,
    isValidDayKey,
    isValidTime,
    mentionLabel,
    slotStartUtc,
    todayKey,
} from './hosting.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type {
    EventAnswer,
    EventApplication,
    EventDraft,
    EventFieldType,
    EventForm,
    EventFormField,
    EventFormOption,
    HostingNotifyPrefs,
    HostingUser,
    ReviewerScope,
    SpaceEvent,
} from './types.js'

export const MAX_EVENT_TITLE = 120
/**
 * Насколько вперёд можно поставить ивент. Окно хостинга (`HOSTING_DAYS_AHEAD`) ему мало:
 * заявка гостя живёт неделю, а воркшоп объявляют за месяц, и упереться в семь дней
 * значит не дать завести его вовсе. Потолок всё же нужен — он ловит опечатку в дате,
 * после которой ивент уехал бы в 2099-й и остался бы там навсегда.
 */
export const EVENT_DAYS_AHEAD = 365
export const MAX_EVENT_DESCRIPTION = 2000
/** Потолок афиши: посты канала — это фото на сотни килобайт, мегабайты тут не нужны. */
export const MAX_EVENT_PHOTO_BYTES = 4 * 1024 * 1024
/** Сколько афиш вешаем на ивент: это анонс, а не фотоальбом. */
export const MAX_EVENT_PHOTOS = 6
/** Сколько живёт залитая, но не привязанная к ивенту картинка (см. `sweepStagedPhotos`). */
const STAGED_TTL_MS = 60 * 60 * 1000

// Лимиты формы-заявки и ответов на неё.
export const MAX_FORM_FIELDS = 15
export const MAX_FIELD_OPTIONS = 12
export const MAX_FIELD_LABEL = 200
export const MAX_ANSWER_TEXT = 1000
export const MAX_WRITE_IN = 200
export const MAX_CIRCLE_REVIEWERS = 40

/**
 * Каталог афиш — рядом с файлом стейта, а не внутри него: JSON переписывается целиком
 * на каждую мутацию, и картинка на 300 КБ утроила бы стоимость любого чек-ина.
 * Лежит в том же томе, поэтому переживает пересборку контейнера вместе со стейтом.
 */
const photosDir = (dataFile: string): string => path.join(path.dirname(dataFile), 'event-photos')

/** Путь к афише. `id` — id ивента либо `draft-<userId>` для заготовки. */
export const eventPhotoPath = (dataFile: string, id: string): string =>
    path.join(photosDir(dataFile), `${sanitizeId(id)}.jpg`)

/** Из id в имя файла: id мы генерируем сами, но путь собирать из чужой строки нельзя. */
const sanitizeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '')

export const saveEventPhoto = async (dataFile: string, id: string, bytes: Uint8Array): Promise<void> => {
    await fs.mkdir(photosDir(dataFile), { recursive: true })
    await fs.writeFile(eventPhotoPath(dataFile, id), bytes)
}

export const readEventPhoto = async (dataFile: string, id: string): Promise<Buffer | null> => {
    try {
        return await fs.readFile(eventPhotoPath(dataFile, id))
    } catch {
        return null
    }
}

export const deleteEventPhoto = async (dataFile: string, id: string): Promise<void> => {
    await fs.rm(eventPhotoPath(dataFile, id), { force: true }).catch(() => {})
}

export const draftPhotoId = (userId: number): string => `draft-${userId}`

/**
 * Картинка, залитая из редактора, но ещё не привязанная к ивенту: при создании id
 * ивента ещё нет, а форму заполняют с фотографиями. Владелец зашит в имя файла —
 * отдельного стейта у стейджинга нет, а показывать и присваивать такой файл
 * вправе только тот, кто его залил.
 */
export const stagedPhotoId = (userId: number): string => `up-${userId}-${randomUUID()}`

export const isStagedPhotoOf = (id: string, userId: number): boolean => id.startsWith(`up-${userId}-`)

/**
 * Афиши ивента в порядке показа. У ивентов, заведённых до мульти-афиш, списка нет —
 * там одна картинка под id самого ивента.
 */
export const eventPhotoIds = (event: SpaceEvent): string[] =>
    event.photos && event.photos.length > 0 ? event.photos : event.hasPhoto ? [event.id] : []

/** Чей это файл: у привязанных афиш id не совпадает с id ивента, нужен обратный поиск. */
export const eventForPhoto = (storage: Storage, photoId: string): SpaceEvent | null =>
    Object.values(storage.get().events).find((e) => eventPhotoIds(e).includes(photoId)) ?? null

const movePhoto = async (dataFile: string, from: string, to: string): Promise<boolean> => {
    try {
        await fs.mkdir(photosDir(dataFile), { recursive: true })
        await fs.rename(eventPhotoPath(dataFile, from), eventPhotoPath(dataFile, to))
        return true
    } catch {
        return false
    }
}

/**
 * Подчищает залитое, но не привязанное: форму могли закрыть, не сохранив, и файл
 * остался бы навсегда. Свежий стейджинг не трогаем — у резидента может быть открыт
 * ещё один редактор, куда он уже загрузил картинки.
 */
export const sweepStagedPhotos = async (dataFile: string, userId: number, now = Date.now()): Promise<void> => {
    const dir = photosDir(dataFile)
    let names: string[]
    try {
        names = await fs.readdir(dir)
    } catch {
        return
    }
    for (const name of names.filter((n) => n.startsWith(`up-${userId}-`))) {
        const file = path.join(dir, name)
        try {
            const stat = await fs.stat(file)
            if (now - stat.mtimeMs > STAGED_TTL_MS) await fs.rm(file, { force: true })
        } catch {
            /* файл уже унесли — и хорошо */
        }
    }
}

/**
 * Приводит афиши ивента к списку, который прислал редактор: новые (стейджинг либо
 * афиша заготовки) переезжают под id ивента, выпавшие удаляются с диска.
 *
 * Чужой id молча игнорируем: без этого, подставив id из другого ивента, его афишу
 * можно было бы утащить к себе — файл переименовывается, а не копируется.
 */
export const syncEventPhotos = async (
    storage: Storage,
    dataFile: string,
    eventId: string,
    wanted: string[],
    userId: number,
): Promise<void> => {
    const event = storage.get().events[eventId]
    if (!event) return
    const current = eventPhotoIds(event)
    const next: string[] = []
    for (const id of wanted.slice(0, MAX_EVENT_PHOTOS)) {
        if (next.includes(id)) continue
        if (current.includes(id)) {
            next.push(id)
            continue
        }
        if (!isStagedPhotoOf(id, userId) && id !== draftPhotoId(userId)) continue
        const adopted = `${eventId}-${randomUUID().slice(0, 8)}`
        if (await movePhoto(dataFile, id, adopted)) next.push(adopted)
    }
    for (const id of current) if (!next.includes(id)) await deleteEventPhoto(dataFile, id)
    await storage.update((s) => {
        const e = s.events[eventId]
        if (!e) return
        e.photos = next
        // Легаси-флаг держим согласованным: на него смотрит `eventPhotoIds` у старых записей.
        e.hasPhoto = next.length > 0
    })
    await sweepStagedPhotos(dataFile, userId)
}

// ---------------------------------------------------------------------------
// Модель
// ---------------------------------------------------------------------------

export type EventError = 'not_found' | 'bad_date' | 'bad_time' | 'past_time' | 'bad_title' | 'not_yours'

export type EventInput = {
    dateKey: string
    time: string
    title: string
    description: string
    residentsOnly: boolean
    /** Ссылка на пост канала: её ставит сервер из заготовки, а не клиент. */
    sourceUrl?: string
    /** Форма-заявка (уже нормализованная сервером). null — без формы, анонс как раньше. */
    form?: EventForm | null
}

const clip = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''

/** Проверяет слот и заголовок. Общая часть создания и правки. */
const validate = (input: EventInput, tzOffsetMinutes: number, allowPast: boolean): EventError | null => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, EVENT_DAYS_AHEAD - 1)
    if (!isValidDayKey(input.dateKey) || input.dateKey < today || input.dateKey > maxDay) return 'bad_date'
    if (!isValidTime(input.time)) return 'bad_time'
    // Правку в прошедший слот пропускаем: ивент, который уже идёт, всё ещё нужно уметь
    // поправить (перепутали кабинет, поменялось описание).
    if (!allowPast && isPastSlot(input.dateKey, input.time, tzOffsetMinutes)) return 'past_time'
    if (clip(input.title, MAX_EVENT_TITLE).length === 0) return 'bad_title'
    return null
}

export const createEvent = async (
    storage: Storage,
    tzOffsetMinutes: number,
    host: HostingUser,
    input: EventInput,
): Promise<{ ok: true; event: SpaceEvent } | { ok: false; error: EventError }> => {
    const bad = validate(input, tzOffsetMinutes, false)
    if (bad) return { ok: false, error: bad }
    const event: SpaceEvent = {
        id: randomUUID(),
        dateKey: input.dateKey,
        time: input.time,
        title: clip(input.title, MAX_EVENT_TITLE),
        description: clip(input.description, MAX_EVENT_DESCRIPTION),
        residentsOnly: input.residentsOnly === true,
        hasPhoto: false,
        photos: [],
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        host,
        createdAt: new Date().toISOString(),
        form: input.form ?? null,
    }
    await storage.update((s) => {
        s.events[event.id] = event
    })
    return { ok: true, event }
}

export const updateEvent = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    input: EventInput,
): Promise<{ ok: true; event: SpaceEvent } | { ok: false; error: EventError }> => {
    if (!storage.get().events[id]) return { ok: false, error: 'not_found' }
    const bad = validate(input, tzOffsetMinutes, true)
    if (bad) return { ok: false, error: bad }
    await storage.update((s) => {
        const e = s.events[id]
        if (!e) return
        e.dateKey = input.dateKey
        e.time = input.time
        e.title = clip(input.title, MAX_EVENT_TITLE)
        e.description = clip(input.description, MAX_EVENT_DESCRIPTION)
        e.residentsOnly = input.residentsOnly === true
        e.form = input.form ?? null
    })
    return { ok: true, event: storage.get().events[id]! }
}

export const deleteEvent = async (storage: Storage, dataFile: string, id: string): Promise<boolean> => {
    const existing = storage.get().events[id]
    if (!existing) return false
    const photos = eventPhotoIds(existing)
    await storage.update((s) => {
        delete s.events[id]
        // Заявки на удалённый ивент осиротели бы — чистим вместе с ним.
        for (const [appId, app] of Object.entries(s.eventApplications)) {
            if (app.eventId === id) delete s.eventApplications[appId]
        }
    })
    for (const photoId of photos) await deleteEventPhoto(dataFile, photoId)
    return true
}

/** Ивенты дня, отсортированные по времени. `forResidents: false` прячет резидентские. */
export const eventsForDay = (storage: Storage, dateKey: string, forResidents: boolean): SpaceEvent[] =>
    Object.values(storage.get().events)
        .filter((e) => e.dateKey === dateKey && (forResidents || !e.residentsOnly))
        .sort((a, b) => (a.time === b.time ? a.createdAt.localeCompare(b.createdAt) : a.time.localeCompare(b.time)))

/**
 * Ивенты дальше окна обзора, от ближайшего к дальнему. `forResidents: false` прячет
 * резидентские, как и `eventsForDay`.
 *
 * Нужны отдельным списком потому, что все дневные поверхности — экран дня, «Активность»,
 * доска — живут в `HOSTING_DAYS_AHEAD`: без него ивент, поставленный на месяц вперёд,
 * пропадал бы с глаз до самой недели проведения, включая автора, которому его ещё
 * нужно уметь поправить.
 */
export const eventsLater = (storage: Storage, tzOffsetMinutes: number, forResidents: boolean): SpaceEvent[] => {
    const lastVisibleDay = addDaysToKey(todayKey(tzOffsetMinutes), HOSTING_DAYS_AHEAD - 1)
    return Object.values(storage.get().events)
        .filter((e) => e.dateKey > lastVisibleDay && (forResidents || !e.residentsOnly))
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))
}

/** Может ли этот человек править ивент: автор или любой dev (дев чинит чужое). */
export const canEditEvent = (event: SpaceEvent, userId: number, isDev: boolean): boolean =>
    isDev || event.host.userId === userId

// ---------------------------------------------------------------------------
// Форма-заявка на ивент
// ---------------------------------------------------------------------------

const shortId = (): string => randomUUID().slice(0, 8)
const clipStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Приводит присланную клиентом форму к чистому виду или к null (нет формы). Пустая форма
 * (без валидных блоков) — это тоже «нет формы»: гость тогда попадает на ивент как раньше.
 * id блоков и вариантов сохраняем клиентские (стабильность в редакторе), иначе генерируем.
 */
export const normalizeEventForm = (raw: unknown): EventForm | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as { fields?: unknown; reviewers?: unknown }
    const rawFields = Array.isArray(r.fields) ? r.fields : []
    const fields: EventFormField[] = []
    for (const f of rawFields.slice(0, MAX_FORM_FIELDS)) {
        if (!f || typeof f !== 'object') continue
        const ff = f as { id?: unknown; type?: unknown; label?: unknown; required?: unknown; multi?: unknown; options?: unknown }
        const label = clipStr(ff.label, MAX_FIELD_LABEL)
        if (!label) continue
        const id = typeof ff.id === 'string' && ff.id ? ff.id.slice(0, 40) : shortId()
        const type: EventFieldType = ff.type === 'choice' ? 'choice' : 'text'
        const required = ff.required === true
        if (type === 'text') {
            fields.push({ id, type, label, required })
            continue
        }
        const rawOpts = Array.isArray(ff.options) ? ff.options : []
        const options: EventFormOption[] = []
        for (const o of rawOpts.slice(0, MAX_FIELD_OPTIONS)) {
            if (!o || typeof o !== 'object') continue
            const oo = o as { id?: unknown; label?: unknown; writeIn?: unknown }
            const olabel = clipStr(oo.label, MAX_FIELD_LABEL)
            if (!olabel) continue
            options.push({
                id: typeof oo.id === 'string' && oo.id ? oo.id.slice(0, 40) : shortId(),
                label: olabel,
                ...(oo.writeIn === true ? { writeIn: true as const } : {}),
            })
        }
        if (options.length === 0) continue // блок выбора без вариантов бессмыслен
        fields.push({ id, type, label, required, multi: ff.multi === true, options })
    }
    if (fields.length === 0) return null

    const rr = r.reviewers as { kind?: unknown; userIds?: unknown } | undefined
    let reviewers: ReviewerScope = { kind: 'all' }
    if (rr && rr.kind === 'creator') reviewers = { kind: 'creator' }
    else if (rr && rr.kind === 'circle') {
        const ids = Array.isArray(rr.userIds) ? rr.userIds.filter((x): x is number => Number.isInteger(x)) : []
        reviewers = { kind: 'circle', userIds: [...new Set(ids)].slice(0, MAX_CIRCLE_REVIEWERS) }
    }
    return { fields, reviewers }
}

/**
 * Вправе ли человек рассматривать заявки ивента. Автор — всегда, dev — всегда; дальше по
 * `form.reviewers`. Для круга и «всех» нужно ещё быть резидентом (вышедший из резидентов
 * права теряет).
 */
export const canReviewEvent = (event: SpaceEvent, userId: number, isResident: boolean, isDev: boolean): boolean => {
    if (!event.form) return false
    if (isDev || event.host.userId === userId) return true
    const r = event.form.reviewers
    if (r.kind === 'creator') return false
    if (r.kind === 'all') return isResident
    return isResident && r.userIds.includes(userId)
}

/** Кому слать DM о новой заявке: рецензенты по `form.reviewers` плюс автор. */
export const reviewerIdsFor = async (event: SpaceEvent, directory: ResidentDirectory): Promise<number[]> => {
    const r = event.form?.reviewers
    if (!r) return []
    const host = event.host.userId
    if (r.kind === 'creator') return [host]
    if (r.kind === 'circle') return [...new Set([host, ...r.userIds])]
    const ids = await directory.listIds()
    return [...new Set([host, ...ids])]
}

export type ApplicationError = 'not_found' | 'no_form' | 'not_visible' | 'past' | 'duplicate' | 'required' | 'not_pending'

/**
 * Собирает ответы по форме, проверяя обязательные. Текст вопроса и подписи выбранных
 * вариантов — снимок: форму потом правят, а заявка должна остаться читаемой.
 */
const buildAnswers = (form: EventForm, raw: unknown): { ok: true; answers: EventAnswer[] } | { ok: false } => {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const answers: EventAnswer[] = []
    for (const field of form.fields) {
        const a = (src[field.id] && typeof src[field.id] === 'object' ? (src[field.id] as Record<string, unknown>) : {}) as {
            text?: unknown
            optionIds?: unknown
            writeIn?: unknown
        }
        if (field.type === 'text') {
            const text = clipStr(a.text, MAX_ANSWER_TEXT)
            if (field.required && !text) return { ok: false }
            answers.push({ fieldId: field.id, question: field.label, type: 'text', ...(text ? { text } : {}) })
            continue
        }
        const options = field.options ?? []
        const selIds = Array.isArray(a.optionIds) ? a.optionIds.filter((x): x is string => typeof x === 'string') : []
        const chosen = options.filter((o) => selIds.includes(o.id))
        const picked = field.multi ? chosen : chosen.slice(0, 1)
        const labels = picked.map((o) => o.label)
        const writeIn = picked.some((o) => o.writeIn) ? clipStr(a.writeIn, MAX_WRITE_IN) : ''
        if (field.required && labels.length === 0) return { ok: false }
        answers.push({
            fieldId: field.id,
            question: field.label,
            type: 'choice',
            ...(labels.length ? { choiceLabels: labels } : {}),
            ...(writeIn ? { writeIn } : {}),
        })
    }
    return { ok: true, answers }
}

/** Заявки на ивент, свежие снизу (по времени подачи). */
export const applicationsForEvent = (storage: Storage, eventId: string): EventApplication[] =>
    Object.values(storage.get().eventApplications)
        .filter((a) => a.eventId === eventId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

/** Активная заявка этого гостя на этот ивент (одна на пару). */
export const applicationOf = (storage: Storage, eventId: string, userId: number): EventApplication | null =>
    Object.values(storage.get().eventApplications).find((a) => a.eventId === eventId && a.guest.userId === userId) ?? null

/** Все заявки этого гостя (для «Моих визитов»). */
export const applicationsByGuest = (storage: Storage, userId: number): EventApplication[] =>
    Object.values(storage.get().eventApplications).filter((a) => a.guest.userId === userId)

export const createApplication = async (
    storage: Storage,
    tzOffsetMinutes: number,
    event: SpaceEvent,
    guest: HostingUser,
    rawAnswers: unknown,
    forResident: boolean,
): Promise<{ ok: true; app: EventApplication } | { ok: false; error: ApplicationError }> => {
    if (!event.form) return { ok: false, error: 'no_form' }
    if (event.residentsOnly && !forResident) return { ok: false, error: 'not_visible' }
    if (isPastSlot(event.dateKey, event.time, tzOffsetMinutes)) return { ok: false, error: 'past' }
    if (applicationOf(storage, event.id, guest.userId)) return { ok: false, error: 'duplicate' }
    const built = buildAnswers(event.form, rawAnswers)
    if (!built.ok) return { ok: false, error: 'required' }
    const app: EventApplication = {
        id: randomUUID(),
        eventId: event.id,
        guest,
        answers: built.answers,
        status: 'pending',
        createdAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
    }
    await storage.update((s) => {
        s.eventApplications[app.id] = app
    })
    return { ok: true, app }
}

export const editApplication = async (
    storage: Storage,
    appId: string,
    userId: number,
    rawAnswers: unknown,
): Promise<{ ok: true; app: EventApplication } | { ok: false; error: ApplicationError }> => {
    const app = storage.get().eventApplications[appId]
    if (!app || app.guest.userId !== userId) return { ok: false, error: 'not_found' }
    if (app.status !== 'pending') return { ok: false, error: 'not_pending' }
    const event = storage.get().events[app.eventId]
    if (!event?.form) return { ok: false, error: 'no_form' }
    const built = buildAnswers(event.form, rawAnswers)
    if (!built.ok) return { ok: false, error: 'required' }
    await storage.update((s) => {
        const a = s.eventApplications[appId]
        if (a) a.answers = built.answers
    })
    return { ok: true, app: storage.get().eventApplications[appId]! }
}

/** Отмена заявки гостем — удаление (как отмена визита). Возвращает удалённую для DM. */
export const cancelApplication = async (storage: Storage, appId: string, userId: number): Promise<EventApplication | null> => {
    const app = storage.get().eventApplications[appId]
    if (!app || app.guest.userId !== userId) return null
    await storage.update((s) => {
        delete s.eventApplications[appId]
    })
    return app
}

export const approveApplication = async (storage: Storage, appId: string, reviewer: HostingUser): Promise<EventApplication | null> => {
    if (!storage.get().eventApplications[appId]) return null
    await storage.update((s) => {
        const a = s.eventApplications[appId]
        if (!a) return
        a.status = 'approved'
        a.approvedBy = reviewer
        a.approvedAt = new Date().toISOString()
    })
    return storage.get().eventApplications[appId] ?? null
}

/** Отклонение рецензентом — удаление заявки (гость может подать заново). Возвращает её для DM. */
export const declineApplication = async (storage: Storage, appId: string): Promise<EventApplication | null> => {
    const app = storage.get().eventApplications[appId]
    if (!app) return null
    await storage.update((s) => {
        delete s.eventApplications[appId]
    })
    return app
}

/** Принятые заявители ивента — для публичного счётчика/списка «кто придёт» на карточке. */
export const approvedApplicants = (storage: Storage, eventId: string): HostingUser[] =>
    applicationsForEvent(storage, eventId)
        .filter((a) => a.status === 'approved')
        .map((a) => a.guest)

// ---------------------------------------------------------------------------
// Уведомления по заявкам
// ---------------------------------------------------------------------------

/** DM рецензентам о новой заявке на ивент. Fire-and-forget, закрытая личка не фатальна. */
export const notifyReviewersNewApplication = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    webappUrl: string,
    event: SpaceEvent,
    app: EventApplication,
): Promise<void> => {
    const ids = await reviewerIdsFor(event, directory)
    const text = [
        `Новая заявка на ивент: <b>${html.escape(event.title)}</b>`,
        `${formatDayKey(event.dateKey)} к ${event.time}.`,
        `От: ${await mentionLabel(client, app.guest)}.`,
    ].join('<br>')
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть заявки', webappUrl)]])
    for (const userId of ids) {
        if (userId === app.guest.userId) continue
        try {
            await client.sendText(userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        } catch {
            /* рецензент не открывал личку — молча пропускаем */
        }
    }
}

/**
 * DM гостю о принятии заявки. Отклонение — тихое (без уведомления): по договорённости
 * отказ гостю не сообщаем, заявка просто удаляется.
 */
export const notifyApplicantApproved = async (
    client: TelegramClient,
    webappUrl: string,
    event: SpaceEvent,
    guest: HostingUser,
): Promise<void> => {
    const text = [
        `Заявка на ивент принята: <b>${html.escape(event.title)}</b>`,
        `Ждём вас ${formatDayKey(event.dateKey)} к ${event.time}.`,
    ].join('<br>')
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть ивенты', webappUrl)]])
    try {
        await client.sendText(guest.userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
    } catch {
        /* гость не открывал личку — молча пропускаем */
    }
}

// ---------------------------------------------------------------------------
// Уведомления резидентам
// ---------------------------------------------------------------------------

/**
 * Дефолт уведомлений об ивентах: включены, про любой день.
 *
 * Режим отличается от заявок (`DEFAULT_HOSTING_NOTIFY`, там 'today') намеренно: заявка —
 * это просьба открыть дверь, и она горит только в свой день, а ивент анонсируют заранее
 * и ровно ради того, чтобы на него успели прийти. Уведомление в день начала обесценило бы
 * рассылку.
 */
export const DEFAULT_EVENT_NOTIFY: HostingNotifyPrefs = { enabled: true, mode: 'all' }

export const eventNotifyPrefsFor = (storage: Storage, userId: number): HostingNotifyPrefs =>
    storage.get().eventNotify[String(userId)] ?? { ...DEFAULT_EVENT_NOTIFY }

/** Сколько описания уносим в личку: анонс, а не пересказ — подробности в миниаппе. */
const NOTIFY_DESCRIPTION_LIMIT = 400

/**
 * Рассылает резидентам уведомление о новом ивенте — в личку, по тем же правилам, что и
 * заявки (`notifyResidentsAboutRequest`), но со своим тумблером `eventNotify`. Автора не
 * уведомляем. Ошибки отправки (закрытая личка) не фатальны.
 *
 * Резидентские ивенты рассылаем как обычные: получатели — сами резиденты.
 */
export const notifyResidentsAboutEvent = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    tzOffsetMinutes: number,
    webappUrl: string,
    event: SpaceEvent,
): Promise<void> => {
    const isForToday = event.dateKey === todayKey(tzOffsetMinutes)
    const lines = [
        `Новый ивент: <b>${html.escape(event.title)}</b>`,
        `${formatDayKey(event.dateKey)} к ${event.time}${isForToday ? ' (сегодня)' : ''}.`,
        `Организатор: ${await mentionLabel(client, event.host)}.`,
    ]
    if (event.residentsOnly) lines.push('Только для резидентов — гостям не показывается.')
    if (event.description) {
        const short =
            event.description.length > NOTIFY_DESCRIPTION_LIMIT
                ? `${event.description.slice(0, NOTIFY_DESCRIPTION_LIMIT).trimEnd()}…`
                : event.description
        // Переносы внутри описания живут только как <br>: html() схлопывает \n в пробел.
        lines.push('', ...short.split('\n').map((line) => html.escape(line)))
    }
    await broadcastEventNotice(client, storage, directory, lines.join('<br>'), webappUrl, isForToday, event.host.userId)
}

/**
 * Общая рассылка резидентам про ивент: один тумблер (`eventNotify`) и одни правила
 * на создание, перенос и отмену - иначе человек, выключивший анонсы, всё равно получал
 * бы про них половину сообщений.
 */
const broadcastEventNotice = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    text: string,
    webappUrl: string,
    isForToday: boolean,
    skipUserId: number,
): Promise<void> => {
    const residents = await directory.listIds()
    const keyboard = BotKeyboard.inline([[BotKeyboard.webView('Открыть ивенты', webappUrl)]])
    for (const userId of residents) {
        if (userId === skipUserId) continue
        const prefs = eventNotifyPrefsFor(storage, userId)
        if (!prefs.enabled) continue
        if (prefs.mode === 'today' && !isForToday) continue
        try {
            await client.sendText(userId, html(text), { replyMarkup: keyboard, disableWebPreview: true })
        } catch {
            // резидент не открывал личку с ботом — молча пропускаем
        }
    }
}

// ---------------------------------------------------------------------------
// Анонс в чаты
// ---------------------------------------------------------------------------

/**
 * Deep link миниаппа для кнопки под анонсом: в группах web_app-кнопки запрещены, поэтому
 * та же ссылка, что у доски (`setHostingBoardLink`). null — миниапп не настроен, кнопки нет.
 */
let eventAnnounceLink: string | null = null

export const setEventAnnounceLink = (link: string | null): void => {
    eventAnnounceLink = link
}

/**
 * Сколько описания уносим в чат: у сообщения с фото подпись ограничена 1024 символами
 * на всё, включая заголовок и организатора.
 */
const CHAT_DESCRIPTION_LIMIT = 600

/**
 * Организатор в анонсе: с ником — t.me-ссылка, без ника — просто имя. Text-mention
 * (`tg://user?id=`), который уходит в личку, тут не годится: он пингует человека при
 * каждой публикации, а анонс не повод дёргать (тот же довод, что у доски).
 */
const hostLabel = (host: HostingUser): string =>
    host.username
        ? `<a href="https://t.me/${encodeURIComponent(host.username)}">@${host.username}</a>`
        : html.escape(displayName(host.name))

/** Чаты, которые получат анонс ивента: allowlist минус замьюченные через /eventmute. */
export const eventAnnounceTargets = (storage: Storage, allowedChats: ReadonlySet<number>): number[] =>
    [...allowedChats].filter((chatId) => storage.get().eventsMuted[String(chatId)] !== true)

/**
 * Анонс нового ивента в общие чаты — параллельно DM резидентам
 * (`notifyResidentsAboutEvent`): в личку уходит рабочее уведомление тем, кто держит
 * спейс, а в чат — приглашение всем, кто там сидит.
 *
 * `residentsOnly` в чат не выносим по тому же правилу, что и на доску: чат читают гости,
 * и звать их на закрытый ивент нельзя.
 */
export const announceEventToChats = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    tzOffsetMinutes: number,
    dataFile: string,
    event: SpaceEvent,
): Promise<void> => {
    if (event.residentsOnly) return
    const targets = eventAnnounceTargets(storage, allowedChats)
    if (targets.length === 0) return

    // Ивент из пересылки ведёт на исходный пост канала: там вёрстка, картинки и
    // комментарии, которых в анонсе быть не может (так же сделано на доске).
    const title = event.sourceUrl
        ? `<a href="${html.escape(event.sourceUrl)}">${html.escape(event.title)}</a>`
        : `<b>${html.escape(event.title)}</b>`
    const lines = [
        `📅 Новый ивент: ${title}`,
        `${formatDayKey(event.dateKey)} к ${event.time}${event.dateKey === todayKey(tzOffsetMinutes) ? ' (сегодня)' : ''}`,
        `Организатор: ${hostLabel(event.host)}`,
    ]
    if (event.description) {
        const short =
            event.description.length > CHAT_DESCRIPTION_LIMIT
                ? `${event.description.slice(0, CHAT_DESCRIPTION_LIMIT).trimEnd()}…`
                : event.description
        lines.push('', ...short.split('\n').map((line) => html.escape(line)))
    }
    const text = lines.join('<br>')
    const markup = eventAnnounceLink
        ? BotKeyboard.inline([[BotKeyboard.url('🚪 Хочу прийти', eventAnnounceLink)]])
        : undefined

    // Афиша — первая: анонс с картинкой в ленте чата заметнее, а разводить ради этого
    // альбом незачем — подробности всё равно в миниаппе.
    const photoId = eventPhotoIds(event)[0]
    const photo = photoId ? await readEventPhoto(dataFile, photoId) : null

    for (const chatId of targets) {
        try {
            if (photo) {
                await client.sendMedia(chatId, InputMedia.photo(photo, { caption: html(text) }), {
                    replyMarkup: markup,
                })
            } else {
                await client.sendText(chatId, html(text), { disableWebPreview: true, replyMarkup: markup })
            }
        } catch (err) {
            console.error(`[events] не удалось отправить анонс ивента в чат ${chatId}:`, err)
        }
    }
}

/**
 * Ивент для календаря (.ics, RFC 5545) - та же механика, что у визита
 * (`buildVisitIcs`): DTSTART в UTC из пояса спейса, фиксированная длительность.
 * Отдаётся по `GET /event.ics`, гейт видимости - там же.
 */
const eventVevent = (event: SpaceEvent, tzOffsetMinutes: number, now: Date): string[] => {
    const startUtc = new Date(slotStartUtc(event.dateKey, event.time, tzOffsetMinutes))
    const endUtc = new Date(startUtc.getTime() + ICS_EVENT_HOURS * 3600_000)
    const description: string[] = []
    if (event.description) description.push(event.description)
    description.push(
        `Организатор: ${displayName(event.host.name)}${event.host.username ? ` (@${event.host.username})` : ''}`,
    )
    return [
        'BEGIN:VEVENT',
        `UID:${event.id}@endpoint-events`,
        `DTSTAMP:${icsStamp(now)}`,
        `DTSTART:${icsStamp(startUtc)}`,
        `DTEND:${icsStamp(endUtc)}`,
        `SUMMARY:${icsEscape(event.title)}`,
        `DESCRIPTION:${icsEscape(description.join('\n'))}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
    ]
}

export const buildEventIcs = (event: SpaceEvent, tzOffsetMinutes: number, now: Date = new Date()): string => {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//endpoint//events//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        ...eventVevent(event, tzOffsetMinutes, now),
        'END:VCALENDAR',
    ]
    return lines.map(icsFold).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Подписка календаря на ивенты (GET /events.ics)
// ---------------------------------------------------------------------------

/** Имя календаря у подписчика. Клиенты показывают его в списке календарей. */
const FEED_NAME = 'Ивенты хакспейса'

/** Как часто календарю стоит перечитывать фид: подсказка, а не гарантия. */
const FEED_REFRESH = 'PT1H'

/**
 * Что уезжает в подписку: будущие ивенты, кроме резидентских.
 *
 * Резидентские не отдаём ни в каком виде - ссылку календарь хранит годами, она
 * переживает и выход человека из резидентов, и пересылку кому угодно. За фидом
 * должно лежать ровно то, что видит в миниаппе любой гость.
 */
export const feedEvents = (storage: Storage, tzOffsetMinutes: number): SpaceEvent[] => {
    const today = todayKey(tzOffsetMinutes)
    return Object.values(storage.get().events)
        .filter((e) => !e.residentsOnly && e.dateKey >= today)
        .sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)))
}

/** Фид подписки: тот же VEVENT, что и в одиночном `.ics`, но пачкой и с именем календаря. */
export const buildEventsFeedIcs = (
    events: SpaceEvent[],
    tzOffsetMinutes: number,
    now: Date = new Date(),
): string => {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//endpoint//events//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `NAME:${icsEscape(FEED_NAME)}`,
        `X-WR-CALNAME:${icsEscape(FEED_NAME)}`,
        `REFRESH-INTERVAL;VALUE=DURATION:${FEED_REFRESH}`,
        `X-PUBLISHED-TTL:${FEED_REFRESH}`,
        ...events.flatMap((e) => eventVevent(e, tzOffsetMinutes, now)),
        'END:VCALENDAR',
    ]
    return lines.map(icsFold).join('\r\n') + '\r\n'
}

/**
 * Токен подписки этого человека: заводим при первом обращении, дальше ссылка
 * постоянная - её один раз добавили в календарь, и менять её нельзя.
 */
export const ensureEventFeedToken = async (storage: Storage, userId: number): Promise<string> => {
    const existing = storage.get().eventFeedTokens[String(userId)]
    if (existing) return existing
    const token = randomBytes(24).toString('base64url')
    await storage.update((s) => {
        s.eventFeedTokens[String(userId)] = token
    })
    return token
}

/** Слот ивента на момент до правки - чтобы в уведомлении назвать и старое, и новое время. */
export type EventSlot = { dateKey: string; time: string }

/**
 * Перенос ивента: DM резидентам со старым и новым слотом.
 *
 * Раньше `notifyResidentsAboutEvent` дёргался ровно один раз, при создании: человек
 * читал анонс в понедельник, приходил в четверг, а ивент к тому моменту уехал на
 * пятницу - и об этом не знал никто, кроме тех, кто снова открыл миниапп.
 *
 * `byUserId` - кто двигал, а не автор ивента: чужой ивент правит и дев, и тогда автору
 * знать о переносе нужнее всех.
 */
export const notifyEventMoved = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    tzOffsetMinutes: number,
    webappUrl: string,
    event: SpaceEvent,
    before: EventSlot,
    byUserId: number,
): Promise<void> => {
    if (before.dateKey === event.dateKey && before.time === event.time) return
    const isForToday = event.dateKey === todayKey(tzOffsetMinutes) || before.dateKey === todayKey(tzOffsetMinutes)
    const text = [
        `Ивент перенесён: <b>${html.escape(event.title)}</b>`,
        `Было ${formatDayKey(before.dateKey)} к ${before.time}.`,
        `Стало ${formatDayKey(event.dateKey)} к ${event.time}.`,
    ].join('<br>')
    await broadcastEventNotice(client, storage, directory, text, webappUrl, isForToday, byUserId)
}

/** Отмена ивента: DM тем же, кому уходил анонс. */
export const notifyEventCancelled = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    tzOffsetMinutes: number,
    webappUrl: string,
    event: SpaceEvent,
    byUserId: number,
): Promise<void> => {
    const text = [
        `Ивент отменён: <b>${html.escape(event.title)}</b>`,
        `${formatDayKey(event.dateKey)} к ${event.time} - не состоится.`,
    ].join('<br>')
    await broadcastEventNotice(
        client, storage, directory, text, webappUrl, event.dateKey === todayKey(tzOffsetMinutes), byUserId,
    )
}

// ---------------------------------------------------------------------------
// Заготовки из пересланных постов
// ---------------------------------------------------------------------------

/**
 * Режет пост канала на заголовок и описание: первая непустая строка — заголовок,
 * остальное — описание. Так анонсы и написаны — название сверху, подробности ниже.
 */
export const splitPostText = (text: string): { title: string; description: string } => {
    const lines = text.split('\n')
    const firstIdx = lines.findIndex((l) => l.trim().length > 0)
    if (firstIdx < 0) return { title: '', description: '' }
    return {
        title: clip(lines[firstIdx], MAX_EVENT_TITLE),
        description: clip(lines.slice(firstIdx + 1).join('\n'), MAX_EVENT_DESCRIPTION),
    }
}

export const saveEventDraft = async (storage: Storage, draft: EventDraft): Promise<void> => {
    await storage.update((s) => {
        s.eventDrafts[String(draft.userId)] = draft
    })
}

export const eventDraftFor = (storage: Storage, userId: number): EventDraft | null =>
    storage.get().eventDrafts[String(userId)] ?? null

export const clearEventDraft = async (storage: Storage, dataFile: string, userId: number): Promise<void> => {
    if (!storage.get().eventDrafts[String(userId)]) return
    await storage.update((s) => {
        delete s.eventDrafts[String(userId)]
    })
    await deleteEventPhoto(dataFile, draftPhotoId(userId))
}
