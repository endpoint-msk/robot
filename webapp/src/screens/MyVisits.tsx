import { Fragment } from 'react'
import { fmtWeekdayDate } from '../dates'
import { icons } from '../icons'
import { bump, push, useStore } from '../store'
import { sec } from '../theme'
import { botCanWrite, haptic, requestWriteAccess } from '../telegram'
import type { HostingRequest } from '../types'
import { BottomBar, DevChips, EmptyState, Header, SectionTitle, Sep } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'

function VisitRow({ r }: { r: HostingRequest }) {
  const approved = r.status === 'approved'
  const p = r.timeProposal
  // Резидент предложил новое время — ход за гостем: строка явно зовёт к действию.
  const needsAnswer = Boolean(p && p.by === 'resident')
  const iconSquare = needsAnswer ? (
    <div className="status-square attn">{icons.clock(18, '#007aff')}</div>
  ) : approved ? (
    <div className="status-square ok">{icons.check(20, '#34c759')}</div>
  ) : (
    <div className="status-square">{icons.clock(18, sec(0.5))}</div>
  )

  let subText: string
  if (needsAnswer) subText = `Резидент предлагает ${p!.time} — нужен ответ`
  else if (p && p.by === 'guest') subText = `вы предложили ${p.time} · ждём${approved ? ' хоста' : ''}`
  else if (approved) subText = `к ${r.time} · подтверждён`
  else subText = `к ${r.time} · ждём резидента`

  const right =
    approved && r.approvedBy ? (
      <div className="approver">
        <span className="approver-label">хостит</span>
        <div className="pill">
          <Avatar user={r.approvedBy} />
          <span className="pill-name">{userLabel(r.approvedBy)}</span>
        </div>
      </div>
    ) : (
      <span className="waiting-label">В ожидании</span>
    )

  return (
    <div className={'row tappable' + (needsAnswer ? ' needs-action' : '')} onClick={() => push('visit', { id: r.id })}>
      {iconSquare}
      <div className="req-main">
        <div className="req-name">{fmtWeekdayDate(r.dateKey)}</div>
        <div className={'req-sub' + (needsAnswer ? ' attn' : '')}>{subText}</div>
      </div>
      {right}
    </div>
  )
}

/** Плашка «бот не может писать вам»: видна, пока доступа нет; тап зовёт нативный
    запрос Telegram, после выдачи доступа плашка пропадает. */
function WriteAccessBanner() {
  if (botCanWrite()) return null
  return (
    <div
      className="write-banner"
      onClick={async () => {
        const ok = await requestWriteAccess()
        if (ok) {
          haptic('success')
          bump()
        }
      }}
    >
      <div className="wb-icon">{icons.bell()}</div>
      <div className="wb-text">
        <div className="wb-title">Бот не может писать вам</div>
        <div className="wb-sub">Разрешите, чтобы получать ответы на заявки</div>
      </div>
      {icons.chevron()}
    </div>
  )
}

function VisitList({ list }: { list: HostingRequest[] }) {
  return (
    <div className="card">
      {list.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 ? <Sep left={66} /> : null}
          <VisitRow r={r} />
        </Fragment>
      ))}
    </div>
  )
}

export function MyVisits() {
  const { data } = useStore()
  const my = data!.myRequests
  const approved = my.filter((r) => r.status === 'approved')
  const pending = my.filter((r) => r.status !== 'approved')

  return (
    <Screen hasBottomBar>
      <Header title="Мои визиты" chip={<DevChips />} />
      <WriteAccessBanner />
      {my.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Пока нет заявок"
            text="Выбери день и время визита — резиденты увидят заявку и откликнутся."
          />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>Одобрены</SectionTitle>
          <VisitList list={approved} />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>Ждут ответа</SectionTitle>
          <VisitList list={pending} />
        </>
      ) : null}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="row tappable" onClick={() => push('peek')}>
          <div className="row-icon" style={{ background: '#34c759' }}>
            {icons.people()}
          </div>
          <span className="row-label">Кто придёт</span>
          <div className="row-right">{icons.chevron()}</div>
        </div>
        <Sep left={54} />
        <div className="row tappable" onClick={() => push('settings')}>
          <div className="row-icon" style={{ background: '#8e8e93' }}>
            {icons.gear()}
          </div>
          <span className="row-label">Настройки</span>
          <div className="row-right">{icons.chevron()}</div>
        </div>
      </div>
      <BottomBar>
        <button className="primary-btn" onClick={() => push('newRequest')}>
          {icons.plus()}
          Новая заявка
        </button>
      </BottomBar>
    </Screen>
  )
}
