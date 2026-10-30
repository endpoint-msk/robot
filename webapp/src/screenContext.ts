import { createContext } from 'react'
import type { Bootstrap } from './types'

/** Запись стека, которую рисует экран: по ней remote.ts держит данные экранов, ещё лежащих в стеке. */
export const EntryContext = createContext(0)

/**
 * Экран нарисован под верхним на время жеста «вниз» (App.tsx): он только картинка, и
 * всё, что трогает клиент Telegram (цвет шапки, кнопка «Назад»), остаётся за верхним.
 */
export const UnderContext = createContext(false)

/**
 * Данные, с которыми экран ушёл вперёд (store.ts, heldData): на «назад» после своего
 * действия он встаёт таким, каким его оставили, и меняется уже на глазах.
 */
export const SnapContext = createContext<Bootstrap | null>(null)

/** Экран - корень вкладки, и под ним панель вкладок (App.tsx): ему нужен отступ снизу. */
export const TabsContext = createContext(false)
