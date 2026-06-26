import type { TelegramClient } from '@mtcute/node'

/** Максимальная длина отчёта в личку (Telegram режет на 4096; оставляем запас под стектрейс). */
const MAX_REPORT_LEN = 3500
/** Не слать один и тот же текст ошибки чаще, чем раз в это окно — защита от флуда при зацикленных тиках. */
const DEDUP_MS = 60_000
/** Префикс собственных ошибок репортера: такие в личку НЕ форвардим, иначе рекурсия при сбое отправки. */
const SELF_PREFIX = '[errors]'

const formatArg = (a: unknown): string => {
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
    if (typeof a === 'string') return a
    try {
        return JSON.stringify(a)
    } catch {
        return String(a)
    }
}

/**
 * Перенаправляет ВСЕ `console.error` (по соглашению проекта это единственный канал ошибок)
 * в личку dev-пользователям из DEV_USER_IDS, не ломая обычный вывод в консоль.
 * Плюс ловит process-level ошибки (`unhandledRejection`/`uncaughtException`).
 * При пустом списке dev'ов — no-op.
 */
export const installErrorReporting = (
    client: TelegramClient,
    devUserIds: Set<number>,
): void => {
    if (devUserIds.size === 0) return

    const ids = [...devUserIds]
    const origError = console.error.bind(console)
    const recent = new Map<string, number>()

    const dm = (text: string) => {
        const now = Date.now()
        const last = recent.get(text)
        if (last !== undefined && now - last < DEDUP_MS) return
        recent.set(text, now)
        // подчищаем протухшие записи, чтобы Map не рос бесконечно
        for (const [k, t] of recent) if (now - t > DEDUP_MS) recent.delete(k)

        const trimmed = text.length > MAX_REPORT_LEN ? `${text.slice(0, MAX_REPORT_LEN)}…` : text
        for (const id of ids) {
            client.sendText(id, `⚠️ Ошибка бота\n\n${trimmed}`).catch((err) => {
                origError(`${SELF_PREFIX} не смог отправить отчёт ${id}:`, err)
            })
        }
    }

    console.error = (...args: unknown[]) => {
        origError(...args)
        const text = args.map(formatArg).join(' ')
        if (text.startsWith(SELF_PREFIX)) return
        dm(text)
    }

    process.on('unhandledRejection', (reason) => {
        console.error('[unhandledRejection]', reason)
    })
    process.on('uncaughtException', (err) => {
        console.error('[uncaughtException]', err)
    })
}
