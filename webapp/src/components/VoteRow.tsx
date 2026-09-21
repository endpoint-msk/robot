import { fmtIsoDay, plural } from '../dates'
import { icons } from '../icons'
import type { VoteView } from '../types'

const votersWord = (n: number): string => `${n} ${plural(n, 'голос', 'голоса', 'голосов')}`

export const timeLeft = (endsAt: string): string => {
  const ms = Date.parse(endsAt) - Date.now()
  if (ms <= 0) return 'закрывается'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return 'меньше часа'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ${plural(hrs, 'час', 'часа', 'часов')}`
  const days = Math.floor(hrs / 24)
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** Строка-подпись под заголовком: срок/итог + число голосов + анонимность. */
export const voteMeta = (v: VoteView): string => {
  const parts: string[] = []
  if (v.status === 'open') parts.push(v.endsAt ? `осталось ${timeLeft(v.endsAt)}` : 'бессрочно')
  else parts.push(v.closedAt ? `завершено ${fmtIsoDay(v.closedAt)}` : 'завершено')
  parts.push(votersWord(v.totalVoters))
  if (v.anon) parts.push('анонимно')
  return parts.join(' · ')
}

export function VoteRow({ vote, onOpen }: { vote: VoteView; onOpen: () => void }) {
  const dot = vote.status === 'closed' ? 'closed' : vote.voted ? 'voted' : 'open'
  return (
    <button type="button" className="row tappable vote-item" onClick={onOpen}>
      <span className={'vote-dot ' + dot} />
      <div className="vote-item-main">
        <div className="vote-item-title">{vote.title}</div>
        <div className="vote-item-meta">{voteMeta(vote)}</div>
      </div>
      <div className="row-right">{icons.chevron()}</div>
    </button>
  )
}
