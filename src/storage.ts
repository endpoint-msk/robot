import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clampResetDay } from './fundraiser.js'
import { emptyDues, emptyState, type DuesState, type HostingRequest, type ResidentMacs, type State } from './types.js'

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
        const suppressedAt = typeof value.suppressedAt === 'string' ? value.suppressedAt : null
        out[key] = { userId, username, macs, anon, suppressedAt, updatedAt }
    }
    return out
}

/**
 * Периоды взносов от прежних версий не знали про `notifyFailed` - проставляем пустой
 * словарь. Без этого код, читающий `period.notifyFailed[key]`, спотыкался бы об undefined
 * на записях, лежащих на диске с прошлых месяцев.
 */
const normalizeDues = (raw: unknown): DuesState => {
    const dues: DuesState = { ...emptyDues(), ...((raw ?? {}) as Partial<DuesState>) }
    for (const period of Object.values(dues.periods ?? {})) {
        if (!period || typeof period !== 'object') continue
        if (!period.notifyFailed || typeof period.notifyFailed !== 'object') period.notifyFailed = {}
    }
    return dues
}

/**
 * Заявки на диске от прежних версий не знали про предложение переноса — проставляем
 * `proposal: null`. Старое поле `timeProposal` (только время) конвертируем в новый
 * слот `{ dateKey, time }`, подставляя день заявки: раньше день не переносился.
 */
const normalizeHostingRequests = (raw: unknown): Record<string, HostingRequest> => {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, HostingRequest> = {}
    for (const [key, value] of Object.entries(raw as Record<string, any>)) {
        if (!value || typeof value !== 'object') continue
        const legacy = value.timeProposal
        const proposal = value.proposal ?? (legacy && typeof legacy === 'object'
            ? { dateKey: legacy.dateKey ?? value.dateKey, time: legacy.time, by: legacy.by, user: legacy.user, at: legacy.at }
            : null)
        const { timeProposal: _drop, ...rest } = value
        out[key] = { ...(rest as HostingRequest), anon: value.anon === true, proposal }
    }
    return out
}

export class Storage {
    private state: State = emptyState()
    private writeChain: Promise<void> = Promise.resolve()
    /** Запись, поставленная в очередь, но ещё не снявшая снимок стейта (см. flush). */
    private queued: Promise<void> | null = null
    /** Когда последний раз успешно записались на диск (мс epoch). 0 - ещё ни разу. */
    private lastWriteAt = 0
    /** Чем упала последняя попытка записи. null - всё в порядке. */
    private lastWriteError: string | null = null
    /**
     * Что пошло не так при загрузке. Копим и отдаём наружу, а не логируем сразу:
     * `load()` выполняется до `tg.start()`, а значит до `installErrorReporting` —
     * console.error на этом этапе не доедет до дев-аккаунтов и осядет только в
     * докер-логах, где на него никто не смотрит.
     */
    private readonly warnings: string[] = []

    constructor(private readonly file: string) {}

    /** Забирает и очищает накопленные предупреждения загрузки (см. `warnings`). */
    takeWarnings(): string[] {
        return this.warnings.splice(0, this.warnings.length)
    }

    /**
     * Собирает стейт из разобранного файла.
     *
     * Неизвестные ключи проезжают насквозь (`...parsed`), а известные - поверх них.
     * Это про откат кода: раньше hydrate пересобирал объект строго из перечисленных
     * полей, и первая же запись после `git reset --hard` навсегда стирала разделы,
     * которых в старой версии ещё нет (взносы, ивенты, согласия с правилами) - вместе
     * с `.bak`, который к тому моменту успевал перезаписаться.
     */
    private hydrate(parsed: Partial<State>): State {
        return {
            ...parsed,
            fundraisers: parsed.fundraisers ?? {},
            lastMessages: parsed.lastMessages ?? {},
            presence: parsed.presence ?? {},
            presenceInvisible: parsed.presenceInvisible ?? {},
            printerSubscribers: parsed.printerSubscribers ?? {},
            macBindings: normalizeMacBindings(parsed.macBindings),
            resetDay: typeof parsed.resetDay === 'number' ? clampResetDay(parsed.resetDay) : 1,
            goalsMuted: parsed.goalsMuted ?? {},
            hostingRequests: normalizeHostingRequests(parsed.hostingRequests),
            hostingAttendance: parsed.hostingAttendance ?? {},
            hostingNotify: parsed.hostingNotify ?? {},
            eventNotify: parsed.eventNotify ?? {},
            hostingBoard: parsed.hostingBoard ?? {},
            hostingBoardMuted: parsed.hostingBoardMuted ?? {},
            announceMuted: parsed.announceMuted ?? {},
            lastAnnouncedVersion: typeof parsed.lastAnnouncedVersion === 'string' ? parsed.lastAnnouncedVersion : '',
            blockedUsers: parsed.blockedUsers ?? {},
            guestNotes: parsed.guestNotes ?? {},
            hostingRules: parsed.hostingRules ?? {},
            backups: parsed.backups ?? {},
            events: parsed.events ?? {},
            eventDrafts: parsed.eventDrafts ?? {},
            // Взносы — вложенный объект, а не словарь: недостающие поля добираем из
            // дефолта, иначе стейт, записанный до появления очередной настройки,
            // приезжал бы с undefined там, где код ждёт число.
            dues: normalizeDues(parsed.dues),
            presenceNoLog: parsed.presenceNoLog ?? {},
            // Вложенный объект, как и dues: пустой словарь дней, а не undefined, иначе
            // первый же расчёт статистики на стейте из прошлой версии споткнётся.
            presenceStats: { days: parsed.presenceStats?.days ?? {} },
            residentSince: parsed.residentSince ?? {},
        }
    }

    /** Читает и парсит файл. null — файла нет либо он не разбирается (тогда пишем в warnings). */
    private async read(file: string): Promise<Partial<State> | null> {
        let raw: string
        try {
            raw = await fs.readFile(file, 'utf8')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
            this.warnings.push(`не удалось прочитать ${file}: ${(err as Error).message}`)
            return null
        }
        try {
            const parsed = JSON.parse(raw) as unknown
            if (!parsed || typeof parsed !== 'object') throw new Error('корень не объект')
            return parsed as Partial<State>
        } catch (err) {
            this.warnings.push(`${file} не разбирается как JSON (${(err as Error).message})`)
            return null
        }
    }

    /**
     * Загружает стейт: основной файл, при неудаче — резервная копия, при неудаче обеих —
     * пустой стейт.
     *
     * Битый файл НЕ роняет процесс. Раньше `JSON.parse` пробрасывался наружу, `main().catch`
     * делал `process.exit(1)`, а `restart: always` превращал это в бесконечный цикл
     * перезапусков без единого сообщения — до `installErrorReporting` дело не доходило.
     * Теперь испорченный файл отводится в сторону под именем `.corrupt-<время>`: он не
     * мешает работать и остаётся для разбора.
     */
    async load(): Promise<void> {
        const parsed = await this.read(this.file)
        if (parsed) {
            this.state = this.hydrate(parsed)
            return
        }
        const hadFile = await fs.stat(this.file).then(() => true, () => false)
        if (hadFile) {
            const quarantine = `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
            try {
                await fs.rename(this.file, quarantine)
                this.warnings.push(`битый стейт отложен в ${quarantine}`)
            } catch (err) {
                this.warnings.push(`не удалось отложить битый стейт: ${(err as Error).message}`)
            }
        }
        const backup = await this.read(`${this.file}.bak`)
        if (backup) {
            this.warnings.push(`стейт восстановлен из ${this.file}.bak`)
            this.state = this.hydrate(backup)
        } else {
            if (hadFile) this.warnings.push('резервной копии тоже нет — начинаю с пустого стейта')
            this.state = emptyState()
        }
        await this.flush()
    }

    get(): State {
        return this.state
    }

    /** Ждёт, пока допишутся все поставленные в очередь записи. Нужен для корректного выключения. */
    async drain(): Promise<void> {
        await this.writeChain
    }

    /** Путь к файлу хранилища — нужен для имени файла бэкапа. */
    path(): string {
        return this.file
    }

    /**
     * Здоровье записи для /healthz и /status: когда последний раз легли на диск и чем
     * упала последняя попытка. Ошибка записи - единственный отказ, при котором бот
     * снаружи выглядит живым, а на деле теряет всё, что ему говорят.
     */
    writeHealth(): { lastWriteAt: number; lastError: string | null } {
        return { lastWriteAt: this.lastWriteAt, lastError: this.lastWriteError }
    }

    /** Снимок стейта ровно в том виде, в каком он ложится на диск. */
    snapshot(): string {
        return JSON.stringify(this.state, null, 2)
    }

    /** Изменяет стейт через `mutator` и атомарно сохраняет. Запись сериализуется через цепочку промисов. */
    update(mutator: (s: State) => void): Promise<void> {
        mutator(this.state)
        return this.flush()
    }

    private flush(): Promise<void> {
        // Запись уже стоит в очереди и ещё не начала сериализацию - она заберёт нашу
        // мутацию с собой. Без этого N мутаций подряд означали N полных перезаписей
        // файла: поллер MAC переписывал весь JSON на каждого онлайн-резидента.
        if (this.queued) return this.queued
        const target = this.file
        const tmp = `${target}.tmp`
        const backup = `${target}.bak`
        const next = this.writeChain.then(async () => {
            // Снимок берём в момент записи, а не постановки в очередь: всё, что
            // намутировали, пока мы ждали своей очереди, попадает в этот же файл.
            this.queued = null
            const snapshot = this.snapshot()
            try {
                await fs.mkdir(path.dirname(target), { recursive: true })
                // Пишем через дескриптор с fsync: без него содержимое остаётся в page cache,
                // и потеря питания сразу после rename оставляет на месте стейта пустой файл -
                // атомарность rename тут не помогает, она про имя, а не про данные.
                const fh = await fs.open(tmp, 'w')
                try {
                    await fh.writeFile(snapshot, 'utf8')
                    await fh.sync()
                } finally {
                    await fh.close()
                }
                // Копию делаем именно copyFile, а не rename: rename оставил бы окно, в котором
                // основного файла нет вовсе, и падение внутри него выглядело бы как «стейта не
                // было никогда». Отсутствие исходника на первой записи - норма.
                await fs.copyFile(target, backup).catch(() => {})
                await fs.rename(tmp, target)
                this.lastWriteAt = Date.now()
                this.lastWriteError = null
            } catch (err) {
                this.lastWriteError = err instanceof Error ? err.message : String(err)
                throw err
            }
        })
        this.queued = next
        // ошибки в одном flush не должны ронять цепочку для следующих
        this.writeChain = next.catch(() => {})
        return next
    }
}
