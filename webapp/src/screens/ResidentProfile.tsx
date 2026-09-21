// Карточка резидента: выдача админки в «чате»/каналах и member tag «resident». Всё —
// только dev (сервер гейтит admin.* через requireDev, здесь прячем управление от не-dev).
// В будущем сюда переедут настройки профиля и интеграции.

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { showAlert } from '../modals'
import { useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { AdminStatus } from '../types'
import { icons } from '../icons'
import { BackRow, ErrorState, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'

const RESIDENT_TAG = 'resident'

export function ResidentProfile() {
  const { userId, name, username } = useParams() as { userId: number; name?: string; username?: string | null }
  const { data: boot } = useStore()
  const isDev = boot!.me.isDev

  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isDev) return
    let alive = true
    setError(false)
    api<AdminStatus>('admin.status', { userId })
      .then((s) => {
        if (alive) setStatus(s)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [userId, isDev])

  const retry = () => {
    setError(false)
    setStatus(null)
    api<AdminStatus>('admin.status', { userId })
      .then(setStatus)
      .catch(() => setError(true))
  }

  // Мутация возвращает свежий статус — обновляем экран прямо из ответа, без повторного
  // тяжёлого запроса. Кнопки на время запроса гасим, чтобы не выстрелить дважды.
  const run = async (method: string, body: Record<string, unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const s = await api<AdminStatus>(method, { userId, ...body })
      setStatus(s)
      haptic('success')
    } catch (e) {
      haptic('error')
      showAlert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const frame = (body: ReactNode) => (
    <Screen>
      <BackRow />
      <div className="person-head">
        <Avatar user={{ userId, name: name ?? '', username: username ?? null }} className="stat-avatar big" profile />
        <div className="person-head-text">
          <div className="title">{name || (username ? '@' + username : 'Резидент')}</div>
          {username ? <div className="subtitle">@{username}</div> : null}
        </div>
      </div>
      {body}
    </Screen>
  )

  if (!isDev) return frame(null)
  if (error) return frame(<ErrorState onRetry={retry} />)
  if (!status) return frame(<SpinnerCenter />)
  if (status.targets.length === 0) return frame(null)

  const tagTarget = status.targets.find((t) => t.canTag)

  return frame(
    <>
      <SectionTitle>Администратор</SectionTitle>
      <div className="card">
        {status.targets.map((t, i) => (
          <Fragment key={t.key}>
            {i > 0 ? <Sep left={14} /> : null}
            <div className="row">
              <span className="row-label">{t.label}</span>
              {t.creator ? (
                <span className="perm-state">владелец</span>
              ) : !t.present ? (
                <span className="perm-state">не в чате</span>
              ) : t.admin ? (
                <button type="button" className="perm-pill on" disabled={busy} onClick={() => run('admin.revoke', { target: t.key })}>
                  Админ
                  {icons.check(13, '#34c759', 2.6)}
                </button>
              ) : (
                <button type="button" className="perm-pill" disabled={busy} onClick={() => run('admin.grant', { target: t.key })}>
                  Выдать
                </button>
              )}
            </div>
          </Fragment>
        ))}
      </div>

      {tagTarget ? (
        <>
          <SectionTitle>Тег «{RESIDENT_TAG}»</SectionTitle>
          <div className="card">
            <div className="row">
              <span className="row-label">Тег в чате</span>
              {!tagTarget.present ? (
                <span className="perm-state">не в чате</span>
              ) : tagTarget.tag ? (
                <button type="button" className="perm-pill on" disabled={busy} onClick={() => run('admin.tag', { on: false })}>
                  {tagTarget.tag}
                  {icons.check(13, '#34c759', 2.6)}
                </button>
              ) : (
                <button type="button" className="perm-pill" disabled={busy} onClick={() => run('admin.tag', { on: true })}>
                  Выдать
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>,
  )
}
