import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import {
    addDaysToKey,
    displayName,
    isPastSlot,
    isValidDayKey,
    isValidTime,
    slotStartUtc,
    todayKey,
} from './hosting.js'
import {
    deleteEventPhoto,
    eventPhotoPath,
    isStagedPhotoOf,
    MAX_EVENT_PHOTOS,
    readEventPhoto,
    sweepStagedPhotos,
} from './events.js'
import { startHeartbeatInterval } from './health.js'
import type { Storage } from './storage.js'
import type { HostingUser, Vote, VoteOption } from './types.js'

export const MAX_VOTE_TITLE = 120
export const MAX_VOTE_DESCRIPTION = 2000
export const MAX_VOTE_OPTION_LABEL = 100
export const MIN_VOTE_OPTIONS = 2
export const MAX_VOTE_OPTIONS = 10
export const MAX_VOTE_PHOTOS = MAX_EVENT_PHOTOS
export const VOTE_DAYS_AHEAD = 365

const clip = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''

const shortId = (): string => randomUUID().slice(0, 8)

// ---------------------------------------------------------------------------
// Афиши (общий каталог с ивентами: event-photos/)
// ---------------------------------------------------------------------------

export const votePhotoIds = (vote: Vote): string[] =>
    vote.photos && vote.photos.length > 0 ? vote.photos : vote.hasPhoto ? [vote.id] : []

export const voteForPhoto = (storage: Storage, photoId: string): Vote | null =>
    Object.values(storage.get().votes).find((v) => votePhotoIds(v).includes(photoId)) ?? null

const movePhoto = async (dataFile: string, from: string, to: string): Promise<boolean> => {
    try {
        await fs.rename(eventPhotoPath(dataFile, from), eventPhotoPath(dataFile, to))
        return true
    } catch {
        return false
    }
}

/** Приводит афиши к присланному списку: новое (стейджинг) переезжает под id голосования, выпавшее удаляется. */
export const syncVotePhotos = async (
    storage: Storage,
    dataFile: string,
    voteId: string,
    wanted: string[],
    userId: number,
): Promise<void> => {
    const vote = storage.get().votes[voteId]
    if (!vote) return
    const current = votePhotoIds(vote)
    const next: string[] = []
    for (const id of wanted.slice(0, MAX_VOTE_PHOTOS)) {
        if (next.includes(id)) continue
        if (current.includes(id)) {
            next.push(id)
            continue
        }
        if (!isStagedPhotoOf(id, userId)) continue
        const adopted = `vote-${voteId}-${shortId()}`
        if (await movePhoto(dataFile, id, adopted)) next.push(adopted)
    }
    for (const id of current) if (!next.includes(id)) await deleteEventPhoto(dataFile, id)
    await storage.update((s) => {
        const v = s.votes[voteId]
        if (!v) return
        v.photos = next
        v.hasPhoto = next.length > 0
    })
    await sweepStagedPhotos(dataFile, userId)
}

// ---------------------------------------------------------------------------
// Модель
// ---------------------------------------------------------------------------

export type VoteError = 'not_found' | 'bad_title' | 'bad_options' | 'bad_deadline' | 'not_yours' | 'has_votes'

export type VoteInput = {
    title: string
    description: string
    options: { id?: string; label: string }[]
    multi: boolean
    anon: boolean
    /** День/время авто-закрытия в поясе спейса, либо null — без срока. */
    deadline: { dateKey: string; time: string } | null
}

export const isVoteOpen = (vote: Vote, now = Date.now()): boolean =>
    vote.closedAt === null && (vote.endsAt === null || Date.parse(vote.endsAt) > now)

export const canManageVote = (vote: Vote, userId: number, isDev: boolean): boolean =>
    isDev || vote.author.userId === userId

const normalizeOptions = (raw: { id?: string; label: string }[]): VoteOption[] => {
    const out: VoteOption[] = []
    for (const o of raw.slice(0, MAX_VOTE_OPTIONS)) {
        const label = clip(o.label, MAX_VOTE_OPTION_LABEL)
        if (!label) continue
        out.push({ id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : shortId(), label })
    }
    return out
}

/** Проверяет и превращает срок в ISO. undefined — срок невалиден, null — срока нет. */
const resolveDeadline = (
    deadline: VoteInput['deadline'],
    tzOffsetMinutes: number,
): string | null | undefined => {
    if (!deadline) return null
    const { dateKey, time } = deadline
    const maxDay = addDaysToKey(todayKey(tzOffsetMinutes), VOTE_DAYS_AHEAD - 1)
    if (!isValidDayKey(dateKey) || dateKey < todayKey(tzOffsetMinutes) || dateKey > maxDay) return undefined
    if (!isValidTime(time) || isPastSlot(dateKey, time, tzOffsetMinutes)) return undefined
    return new Date(slotStartUtc(dateKey, time, tzOffsetMinutes)).toISOString()
}

export const createVote = async (
    storage: Storage,
    tzOffsetMinutes: number,
    author: HostingUser,
    input: VoteInput,
): Promise<{ ok: true; vote: Vote } | { ok: false; error: VoteError }> => {
    const title = clip(input.title, MAX_VOTE_TITLE)
    if (!title) return { ok: false, error: 'bad_title' }
    const options = normalizeOptions(input.options)
    if (options.length < MIN_VOTE_OPTIONS) return { ok: false, error: 'bad_options' }
    const endsAt = resolveDeadline(input.deadline, tzOffsetMinutes)
    if (endsAt === undefined) return { ok: false, error: 'bad_deadline' }
    const vote: Vote = {
        id: randomUUID(),
        title,
        description: clip(input.description, MAX_VOTE_DESCRIPTION),
        options,
        multi: input.multi === true,
        anon: input.anon === true,
        photos: [],
        hasPhoto: false,
        author,
        createdAt: new Date().toISOString(),
        endsAt,
        closedAt: null,
        ballots: {},
        ...(input.anon === true ? { tally: {}, voters: [] } : {}),
    }
    await storage.update((s) => {
        s.votes[vote.id] = vote
    })
    return { ok: true, vote }
}

/**
 * Правка идущего голосования. Варианты/множественность/анонимность меняются только
 * пока никто не проголосовал: после первого голоса они привязаны к уже поданным
 * бюллетеням. Заголовок, описание, афиши и срок правятся всегда.
 */
export const updateVote = async (
    storage: Storage,
    tzOffsetMinutes: number,
    id: string,
    input: VoteInput,
): Promise<{ ok: true; vote: Vote } | { ok: false; error: VoteError }> => {
    const vote = storage.get().votes[id]
    if (!vote) return { ok: false, error: 'not_found' }
    const title = clip(input.title, MAX_VOTE_TITLE)
    if (!title) return { ok: false, error: 'bad_title' }
    const endsAt = resolveDeadline(input.deadline, tzOffsetMinutes)
    if (endsAt === undefined) return { ok: false, error: 'bad_deadline' }
    const hasVotes = ballotCount(vote) > 0
    let options = vote.options
    if (!hasVotes) {
        options = normalizeOptions(input.options)
        if (options.length < MIN_VOTE_OPTIONS) return { ok: false, error: 'bad_options' }
    }
    await storage.update((s) => {
        const v = s.votes[id]
        if (!v) return
        v.title = title
        v.description = clip(input.description, MAX_VOTE_DESCRIPTION)
        v.endsAt = endsAt
        if (!hasVotes) {
            v.options = options
            v.multi = input.multi === true
            if (v.anon !== (input.anon === true)) {
                v.anon = input.anon === true
                if (v.anon) {
                    v.tally = {}
                    v.voters = []
                    v.ballots = {}
                } else {
                    delete v.tally
                    delete v.voters
                }
            }
        }
    })
    return { ok: true, vote: storage.get().votes[id]! }
}

export const deleteVote = async (storage: Storage, dataFile: string, id: string): Promise<boolean> => {
    const vote = storage.get().votes[id]
    if (!vote) return false
    const photos = votePhotoIds(vote)
    await storage.update((s) => {
        delete s.votes[id]
    })
    for (const photoId of photos) await deleteEventPhoto(dataFile, photoId)
    return true
}

export type CastError = 'not_found' | 'closed' | 'bad_option' | 'already_voted'

export const castVote = async (
    storage: Storage,
    id: string,
    user: HostingUser,
    rawOptionIds: unknown,
): Promise<{ ok: true; vote: Vote } | { ok: false; error: CastError }> => {
    const vote = storage.get().votes[id]
    if (!vote) return { ok: false, error: 'not_found' }
    if (!isVoteOpen(vote)) return { ok: false, error: 'closed' }
    const valid = new Set(vote.options.map((o) => o.id))
    const ids = Array.isArray(rawOptionIds)
        ? [...new Set(rawOptionIds.filter((x): x is string => typeof x === 'string' && valid.has(x)))]
        : []
    const picked = vote.multi ? ids : ids.slice(0, 1)

    if (vote.anon) {
        if (picked.length === 0) return { ok: false, error: 'bad_option' }
        if ((vote.voters ?? []).includes(String(user.userId))) return { ok: false, error: 'already_voted' }
        await storage.update((s) => {
            const v = s.votes[id]
            if (!v) return
            v.tally ??= {}
            v.voters ??= []
            for (const optId of picked) v.tally[optId] = (v.tally[optId] ?? 0) + 1
            v.voters.push(String(user.userId))
        })
        return { ok: true, vote: storage.get().votes[id]! }
    }

    await storage.update((s) => {
        const v = s.votes[id]
        if (!v) return
        if (picked.length === 0) delete v.ballots[String(user.userId)]
        else v.ballots[String(user.userId)] = { optionIds: picked, user, at: new Date().toISOString() }
    })
    return { ok: true, vote: storage.get().votes[id]! }
}

/** Закрывает голосование (ручное). Возвращает закрытое, либо null — не найдено/уже закрыто. */
export const closeVote = async (storage: Storage, id: string): Promise<Vote | null> => {
    const vote = storage.get().votes[id]
    if (!vote || vote.closedAt !== null) return null
    await storage.update((s) => {
        const v = s.votes[id]
        if (v) {
            v.closedAt = new Date().toISOString()
            v.announcedClose = true
        }
    })
    return storage.get().votes[id] ?? null
}

export const ballotCount = (vote: Vote): number =>
    vote.anon ? (vote.voters ?? []).length : Object.keys(vote.ballots).length

export const optionCount = (vote: Vote, optionId: string): number =>
    vote.anon
        ? vote.tally?.[optionId] ?? 0
        : Object.values(vote.ballots).filter((b) => b.optionIds.includes(optionId)).length

/** userId голосов за вариант — только для неанонимных (у анонимных маппинга нет). */
export const votersOf = (vote: Vote, optionId: string): HostingUser[] =>
    vote.anon
        ? []
        : Object.values(vote.ballots)
              .filter((b) => b.optionIds.includes(optionId))
              .map((b) => b.user)

export const activeVotes = (storage: Storage, now = Date.now()): Vote[] =>
    Object.values(storage.get().votes)
        .filter((v) => isVoteOpen(v, now))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export const archivedVotes = (storage: Storage, now = Date.now()): Vote[] =>
    Object.values(storage.get().votes)
        .filter((v) => !isVoteOpen(v, now))
        .sort((a, b) => (b.closedAt ?? b.endsAt ?? '').localeCompare(a.closedAt ?? a.endsAt ?? ''))

// ---------------------------------------------------------------------------
// Пост в чат резидентов
// ---------------------------------------------------------------------------

let voteLink: string | null = null

export const setVoteAnnounceLink = (link: string | null): void => {
    voteLink = link
}

const CHAT_DESCRIPTION_LIMIT = 400

const voteButton = (): ReturnType<typeof BotKeyboard.inline> | undefined =>
    voteLink ? BotKeyboard.inline([[BotKeyboard.url('🗳 Открыть голосование', voteLink)]]) : undefined

const authorLabel = (author: HostingUser): string =>
    author.username
        ? `<a href="https://t.me/${encodeURIComponent(author.username)}">@${author.username}</a>`
        : html.escape(displayName(author.name))

const deadlineLabel = (endsAt: string | null, tzOffsetMinutes: number): string | null => {
    if (!endsAt) return null
    const shifted = new Date(Date.parse(endsAt) + tzOffsetMinutes * 60_000)
    const dd = String(shifted.getUTCDate()).padStart(2, '0')
    const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
    const hh = String(shifted.getUTCHours()).padStart(2, '0')
    const mi = String(shifted.getUTCMinutes()).padStart(2, '0')
    return `${dd}.${mm} ${hh}:${mi}`
}

export const announceVoteOpened = async (
    client: TelegramClient,
    residentsChatId: number | null,
    dataFile: string,
    vote: Vote,
    tzOffsetMinutes: number,
): Promise<void> => {
    if (residentsChatId === null) return
    const lines = [`🗳 Новое голосование: <b>${html.escape(vote.title)}</b>`]
    if (vote.description) {
        const short =
            vote.description.length > CHAT_DESCRIPTION_LIMIT
                ? `${vote.description.slice(0, CHAT_DESCRIPTION_LIMIT).trimEnd()}…`
                : vote.description
        lines.push('', ...short.split('\n').map((l) => html.escape(l)))
    }
    lines.push('', ...vote.options.map((o) => `• ${html.escape(o.label)}`))
    const deadline = deadlineLabel(vote.endsAt, tzOffsetMinutes)
    const foot = [vote.anon ? 'анонимно' : 'открыто', vote.multi ? 'можно несколько' : null, deadline ? `до ${deadline}` : null]
        .filter(Boolean)
        .join(' · ')
    lines.push('', foot)
    const text = lines.join('<br>')
    const photoId = votePhotoIds(vote)[0]
    const photo = photoId ? await readEventPhoto(dataFile, photoId) : null
    try {
        if (photo) {
            await client.sendMedia(residentsChatId, InputMedia.photo(photo, { caption: html(text) }), { replyMarkup: voteButton() })
        } else {
            await client.sendText(residentsChatId, html(text), { disableWebPreview: true, replyMarkup: voteButton() })
        }
    } catch (err) {
        console.error('[votes] не удалось отправить открытие голосования в чат:', err)
    }
}

const pct = (count: number, total: number): number => (total > 0 ? Math.round((count / total) * 100) : 0)

export const announceVoteClosed = async (
    client: TelegramClient,
    residentsChatId: number | null,
    vote: Vote,
): Promise<void> => {
    if (residentsChatId === null) return
    const total = ballotCount(vote)
    const ranked = [...vote.options].sort((a, b) => optionCount(vote, b.id) - optionCount(vote, a.id))
    const lines = [`🏁 Голосование завершено: <b>${html.escape(vote.title)}</b>`, '']
    for (const o of ranked) {
        const c = optionCount(vote, o.id)
        lines.push(`• ${html.escape(o.label)} — ${c} (${pct(c, total)}%)`)
    }
    const word = total === 1 ? 'голос' : total >= 2 && total <= 4 ? 'голоса' : 'голосов'
    lines.push('', `Всего ${total} ${word}${vote.anon ? ', анонимно' : ''}.`)
    try {
        await client.sendText(residentsChatId, html(lines.join('<br>')), { disableWebPreview: true, replyMarkup: voteButton() })
    } catch (err) {
        console.error('[votes] не удалось отправить итоги голосования в чат:', err)
    }
}

// ---------------------------------------------------------------------------
// Шедулер авто-закрытия
// ---------------------------------------------------------------------------

export const startVoteScheduler = (
    client: TelegramClient,
    storage: Storage,
    residentsChatId: number | null,
    tzOffsetMinutes: number,
): { stop: () => void } => {
    const tick = async (): Promise<void> => {
        const now = Date.now()
        const toClose = Object.values(storage.get().votes).filter(
            (v) => v.closedAt === null && v.endsAt !== null && Date.parse(v.endsAt) <= now,
        )
        for (const vote of toClose) {
            await storage.update((s) => {
                const v = s.votes[vote.id]
                if (v && v.closedAt === null) v.closedAt = new Date().toISOString()
            })
        }
        const toAnnounce = Object.values(storage.get().votes).filter(
            (v) => v.closedAt !== null && v.endsAt !== null && v.announcedClose !== true,
        )
        for (const vote of toAnnounce) {
            await announceVoteClosed(client, residentsChatId, vote)
            await storage.update((s) => {
                const v = s.votes[vote.id]
                if (v) v.announcedClose = true
            })
        }
    }
    return startHeartbeatInterval('votes', 60_000, tick, '[votes]')
}
