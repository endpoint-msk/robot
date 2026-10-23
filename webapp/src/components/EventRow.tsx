// Строка ивента в списке — одна и та же на экране дня и в списке «Позже».

import { Fragment } from 'react'
import { dayNum, monthIdx, MONTHS_ABBR, weekdayIdx, WEEKDAYS_SHORT, yearOf } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import type { SpaceEvent } from '../types'
import { SectionTitle, Sep } from './common'

export function EventRow({
  event,
  backLabel,
  dateLabel,
  tile = false,
}: {
  event: SpaceEvent
  backLabel?: string
  /** День перед временем: нужен там, где строки идут вперемешку по разным дням. */
  dateLabel?: string
  /** Плитка с датой вместо значка: дальние ивенты различаются с одного взгляда. */
  tile?: boolean
}) {
  const host = event.host.username ? '@' + event.host.username : event.host.name
  return (
    <button
      type="button"
      className="row tappable"
      onClick={() => push('event', { event, ...(backLabel ? { backLabel } : {}) })}
    >
      {tile ? (
        <div className="ev-tile small" aria-hidden="true">
          <span>{MONTHS_ABBR[monthIdx(event.dateKey)]}</span>
          <b>{dayNum(event.dateKey)}</b>
        </div>
      ) : (
        <div className="row-icon ev-row-icon">{icons.calendar(17, '#bf5af2')}</div>
      )}
      <div className="ev-row-main">
        <div className="ev-row-title-line">
          <span className="ev-row-title">{event.title}</span>
          {event.residentsOnly ? <span className="ev-chip">резидентам</span> : null}
        </div>
        <div className="ev-row-sub">{[dateLabel, `в\u00a0${event.time}`, host].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="row-right">{icons.chevron()}</div>
    </button>
  )
}

/**
 * Ивенты дальше окна обзора. Своя секция нужна потому, что дни на экранах — это
 * ближайшая неделя: анонс, поставленный на месяц вперёд, иначе негде было бы увидеть
 * и некому поправить. Пусто — секции нет вовсе.
 */
export function LaterEvents({ backLabel }: { backLabel: string }) {
  const { data } = useStore()
  const events = data!.laterEvents ?? []
  if (events.length === 0) return null
  const thisYear = yearOf(data!.todayKey)
  return (
    <>
      <SectionTitle>Позже</SectionTitle>
      <div className="card">
        {events.map((event, i) => (
          <Fragment key={event.id}>
            {i > 0 ? <Sep left={64} /> : null}
            <EventRow
              event={event}
              backLabel={backLabel}
              tile
              dateLabel={
                WEEKDAYS_SHORT[weekdayIdx(event.dateKey)]!.toLowerCase() +
                (yearOf(event.dateKey) === thisYear ? '' : ` ${yearOf(event.dateKey)}`)
              }
            />
          </Fragment>
        ))}
      </div>
    </>
  )
}
