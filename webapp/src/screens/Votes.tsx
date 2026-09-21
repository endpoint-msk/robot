import { Fragment } from 'react'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { BackRow, BottomBar, EmptyState, Header, PrimaryButton, Sep } from '../components/common'
import { Screen } from '../components/Screen'
import { VoteRow } from '../components/VoteRow'

export function Votes() {
  const { data } = useStore()
  const votes = data!.votes ?? []

  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
      <Header title="Голосования" subtitle="Решаем спейсом" />

      {votes.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Активных голосований нет"
            text="Заведи первое или загляни в архив прошедших."
            icon={icons.ballot(30, 'var(--purple)')}
          />
        </div>
      ) : (
        <div className="card">
          {votes.map((v, i) => (
            <Fragment key={v.id}>
              {i > 0 ? <Sep left={40} /> : null}
              <VoteRow vote={v} onOpen={() => push('vote', { vote: v })} />
            </Fragment>
          ))}
        </div>
      )}

      <div style={{ height: 18 }} />
      <div className="card">
        <button type="button" className="row tappable" onClick={() => push('voteArchive')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.archiveBox()}
          </div>
          <span className="row-label">Архив голосований</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>

      <BottomBar>
        <PrimaryButton onClick={() => push('voteEdit')}>Создать голосование</PrimaryButton>
      </BottomBar>
      {/* Место под нижнюю панель, иначе она перекрывает последнюю карточку. */}
      <div style={{ height: 84 }} />
    </Screen>
  )
}
