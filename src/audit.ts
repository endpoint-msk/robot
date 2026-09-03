// Журнал действий: кто что сделал, строкой в файл рядом со стейтом.
//
// Нужен потому, что в модели актор сохраняется только там, где он часть данных:
// кто ведёт визит (`approvedBy`), кто закрыл день (`lock.by`), кто заблокировал
// (`BlockedUser.by`). Все отменяющие действия — снятие хостинга, закрытие заявки,
// удаление ивента, отзыв переноса, откат подтверждения взноса — стирают ровно то
// поле, где мог бы лежать след. «Кто захостил» видно всегда, «кто расхостил» —
// никогда, и прочитать это задним числом из стейта уже нельзя.
//
// Формат — append-only ndjson по месяцам, тот же приём, что у `presence-log.ts`:
// стейт переписывается целиком на каждую мутацию, и записям такого рода там не
// место. Файл лежит внутри директории стейта, а она в докере примонтирована с
// хоста — то есть журнал доступен снаружи контейнера без отдельной возни.

import { promises as fs } from 'node:fs'
import path from 'node:path'

export type AuditActor = { id: number; username?: string | null; name?: string }

export type AuditEvent = {
    /** Машинное имя действия: метод API, callback или команда. */
    action: string
    actor: AuditActor
    /** Фраза без имени актора — его подставляет `audit` («@keet закрыл заявку …»). */
    text: string
    /** false — попытку отбили. Отказы пишем вместе с успехами: в стейте от них не остаётся вообще ничего. */
    ok?: boolean
    /** Статус и код отказа. */
    error?: string
    /** Ключи для поиска по журналу: id заявки, id ивента, userId цели. */
    meta?: Record<string, unknown>
}

/** Директория журнала. null — `initAuditLog` не звали, записи молча отбрасываются. */
let dir: string | null = null
let tzOffsetMinutes = 0
/** Очередь записи: не ждём диск в вызывающем коде, но и порядок строк не теряем. */
let chain: Promise<void> = Promise.resolve()
let dirEnsured = false

/**
 * Включает журнал. Директория — рядом со стейтом (как `presence-log/` и
 * `event-photos/`), пояс нужен только для имени месячного файла.
 */
export const initAuditLog = (dataFile: string, tzOffset: number): void => {
    dir = path.join(path.dirname(dataFile), 'audit')
    tzOffsetMinutes = tzOffset
}

/** Ждёт, пока допишутся поставленные в очередь строки. Для выключения и для падения. */
export const drainAudit = (): Promise<void> => chain

const monthFile = (now: Date, base: string): string =>
    path.join(base, `${new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 7)}.ndjson`)

const label = (actor: AuditActor): string => (actor.username ? `@${actor.username}` : actor.name || `id${actor.id}`)

/** Актор из mtcute-юзера: там другие имена полей, чем у `HostingUser`. */
export const auditUser = (u: { id: number; username?: string | null; displayName?: string }): AuditActor => ({
    id: u.id,
    username: u.username ?? null,
    name: u.displayName ?? '',
})

/**
 * Дописывает строку в журнал. Ничего не возвращает и не ждёт диска: за вызовом
 * стоит ручка миниаппа, и запись в очереди не должна попадать в её latency.
 * Порядок при этом сохраняется — цепочка промисов, как `writeChain` в storage.ts.
 */
export const audit = (event: AuditEvent): void => {
    const base = dir
    if (base === null) return
    const now = new Date()
    const line = `${JSON.stringify({
        at: now.toISOString(),
        action: event.action,
        actor: { id: event.actor.id, username: event.actor.username ?? null, name: event.actor.name ?? '' },
        ok: event.ok !== false,
        ...(event.error ? { error: event.error } : {}),
        text: `${label(event.actor)} ${event.text}`,
        ...(event.meta && Object.keys(event.meta).length > 0 ? { meta: event.meta } : {}),
    })}\n`
    const file = monthFile(now, base)
    chain = chain
        .then(async () => {
            if (!dirEnsured) {
                await fs.mkdir(base, { recursive: true })
                dirEnsured = true
            }
            await fs.appendFile(file, line, 'utf8')
        })
        .catch((err) => {
            // console.error, а не warn: журнал, который молча не пишется, ничем не
            // отличается от выключенного, и узнать об этом надо в момент поломки.
            // Повторы одного и того же текста гасит дедуп в errors.ts.
            console.error('[audit] не удалось записать журнал действий:', err)
        })
}
