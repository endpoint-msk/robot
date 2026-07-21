import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clampResetDay } from './fundraiser.js'
import { emptyState, type HostingRequest, type ResidentMacs, type State } from './types.js'

/**
 * Приводит macBindings к актуальной схеме (`macs: MacEntry[]`, `anon`).
 * Старый формат хранил один MAC в поле `mac` без массива — конвертируем его,
 * чтобы существующие записи на диске не роняли код.
 */
const normalizeMacBindings = (raw: unknown): Record<string, ResidentMacs> => {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, ResidentMacs> = {}
    for (const [key, value] of Object.entries(raw as Record<string, any>)) {
        if (!value || typeof value !== 'object') continue
        const userId = Number(value.userId ?? key)
        const username = typeof value.username === 'string' ? value.username : null
        const anon = value.anon === true
        const updatedAt = typeof value.updatedAt === 'string'
            ? value.updatedAt
            : (typeof value.boundAt === 'string' ? value.boundAt : new Date().toISOString())
        let macs: { mac: string; label: string }[] = []
        if (Array.isArray(value.macs)) {
            macs = value.macs
                .map((e: any) => (typeof e === 'string'
                    ? { mac: e, label: '' }
                    : { mac: String(e?.mac ?? ''), label: typeof e?.label === 'string' ? e.label : '' }))
                .filter((e: { mac: string }) => e.mac.length > 0)
        } else if (typeof value.mac === 'string' && value.mac.length > 0) {
            // старый формат: один MAC в поле `mac`
            macs = [{ mac: value.mac, label: '' }]
        }
        if (macs.length === 0) continue
        out[key] = { userId, username, macs, anon, updatedAt }
    }
    return out
}

/** Заявки на диске от прежних версий не знали про `timeProposal` — проставляем null, чтобы код не спотыкался. */
const normalizeHostingRequests = (raw: unknown): Record<string, HostingRequest> => {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, HostingRequest> = {}
    for (const [key, value] of Object.entries(raw as Record<string, HostingRequest>)) {
        if (!value || typeof value !== 'object') continue
        out[key] = { ...value, anon: value.anon === true, timeProposal: value.timeProposal ?? null }
    }
    return out
}

export class Storage {
    private state: State = emptyState()
    private writeChain: Promise<void> = Promise.resolve()

    constructor(private readonly file: string) {}

    async load(): Promise<void> {
        try {
            const buf = await fs.readFile(this.file, 'utf8')
            const parsed = JSON.parse(buf) as State
            this.state = {
                fundraisers: parsed.fundraisers ?? {},
                lastMessages: parsed.lastMessages ?? {},
                presence: parsed.presence ?? {},
                chatLastActivity: parsed.chatLastActivity ?? {},
                presenceListMessages: parsed.presenceListMessages ?? {},
                presenceListPostedAt: parsed.presenceListPostedAt ?? {},
                presenceAutoMuted: parsed.presenceAutoMuted ?? {},
                printerSubscribers: parsed.printerSubscribers ?? {},
                macBindings: normalizeMacBindings(parsed.macBindings),
                resetDay: typeof parsed.resetDay === 'number' ? clampResetDay(parsed.resetDay) : 1,
                goalsMuted: parsed.goalsMuted ?? {},
                hostingRequests: normalizeHostingRequests(parsed.hostingRequests),
                hostingAttendance: parsed.hostingAttendance ?? {},
                hostingNotify: parsed.hostingNotify ?? {},
                hostingBoard: parsed.hostingBoard ?? {},
                hostingBoardMuted: parsed.hostingBoardMuted ?? {},
                announceMuted: parsed.announceMuted ?? {},
                lastAnnouncedVersion: typeof parsed.lastAnnouncedVersion === 'string' ? parsed.lastAnnouncedVersion : '',
            }
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                this.state = emptyState()
                await this.flush()
                return
            }
            throw err
        }
    }

    get(): State {
        return this.state
    }

    /** Изменяет стейт через `mutator` и атомарно сохраняет. Запись сериализуется через цепочку промисов. */
    update(mutator: (s: State) => void): Promise<void> {
        mutator(this.state)
        return this.flush()
    }

    private flush(): Promise<void> {
        const snapshot = JSON.stringify(this.state, null, 2)
        const target = this.file
        const tmp = `${target}.tmp`
        const next = this.writeChain.then(async () => {
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(tmp, snapshot, 'utf8')
            await fs.rename(tmp, target)
        })
        // ошибки в одном flush не должны ронять цепочку для следующих
        this.writeChain = next.catch(() => {})
        return next
    }
}
