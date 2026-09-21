import { Fragment } from 'react'
import { api } from '../api'
import { push } from '../store'
import { useRemote } from '../remote'
import type { VoteArchiveResponse } from '../types'
import { BackRow, EmptyState, ErrorState, Header, Sep } from '../components/common'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'
import { VoteRow } from '../components/VoteRow'

export function VoteArchive() {
  const archive = useRemote(async () => (await api<VoteArchiveResponse>('vote.archive')).votes, [])

  let body
  if (archive.error) body = <ErrorState onRetry={archive.reload} />
  else if (!archive.data) body = null
  else if (archive.data.length === 0)
    body = (
      <div className="card">
        <EmptyState title="Архив пуст" text="Здесь появятся завершённые голосования." />
      </div>
    )
  else
    body = (
      <div className="card">
        {archive.data.map((v, i) => (
          <Fragment key={v.id}>
            {i > 0 ? <Sep left={40} /> : null}
            <VoteRow vote={v} onOpen={() => push('vote', { vote: v })} />
          </Fragment>
        ))}
      </div>
    )

  return (
    <Screen>
      <BackRow label="Голосования" />
      <Header title="Архив голосований" />
      <Swap loading={archive.loading && !archive.data} skeleton={archive.pending ? <SkRows count={5} tail /> : null}>
        {body}
      </Swap>
    </Screen>
  )
}
