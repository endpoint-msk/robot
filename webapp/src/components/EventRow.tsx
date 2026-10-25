// Строка ивента в списке — одна и та же на экране дня и в списке «Позже».

import { Fragment, type CSSProperties } from 'react'
import { dayNum, monthIdx, MONTHS_ABBR, weekdayIdx, WEEKDAYS_SHORT, yearOf } from '../dates'
import { icons } from '../icons'
import { toneColors } from '../motion'
import { push, useStore } from '../store'
import type { SpaceEvent } from '../types'
import { SectionTitle, Sep } from './common'

/** Тон ивента: рисованная афиша без фото остаётся в своей фиолетовой палитре. */
export const eventTone = (event: SpaceEvent): string | null =>
  (event.photos ?? []).length > 0 ? event.tone ?? null : null

/**
 * Тон афиши переменными CSS на корень экрана, карточки или плитки, где app.css берёт их
 * с откатом на фиолетовый. Значения посчитаны под текущую тему, на её смене их обновляет
 * перерисовка. Строка дня и листалка дня тон не берут: рыжий рядом с оранжевым
 * закрытого дня читался бы как статус.
 */
export const toneVars = (tone: string | null): CSSProperties | undefined => {
  if (!tone) return undefined
  const c = toneColors(tone)
  return {
    '--ev-tone': tone,
    '--ev-band': c.band,
    '--ev-accent': c.ink,
    '--ev-soft': c.soft,
    '--ev-soft-accent': c.softInk,
  } as CSSProperties
}

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
    <button type="button" className="row tappable" onClick={() => push('event', { event, ...(backLabel ? { backLabel } : {}) })}>
      {tile ? (
        <div className="ev-tile small" aria-hidden="true" style={toneVars(eventTone(event))}>
          <span>{MONTHS_ABBR[monthIdx(event.dateKey)]}</span>
          <b>{dayNum(event.dateKey)}</b>
        </div>
      ) : (
        <div className="row-icon ev-row-icon">
          {icons.calendar(17, '#bf5af2')}
        </div>
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
  const label = (event: SpaceEvent): string =>
    WEEKDAYS_SHORT[weekdayIdx(event.dateKey)]!.toLowerCase() + (yearOf(event.dateKey) === thisYear ? '' : ` ${yearOf(event.dateKey)}`)
  return (
    <>
      <SectionTitle>Позже</SectionTitle>
      <div className="card">
        {events.map((event, i) => (
          <Fragment key={event.id}>
            {i > 0 ? <Sep left={64} /> : null}
            <EventRow event={event} backLabel={backLabel} tile dateLabel={label(event)} />
          </Fragment>
        ))}
      </div>
    </>
  )
}
