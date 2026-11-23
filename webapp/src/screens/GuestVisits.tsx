// Профиль гостя для резидентов: сколько раз приходил и сколько раз не пришёл, когда
// обычно бывает, кто его хостит, на какие ивенты его приняли, заметка и вся история -
// заявки и визиты без заявки. Открывается из поиска по архиву, из «Кто пришёл» и по
// чипу «5-й» в строке заявки.
//
// Строки истории свои, а не RequestsCard: там главное — гость и время внутри одного
// дня, а здесь гость один на весь экран и главное — дата.

import { plural, tr } from '../i18n'
import { Fragment } from 'react'
import { api } from '../api'
import { fmtDayMonth, fmtShortDate, visitsWord, weekdaysFull, yearOf } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { useParams, useStore } from '../store'
import { hasProfile, openProfile } from '../telegram'
import { sec } from '../theme'
import type { GuestProfile, GuestRequestsResponse, HostingRequest, User, VisitOutcome, WalkIn } from '../types'
import { EmptyState, ErrorState, BackRow, Sep, SectionTitle } from '../components/common'
import { GuestNoteText, startNoteEdit } from '../components/GuestNoteText'
import { Avatar, userLabel } from '../components/people'
import { ProfileHead, type ProfileAction } from '../components/ProfileHead'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkProfile, SkQuad, SkRows } from '../components/skeleton'

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
  const host = r.approvedBy ? tr(`хост ${userLabel(r.approvedBy)}`, `host: ${userLabel(r.approvedBy)}`) : ''
  const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ')
  if (o.status === 'came') {
    const how = o.source === 'door' ? tr('по кнопке «Я на месте»', 'used “I’m here”') : o.source === 'mark' && o.by ? tr(`отметка ${userLabel(o.by)}`, `marked by ${userLabel(o.by)}`) : ''
    return { text: join(tr('визит', 'visit'), how, host), tone: 'came' }
  }
  if (o.status === 'missed') return { text: join(tr('неявка', 'no-show'), o.by ? tr(`отметка ${userLabel(o.by)}`, `marked by ${userLabel(o.by)}`) : '', host), tone: 'missed' }
  if (o.status === 'unknown') return { text: join(tr('без отметки', 'unmarked'), host), tone: 'muted' }
  if (r.dateKey >= todayKey) return { text: r.status === 'approved' ? join(tr('подтверждён', 'confirmed'), host) : tr('ждёт ответа', 'pending'), tone: 'muted' }
  return { text: tr('без ответа', 'no reply'), tone: 'muted' }
}

type HistoryItem = { key: string; dateKey: string; request: HostingRequest | null; walkIn: WalkIn | null }

/**
 * Строка ленты истории: узел на линии цвета исхода (приход зелёный, неявка оранжевая,
 * будущий визит в цвет акцента, без исхода пустой). Плитки даты нет: дата и так в
 * заголовке строки.
 */
function HistoryRow({ item, todayKey }: { item: HistoryItem; todayKey: string }) {
  const r = item.request
  const line = r
    ? requestLine(r, todayKey)
    : { text: tr(`без заявки · отметка ${userLabel(item.walkIn!.by)}`, `walk-in · marked by ${userLabel(item.walkIn!.by)}`), tone: 'came' as const }
  const node = line.tone !== 'muted' ? line.tone : r && r.dateKey >= todayKey ? 'next' : 'muted'
  return (
    <div className={'row hist-row ' + node}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="week-title">{r ? tr(`${fmtShortDate(r.dateKey)} · к ${r.time}`, `${fmtShortDate(r.dateKey)} · at ${r.time}`) : fmtShortDate(item.dateKey)}</div>
        <div className={'week-sub visit-status ' + line.tone}>
          {line.text}
          {r?.anon ? tr(' · инкогнито', ' · anonymous') : ''}
        </div>
        {r?.purpose ? <div className="week-sub guest-purpose">{r.purpose}</div> : null}
      </div>
    </div>
  )
}

/** Сводка: визиты и неявки первой строкой, «обычно» и ближайший визит второй. */
function ProfileStats({ p }: { p: GuestProfile }) {
  const usual = p.usual
    ? tr(`по ${WEEKDAYS_PLURAL_DAT[p.usual.weekday]}`, `on ${weekdaysFull()[p.usual.weekday]}s`) +
      (p.usual.time ? tr(` к ${p.usual.time}`, ` at ${p.usual.time}`) : '')
    : null
  const next = p.next ? tr(`${fmtShortDate(p.next.dateKey)} к ${p.next.time}`, `${fmtShortDate(p.next.dateKey)} at ${p.next.time}`) : null
  return (
    <div className="card stats-quad">
      <div className="sq-row">
        <div className="sq-cell">
          <div className="sq-num">{p.visits}</div>
          <div className="sq-label">
            {plural(p.visits, ['визит', 'визита', 'визитов'], ['visit', 'visits'])}
            {p.unmarked > 0 ? nb(tr(`, ${p.unmarked} без отметки`, `, ${p.unmarked} unmarked`)) : ''}
          </div>
        </div>
        <div className="sq-vsep" />
        <div className="sq-cell">
          <div className={'sq-num' + (p.missed > 0 ? ' missed' : '')}>{p.missed}</div>
          <div className="sq-label">{plural(p.missed, ['неявка', 'неявки', 'неявок'], ['no-show', 'no-shows'])}</div>
        </div>
      </div>
      {usual || next ? (
        <>
          <div className="sep" style={{ margin: '0 16px' }} />
          <div className="sq-row">
            <div className="sq-cell">
              <div className="sq-num small">{usual ?? '—'}</div>
              <div className="sq-label">{tr('обычно приходит', 'usually visits')}</div>
            </div>
            <div className="sq-vsep" />
            <div className="sq-cell">
              <div className="sq-num small">{next ?? '—'}</div>
              <div className="sq-label">{p.next && !p.next.approved ? tr('заявка ждёт ответа', 'request pending') : tr('следующий визит', 'next visit')}</div>
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
    profile ? (profile.firstDateKey ? tr(`первый визит ${fmtWhen(profile.firstDateKey, todayKey)}`, `first visit ${fmtWhen(profile.firstDateKey, todayKey)}`) : tr('визитов пока нет', 'no visits yet')) : '',
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
            <SectionTitle>{tr('Хосты', 'Hosts')}</SectionTitle>
            <div className="card">
              {profile.hosts.map((h, i) => (
                <Fragment key={h.user.userId}>
                  {i > 0 ? <Sep inset={34} /> : null}
                  <div className="row">
                    <Avatar user={h.user} className="stat-avatar" profile />
                    <span className="row-label">{userLabel(h.user)}</span>
                    <span className="row-right count-muted">{visitsWord(h.count)}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        {profile.events.length > 0 ? (
          <>
            <SectionTitle>{tr('Ивенты', 'Events')}</SectionTitle>
            <div className="card">
              {profile.events.map((e, i) => (
                <Fragment key={e.id}>
                  {i > 0 ? <Sep inset="icon" /> : null}
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
        <SectionTitle>{tr('История', 'History')}</SectionTitle>
        {items.length === 0 ? (
          <div className="card">
            <EmptyState title={tr('Записей нет', 'No records')} text={tr('Все заявки этого человека уже удалены.', 'This person’s requests have all been deleted.')} />
          </div>
        ) : (
          <div className="card hist-card">
            {items.map((item) => (
              <HistoryRow key={item.key} item={item} todayKey={todayKey} />
            ))}
          </div>
        )}
      </>
    )
  }

  // Заметка открывается и кнопкой в шапке, а её текст остаётся строкой ниже, как «О себе» в Telegram.
  const actions: ProfileAction[] = user
    ? [
        {
          key: 'note',
          label: tr('Заметка', 'Note'),
          icon: icons.note(22, 'currentColor'),
          onClick: () => startNoteEdit('guest-' + user.userId),
        },
        ...(hasProfile(user)
          ? [{ key: 'tg', label: 'Telegram', icon: icons.telegram(22, 'currentColor'), onClick: () => openProfile(user) }]
          : []),
      ]
    : []

  return (
    <Screen>
      <BackRow />
      {user ? (
        <ProfileHead
          user={user}
          name={user.name}
          sub={sub}
          actions={actions}
        />
      ) : (
        <SkProfile />
      )}
      {/* Заметка — общая память резидентов о человеке; она известна сразу, из bootstrap. */}
      {user ? (
        <>
          {/* Заметка пишется прямо здесь: касание текста или кнопки «Заметка» в шапке
              ставит в неё курсор. */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="row note-row">
              <div className="row-icon" style={{ background: 'rgba(var(--sec), 0.12)' }}>
                {icons.note(17, sec(0.6))}
              </div>
              <GuestNoteText place={'guest-' + user.userId} guest={user} note={note} empty={tr('Добавить заметку', 'Add note')} />
            </div>
          </div>
        </>
      ) : null}
      {/* Шапка и заметка уже настоящие — подменяется только сводка и история. */}
      <Swap
        loading={!guest.data && !guest.error}
        skeleton={
          guest.pending ? (
            // Каркас по секциям экрана, иначе «История» уезжала вниз на всю сводку и хостов.
            // Хосты есть у того, кто уже приходил: это знает значок визитов из bootstrap.
            <div aria-busy="true" aria-label={tr('Загружаем профиль гостя', 'Loading guest profile')}>
              <SkQuad />
              {(data!.guestStats?.[String(userId)]?.past ?? 0) > 0 ? (
                <>
                  <SectionTitle>{tr('Хосты', 'Hosts')}</SectionTitle>
                  <SkRows count={1} avatar />
                </>
              ) : null}
              <SectionTitle>{tr('История', 'History')}</SectionTitle>
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
