// Выбор ответственных за ивент (резиденты или гости) — лист вопроса, а не экран в стеке:
// редактор ивента остаётся смонтированным, и черновик правки не теряется. Выбор
// применяется сразу по тапу (родитель хранит полные объекты — они же идут в превью, на
// сервер уходят id), поэтому решение у листа одно, «Готово».

import { useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { Actions, Question, sheetPrompt } from '../modals'
import { useRemote } from '../remote'
import type { EventPeopleResponse, ResponsibleCandidate, User } from '../types'
import { Found, SearchField, searchNeedle, Sep } from './common'
import { Avatar } from './people'

function PersonRow({ user, query, on, onToggle }: { user: User; query: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="row tappable" role="checkbox" aria-checked={on} onClick={onToggle}>
      <Avatar user={user} className="req-avatar" />
      <div className="req-main">
        <div className="req-name">
          <Found text={user.name} query={query} />
        </div>
        {user.username ? (
          <div className="req-sub">
            @<Found text={user.username} query={query} />
          </div>
        ) : null}
      </div>
      <div className={'checkbox' + (on ? ' on' : '')}>{on ? icons.check(13, '#fff', 2.6) : null}</div>
    </button>
  )
}

function Group({
  title,
  people,
  query,
  selected,
  onToggle,
}: {
  title: string
  people: ResponsibleCandidate[]
  query: string
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
            {i > 0 ? <Sep inset="avatar" /> : null}
            <PersonRow user={u} query={query} on={selected.includes(u.userId)} onToggle={() => onToggle(u)} />
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Лист рисует ModalHost вне редактора, и новые пропсы до него не доходят: выбор лист
 * держит сам и на каждом тапе отдаёт его редактору целиком.
 */
function ResponsibleSheet({ initial, onChange, done }: { initial: User[]; onChange: (next: User[]) => void; done: () => void }) {
  const [selected, setSelected] = useState(initial)
  const [query, setQuery] = useState('')
  const { data, error, loading } = useRemote(async () => (await api<EventPeopleResponse>('event.people')).people, [])

  const ids = selected.map((u) => u.userId)
  const toggle = (u: User): void => {
    const next = ids.includes(u.userId) ? selected.filter((x) => x.userId !== u.userId) : [...selected, u]
    setSelected(next)
    onChange(next)
  }

  const q = searchNeedle(query)
  const match = (u: ResponsibleCandidate): boolean =>
    !q || u.name.toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q)
  const residents = (data ?? []).filter((u) => u.resident && match(u))
  const guests = (data ?? []).filter((u) => !u.resident && match(u))

  return (
    <>
      <Question text="Ответственные" />
      <div className="resp-search">
        <SearchField value={query} onChange={setQuery} placeholder="Поиск по имени или нику" />
      </div>
      {/* Список прокручивается сам, а «Готово» стоит под ним: внизу длинного списка её
          пришлось бы искать. */}
      <div className="resp-body">
        {loading ? (
          <div className="fb-hint">Загружаем людей…</div>
        ) : error || !data ? (
          <div className="fb-hint">Не удалось загрузить список.</div>
        ) : residents.length === 0 && guests.length === 0 ? (
          <div className="fb-hint">Никого не нашлось.</div>
        ) : (
          <>
            <Group title="Резиденты" people={residents} query={q} selected={ids} onToggle={toggle} />
            <Group title="Гости" people={guests} query={q} selected={ids} onToggle={toggle} />
          </>
        )}
      </div>
      <Actions label="Готово" onConfirm={done} cancel={null} onCancel={done} />
    </>
  )
}

/** Выбор ответственных листом: изменения уходят в `onChange` сразу, лист их только показывает. */
export const pickResponsibles = async (selected: User[], onChange: (next: User[]) => void): Promise<void> => {
  await sheetPrompt<true>(({ done }) => <ResponsibleSheet initial={selected} onChange={onChange} done={() => done(true)} />)
}
