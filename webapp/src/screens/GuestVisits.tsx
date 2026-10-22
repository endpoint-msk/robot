// Профиль гостя для резидентов: сколько раз приходил и сколько раз не пришёл, когда
// обычно бывает, кто его хостит, на какие ивенты его приняли, заметка и вся история -
// заявки и визиты без заявки. Открывается из поиска по архиву, из «Кто пришёл» и по
// чипу «5-й» в строке заявки.
//
// Строки истории свои, а не RequestsCard: там главное — гость и время внутри одного
// дня, а здесь гость один на весь экран и главное — дата.

import { Fragment } from 'react'
import { api } from '../api'
import { dayNum, fmtDayMonth, fmtShortDate, MONTHS_ABBR, monthIdx, plural, yearOf } from '../dates'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { sec } from '../theme'
import type { GuestProfile, GuestRequestsResponse, HostingRequest, User, VisitOutcome, WalkIn } from '../types'
import { EmptyState, ErrorState, BackRow, Sep, SectionTitle } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

/** «по четвергам»: день недели в дательном множественном, 0 - понедельник. */
const WEEKDAYS_PLURAL_DAT = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям']

/** «12 марта», а для прошлых лет ещё и год: «12 марта 2025». */
const fmtWhen = (dateKey: string, todayKey: string): string =>
  fmtDayMonth(dateKey) + (yearOf(dateKey) !== yearOf(todayKey) ? ` ${yearOf(dateKey)}` : '')

/**
 * Что стало с визитом. Существительными, а не «пришёл/пришла»: пол гостя мы не знаем.
 * `tone` красит строку и выбирает значок справа.
 */
function requestLine(r: HostingRequest, todayKey: string): { text: string; tone: 'came' | 'missed' | 'muted' } {
  const o: VisitOutcome = r.visit ?? { status: null, source: null, by: null, at: null }
  const host = r.approvedBy ? `хост ${userLabel(r.approvedBy)}` : ''
  const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ')
  if (o.status === 'came') {
    const how = o.source === 'door' ? 'по кнопке «Я на месте»' : o.source === 'mark' && o.by ? `отметка ${userLabel(o.by)}` : ''
    return { text: join('приход', how, host), tone: 'came' }
  }
  if (o.status === 'missed') return { text: join('неявка', o.by ? `отметка ${userLabel(o.by)}` : '', host), tone: 'missed' }
  if (o.status === 'unknown') return { text: join('без отметки', host), tone: 'muted' }
  if (r.dateKey >= todayKey) return { text: r.status === 'approved' ? join('подтверждён', host) : 'ждёт ответа', tone: 'muted' }
  return { text: 'без ответа', tone: 'muted' }
}

type HistoryItem = { key: string; dateKey: string; request: HostingRequest | null; walkIn: WalkIn | null }

function HistoryRow({ item, todayKey }: { item: HistoryItem; todayKey: string }) {
  const r = item.request
  const line = r
    ? requestLine(r, todayKey)
    : { text: `без заявки · отметка ${userLabel(item.walkIn!.by)}`, tone: 'came' as const }
  return (
    <div className="row">
      <div className="week-square">
        <span className="ws-day">{String(dayNum(item.dateKey))}</span>
        <span className="ws-month">{MONTHS_ABBR[monthIdx(item.dateKey)]}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="week-title">{r ? `${fmtShortDate(r.dateKey)} · к ${r.time}` : fmtShortDate(item.dateKey)}</div>
        <div className={'week-sub visit-status ' + line.tone}>
          {line.text}
          {r?.anon ? ' · инкогнито' : ''}
        </div>
        {r?.purpose ? <div className="week-sub guest-purpose">{r.purpose}</div> : null}
      </div>
      {line.tone === 'came' ? (
        <div className="row-right">{icons.check(15, '#34c759')}</div>
      ) : line.tone === 'missed' ? (
        <div className="row-right">{icons.xmark(12, '#ff9500')}</div>
      ) : null}
    </div>
  )
}

/** Сводка: визиты и неявки первой строкой, «обычно» и ближайший визит второй. */
function ProfileStats({ p }: { p: GuestProfile }) {
  const usual = p.usual ? `по ${WEEKDAYS_PLURAL_DAT[p.usual.weekday]}${p.usual.time ? ` к ${p.usual.time}` : ''}` : null
  const next = p.next ? `${fmtShortDate(p.next.dateKey)} к ${p.next.time}` : null
  return (
    <div className="card stats-quad">
      <div className="sq-row">
        <div className="sq-cell">
          <div className="sq-num">{p.visits}</div>
          <div className="sq-label">
            {plural(p.visits, 'визит', 'визита', 'визитов')}
            {p.unmarked > 0 ? `, ${p.unmarked} без отметки` : ''}
          </div>
        </div>
        <div className="sq-vsep" />
        <div className="sq-cell">
          <div className={'sq-num' + (p.missed > 0 ? ' missed' : '')}>{p.missed}</div>
          <div className="sq-label">{plural(p.missed, 'неявка', 'неявки', 'неявок')}</div>
        </div>
      </div>
      {usual || next ? (
        <>
          <div className="sep" style={{ margin: '0 16px' }} />
          <div className="sq-row">
            <div className="sq-cell">
              <div className="sq-num small">{usual ?? '—'}</div>
              <div className="sq-label">обычно приходит</div>
            </div>
            <div className="sq-vsep" />
            <div className="sq-cell">
              <div className="sq-num small">{next ?? '—'}</div>
              <div className="sq-label">{p.next && !p.next.approved ? 'заявка ждёт ответа' : 'следующий визит'}</div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function GuestVisits() {
  const params = useParams()
  const { data } = useStore()
  const userId = params.userId as number
  const todayKey = data!.todayKey
  // Пока грузится профиль, шапку рисуем по данным из строки, откуда пришли: экран не мигает пустым.
  const preset = params.user as User | undefined
  const guest = useRemote(() => api<GuestRequestsResponse>('guest.requests', { userId }), [userId])

  const user = guest.data ? guest.data.user : preset
  const note = (data!.notes || []).find((n) => n.userId === userId) || null
  const profile = guest.data?.profile ?? null
  const sub = [
    user?.username ? '@' + user.username : '',
    profile ? (profile.firstDateKey ? `первый визит ${fmtWhen(profile.firstDateKey, todayKey)}` : 'визитов пока нет') : '',
  ]
    .filter(Boolean)
    .join(' · ')

  let body
  if (guest.error) {
    body = <ErrorState onRetry={guest.reload} />
  } else if (!guest.data || !profile) {
    body = null
  } else {
    const items: HistoryItem[] = [
      ...guest.data.requests.map((r) => ({ key: r.id, dateKey: r.dateKey, request: r, walkIn: null })),
      ...guest.data.walkIns.map((w) => ({ key: w.id, dateKey: w.dateKey, request: null, walkIn: w })),
    ].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    body = (
      <>
        <ProfileStats p={profile} />
        {profile.hosts.length > 0 ? (
          <>
            <SectionTitle>Хосты</SectionTitle>
            <div className="card">
              {profile.hosts.map((h, i) => (
                <Fragment key={h.user.userId}>
                  {i > 0 ? <Sep left={58} /> : null}
                  <div className="row">
                    <Avatar user={h.user} className="stat-avatar" profile />
                    <span className="row-label">{userLabel(h.user)}</span>
                    <span className="row-right count-muted">{`${h.count} ${plural(h.count, 'визит', 'визита', 'визитов')}`}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        {profile.events.length > 0 ? (
          <>
            <SectionTitle>Ивенты</SectionTitle>
            <div className="card">
              {profile.events.map((e, i) => (
                <Fragment key={e.id}>
                  {i > 0 ? <Sep left={54} /> : null}
                  <div className="row">
                    <div className="row-icon" style={{ background: 'var(--purple)' }}>
                      {icons.calendar(17, '#fff')}
                    </div>
                    <span className="row-label">
                      {e.title}
                      <span className="row-sublabel">{fmtWhen(e.dateKey, todayKey)}</span>
                    </span>
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        <SectionTitle>История</SectionTitle>
        {items.length === 0 ? (
          <div className="card">
            <EmptyState title="Записей нет" text="Все заявки этого человека уже удалены." />
          </div>
        ) : (
          <div className="card">
            {items.map((item, i) => (
              <Fragment key={item.key}>
                {i > 0 ? <Sep left={70} /> : null}
                <HistoryRow item={item} todayKey={todayKey} />
              </Fragment>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <Screen>
      <BackRow />
      <div className="person-head">
        {user ? <Avatar user={user} className="stat-avatar big" profile /> : null}
        <div className="person-head-text">
          <div className="title">{user ? user.name : 'Гость'}</div>
          {sub ? <div className="subtitle">{sub}</div> : null}
        </div>
      </div>
      {/* Заметка — общая память резидентов о человеке; она известна сразу, из bootstrap. */}
      {user ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className="row tappable"
              onClick={() => push('guestNote', { guest: user, backLabel: 'Гость' })}
            >
              <div className="row-icon" style={{ background: 'rgba(var(--sec), 0.12)' }}>
                {icons.note(17, sec(0.6))}
              </div>
              <span className="row-label">{note ? note.text : 'Заметки пока нет'}</span>
              <div className="row-right">{icons.chevron()}</div>
            </button>
          </div>
        </>
      ) : null}
      {/* Шапка и заметка уже настоящие — подменяется только сводка и история. */}
      <Swap
        loading={!guest.data && !guest.error}
        skeleton={
          guest.pending ? (
            <div aria-busy="true" aria-label="Загружаем профиль гостя">
              <SkRows count={2} />
              <SectionTitle>История</SectionTitle>
              <SkRows count={4} avatar />
            </div>
          ) : null
        }
      >
        {body}
      </Swap>
    </Screen>
  )
}
