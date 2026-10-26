// Шапка профиля, как в Telegram: аватарка по центру, имя, строка под ним и ряд кнопок
// действий. Когда имя уходит под край, оно с маленькой аватаркой остаётся в строке на
// стекле (TopBar). Растяжки за верх нет: тянуть вниз по-прежнему значит закрыть экран.
// Кнопки только из того, что на экране уже есть: ряд вместо разброса по нему.

import { useRef, type ReactNode } from 'react'
import { reducedMotion } from '../motion'
import { Avatar } from './people'
import { topBarEdge, useTopBar } from './TopBar'

export type ProfileAction = { key: string; label: string; icon: ReactNode; onClick: () => void }

type ProfileUser = { userId: number; name?: string; username?: string | null }

/** Прокрутка к разделу экрана по кнопке шапки: раздел встаёт под строкой на стекле, а не за ней. */
export function scrollToSection(el: HTMLElement | null): void {
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - topBarEdge() - 8
  window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' })
}

export function ProfileHead({
  user,
  name,
  sub,
  barSub,
  actions = [],
}: {
  user: ProfileUser
  name: string
  sub?: ReactNode
  /** Подпись под именем в строке на стекле: там места на одну короткую. */
  barSub?: ReactNode
  actions?: ProfileAction[]
}) {
  const nameRef = useRef<HTMLDivElement>(null)
  useTopBar({ key: String(user.userId), title: name, subtitle: barSub, avatar: user }, nameRef)
  return (
    // Листалка карточек меряет по шапке полосу в тон аватарки (Pager, data-pager-head).
    <div className="prof" data-pager-head>
      <Avatar user={user} className="prof-ava" profile />
      <div className="prof-name" ref={nameRef}>
        {name}
      </div>
      {sub ? <div className="prof-sub">{sub}</div> : null}
      {actions.length > 0 ? (
        <div className="prof-acts">
          {actions.map((a) => (
            <button key={a.key} type="button" className="prof-act" onClick={a.onClick}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
