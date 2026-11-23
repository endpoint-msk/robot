// Строка ивента в списке — одна и та же на экране дня и в списке «Позже».

import { tr } from '../i18n'
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { dayNum, monthIdx, monthsAbbr, weekdayIdx, weekdaysShort, yearOf } from '../dates'
import { icons } from '../icons'
import { eventPhotoUrl } from '../links'
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

/**
 * Афиша в значке строки. Это тот же адрес, что у афиши на экране ивента: файл остаётся
 * в кэше, и экран открывается уже с ней. Проявляется целиком, как сама афиша.
 */
function RowPoster({ photoId, onError }: { photoId: string; onError: () => void }) {
  const src = eventPhotoUrl(photoId)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth > 0) setLoading(false)
  }, [src])
  return (
    <img
      ref={ref}
      className={'ev-row-photo' + (loading ? ' loading' : '')}
      src={src}
      alt=""
      onLoad={() => setLoading(false)}
      onError={onError}
    />
  )
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
  // Не загрузилась афиша - значок остаётся рисованной афишей, а не пустым квадратом.
  const [broken, setBroken] = useState(false)
  const photo = broken ? undefined : (event.photos ?? [])[0]
  const host = event.host.username ? '@' + event.host.username : event.host.name
  return (
    <button type="button" className="row tappable" onClick={() => push('event', { event, ...(backLabel ? { backLabel } : {}) })}>
      {tile ? (
        <div className="ev-tile small" aria-hidden="true" style={toneVars(eventTone(event))}>
          <span>{monthsAbbr()[monthIdx(event.dateKey)]}</span>
          <b>{dayNum(event.dateKey)}</b>
        </div>
      ) : (
        <div className={'row-icon ev-row-icon' + (photo ? ' photo' : '')} aria-hidden="true" style={photo ? toneVars(eventTone(event)) : undefined}>
          {photo ? <RowPoster photoId={photo} onError={() => setBroken(true)} /> : null}
        </div>
      )}
      <div className="ev-row-main">
        <div className="ev-row-title-line">
          <span className="ev-row-title">{event.title}</span>
          {event.residentsOnly ? <span className="ev-chip">{tr('резидентам', 'residents only')}</span> : null}
        </div>
        <div className="ev-row-sub">{[dateLabel, tr(`в\u00a0${event.time}`, `at ${event.time}`), host].filter(Boolean).join(' · ')}</div>
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
  const label = (event: SpaceEvent): string => {
    const weekday = weekdaysShort()[weekdayIdx(event.dateKey)]!
    return tr(weekday.toLowerCase(), weekday) + (yearOf(event.dateKey) === thisYear ? '' : ` ${yearOf(event.dateKey)}`)
  }
  return (
    <>
      <SectionTitle>{tr('Позже', 'Later')}</SectionTitle>
      <div className="card">
        {events.map((event, i) => (
          <Fragment key={event.id}>
            {i > 0 ? <Sep inset="avatar" /> : null}
            <EventRow event={event} backLabel={backLabel} tile dateLabel={label(event)} />
          </Fragment>
        ))}
      </div>
    </>
  )
}
