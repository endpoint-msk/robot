// День у гостя тем же экраном, что у резидента: полоса в тон дня, кто придёт, «Хочу прийти»
// в шапке, дни листаются (DayPager из Day.tsx). На странице только то, что гостю и так
// приходит в bootstrap: публичное «кто придёт», тема дня, ивенты и замок.

import { tr } from '../i18n'
import { Fragment } from 'react'
import { fmtDayMonth, peopleWord, weekdayIdx, weekdaysFull } from '../dates'
import { icons } from '../icons'
import { push, startNewRequest, useParams, useStore } from '../store'
import type { DayLock } from '../types'
import { Header, SectionTitle, Sep } from '../components/common'
import { AttendeesCard } from '../components/attendees'
import { DayTopic } from '../components/DayTopic'
import { EventRow } from '../components/EventRow'
import { Avatar, userLabel } from '../components/people'
import { ComingNames, DayPager, DroppedDay, type DayPageProps } from './Day'

/** Плашка закрытого дня у гостя: причина без того, кто закрыл. */
function LockBanner({ lock }: { lock: DayLock }) {
  return (
    <div className="lock-banner">
      <div className="lb-icon">{icons.lockFilled()}</div>
      <div className="lb-text">
        <div className="lb-title">{tr('Спейс закрыт для гостей', 'The space is closed to guests')}</div>
        <div className="lb-sub">{lock.reason || tr('В этот день заявку оставить не получится', 'You can’t request to visit on this day')}</div>
      </div>
    </div>
  )
}

function GuestDayPage({ day, active, headRef, pageRef }: DayPageProps) {
  const { data } = useStore()
  const me = data!.me.id
  const att = day.attendees
  const isToday = day.dateKey === data!.todayKey
  const weekday = weekdaysFull()[weekdayIdx(day.dateKey)]!
  // На этот день у гостя уже есть заявка: на месте «Хочу прийти» она сама.
  const mine = data!.myRequests.find((r) => r.dateKey === day.dateKey) ?? null
  const faces = att.slice(0, 3)

  return (
    <div className={'dpg-page' + (active ? ' active' : '')} ref={pageRef} inert={!active}>
      <div className="dpg-head" ref={headRef}>
        <Header
          title={weekday}
          subtitle={`${isToday ? tr('Сегодня, ', 'Today, ') : ''}${fmtDayMonth(day.dateKey)}${att.length > 0 ? ` · ${peopleWord(att.length)}` : ''}`}
        />
        {day.agenda ? <DayTopic text={day.agenda.text} dateKey={day.dateKey} /> : null}
        <div className="dpg-coming">
          <div className="dpg-faces" aria-hidden="true">
            {faces.length === 0 ? (
              <span className="dpg-myslot">
                <span className="dpg-slot" />
              </span>
            ) : (
              faces.map((a, i) => (
                <span key={a.userId} className="dpg-face" style={{ zIndex: faces.length - i }}>
                  <Avatar user={a} />
                </span>
              ))
            )}
          </div>
          <div className="dpg-coming-text">
            <div className="dpg-coming-k">{tr(`Придут · ${att.length}`, `Attending · ${att.length}`)}</div>
            <ComingNames names={[...(att.some((a) => a.userId === me) ? [tr('вы', 'you')] : []), ...att.filter((a) => a.userId !== me).map(userLabel)]} />
          </div>
          {mine ? (
            <button
              type="button"
              className={'dpg-pill' + (mine.status === 'approved' ? ' on' : '')}
              onClick={() => push('visit', { id: mine.id })}
            >
              {/* Коротко, как «Вы придёте» у резидента: подпись длиннее сжимает «Придут». */}
              <span className={'dpg-pill-l ' + (mine.status === 'approved' ? 'dpg-pill-on' : 'dpg-pill-off')}>
                {mine.status === 'approved' ? icons.check(14, '#fff', 2.6) : null}
                {`${mine.status === 'approved' ? tr('Визит', 'Visit') : tr('Заявка', 'Request')} ${tr('к', 'at')} ${mine.time}`}
              </span>
            </button>
          ) : !day.lock ? (
            <button type="button" className="dpg-pill" onClick={() => startNewRequest({ dateKey: day.dateKey })}>
              <span className="dpg-pill-l dpg-pill-off">{tr('Хочу прийти', 'Request a visit')}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="dpg-body">
        {day.lock ? <LockBanner lock={day.lock} /> : null}
        {/* Ивенты над людьми: это главное, что происходит в этот день. Сам ивент
            открывается афишей. */}
        {day.events.length > 0 ? (
          <div className="card dpg-events">
            {day.events.map((ev, i) => (
              <Fragment key={ev.id}>
                {i > 0 ? <Sep inset="icon" /> : null}
                <EventRow event={ev} backLabel={weekday} />
              </Fragment>
            ))}
          </div>
        ) : null}
        {att.length > 0 ? (
          <>
            <SectionTitle>{tr('Кто придёт', 'Who’s coming')}</SectionTitle>
            <AttendeesCard list={att} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function PeekDay() {
  const params = useParams()
  const { data } = useStore()
  const index = data!.days.findIndex((d) => d.dateKey === params.dateKey)
  if (index < 0) return <DroppedDay dateKey={String(params.dateKey)} backLabel={tr('Активность', 'Activity')} backText={tr('К активности', 'Back to activity')} />
  return <DayPager days={data!.days} index={index} Page={GuestDayPage} backLabel={tr('Активность', 'Activity')} />
}
