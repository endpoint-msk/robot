import { execFileSync } from 'node:child_process'

/**
 * Коммит, на котором крутится бот, — подпись внизу настроек миниаппа.
 *
 * Два источника, потому что запусков тоже два. В образе `.git` нет вовсе (Dockerfile
 * копирует только `src` и `webapp`), поэтому там значение приезжает переменной
 * `GIT_COMMIT` со сборки; локальный `npm start` идёт из рабочей копии — у неё можно
 * просто спросить git. Ошибку глотаем: не знать свой коммит не повод не стартовать.
 */
let cached: string | null | undefined

export const buildCommit = (): string | null => {
    if (cached !== undefined) return cached
    const fromEnv = process.env.GIT_COMMIT?.trim()
    if (fromEnv) {
        cached = fromEnv
        return cached
    }
    try {
        cached = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .trim()
    } catch {
        cached = null
    }
    return cached
}
