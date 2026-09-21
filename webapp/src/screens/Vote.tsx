import { useState } from 'react'
import { action } from '../api'
import { plural } from '../dates'
import { icons } from '../icons'
import { linkedText } from '../linkify'
import { choiceDialog, confirmDialog, showImage } from '../modals'
import { haptic, initData } from '../telegram'
import { pop, push, useParams, useStore } from '../store'
import type { User, VoteView } from '../types'
import { BackRow, BottomBar, Footnote, Header, PrimaryButton } from '../components/common'
import { AvatarStack } from '../components/people'
import { Screen } from '../components/Screen'
import { voteMeta } from '../components/VoteRow'

export function VotePoster({ photoId, className }: { photoId: string; className?: string }) {
  const src = `${location.origin}/vote-photo.jpg?id=${encodeURIComponent(photoId)}&initData=${encodeURIComponent(initData())}`
  return (
    <img
      className={className || 'ev-poster'}
      src={src}
      alt=""
      onClick={(e) => {
        e.stopPropagation()
        showImage(src, 'Афиша голосования')
      }}
    />
  )
}

const pct = (count: number, total: number): number => (total > 0 ? Math.round((count / total) * 100) : 0)
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

function Option({
  label,
  count,
  total,
  chosen,
  yourVote,
  interactive,
  multi,
  voters,
  onTap,
  onVoters,
}: {
  label: string
  count: number
  total: number
  chosen: boolean
  yourVote: boolean
  interactive: boolean
  multi: boolean
  voters: User[] | undefined
  onTap: () => void
  onVoters: () => void
}) {
  const p = pct(count, total)
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag className={'vopt' + (chosen ? ' chosen' : '')} onClick={interactive ? onTap : undefined} type={interactive ? 'button' : undefined}>
      <div className="vopt-row">
        {interactive ? (
          <span className={'vmark' + (multi ? ' box' : '') + (chosen ? ' on' : '')}>
            {chosen ? icons.check(12, '#fff', 2.8) : null}
          </span>
        ) : null}
        <span className="vopt-label">{label}</span>
        {voters && voters.length > 0 ? (
          <button
            type="button"
            className="vopt-av"
            aria-label="Кто голосовал"
            onClick={(e) => {
              e.stopPropagation()
              onVoters()
            }}
          >
            <AvatarStack users={voters} max={3} />
          </button>
        ) : null}
        <span className="vopt-pct">{p}%</span>
      </div>
      <div className="vopt-bar">
        <i className={chosen ? 'mine' : undefined} style={{ width: `${p}%` }} />
      </div>
      <div className="vopt-count">
        {count === 0 ? 'нет голосов' : `${count} ${plural(count, 'голос', 'голоса', 'голосов')}`}
        {yourVote ? <span className="vopt-mine"> · ваш голос</span> : null}
      </div>
    </Tag>
  )
}

export function Vote() {
  const params = useParams()
  const { data } = useStore()
  const initial = (params.vote as VoteView | undefined) ?? data!.votes?.find((v) => v.id === params.id)
  const vote = (initial && data!.votes?.find((v) => v.id === initial.id)) ?? initial

  const [sel, setSel] = useState<string[]>(vote?.myVote ?? [])

  if (!vote) {
    return (
      <Screen>
        <BackRow />
        <Header title="Голосование не найдено" subtitle="Возможно, его уже удалили" />
      </Screen>
    )
  }

  const open = vote.status === 'open'
  const interactive = open && (!vote.anon || !vote.voted)
  const changed = !sameSet(sel, vote.myVote ?? [])

  const toggle = (id: string): void => {
    if (vote.multi) setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    else setSel([id])
  }

  const submit = async (): Promise<void> => {
    if (sel.length === 0) return
    if (vote.anon) {
      const ok = await confirmDialog('В анонимном голосовании переголосовать нельзя. Отправить голос?', { confirmLabel: 'Проголосовать' })
      if (!ok) return
    }
    if (await action('vote.cast', { id: vote.id, optionIds: sel })) haptic('success')
  }

  const manage = async (): Promise<void> => {
    const opts = [
      ...(open ? [{ key: 'edit', label: 'Редактировать' }] : []),
      ...(open ? [{ key: 'close', label: 'Завершить голосование' }] : []),
      { key: 'delete', label: 'Удалить', destructive: true },
    ]
    const choice = await choiceDialog('Управление голосованием', opts)
    if (choice === 'edit') push('voteEdit', { vote })
    else if (choice === 'close') {
      const ok = await confirmDialog('Завершить голосование? Итоги уйдут в чат резидентов.', { confirmLabel: 'Завершить' })
      if (ok && (await action('vote.close', { id: vote.id }))) {
        haptic('success')
        pop()
      }
    } else if (choice === 'delete') {
      const ok = await confirmDialog(`Удалить голосование «${vote.title}»?`, { confirmLabel: 'Удалить', destructive: true })
      if (ok && (await action('vote.delete', { id: vote.id }))) {
        haptic('warning')
        pop()
      }
    }
  }

  const photos = vote.photos ?? []
  const total = vote.totalVoters
  const shown = interactive ? sel : vote.myVote ?? []

  return (
    <Screen>
      <BackRow />
      <div className="vote-head">
        <div className="vote-q">{vote.title}</div>
        <div className="vote-q-meta">{voteMeta(vote)}</div>
      </div>

      {photos.length === 1 ? <VotePoster photoId={photos[0]!} /> : null}
      {photos.length > 1 ? (
        <div className="ev-gallery">
          {photos.map((id) => (
            <VotePoster key={id} photoId={id} className="ev-poster ev-gallery-item" />
          ))}
        </div>
      ) : null}

      {vote.description ? <div className="vote-desc">{linkedText(vote.description)}</div> : null}

      <div className="card vote-card">
        {vote.options.map((o) => (
          <Option
            key={o.id}
            label={o.label}
            count={o.count}
            total={total}
            chosen={shown.includes(o.id)}
            yourVote={!interactive && (vote.myVote ?? []).includes(o.id)}
            interactive={interactive}
            multi={vote.multi}
            voters={vote.voters?.[o.id]}
            onTap={() => toggle(o.id)}
            onVoters={() => push('voteVoters', { vote })}
          />
        ))}
      </div>

      {vote.anon ? (
        <Footnote>{vote.voted ? 'Вы проголосовали. В анонимном голосовании переголосовать нельзя.' : 'Анонимно: кто как проголосовал, не увидит никто — только итоги.'}</Footnote>
      ) : null}

      {vote.canManage ? (
        <button type="button" className="vote-manage" onClick={manage}>
          Управление голосованием
        </button>
      ) : null}

      {interactive ? (
        <BottomBar>
          <PrimaryButton onClick={submit} disabled={sel.length === 0 || (vote.voted && !changed)}>
            {vote.voted ? 'Изменить голос' : 'Проголосовать'}
          </PrimaryButton>
        </BottomBar>
      ) : null}
      {interactive ? <div style={{ height: 88 }} /> : null}
    </Screen>
  )
}
