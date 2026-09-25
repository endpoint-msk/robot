import type { Storage } from './storage.js'
import type { DoorCode, HostingUser } from './types.js'

/** Потолки длины - от опечаток, а не от панели: код домофона короче. */
export const MAX_DOOR_CODE_LENGTH = 16
export const MAX_DOOR_NOTE_LENGTH = 60

/** Код как на клавиатуре панели: пробелы убираем, буквы клавиш - заглавные («12к345» → «12К345»). */
export const normalizeDoorCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase()

export const isValidDoorCode = (code: string): boolean =>
    code.length > 0 && code.length <= MAX_DOOR_CODE_LENGTH && /^[0-9A-ZА-ЯЁ#*]+$/u.test(code)

export const doorCodeOf = (storage: Storage): DoorCode | null => storage.get().door

/** Пустой код снимает его совсем: пусть лучше строки не будет, чем она покажет устаревшие цифры. */
export const setDoorCode = async (storage: Storage, code: string, note: string, by: HostingUser): Promise<void> => {
    await storage.update((s) => {
        s.door = code ? { code, note, by, at: new Date().toISOString() } : null
    })
}

/** Текст всплывающего окна кнопки «Домофон» в боте. */
export const doorAlertText = (door: DoorCode): string =>
    door.note ? `Код домофона: ${door.code}\n${door.note}` : `Код домофона: ${door.code}`
