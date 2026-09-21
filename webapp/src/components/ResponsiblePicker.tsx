// Выбор ответственных за ивент (резиденты или гости) — нижний лист через портал, а не
// экран в стеке: редактор ивента остаётся смонтированным, и черновик правки не теряется.
// Выбор применяется сразу по тапу (родитель хранит полные объекты — они же идут в превью,
// на сервер уходят id).

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { icons } from '../icons'
import { pushOverlay } from '../overlays'
import { useRemote } from '../remote'
import type { EventPeopleResponse, ResponsibleCandidate, User } from '../types'
import { Sep } from './common'
import { Avatar } from './people'

function PersonRow({ user, on, onToggle }: { user: User; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="row tappable" role="checkbox" aria-checked={on} onClick={onToggle}>
      <Avatar user={user} className="req-avatar" />
      <div className="req-main">
        <div className="req-name">{user.name}</div>
        {user.username ? <div className="req-sub">{'@' + user.username}</div> : null}
      </div>
      <div className={'checkbox' + (on ? ' on' : '')}>{on ? icons.check(13, '#fff', 2.6) : null}</div>
    </button>
  )
}

function Group({
  title,
  people,
  selected,
  onToggle,
}: {
  title: string
  people: ResponsibleCandidate[]
  selected: number[]
  onToggle: (u: User) => void
}) {
  if (people.length === 0) return null
  return (
    <>
      <div className="resp-group-title">{`${title} · ${people.length}`}</div>
      <div className="card">
        {people.map((u, i) => (
          <div key={u.userId}>
            {i > 0 ? <Sep left={66} /> : null}
            <PersonRow user={u} on={selected.includes(u.userId)} onToggle={() => onToggle(u)} />
          </div>
        ))}
      </div>
    </>
  )
}

export function ResponsibleSheet({
  selected,
  onChange,
  onClose,
}: {
  selected: User[]
  onChange: (next: User[]) => void
  onClose: () => void
}) {
  const [shown, setShown] = useState(false)
  const [query, setQuery] = useState('')
  const { data, error, loading } = useRemote(async () => (await api<EventPeopleResponse>('event.people')).people, [])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (): void => {
    setShown(false)
    setTimeout(onClose, 220)
  }
  // Системная «Назад» закрывает лист, а не экран под ним.
  useEffect(() => pushOverlay(close), [])

  const ids = selected.map((u) => u.userId)
  const toggle = (u: User): void => {
    onChange(ids.includes(u.userId) ? selected.filter((x) => x.userId !== u.userId) : [...selected, u])
  }

  const q = query.trim().toLowerCase()
  const match = (u: ResponsibleCandidate): boolean =>
    !q || u.name.toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q)
  const residents = (data ?? []).filter((u) => u.resident && match(u))
  const guests = (data ?? []).filter((u) => !u.resident && match(u))

  return createPortal(
    <div
      className={'tp-overlay' + (shown ? ' shown' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="resp-sheet">
        <div className="tp-bar">
          <span className="tp-bar-btn" style={{ visibility: 'hidden' }}>
            Готово
          </span>
          <span className="tp-bar-title">Ответственные</span>
          <button className="tp-bar-btn primary" onClick={close}>
            Готово
          </button>
        </div>
        <div className="resp-search">
          <div className="card">
            <div className="row">
              <input
                className="text-input"
                type="text"
                value={query}
                placeholder="Поиск по имени или нику"
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="resp-body">
          {loading ? (
            <div className="fb-hint">Загружаем людей…</div>
          ) : error || !data ? (
            <div className="fb-hint">Не удалось загрузить список.</div>
          ) : residents.length === 0 && guests.length === 0 ? (
            <div className="fb-hint">Никого не нашлось.</div>
          ) : (
            <>
              <Group title="Резиденты" people={residents} selected={ids} onToggle={toggle} />
              <Group title="Гости" people={guests} selected={ids} onToggle={toggle} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
