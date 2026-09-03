import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import { startHeartbeatInterval } from './health.js'
import type { Storage } from './storage.js'
import type { BackupSchedule, BackupUnit } from './types.js'

/** Интервал авто-бэкапа: «раз в `value` `unit`». */
export type BackupInterval = { value: number; unit: BackupUnit }

const UNIT_MS: Record<Exclude<BackupUnit, 'm'>, number> = {
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
}

/** Верхняя граница множителя — защита от `/autobackup 999999m`. */
const MAX_INTERVAL_VALUE = 99

/** Пауза перед повтором, если отправка бэкапа не удалась (иначе ретрай был бы каждую минуту). */
const RETRY_DELAY_MS = 15 * 60_000

/** Синтаксис интервала: `12h`, `3d`, `2w`, `1m`. `m` — месяц, минут тут намеренно нет. */
export const parseBackupInterval = (raw: string): BackupInterval | null => {
    const m = /^(\d{1,2})\s*([hdwm])$/i.exec(raw.trim())
    if (!m) return null
    const value = Number(m[1])
    if (!Number.isInteger(value) || value < 1 || value > MAX_INTERVAL_VALUE) return null
    return { value, unit: m[2]!.toLowerCase() as BackupUnit }
}

const plural = (n: number, forms: [string, string, string]): string => {
    const tail = n % 10
    const teen = n % 100
    if (tail === 1 && teen !== 11) return forms[0]
    if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return forms[1]
    return forms[2]
}

const UNIT_FORMS: Record<BackupUnit, [string, string, string]> = {
    h: ['час', 'часа', 'часов'],
    d: ['день', 'дня', 'дней'],
    w: ['неделю', 'недели', 'недель'],
    m: ['месяц', 'месяца', 'месяцев'],
}

/** «раз в месяц», «раз в 2 недели», «раз в 12 часов». */
export const intervalLabel = (i: BackupInterval): string =>
    i.value === 1
        ? `раз в ${UNIT_FORMS[i.unit][0]}`
        : `раз в ${i.value} ${plural(i.value, UNIT_FORMS[i.unit])}`

/**
 * Следующий запуск. Месяцы считаем календарно (UTC), а не «30 дней»: иначе бэкап
 * с каждым разом уползал бы на пару суток. День, которого нет в целевом месяце
 * (31 января + 1m), зажимаем в последний день этого месяца.
 */
export const nextBackupAt = (from: Date, i: BackupInterval): Date => {
    if (i.unit === 'm') {
        const d = new Date(from.getTime())
        const day = d.getUTCDate()
        d.setUTCMonth(d.getUTCMonth() + i.value)
        if (d.getUTCDate() !== day) d.setUTCDate(0)
        return d
    }
    return new Date(from.getTime() + i.value * UNIT_MS[i.unit])
}

/** `data-2026-07-25-13-40-11` — основа имени: файл хранилища плюс метка времени UTC. */
const backupBaseName = (storage: Storage, now: Date): string => {
    const base = path.basename(storage.path()).replace(/\.json$/i, '') || 'data'
    return `${base}-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
}

const formatUtc = (iso: string): string => iso.slice(0, 16).replace('T', ' ') + ' UTC'

/** Одна запись tar: имя внутри архива, содержимое, время в мс. */
type TarEntry = { name: string; data: Buffer; mtime: number }

/** Поле ustar-заголовка: `len-1` восьмеричных цифр с ведущими нулями плюс завершающий `\0`. */
const octalField = (n: number, len: number): string => {
    const digits = len - 1
    return n.toString(8).padStart(digits, '0').slice(-digits) + '\0'
}

/**
 * Свой минимальный tar.gz без сторонних зависимостей: у нас всего пара директорий
 * с мелкими файлами, и тянуть ради этого archiver/tar в проект незачем. Имена короткие
 * (`presence-log/…`, `event-photos/…`), в 100-байтовое поле ustar влезают без префикса.
 */
const tarHeader = (entry: TarEntry): Buffer => {
    const h = Buffer.alloc(512, 0)
    h.write(entry.name, 0, 100, 'utf8')
    h.write('0000644\0', 100, 'ascii') // mode
    h.write('0000000\0', 108, 'ascii') // uid
    h.write('0000000\0', 116, 'ascii') // gid
    h.write(octalField(entry.data.length, 12), 124, 'ascii')
    h.write(octalField(Math.floor(entry.mtime / 1000), 12), 136, 'ascii')
    h.write('        ', 148, 'ascii') // контрольная сумма считается по пробелам на её месте
    h.write('0', 156, 'ascii') // typeflag: обычный файл
    h.write('ustar\0', 257, 'ascii')
    h.write('00', 263, 'ascii')
    let sum = 0
    for (let i = 0; i < 512; i++) sum += h[i]!
    h.write(sum.toString(8).padStart(6, '0').slice(-6) + '\0 ', 148, 'ascii')
    return h
}

const buildTarGz = (entries: TarEntry[]): Buffer => {
    const parts: Buffer[] = []
    for (const e of entries) {
        parts.push(tarHeader(e), e.data)
        const pad = (512 - (e.data.length % 512)) % 512
        if (pad) parts.push(Buffer.alloc(pad, 0))
    }
    parts.push(Buffer.alloc(1024, 0)) // два нулевых блока — конец архива
    return zlib.gzipSync(Buffer.concat(parts))
}

/** Файлы примыкающей к стейту директории (`presence-log/`, `event-photos/`, `audit/`) для архива. */
const collectDir = async (dir: string, prefix: string): Promise<TarEntry[]> => {
    let names: string[]
    try {
        names = await fs.readdir(dir)
    } catch {
        return [] // директории может не быть — журнал/афиши ещё не завелись
    }
    const out: TarEntry[] = []
    for (const name of names.sort()) {
        const full = path.join(dir, name)
        try {
            const stat = await fs.stat(full)
            if (!stat.isFile()) continue
            out.push({ name: `${prefix}/${name}`, data: await fs.readFile(full), mtime: stat.mtimeMs })
        } catch {
            // файл исчез между readdir и чтением — пропускаем, бэкап важнее одной строки
        }
    }
    return out
}

/**
 * Документ-архив со всем стейтом: `data.json` (из in-memory снимка — он всегда
 * консистентен, в отличие от возможной гонки с tmp+rename), сырой журнал присутствия
 * (`presence-log/`), афиши ивентов (`event-photos/`) и журнал действий (`audit/`).
 * Раньше уходил только JSON, и сессии журнала с картинками в бэкап не попадали.
 * Один и тот же для ручной и авто-отправки.
 */
export const buildBackupArchive = async (storage: Storage, now: Date, caption: string) => {
    const dataName = `${path.basename(storage.path()).replace(/\.json$/i, '') || 'data'}.json`
    const stateDir = path.dirname(storage.path())
    const entries: TarEntry[] = [
        { name: dataName, data: Buffer.from(storage.snapshot(), 'utf8'), mtime: now.getTime() },
        ...(await collectDir(path.join(stateDir, 'presence-log'), 'presence-log')),
        ...(await collectDir(path.join(stateDir, 'event-photos'), 'event-photos')),
        ...(await collectDir(path.join(stateDir, 'audit'), 'audit')),
    ]
    const gz = buildTarGz(entries)
    const sizeKb = Math.max(1, Math.round(gz.length / 1024))
    return InputMedia.document(gz, {
        fileName: `${backupBaseName(storage, now)}.tar.gz`,
        fileMime: 'application/gzip',
        caption: html(
            `${html.escape(caption)} · ${entries.length} ${plural(entries.length, ['файл', 'файла', 'файлов'])} · ${sizeKb} КБ · ${formatUtc(now.toISOString())}`,
        ),
    })
}

export type BackupDeps = {
    client: TelegramClient
    storage: Storage
    devUserIds: Set<number>
}

/**
 * Дев ли отправитель и в личке ли он. Не-девам и в группах не отвечаем вовсе, чтобы
 * команда не светилась.
 *
 * Только личка: в файле весь стейт - userId, ники, MAC-привязки, присутствие, цели
 * визитов, заметки о гостях и суммы взносов. Раньше дамп уходил в любой allowlist-чат,
 * и одна опечатка в командной строке клала всё это в историю группы навсегда.
 */
const isDevHere = (msg: MessageContext, deps: BackupDeps): boolean => {
    if (!msg.sender || msg.sender.type !== 'user') return false
    if (!deps.devUserIds.has(msg.sender.id)) return false
    return msg.chat.type === 'user'
}

const USAGE = [
    'Использование: /autobackup <интервал>, например /autobackup 1m — бэкап в этот чат раз в месяц.',
    'Интервал: 12h (часы), 3d (дни), 2w (недели), 1m (месяцы).',
    'Выключить — /autobackup off. Разовый бэкап — /backup.',
].join('\n')

/** Человекочитаемый статус расписания для этого чата. */
const scheduleStatus = (b: BackupSchedule): string => {
    const lines = [
        `Авто-бэкап в этот чат включён: ${intervalLabel(b)}.`,
        `Следующий — ${formatUtc(b.nextAt)}.`,
    ]
    if (b.lastSentAt) lines.push(`Последний — ${formatUtc(b.lastSentAt)}.`)
    lines.push('', USAGE)
    return lines.join('\n')
}

/** `/backup` и `/autobackup` — только для DEV_USER_IDS. */
export const registerBackupHandlers = (dp: Dispatcher, deps: BackupDeps): void => {
    const { client, storage } = deps

    dp.onNewMessage(filters.command('backup'), async (msg) => {
        if (!isDevHere(msg, deps)) return
        await msg.answerMedia(await buildBackupArchive(storage, new Date(), 'Бэкап хранилища'), { silent: true })
    })

    dp.onNewMessage(filters.command('autobackup'), async (msg) => {
        if (!isDevHere(msg, deps)) return
        const chatId = Number(msg.chat.id)
        const key = String(chatId)
        // Склеиваем хвост: `/autobackup 1 m` должен читаться так же, как `/autobackup 1m`.
        const arg = msg.command.slice(1).join(' ').trim().toLowerCase()
        const existing = storage.get().backups[key]

        if (!arg) {
            await msg.answerText(existing ? scheduleStatus(existing) : `Авто-бэкап в этот чат выключен.\n\n${USAGE}`)
            return
        }
        if (arg === 'off' || arg === 'stop' || arg === 'выкл') {
            if (!existing) {
                await msg.answerText('Авто-бэкап в этот чат и так выключен.')
                return
            }
            await storage.update((s) => {
                delete s.backups[key]
            })
            await msg.answerText('Авто-бэкап в этот чат выключен.')
            return
        }

        const interval = parseBackupInterval(arg)
        if (!interval) {
            await msg.answerText(`Не понял интервал «${arg}».\n\n${USAGE}`)
            return
        }
        const now = new Date()
        await storage.update((s) => {
            s.backups[key] = {
                chatId,
                value: interval.value,
                unit: interval.unit,
                // Отсчёт от «сейчас»: первый бэкап уходит сразу, следующий — через интервал.
                nextAt: nextBackupAt(now, interval).toISOString(),
                lastSentAt: now.toISOString(),
                by: msg.sender!.id,
            }
        })
        await msg.answerText(
            [
                `Готово: буду присылать бэкап хранилища в этот чат ${intervalLabel(interval)}.`,
                `Следующий — ${formatUtc(nextBackupAt(now, interval).toISOString())}. Выключить — /autobackup off.`,
                'Файл содержит весь стейт бота, включая персональные данные — держите чат закрытым.',
            ].join('\n'),
        )
        // Первый бэкап сразу: сразу видно, что доставка работает.
        await client.sendMedia(chatId, await buildBackupArchive(storage, now, 'Авто-бэкап хранилища'), { silent: true })
    })
}

/**
 * Тик раз в минуту: шлёт бэкапы, у которых подошёл срок. Расписание живёт в стейте,
 * поэтому переживает рестарт — пропущенный за время простоя бэкап уйдёт на первом тике.
 */
export const startBackupScheduler = (
    client: TelegramClient,
    storage: Storage,
    devUserIds: ReadonlySet<number>,
): { stop: () => void } => {
    const tick = async () => {
        const now = new Date()
        const due = Object.values(storage.get().backups).filter((b) => {
            const at = Date.parse(b.nextAt)
            // Битая дата в стейте — считаем, что пора: иначе расписание молча зависнет навсегда.
            return !Number.isFinite(at) || at <= now.getTime()
        })
        for (const b of due) {
            const key = String(b.chatId)
            // Адресата сверяем на каждом тике, а не только при включении: расписание
            // живёт в стейте и переживает и смену DEV_USER_IDS, и правку файла руками.
            // Чат - это личка (chatId === userId дева), и если он больше не дев, весь
            // стейт продолжал бы уезжать к нему по расписанию.
            if (!devUserIds.has(b.chatId)) {
                await storage.update((s) => {
                    delete s.backups[key]
                })
                console.error(`[backup] расписание для чата ${b.chatId} удалено: адресат больше не дев.`)
                continue
            }
            try {
                await client.sendMedia(b.chatId, await buildBackupArchive(storage, now, 'Авто-бэкап хранилища'), {
                    silent: true,
                })
                await storage.update((s) => {
                    const cur = s.backups[key]
                    if (!cur) return
                    cur.lastSentAt = now.toISOString()
                    cur.nextAt = nextBackupAt(now, cur).toISOString()
                })
            } catch (err) {
                console.error(`[backup] не удалось отправить бэкап в чат ${b.chatId}:`, err)
                // Расписание не двигаем на полный интервал — пробуем ещё раз через RETRY_DELAY_MS.
                await storage.update((s) => {
                    const cur = s.backups[key]
                    if (cur) cur.nextAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString()
                })
            }
        }
    }

    return startHeartbeatInterval('backup', 60_000, tick, '[backup]')
}
