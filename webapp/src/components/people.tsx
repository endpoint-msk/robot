// Аватарки (градиент по userId + буква + настоящее фото поверх) и обёртка для
// открытия профиля в Telegram по тапу.

import { useState, type CSSProperties, type ReactNode } from 'react'
import { avatarUrl } from '../links'
import { ownTapRecent, reducedMotion } from '../motion'
import { hasProfile, openProfile } from '../telegram'
import type { User } from '../types'

const GRADIENTS = [
  ['#6fc7ff', '#2f7bff'], ['#ff9db8', '#ff4f7e'], ['#ffc06a', '#ff7d2e'], ['#c39bff', '#7d52f0'],
  ['#5fe0c4', '#14a58a'], ['#8b96ff', '#4c56d8'], ['#ff9d8a', '#e0483e'], ['#f79bff', '#c44fe0'],
]

/** Второй цвет градиента аватарки: тон, в который красится карточка человека. */
export const avatarTone = (userId: number): string => GRADIENTS[Math.abs(userId) % GRADIENTS.length]![1]!

export const userLabel = (u: { username: string | null; name: string }): string =>
  u.username ? '@' + u.username : u.name

type AvatarUser = { userId: number; name?: string; username?: string | null }

export function Avatar({
  user,
  className,
  profile = false,
  style,
}: {
  user: AvatarUser
  className?: string
  style?: CSSProperties
  /** Тап по аватарке открывает профиль в Telegram (по нику либо по id). */
  profile?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [retried, setRetried] = useState(false)
  const [hidden, setHidden] = useState(false)

  const grad = GRADIENTS[Math.abs(user.userId) % GRADIENTS.length]!
  const letter = ((user.name || user.username || '?').trim().charAt(0) || '?').toUpperCase()
  // Настоящее фото кладём поверх буквы (см. /avatar.jpg): нет фото или не
  // загрузилось — картинка убирается, остаётся градиент с буквой.
  const base = avatarUrl(user.userId)
  const src = retried ? base + '&r=1' : base

  const tappable = profile && hasProfile(user)
  const cls = 'avatar' + (className ? ' ' + className : '') + (tappable ? ' person-tap' : '')

  return (
    <div
      className={cls}
      style={{ background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`, ...style }}
      onClick={
        tappable
          ? (e) => {
              e.stopPropagation()
              openProfile(user)
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

/**
 * Лица внахлёст: каждое следующее лежит под предыдущим. Порядок в стопке и есть
 * важность (резиденты, потом гости), а браузер по умолчанию кладёт поздний элемент
 * сверху, и последний в ряду перекрывал бы первого.
 *
 * Лицо, вставшее в стопку после своего действия, проявляется, как в ряду «Придут» на
 * экране дня. Ключ - человек, а не место: новый первым не перерисовывает соседей, и их
 * фото не мигают заново.
 */
export function AvatarStack({ users, max = 3 }: { users: AvatarUser[]; max?: number }) {
  const shown = users.slice(0, max)
  const sig = shown.map((u) => u.userId).join(',')
  const [seen, setSeen] = useState(() => ({ sig, fresh: [] as number[] }))
  if (seen.sig !== sig) {
    const before = new Set(seen.sig ? seen.sig.split(',').map(Number) : [])
    const added = ownTapRecent() && !reducedMotion() ? shown.filter((u) => !before.has(u.userId)).map((u) => u.userId) : []
    setSeen({ sig, fresh: [...added, ...seen.fresh.filter((id) => shown.some((u) => u.userId === id))] })
  }
  const taken = new Map<number, number>()
  return (
    <div className="avatar-stack">
      {shown.map((u, i) => {
        const n = taken.get(u.userId) ?? 0
        taken.set(u.userId, n + 1)
        return (
          <Avatar
            key={n ? `${u.userId}-${n}` : u.userId}
            user={u}
            className={seen.fresh.includes(u.userId) ? 'face-in' : undefined}
            style={{ zIndex: shown.length - i }}
          />
        )
      })}
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
