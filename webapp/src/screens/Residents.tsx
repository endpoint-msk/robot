// Дев-список резидентов: поиск по составу чата резидентов, тап открывает карточку с
// выдачей прав и тегов. Нужен, чтобы админ мог найти и открыть профиль любого резидента,
// даже если тот ни разу не приходил в спейс (список — ростер, а не журнал присутствия).
// Гейт на сервере (admin.* под requireDev), вход-чип лишь прячет раздел в Dev-меню.

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push } from '../store'
import type { ResidentsListResponse } from '../types'
import { BackRow, ErrorState, Footnote, Header, SearchField, searchNeedle, Sep } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

export function Residents() {
  const [q, setQ] = useState('')
  const { data, error, pending, reload } = useRemote(() => api<ResidentsListResponse>('admin.residents'), [])

  const people = useMemo(() => {
    const list = data?.people ?? []
    const needle = searchNeedle(q)
    if (!needle) return list
    return list.filter(
      (u) => u.name.toLowerCase().includes(needle) || (u.username ?? '').toLowerCase().includes(needle),
    )
  }, [data, q])

  const frame = (body: ReactNode) => (
    <Screen>
      <BackRow />
      <Header title="Резиденты" subtitle="Права в чатах и тег" />
      <SearchField value={q} onChange={setQ} placeholder="Поиск по имени или нику" />
      <Swap loading={!data && !error} skeleton={pending ? <SkRows count={8} avatar /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  if (error) return frame(<ErrorState onRetry={reload} />)
  if (!data) return frame(null)

  if (people.length === 0) {
    return frame(<Footnote>{q.trim() ? 'Никого не нашлось.' : 'Ростер резидентов пуст — бот не смог прочитать состав чата.'}</Footnote>)
  }

  return frame(
    <div className="card">
      {people.map((u, i) => (
        <Fragment key={u.userId}>
          {i > 0 ? <Sep inset="avatar" /> : null}
          <div
            className="row tappable"
            onClick={() => push('residentProfile', { userId: u.userId, name: u.name, username: u.username })}
          >
            <Avatar user={u} className="req-avatar" />
            <div className="req-main">
              <div className="req-name">{u.name}</div>
              {u.username ? <div className="req-sub">@{u.username}</div> : null}
            </div>
            <div className="row-right">{icons.chevron()}</div>
          </div>
        </Fragment>
      ))}
    </div>,
  )
}
