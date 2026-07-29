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

/** Переносит афишу заготовки на созданный ивент. false — переносить было нечего. */
export const adoptDraftPhoto = async (dataFile: string, draftId: string, eventId: string): Promise<boolean> => {
    const bytes = await readEventPhoto(dataFile, draftId)
    if (!bytes) return false
    await saveEventPhoto(dataFile, eventId, bytes)
    await deleteEventPhoto(dataFile, draftId)
    return true
}

export const draftPhotoId = (userId: number): string => `draft-${userId}`

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
    if (!storage.get().events[id]) return false
    await storage.update((s) => {
        delete s.events[id]
    })
    await deleteEventPhoto(dataFile, id)
    return true
}

export const setEventPhoto = async (storage: Storage, id: string, has: boolean): Promise<void> => {
    await storage.update((s) => {
        const e = s.events[id]
        if (e) e.hasPhoto = has
    })
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
