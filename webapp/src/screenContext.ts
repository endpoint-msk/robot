import { createContext } from 'react'

/** Запись стека, которую рисует экран: по ней remote.ts держит данные экранов, ещё лежащих в стеке. */
export const EntryContext = createContext(0)

/**
 * Экран нарисован под верхним на время жеста «вниз» (App.tsx): он только картинка, и
 * всё, что трогает клиент Telegram (цвет шапки, кнопка «Назад»), остаётся за верхним.
 */
export const UnderContext = createContext(false)
