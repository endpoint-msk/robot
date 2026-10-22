// «Кто пришёл» за день: отметки по заявкам и гости без заявки. Открывается с экрана
// сегодняшнего дня и из архива недели. Править можно только сам день визита и ночь
// после него (сервер отдаёт `editable`), прошедший день дальше только читается.
//
// Пропуском считается только явная отметка «не пришёл». Подтверждённый визит, который
// никто не отметил, остаётся «без отметки», а не неявкой: забыл резидент, а не гость.

import { Fragment, useState } from 'react'
import { action, api } from '../api'
import { fmtDayMonth, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { markOwnTap } from '../motion'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import { sec } from '../theme'
import type { HostingRequest, User, VisitOutcome, VisitsDay, WalkIn } from '../types'
import { ActionButton, BackRow, EmptyState, ErrorState, Header, ReadonlyBadge, SectionTitle, Sep } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'
import { minuteOfDay, useNowMin } from './Visit'

const NO_OUTCOME: VisitOutcome = { status: null, source: null, by: null, at: null }

/**
 * Исход с учётом своего тапа, который сервер ещё не подтвердил. Снятая отметка до
 * ответа показывается приблизительно: «до отметок» знает только сервер, и через
 * мгновение его ответ встанет на место.
 */
function effective(r: HostingRequest, pending: Record<string, boolean | null>, me: User, todayKey: string): VisitOutcome {
  if (!(r.id in pending)) return r.visit ?? NO_OUTCOME
  const came = pending[r.id]
  if (came === true || came === false) return { status: came ? 'came' : 'missed', source: 'mark', by: me, at: null }
  if (r.arrivedAt) return { status: 'came', source: 'door', by: null, at: null }
  if (r.status === 'approved' && r.dateKey < todayKey) return { status: 'unknown', source: null, by: null, at: null }
  return NO_OUTCOME
}

/** Подпись исхода: существительными, а не «пришёл/пришла» - пол гостя мы не знаем. */
function outcomeLine(o: VisitOutcome): { text: string; tone: string } | null {
  if (o.status === 'came') {
    if (o.source === 'door') return { text: 'приход · по кнопке «Я на месте»', tone: 'came' }
    if (o.source === 'legacy') return { text: 'приход · визит до отметок', tone: 'came' }
    return { text: o.by ? `приход · отметка ${userLabel(o.by)}` : 'приход', tone: 'came' }
  }
  if (o.status === 'missed') return { text: o.by ? `неявка · отметка ${userLabel(o.by)}` : 'неявка', tone: 'missed' }
  if (o.status === 'unknown') return { text: 'без отметки', tone: 'muted' }
  return null
}

/** Профиль есть только у того, за кем есть аккаунт: у добавленных по имени (id 0) его нет. */
const openGuest = (u: User): void => {
  if (u.userId !== 0) push('guestVisits', { userId: u.userId, user: u })
}

function RequestVisitRow({
  r,
  outcome,
  editable,
  canMiss,
  onMark,
}: {
  r: HostingRequest
  outcome: VisitOutcome
  editable: boolean
  /** «Не пришёл» доступен: визит подтверждён и его время уже наступило. */
  canMiss: boolean
  onMark: (r: HostingRequest, came: boolean | null) => void
}) {
  const line = outcomeLine(outcome)
  const came = outcome.status === 'came'
  const missed = outcome.status === 'missed'
  // Повторный тап по своей же отметке её снимает. «Приход» по кнопке гостя или до
  // отметок отметкой не является: тап по нему ставит её явно.
  const ownCame = came && outcome.source === 'mark'
  return (
    <div className="row visit-row">
      <button type="button" className="visit-who" onClick={() => openGuest(r.guest)}>
        <Avatar user={r.guest} className="req-avatar" />
        <div className="req-main">
          <div className="req-name">{r.guest.name}</div>
          <div className="req-sub">
            {`к ${r.time} · ${r.approvedBy ? `хостит ${userLabel(r.approvedBy)}` : 'без хоста'}`}
            {r.anon ? ' · анонимно' : ''}
          </div>
          {line ? <div className={'visit-status ' + line.tone}>{line.text}</div> : null}
        </div>
      </button>
      {editable ? (
        <div className="visit-mark">
          <button
            type="button"
            className={'vm-btn came' + (came ? ' on' : '')}
            aria-label={ownCame ? 'Снять отметку прихода' : 'Отметить приход'}
            aria-pressed={came}
            onClick={() => onMark(r, ownCame ? null : true)}
          >
            {icons.check(16, came ? '#fff' : sec(0.45), 2.4)}
          </button>
          <button
            type="button"
            className={'vm-btn missed' + (missed ? ' on' : '')}
            aria-label={missed ? 'Снять отметку неявки' : 'Отметить неявку'}
            aria-pressed={missed}
            disabled={!canMiss && !missed}
            title={!canMiss && !missed ? (r.status === 'approved' ? 'Визит ещё не начался' : 'Заявку никто не брал') : undefined}
            onClick={() => onMark(r, missed ? null : false)}
          >
            {icons.xmark(14, missed ? '#fff' : sec(0.45))}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function WalkInRow({ w, editable, onRemove }: { w: WalkIn; editable: boolean; onRemove: (w: WalkIn) => Promise<unknown> }) {
  const sub = w.guest.username ? '@' + w.guest.username : w.guest.userId === 0 ? 'без аккаунта' : ''
  return (
    <div className="row visit-row">
      <button type="button" className="visit-who" onClick={() => openGuest(w.guest)}>
        <Avatar user={w.guest} className="req-avatar" />
        <div className="req-main">
          <div className="req-name">{w.guest.name}</div>
          {sub ? <div className="req-sub">{sub}</div> : null}
          <div className="visit-status came">{`приход · отметка ${userLabel(w.by)}`}</div>
        </div>
      </button>
      {editable ? (
        <ActionButton className="vm-remove" label="Убрать из списка" onClick={() => onRemove(w)}>
          {icons.xmark(11, sec(0.5))}
        </ActionButton>
      ) : null}
    </div>
  )
}

export function Visits() {
  const params = useParams()
  const { data } = useStore()
  const dateKey = params.dateKey as string
  const todayKey = data!.todayKey
  const isToday = dateKey === todayKey
  // Вчерашний вечер, который ещё можно отметить: открыт с экрана сегодняшнего дня.
  const isGrace = dateKey === data!.visitGraceDay
  const me: User = { userId: data!.me.id, name: data!.me.name, username: data!.me.username }
  const nowMin = useNowMin()

  // Из архива недели день приезжает готовым: экран рисуется сразу, а свежая версия
  // догоняет. После своих отметок сервер отдаёт день целиком, и он заменяет оба.
  const preset = (params.preset as VisitsDay | undefined) ?? null
  const remote = useRemote(() => api<VisitsDay>('visits.day', { dateKey }), [dateKey])
  const [local, setLocal] = useState<VisitsDay | null>(null)
  const day = local ?? remote.data ?? preset
  const [pending, setPending] = useState<Record<string, boolean | null>>({})

  const mark = async (r: HostingRequest, came: boolean | null): Promise<void> => {
    haptic.impact(came === null ? 'soft' : 'light')
    markOwnTap()
    setPending((p) => ({ ...p, [r.id]: came }))
    const res = await action('visit.mark', { id: r.id, came }, { quiet: true })
    if (res?.visitsDay) setLocal(res.visitsDay)
    setPending((p) => {
      const { [r.id]: _done, ...rest } = p
      return rest
    })
  }

  const markAll = async (): Promise<void> => {
    haptic.impact('medium')
    markOwnTap()
    const res = await action('visit.markAll', { dateKey }, { quiet: true })
    if (res?.visitsDay) setLocal(res.visitsDay)
  }

  const removeWalkIn = async (w: WalkIn): Promise<void> => {
    haptic.impact('soft')
    markOwnTap()
    const res = await action('walkin.remove', { id: w.id }, { quiet: true })
    if (res?.visitsDay) setLocal(res.visitsDay)
  }

  const title = isToday || isGrace ? 'Кто пришёл' : WEEKDAYS_FULL[weekdayIdx(dateKey)]
  let subtitle = `${isToday ? 'Сегодня, ' : isGrace ? 'Вчера, ' : ''}${fmtDayMonth(dateKey)}`
  let body = null

  if (!day && remote.error) {
    body = <ErrorState onRetry={remote.reload} />
  } else if (day) {
    const editable = day.editable
    const requests = [...day.requests].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'))
    const outcomes = new Map(requests.map((r) => [r.id, effective(r, pending, me, todayKey)]))
    const came = requests.filter((r) => outcomes.get(r.id)?.status === 'came').length + day.walkIns.length
    const unmarked = requests.filter((r) => outcomes.get(r.id)?.status === 'unknown').length
    subtitle += ` · пришли ${came}${unmarked > 0 ? ` · без отметки ${unmarked}` : ''}`
    // «Все пришли» трогает только тех, о ком ничего не известно: явную неявку и приход
    // по кнопке гостя общая кнопка не переписывает (то же правило на сервере).
    const rest = requests.filter((r) => {
      const o = outcomes.get(r.id)
      return r.status === 'approved' && !r.arrivedAt && o?.source !== 'mark' && o?.status !== 'came'
    }).length
    const canMiss = (r: HostingRequest): boolean =>
      r.status === 'approved' && (r.dateKey < todayKey || nowMin >= minuteOfDay(r.time))

    body = (
      <>
        {!editable ? <ReadonlyBadge /> : null}
        {editable && rest > 0 ? (
          <div className="card">
            <ActionButton className="row tappable" onClick={markAll}>
              <div className="row-icon" style={{ background: 'var(--green)' }}>
                {icons.check(17, '#fff', 2.4)}
              </div>
              <span className="row-label">Все пришли</span>
              <span className="row-right count-muted">{String(rest)}</span>
            </ActionButton>
          </div>
        ) : null}
        {requests.length > 0 ? (
          <>
            <SectionTitle>{`По заявкам · ${requests.length}`}</SectionTitle>
            <div className="card">
              {requests.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 ? <Sep left={66} /> : null}
                  <RequestVisitRow
                    r={r}
                    outcome={outcomes.get(r.id) ?? NO_OUTCOME}
                    editable={editable}
                    canMiss={canMiss(r)}
                    onMark={(req, value) => void mark(req, value)}
                  />
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        {day.walkIns.length > 0 || editable ? (
          <>
            <SectionTitle>{day.walkIns.length > 0 ? `Без заявки · ${day.walkIns.length}` : 'Без заявки'}</SectionTitle>
            <div className="card">
              {day.walkIns.map((w, i) => (
                <Fragment key={w.id}>
                  {i > 0 ? <Sep left={66} /> : null}
                  <WalkInRow w={w} editable={editable} onRemove={removeWalkIn} />
                </Fragment>
              ))}
              {editable ? (
                <>
                  {day.walkIns.length > 0 ? <Sep left={54} /> : null}
                  <button type="button" className="row tappable" onClick={() => push('walkIn', { dateKey })}>
                    <div className="row-icon" style={{ background: 'var(--blue)' }}>
                      {icons.personPlus('#fff')}
                    </div>
                    <span className="row-label">Добавить гостя без заявки</span>
                    <div className="row-right">{icons.chevron()}</div>
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        {requests.length === 0 && day.walkIns.length === 0 && !editable ? (
          <div className="card">
            <EmptyState title="Никого не отметили" text="В этот день не было ни заявок, ни гостей без заявки." />
          </div>
        ) : null}
      </>
    )
  }

  return (
    <Screen>
      <BackRow />
      <Header title={title} subtitle={subtitle} />
      {/* Шапка известна заранее, подменяется только список. */}
      <Swap
        loading={!day && !remote.error}
        skeleton={
          remote.pending ? (
            <div aria-busy="true" aria-label="Загружаем, кто пришёл">
              <SectionTitle>По заявкам</SectionTitle>
              <SkRows count={3} avatar tail />
            </div>
          ) : null
        }
      >
        {body}
      </Swap>
    </Screen>
  )
}
