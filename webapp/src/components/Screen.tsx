// Обёртка .screen: анимация входа + отступ под нижнюю панель. Класс анимации
// берётся из контекста (App выставляет его на текущую навигацию), а ремаунт по
// navId запускает CSS-анимацию только при навигации, не при обновлении данных.

import { createContext, useContext, type ReactNode } from 'react'
import type { Anim } from '../store'

export const AnimContext = createContext<Anim>(null)

export function Screen({ hasBottomBar = false, children }: { hasBottomBar?: boolean; children?: ReactNode }) {
  const anim = useContext(AnimContext)
  const cls = 'screen' + (hasBottomBar ? ' has-bottom-bar' : '') + (anim ? ' ' + anim : '')
  return <div className={cls}>{children}</div>
}
