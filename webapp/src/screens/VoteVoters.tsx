import { Fragment } from 'react'
import { plural } from '../dates'
import { useParams, useStore } from '../store'
import type { VoteView } from '../types'
import { BackRow, EmptyState, Header, SectionTitle, Sep } from '../components/common'
import { Avatar, Profile } from '../components/people'
import { Screen } from '../components/Screen'

export function VoteVoters() {
  const params = useParams()
  const { data } = useStore()
  const vote = (params.vote as VoteView | undefined) ?? data!.votes?.find((v) => v.id === params.id)
  if (!vote) {
    return (
      <Screen>
        <BackRow />
        <Header title="Кто голосовал" />
      </Screen>
    )
  }
  const options = vote.options.filter((o) => (vote.voters?.[o.id]?.length ?? 0) > 0)

  return (
    <Screen>
      <BackRow />
      <Header title="Кто голосовал" subtitle={vote.title} />
      {options.length === 0 ? (
        <div className="card">
          <EmptyState title="Пока никто не голосовал" />
        </div>
      ) : (
        options.map((o) => {
          const voters = vote.voters?.[o.id] ?? []
          return (
            <Fragment key={o.id}>
              <SectionTitle>{`${o.label} · ${voters.length} ${plural(voters.length, 'голос', 'голоса', 'голосов')}`}</SectionTitle>
              <div className="card">
                {voters.map((u, i) => (
                  <Fragment key={u.userId}>
                    {i > 0 ? <Sep left={66} /> : null}
                    <Profile user={u} className="row">
                      <Avatar user={u} className="req-avatar" />
                      <div className="req-main">
                        <div className="req-name">{u.name}</div>
                        {u.username ? <div className="req-sub">{'@' + u.username}</div> : null}
                      </div>
                    </Profile>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          )
        })
      )}
    </Screen>
  )
}
