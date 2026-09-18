// Журнал ошибок: каждая пойманная ошибка строкой в файл рядом со стейтом.
//
// Раньше единственным следом ошибки была личка дев'ам: любой console.error уходил
// сообщением, и роутер с мигающим линком или временно недоступный принтер сыпали в
// личку наравне с падением процесса. Журнал разводит эти два: копится всё, а в личку
// (см. errors.ts) идёт только критичное. Прочитать накопленное - дев-команда /errors.
//
// Формат - append-only ndjson по месяцам (UTC), тот же приём, что у `audit.ts` и
// `presence-log.ts`: стейт переписывается целиком на каждую мутацию, и записям такого
// рода там не место. Файл в директории стейта, а она в докере примонтирована с хоста.

import { promises as fs } from 'node:fs'
import path from 'node:path'

export type ErrorEntry = { at: string; text: string }

/** Стек-трейсы длинные; в файл кладём с запасом, но не бесконечность. */
const MAX_STORED_LEN = 4000

// Пристрелка на чтение: сколько последних записей отдаём /errors без прохода по всей истории.
const READ_TAIL = 200

/**
 * Оригинальный console.error, снятый ДО того, как errors.ts подменит его перехватчиком.
 * Модуль импортируется на верхнем уровне index.ts, то есть раньше installErrorReporting.
 * Через него репортим собственные сбои записи - иначе они снова попали бы в этот же
 * журнал (и в дедуп errors.ts) и закольцевались бы при недоступном диске.
 */
const rawError = console.error.bind(console)

/** Директория журнала. null - `initErrorLog` не звали, записи молча отбрасываются. */
let dir: string | null = null
let chain: Promise<void> = Promise.resolve()
let dirEnsured = false

/** Включает журнал. Директория - рядом со стейтом (как `audit/` и `presence-log/`). */
export const initErrorLog = (dataFile: string): void => {
    const base = path.join(path.dirname(dataFile), 'errors')
    dir = base
    chain = chain
        .then(async () => {
            await fs.mkdir(base, { recursive: true })
            dirEnsured = true
            console.log(`[error-log] журнал ошибок: ${base}`)
        })
        .catch((err) => {
            rawError('[error-log] не удалось создать директорию журнала:', err)
        })
}

const monthKey = (now: Date): string => now.toISOString().slice(0, 7)
const monthFile = (base: string, key: string): string => path.join(base, `${key}.ndjson`)

/**
 * Дописывает ошибку в журнал. Ничего не возвращает и не ждёт диска - как `audit()`:
 * за вызовом стоит перехватчик console.error, и запись не должна тормозить обычный
 * вывод. Порядок сохраняется цепочкой промисов.
 */
export const logError = (text: string): void => {
    const base = dir
    if (base === null) return
    const now = new Date()
    const trimmed = text.length > MAX_STORED_LEN ? `${text.slice(0, MAX_STORED_LEN)}…` : text
    const line = `${JSON.stringify({ at: now.toISOString(), text: trimmed })}\n`
    const file = monthFile(base, monthKey(now))
    chain = chain
        .then(async () => {
            if (!dirEnsured) {
                await fs.mkdir(base, { recursive: true })
                dirEnsured = true
            }
            await fs.appendFile(file, line, 'utf8')
        })
        .catch((err) => {
            rawError('[error-log] не удалось записать журнал ошибок:', err)
        })
}

/** Ждёт, пока допишутся поставленные в очередь строки. Для выключения и для падения. */
export const drainErrorLog = (): Promise<void> => chain

const readMonth = async (base: string, key: string): Promise<ErrorEntry[]> => {
    let raw: string
    try {
        raw = await fs.readFile(monthFile(base, key), 'utf8')
    } catch {
        return []
    }
    const out: ErrorEntry[] = []
    for (const line of raw.split('\n')) {
        if (!line) continue
        try {
            const parsed = JSON.parse(line) as ErrorEntry
            if (typeof parsed.at === 'string' && typeof parsed.text === 'string') out.push(parsed)
        } catch {
            // оборванная последняя строка - норма для append-only, пропускаем
        }
    }
    return out
}

/**
 * Последние ошибки, новыми сверху. Читаем текущий месяц, при нехватке добираем
 * прошлый - двух месяцев хватает на «что случилось недавно», а прошлое всё равно
 * лежит файлами и доступно снаружи контейнера.
 */
export const readRecentErrors = async (limit: number): Promise<ErrorEntry[]> => {
    const base = dir
    if (base === null) return []
    const now = new Date()
    let entries = await readMonth(base, monthKey(now))
    if (entries.length < limit) {
        const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
        entries = [...(await readMonth(base, monthKey(prev))), ...entries]
    }
    return entries.slice(-Math.min(limit, READ_TAIL)).reverse()
}
