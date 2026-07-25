import path from 'node:path'
import { html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import type { AllowedChats } from './handlers.js'
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

/** `data-2026-07-25-13-40-11.json` — имя от файла хранилища плюс метка времени UTC. */
const backupFileName = (storage: Storage, now: Date): string => {
    const base = path.basename(storage.path()).replace(/\.json$/i, '') || 'data'
    return `${base}-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
}

const formatUtc = (iso: string): string => iso.slice(0, 16).replace('T', ' ') + ' UTC'

/** Документ с полным снимком стейта. Один и тот же для ручной и авто-отправки. */
export const buildBackupDocument = (storage: Storage, now: Date, caption: string) => {
    const json = Buffer.from(storage.snapshot(), 'utf8')
    const sizeKb = Math.max(1, Math.round(json.length / 1024))
    return InputMedia.document(json, {
        fileName: backupFileName(storage, now),
        fileMime: 'application/json',
        caption: html(`${html.escape(caption)} · ${sizeKb} КБ · ${formatUtc(now.toISOString())}`),
    })
}

export type BackupDeps = {
    client: TelegramClient
    storage: Storage
    devUserIds: Set<number>
    allowedChats: AllowedChats
}

/**
 * Дев ли отправитель и можно ли тут отвечать. Личка дева — всегда, группы — только
 * из allowlist: «молчание в чужих чатах» распространяется и на дев-команды.
 * Не-девам не отвечаем вовсе, чтобы команда не светилась.
 */
const isDevHere = (msg: MessageContext, deps: BackupDeps): boolean => {
    if (!msg.sender || msg.sender.type !== 'user') return false
    if (!deps.devUserIds.has(msg.sender.id)) return false
    return msg.chat.type === 'user' || deps.allowedChats.has(Number(msg.chat.id))
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
        await msg.answerMedia(buildBackupDocument(storage, new Date(), 'Бэкап хранилища'))
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
        await client.sendMedia(chatId, buildBackupDocument(storage, now, 'Авто-бэкап хранилища'))
    })
}

/**
 * Тик раз в минуту: шлёт бэкапы, у которых подошёл срок. Расписание живёт в стейте,
 * поэтому переживает рестарт — пропущенный за время простоя бэкап уйдёт на первом тике.
 */
export const startBackupScheduler = (
    client: TelegramClient,
    storage: Storage,
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
            try {
                await client.sendMedia(b.chatId, buildBackupDocument(storage, now, 'Авто-бэкап хранилища'))
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

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[backup] tick error:', err))
    }, 60_000)

    return {
        stop: () => clearInterval(handle),
    }
}
