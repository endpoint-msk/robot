// Гость пришёл без заявки: резидент выбирает, кто это. Сверху принятые на ивент этого
// дня (их визит - ивент, заявки на визит у них обычно нет), дальше знакомые боту гости.
// Кого бот не знает, ищем по @нику в Telegram, а у кого и ника нет - пишем просто имя.

import { Fragment, useState } from 'react'
import { action, api } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { markOwnTap } from '../motion'
import { useRemote } from '../remote'
import { pop, useParams } from '../store'
import { haptic } from '../telegram'
import type { WalkInCandidate, WalkInCandidatesResponse } from '../types'
import { ActionButton, BackRow, EmptyState, ErrorState, Found, Header, SearchField, searchNeedle, SectionTitle, Sep } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

/** Тот же формат, что проверяет сервер: в Telegram ник от 4 до 32 символов. */
const USERNAME_RE = /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/

function CandidateRow({ p, query, onAdd }: { p: WalkInCandidate; query: string; onAdd: () => Promise<unknown> }) {
  return (
    <div className="row">
      <Avatar user={p} className="req-avatar" />
      <div className="req-main">
        <div className="req-name">
          <Found text={p.name} query={query} />
        </div>
        {p.username ? (
          <div className="req-sub">
            @<Found text={p.username} query={query} />
          </div>
        ) : null}
      </div>
      <ActionButton className="host-btn" onClick={onAdd}>
        Отметить
      </ActionButton>
    </div>
  )
}

export function WalkIn() {
  const { dateKey } = useParams()
  const [query, setQuery] = useState('')
  const { data, error, loading, pending, reload } = useRemote(
    async () => (await api<WalkInCandidatesResponse>('walkin.candidates', { dateKey })).people,
    [dateKey],
  )

  const add = async (params: Record<string, unknown>): Promise<void> => {
    haptic.impact('light')
    markOwnTap()
    const res = await action('walkin.add', { dateKey, ...params }, { quiet: true })
    if (res) {
      haptic.notify('success')
      pop()
    }
  }

  const q = query.trim()
  const lower = searchNeedle(query)
  let body
  if (error) body = <ErrorState onRetry={reload} />
  else if (!data) body = null
  else {
    const match = (p: WalkInCandidate): boolean =>
      !lower || p.name.toLowerCase().includes(lower) || (p.username ?? '').toLowerCase().includes(lower)
    const fromEvent = data.filter((p) => p.fromEvent && match(p))
    const known = data.filter((p) => !p.fromEvent && match(p))
    // Ник, которого среди знакомых нет: ищем его в Telegram. Имя без @ - запасной путь
    // для тех, у кого ника нет вовсе; профиля у такой записи не будет.
    const exact = data.some((p) => (p.username ?? '').toLowerCase() === lower)
    const byUsername = q && USERNAME_RE.test(q) && !exact ? q.replace(/^@/, '') : null
    const byName = q && !q.startsWith('@') ? q : null
    const group = (title: string, list: WalkInCandidate[]) =>
      list.length > 0 ? (
        <>
          <SectionTitle>{`${title} · ${list.length}`}</SectionTitle>
          <div className="card">
            {list.map((p, i) => (
              <Fragment key={p.userId}>
                {i > 0 ? <Sep inset="avatar" /> : null}
                <CandidateRow p={p} query={lower} onAdd={() => add({ userId: p.userId })} />
              </Fragment>
            ))}
          </div>
        </>
      ) : null
    body = (
      <>
        {byUsername || byName ? (
          <div className="card">
            {byUsername ? (
              <ActionButton className="row tappable" onClick={() => add({ username: byUsername })}>
                <div className="row-icon" style={{ background: 'var(--blue)' }}>
                  {icons.chat(17, '#fff')}
                </div>
                <span className="row-label">{`Найти @${byUsername} в Telegram`}</span>
              </ActionButton>
            ) : null}
            {byUsername && byName ? <Sep inset="icon" /> : null}
            {byName ? (
              <ActionButton className="row tappable" onClick={() => add({ name: byName })}>
                <div className="row-icon" style={{ background: 'var(--gray)' }}>
                  {icons.personPlus('#fff')}
                </div>
                <span className="row-label">
                  {`Добавить «${byName}»`}
                  <span className="row-sublabel">без аккаунта Telegram</span>
                </span>
              </ActionButton>
            ) : null}
          </div>
        ) : null}
        {group('С ивента', fromEvent)}
        {group('Гости', known)}
        {fromEvent.length === 0 && known.length === 0 && !q ? (
          <div className="card">
            <EmptyState title="Знакомых гостей нет" text="Впишите @ник или имя того, кто пришёл." />
          </div>
        ) : null}
      </>
    )
  }

  return (
    <Screen>
      <BackRow />
      <Header title="Без заявки" subtitle={fmtShortDate(dateKey)} />
      <SearchField value={query} onChange={setQuery} placeholder="Имя, @ник или новый гость" />
      <Swap
        loading={loading && !data}
        skeleton={
          pending ? (
            <div aria-busy="true" aria-label="Загружаем гостей">
              <SectionTitle>Гости</SectionTitle>
              <SkRows count={4} avatar tail />
            </div>
          ) : null
        }
      >
        {body}
      </Swap>
    </Screen>
  )
}
