// «Вернуть» вместо «Вы уверены?» (миниапп, шесть обратимых действий): действие
// применяется сразу, а то, что оно отправляет людям, ждёт конца отсчёта. Пока отсчёт
// идёт, «Вернуть» кладёт объект обратно тем же, а отложенные сообщения не уходят вовсе.
//
// Держим только в памяти процесса, как кэш директории: перезапуск бота посреди отсчёта
// даёт «Уже не вернуть», а отложенное на выключении уходит сразу (flushUndo), а не теряется.
// Поэтому же таймер на токен одноразовый `setTimeout`, а не тик шедулера: цепочки тут нет,
// и остановку заменяет flushUndo.

import { randomUUID } from 'node:crypto'

/** Отсчёт в миниаппе. */
export const UNDO_MS = 5_000
/** Запас на дорогу запроса: «Вернуть», нажатое на последней секунде, ещё должно успеть. */
const UNDO_GRACE_MS = 1_500

type Held = {
    userId: number
    /** Что сделали, словами журнала действий: возврат пишется туда же. */
    label: string
    /** true - вернули; false - за время отсчёта что-то изменилось, и возвращать нельзя. */
    restore: () => Promise<boolean>
    effects: () => Promise<void>
    timer: ReturnType<typeof setTimeout>
}

const held = new Map<string, Held>()

const runEffects = async (h: Held): Promise<void> => {
    try {
        await h.effects()
    } catch (err) {
        console.error('[undo] отложенное после действия не ушло:', err)
    }
}

/**
 * Действие уже применено; `restore` вернёт его, `effects` (личка людям) уйдёт по концу
 * отсчёта, если «Вернуть» не нажали. Возвращает токен для ручки `undo`.
 */
export const holdUndo = (
    userId: number,
    label: string,
    restore: () => Promise<boolean>,
    effects: () => Promise<void> = async () => {},
): string => {
    const token = randomUUID()
    const timer = setTimeout(() => {
        const h = held.get(token)
        if (!h) return
        held.delete(token)
        void runEffects(h)
    }, UNDO_MS + UNDO_GRACE_MS)
    held.set(token, { userId, label, restore, effects, timer })
    return token
}

/** Чьё действие и что в нём сделали - для строки журнала до того, как токен истратят. */
export const undoLabel = (token: string): string | null => held.get(token)?.label ?? null

/**
 * `gone` - токена нет: отсчёт кончился, бот перезапускался, или он чужой. `stale` - за
 * время отсчёта объект изменился, и действие остаётся в силе вместе с отложенным.
 */
export const takeUndo = async (token: string, userId: number): Promise<'ok' | 'gone' | 'stale'> => {
    const h = held.get(token)
    if (!h || h.userId !== userId) return 'gone'
    held.delete(token)
    clearTimeout(h.timer)
    let ok = false
    try {
        ok = await h.restore()
    } catch (err) {
        console.error('[undo] не удалось вернуть:', err)
    }
    if (ok) return 'ok'
    await runEffects(h)
    return 'stale'
}

/** Выключение: всё отложенное уходит сейчас, а не пропадает вместе с процессом. */
export const flushUndo = async (): Promise<void> => {
    const all = [...held.values()]
    held.clear()
    for (const h of all) clearTimeout(h.timer)
    await Promise.all(all.map(runEffects))
}
