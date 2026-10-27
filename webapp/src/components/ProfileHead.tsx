// Шапка профиля, как в Telegram: аватарка по центру, имя, строка под ним и ряд кнопок
// действий. Растяжки за верх нет: тянуть вниз по-прежнему значит закрыть экран.
// Кнопки только из того, что у экрана уже есть: ряд вместо разброса по нему.

import { type ReactNode } from 'react'
import { Avatar } from './people'

export type ProfileAction = { key: string; label: string; icon: ReactNode; onClick: () => void }

type ProfileUser = { userId: number; name?: string; username?: string | null }

export function ProfileHead({
  user,
  name,
  sub,
  actions = [],
}: {
  user: ProfileUser
  name: string
  sub?: ReactNode
  actions?: ProfileAction[]
}) {
  return (
    // Листалка карточек меряет по шапке полосу в тон аватарки (Pager, data-pager-head).
    <div className="prof" data-pager-head>
      <Avatar user={user} className="prof-ava" profile />
      <div className="prof-name">{name}</div>
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
