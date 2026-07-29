import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
    addDaysToKey,
    HOSTING_DAYS_AHEAD,
    isPastSlot,
    isValidDayKey,
    isValidTime,
    todayKey,
} from './hosting.js'
import type { Storage } from './storage.js'
import type { EventDraft, HostingUser, SpaceEvent } from './types.js'

export const MAX_EVENT_TITLE = 120
export const MAX_EVENT_DESCRIPTION = 2000
/** Потолок афиши: посты канала — это фото на сотни килобайт, мегабайты тут не нужны. */
export const MAX_EVENT_PHOTO_BYTES = 4 * 1024 * 1024
/** Сколько афиш вешаем на ивент: это анонс, а не фотоальбом. */
export const MAX_EVENT_PHOTOS = 6
/** Сколько живёт залитая, но не привязанная к ивенту картинка (см. `sweepStagedPhotos`). */
const STAGED_TTL_MS = 60 * 60 * 1000

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
}

const clip = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''

/** Проверяет слот и заголовок. Общая часть создания и правки. */
const validate = (input: EventInput, tzOffsetMinutes: number, allowPast: boolean): EventError | null => {
    const today = todayKey(tzOffsetMinutes)
    const maxDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
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
    })
    return { ok: true, event: storage.get().events[id]! }
}

export const deleteEvent = async (storage: Storage, dataFile: string, id: string): Promise<boolean> => {
    const existing = storage.get().events[id]
    if (!existing) return false
    const photos = eventPhotoIds(existing)
    await storage.update((s) => {
        delete s.events[id]
    })
    for (const photoId of photos) await deleteEventPhoto(dataFile, photoId)
    return true
}

/** Ивенты дня, отсортированные по времени. `forResidents: false` прячет резидентские. */
export const eventsForDay = (storage: Storage, dateKey: string, forResidents: boolean): SpaceEvent[] =>
    Object.values(storage.get().events)
        .filter((e) => e.dateKey === dateKey && (forResidents || !e.residentsOnly))
        .sort((a, b) => (a.time === b.time ? a.createdAt.localeCompare(b.createdAt) : a.time.localeCompare(b.time)))

/** Может ли этот человек править ивент: автор или любой dev (дев чинит чужое). */
export const canEditEvent = (event: SpaceEvent, userId: number, isDev: boolean): boolean =>
    isDev || event.host.userId === userId

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
