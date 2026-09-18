import type { TelegramClient } from '@mtcute/node'
import { logError } from './error-log.js'

/** Максимальная длина отчёта в личку (Telegram режет на 4096; оставляем запас под стектрейс). */
const MAX_REPORT_LEN = 3500
/** Не слать один и тот же текст ошибки чаще, чем раз в это окно — защита от флуда при зацикленных тиках. */
const DEDUP_MS = 60_000
/** Префикс собственных ошибок репортера: такие в личку НЕ форвардим, иначе рекурсия при сбое отправки. */
const SELF_PREFIX = '[errors]'
/**
 * В личку идёт только критичное - остальное молча копится в журнале (/errors).
 * Критичное = процесс умирает (uncaughtException/unhandledRejection) или бьётся стейт
 * ([storage]: битый data.json / сбой записи). Роутер, dispatcher, недоступный принтер и
 * прочие внешние сбои - в журнал без личек: они шумели больше всего, а лечатся сами.
 */
const CRITICAL_PREFIXES = ['[uncaughtException]', '[unhandledRejection]', '[storage]']
const isCritical = (text: string): boolean => CRITICAL_PREFIXES.some((p) => text.startsWith(p))

const formatArg = (a: unknown): string => {
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
    if (typeof a === 'string') return a
    try {
        return JSON.stringify(a)
    } catch {
        return String(a)
    }
}

/** Сколько ждём отправки последнего отчёта и дозаписи стейта перед падением. */
const FATAL_GRACE_MS = 3000

const withTimeout = async (p: Promise<unknown>, ms: number): Promise<void> => {
    await Promise.race([p.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))])
}

/**
 * Перехватывает ВСЕ `console.error` (по соглашению проекта это единственный канал ошибок):
 * пишет каждую в журнал (`error-log.ts`, читается командой /errors), а в личку dev'ам
 * форвардит только критичное (`isCritical`) - не ломая обычный вывод в консоль.
 * Плюс ловит process-level ошибки (`unhandledRejection`/`uncaughtException`).
 *
 * Пустой список dev'ов отключает только пересылку в личку: журнал и process-хендлеры
 * ставятся всегда, иначе поведение процесса зависело бы от того, кому идут отчёты.
 */
export const installErrorReporting = (
    client: TelegramClient,
    devUserIds: Set<number>,
    /** Что успеть сделать перед падением - обычно `storage.drain()`. */
    onFatal?: () => Promise<void>,
): void => {
    const ids = [...devUserIds]
    const origError = console.error.bind(console)
    const recent = new Map<string, number>()

    /** Разослать отчёт девам. Промис резолвится, когда попытки завершились. */
    const dm = (text: string): Promise<void> => {
        if (ids.length === 0) return Promise.resolve()
        const now = Date.now()
        const last = recent.get(text)
        if (last !== undefined && now - last < DEDUP_MS) return Promise.resolve()
        recent.set(text, now)
        // подчищаем протухшие записи, чтобы Map не рос бесконечно
        for (const [k, t] of recent) if (now - t > DEDUP_MS) recent.delete(k)

        const trimmed = text.length > MAX_REPORT_LEN ? `${text.slice(0, MAX_REPORT_LEN)}…` : text
        return Promise.all(
            // silent: отчёты приходят пачками и по ночам — уведомление без звука.
            ids.map((id) =>
                client.sendText(id, `⚠️ Ошибка бота\n\n${trimmed}`, { silent: true }).catch((err) => {
                    origError(`${SELF_PREFIX} не смог отправить отчёт ${id}:`, err)
                }),
            ),
        ).then(() => {})
    }

    console.error = (...args: unknown[]) => {
        origError(...args)
        const text = args.map(formatArg).join(' ')
        // Свои сбои отправки не журналируем и не форвардим — иначе рекурсия при мёртвой сети.
        if (text.startsWith(SELF_PREFIX)) return
        logError(text)
        if (isCritical(text)) void dm(text)
    }

    process.on('unhandledRejection', (reason) => {
        console.error('[unhandledRejection]', reason)
    })

    /**
     * Необработанное исключение - это падение процесса, а не строчка в логе.
     *
     * Раньше листенер только логировал, и этим отменял дефолтное поведение Node: процесс
     * продолжал жить в неопределённом состоянии (половина таймеров мертва, соединение
     * подвешено), `restart: always` не срабатывал, а снаружи это выглядело как «бот
     * отвечает, но ничего не делает». Порядок обязателен: сначала отчёт и дозапись
     * стейта, потом exit - иначе теряется последняя подтверждённая пользователю правка.
     */
    process.on('uncaughtException', (err) => {
        origError('[uncaughtException]', err)
        const text = `[uncaughtException] ${formatArg(err)}`
        // Журналируем явно: этот путь идёт мимо перехваченного console.error, а падение —
        // ровно та ошибка, ради которой журнал переживает рестарт.
        logError(text)
        void (async () => {
            await withTimeout(dm(text), FATAL_GRACE_MS)
            if (onFatal) await withTimeout(onFatal(), FATAL_GRACE_MS)
            process.exit(1)
        })()
    })
}
