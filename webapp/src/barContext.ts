import { createContext } from 'react'

// Портал-цель для нижней панели: узел вне анимируемого .screen (transform сделал бы
// его containing block'ом для position:fixed, и панель поехала бы вместе с экраном).
// App держит этот узел под #app (значит, body.busy → pointer-events:none её тоже
// отключает), а .bottom-bar якорится к вьюпорту.
export const BarContext = createContext<HTMLElement | null>(null)
