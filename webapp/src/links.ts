// Ссылки на GET-ручки сервера. initData в URL не кладём: адрес попадает в историю
// браузера и логи, а initData открывает весь API. У картинок свой токен из
// bootstrap, у .ics — разовая ссылка из `ics.link`.

import { useEffect, useRef } from 'react'
import { api } from './api'
import { getState } from './store'
import { openUrl } from './telegram'
import { showAlert } from './modals'

const mediaToken = (): string => getState().data?.mediaToken ?? ''

export const avatarUrl = (userId: number): string =>
  `${location.origin}/avatar.jpg?id=${encodeURIComponent(userId)}&t=${encodeURIComponent(mediaToken())}`

export const eventPhotoUrl = (photoId: string): string =>
  `${location.origin}/event-photo.jpg?id=${encodeURIComponent(photoId)}&t=${encodeURIComponent(mediaToken())}`

type IcsLink = { url: string; exp: number }

/** Запас до конца срока ссылки: браузеру ещё надо успеть её открыть. */
const ICS_MARGIN_SEC = 60

const fetchIcsLink = (kind: 'visit' | 'event', id: string): Promise<IcsLink> =>
  api<IcsLink>('ics.link', { kind, id })

/**
 * Кнопка «в календарь». Ссылку берём заранее, при показе экрана: `openLink` после
 * сетевого `await` клиент Telegram может не считать ответом на тап и не открыть.
 * Протухла (экран держали открытым) — берём новую уже по тапу.
 */
export function useIcsLink(kind: 'visit' | 'event', id: string, enabled: boolean): () => Promise<void> {
  const link = useRef<IcsLink | null>(null)

  useEffect(() => {
    link.current = null
    if (!enabled) return
    let alive = true
    void (async () => {
      try {
        const fresh = await fetchIcsLink(kind, id)
        if (alive) link.current = fresh
      } catch {
        /* возьмём по тапу */
      }
    })()
    return () => {
      alive = false
    }
  }, [kind, id, enabled])

  return async () => {
    let cur = link.current
    if (!cur || cur.exp - ICS_MARGIN_SEC < Date.now() / 1000) {
      try {
        cur = await fetchIcsLink(kind, id)
        link.current = cur
      } catch (err) {
        showAlert((err as Error).message)
        return
      }
    }
    openUrl(location.origin + cur.url)
  }
}
