import { promises as fs } from 'node:fs'
import path from 'node:path'
import { emptyState, type State } from './types.js'

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
                printerSubscribers: parsed.printerSubscribers ?? {},
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
