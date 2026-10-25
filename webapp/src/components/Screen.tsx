// Обёртка .screen: анимация входа + отступ под нижнюю панель. Класс анимации
// берётся из контекста (App выставляет его на текущую навигацию), а ремаунт по
// navId запускает CSS-анимацию только при навигации, не при обновлении данных.

import { createContext, useContext, useRef, type ReactNode } from 'react'
import { UnderContext } from '../screenContext'
import type { Anim } from '../store'
import { useSwipeBack } from './useSwipeBack'

export const AnimContext = createContext<Anim>(null)

export function Screen({ hasBottomBar = false, children }: { hasBottomBar?: boolean; children?: ReactNode }) {
  const anim = useContext(AnimContext)
  // Копия экрана под верхним (App.tsx, UnderScreen) только картинка и жестов не ведёт.
  const under = useContext(UnderContext)
  const ref = useRef<HTMLDivElement>(null)
  useSwipeBack(ref, !under)
  const cls = 'screen' + (hasBottomBar ? ' has-bottom-bar' : '') + (anim ? ' ' + anim : '')
  return (
    <div className={cls} ref={ref}>
      {children}
    </div>
  )
}
