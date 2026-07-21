// Аватарки (градиент по userId + буква + настоящее фото поверх) и обёртка для
// открытия профиля в Telegram по тапу.

import { useState, type ReactNode } from 'react'
import { hasProfile, initData, openProfile } from '../telegram'
import type { User } from '../types'

const GRADIENTS = [
  ['#6fc7ff', '#2f7bff'], ['#ff9db8', '#ff4f7e'], ['#ffc06a', '#ff7d2e'], ['#c39bff', '#7d52f0'],
  ['#5fe0c4', '#14a58a'], ['#8b96ff', '#4c56d8'], ['#ff9d8a', '#e0483e'], ['#f79bff', '#c44fe0'],
]

export const userLabel = (u: { username: string | null; name: string }): string =>
  u.username ? '@' + u.username : u.name

type AvatarUser = { userId: number; name?: string; username?: string | null }

export function Avatar({
  user,
  className,
  profile = false,
}: {
  user: AvatarUser
  className?: string
  /** Тап по аватарке открывает профиль в Telegram (если есть username). */
  profile?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [retried, setRetried] = useState(false)
  const [hidden, setHidden] = useState(false)

  const grad = GRADIENTS[Math.abs(user.userId) % GRADIENTS.length]!
  const letter = ((user.name || user.username || '?').trim().charAt(0) || '?').toUpperCase()
  // Настоящее фото кладём поверх буквы (см. /avatar.jpg): нет фото или не
  // загрузилось — картинка убирается, остаётся градиент с буквой.
  const base = `${location.origin}/avatar.jpg?id=${encodeURIComponent(user.userId)}&initData=${encodeURIComponent(initData())}`
  const src = retried ? base + '&r=1' : base

  const tappable = profile && hasProfile(user)
  const cls = 'avatar' + (className ? ' ' + className : '') + (tappable ? ' person-tap' : '')

  return (
    <div
      className={cls}
      style={{ background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})` }}
      onClick={
        tappable
          ? (e) => {
              e.stopPropagation()
              openProfile(user as User)
            }
          : undefined
      }
    >
      {letter}
      {!hidden ? (
        <img
          className={'avatar-photo' + (loaded ? ' loaded' : '')}
          alt=""
          loading="lazy"
          src={src}
          onLoad={() => setLoaded(true)}
          onError={() => {
            // Первый запрос по холодному юзеру сервер отбивает 404-кой и уходит качать
            // фото фоном. Один раз перепросим — к этому моменту оно обычно уже в кэше.
            if (retried) {
              setHidden(true)
              return
            }
            setTimeout(() => setRetried(true), 1200)
          }}
        />
      ) : null}
    </div>
  )
}

export function AvatarStack({ users, max = 3 }: { users: AvatarUser[]; max?: number }) {
  return (
    <div className="avatar-stack">
      {users.slice(0, max).map((u, i) => (
        <Avatar key={`${u.userId}-${i}`} user={u} />
      ))}
    </div>
  )
}

/** Обёртка-div, открывающая профиль пользователя по тапу (аналог bindProfile). */
export function Profile({
  user,
  className = '',
  children,
}: {
  user: User
  className?: string
  children: ReactNode
}) {
  const tappable = hasProfile(user)
  const cls = className + (tappable ? (className ? ' ' : '') + 'person-tap' : '')
  return (
    <div
      className={cls || undefined}
      onClick={
        tappable
          ? (e) => {
              e.stopPropagation() // строка/карточка вокруг обычно тапабельна сама
              openProfile(user)
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
