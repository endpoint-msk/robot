// Редактор ивента: что будет, когда, для кого + живое превью карточки.
// Вход двойной — «Создать ивент» на экране дня и заготовка из пересланного в личку
// поста канала (тогда поля уже заполнены, см. params.draft).

import { useState } from 'react'
import { action } from '../api'
import { fmtDayMonth, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { confirmDialog } from '../modals'
import { haptic } from '../telegram'
import { pop, useParams, useStore } from '../store'
import { initData } from '../telegram'
import type { SpaceEvent } from '../types'
import { BackRow, Header, SectionTitle, Switch } from '../components/common'
import { Screen } from '../components/Screen'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 2000
/** Шаг стрелок времени: получасовой, как в афишах («в 19:00», «в 19:30»). */
const STEP_MINUTES = 30

const stepTime = (time: string, deltaSteps: number): string => {
  const [h, m] = time.split(':')
  const total = (Number(h) || 0) * 60 + (Number(m) || 0) + deltaSteps * STEP_MINUTES
  // Заворачиваем по суткам, чтобы стрелки не упирались в 00:00 и 23:30.
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/** Афиша: у ивента — по его id, у заготовки — по ключу владельца. */
export function EventPoster({ photoId, className }: { photoId: string; className?: string }) {
  const src = `${location.origin}/event-photo.jpg?id=${encodeURIComponent(photoId)}&initData=${encodeURIComponent(initData())}`
  return <img className={className || 'event-poster'} src={src} alt="" />
}

export function Event() {
  const params = useParams()
  const { data } = useStore()
  const days = data!.days
  const existing = params.event as SpaceEvent | undefined
  // Заготовка из пересланного поста: текст уже вставлен, афиша лежит под ключом владельца.
  const draft = params.fromDraft ? data!.eventDraft || null : null

  const [title, setTitle] = useState(existing?.title ?? draft?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? draft?.description ?? '')
  // Экран дня открывает редактор уже на своём дне; из заготовки дня нет — берём ближайший.
  const [dateKey, setDateKey] = useState(existing?.dateKey ?? (params.dateKey as string | undefined) ?? days[0]!.dateKey)
  const [time, setTime] = useState(existing?.time ?? '19:00')
  const [residentsOnly, setResidentsOnly] = useState(existing?.residentsOnly ?? false)

  const photoId = existing?.hasPhoto ? existing.id : draft?.hasPhoto ? `draft-${data!.me.id}` : null
  const canSave = title.trim().length > 0

  const save = async (): Promise<void> => {
    if (!canSave) return
    const payload = { dateKey, time, title, description, residentsOnly }
    const done = existing
      ? await action('event.update', { id: existing.id, ...payload })
      : await action('event.create', { ...payload, fromDraft: Boolean(draft) })
    if (done) {
      haptic('success')
      pop()
    }
  }

  const remove = async (): Promise<void> => {
    if (!existing) return
    const ok = await confirmDialog(`Удалить ивент «${existing.title}»?`, {
      confirmLabel: 'Удалить',
      destructive: true,
    })
    if (!ok) return
    const done = await action('event.delete', { id: existing.id })
    if (done) {
      haptic('warning')
      pop()
    }
  }

  // Заготовку, от которой отказались, надо снять с сервера — иначе миниапп предложит
  // завести тот же ивент при следующем открытии.
  const dropDraft = async (): Promise<void> => {
    const ok = await confirmDialog('Не делать ивент из этого поста?', { confirmLabel: 'Не делать' })
    if (!ok) return
    const done = await action('event.draft.drop', {})
    if (done) pop()
  }

  return (
    <Screen>
      <BackRow label={params.backLabel || 'День'} />
      <Header
        title={existing ? 'Ивент' : 'Новый ивент'}
        subtitle={residentsOnly ? 'Увидят только резиденты' : 'Гости увидят его в «Активности»'}
      />

      <SectionTitle>Что будет</SectionTitle>
      <div className="card">
        <div className="ev-field">
          <input
            className="ev-title-input"
            placeholder="Название ивента"
            maxLength={MAX_TITLE}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="ev-field">
          <textarea
            className="ev-desc-input"
            placeholder="Описание: что будет, кому интересно, что взять с собой"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {photoId ? (
          <>
            <div className="sep" style={{ marginLeft: 14 }} />
            <div className="ev-poster-slot">
              <EventPoster photoId={photoId} />
            </div>
          </>
        ) : null}
      </div>

      <SectionTitle>Когда</SectionTitle>
      <div className="day-chips">
        {days.map((d) => (
          <button
            key={d.dateKey}
            className={'day-chip' + (d.dateKey === dateKey ? ' selected' : '')}
            onClick={() => setDateKey(d.dateKey)}
          >
            <span className="dc-dow">{WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]}</span>
            <span className="dc-num">{fmtDayMonth(d.dateKey).split(' ')[0]}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row">
          <span className="row-label">Начало в</span>
          <div className="row-right ev-time">
            <button className="ev-step" aria-label="Раньше" onClick={() => setTime(stepTime(time, -1))}>
              {icons.minus()}
            </button>
            <span className="ev-time-value">{time}</span>
            <button className="ev-step" aria-label="Позже" onClick={() => setTime(stepTime(time, 1))}>
              {icons.plusSmall()}
            </button>
          </div>
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="row">
          <span className="row-label">
            Только резидентам
            <span className="row-sublabel">Гости не увидят ивент в «Активности»</span>
          </span>
          <Switch on={residentsOnly} onToggle={() => setResidentsOnly(!residentsOnly)} />
        </div>
      </div>

      <SectionTitle>{`Превью · ${residentsOnly ? 'резиденты' : 'все'}`}</SectionTitle>
      <EventCard
        event={{
          id: existing?.id ?? 'preview',
          dateKey,
          time,
          title: title.trim() || 'Название ивента',
          description,
          residentsOnly,
          hasPhoto: Boolean(photoId),
          host: existing?.host ?? { userId: data!.me.id, username: data!.me.username, name: data!.me.name },
          createdAt: '',
        }}
        photoId={photoId}
        dimTitle={title.trim().length === 0}
      />

      {existing ? (
        <button className="destructive-btn" style={{ marginTop: 22 }} onClick={remove}>
          Удалить ивент
        </button>
      ) : null}
      {draft ? (
        <button className="secondary-btn" style={{ marginTop: 10 }} onClick={dropDraft}>
          Не делать ивент из поста
        </button>
      ) : null}
      <button className="primary-btn" style={{ marginTop: 22 }} disabled={!canSave} onClick={save}>
        {existing ? 'Сохранить' : 'Опубликовать'}
      </button>
    </Screen>
  )
}

/**
 * Карточка ивента — одна и та же в превью редактора и в «Активности»,
 * чтобы резидент видел ровно то, что увидят остальные.
 */
export function EventCard({
  event,
  photoId,
  dimTitle = false,
}: {
  event: SpaceEvent
  photoId?: string | null
  dimTitle?: boolean
}) {
  const poster = photoId ?? (event.hasPhoto ? event.id : null)
  return (
    <div className="event-card">
      <div className="ev-head">
        {icons.calendar(14, '#bf5af2')}
        <span className="ev-kicker">Ивент · в {event.time}</span>
        {event.residentsOnly ? <span className="ev-chip">только резидентам</span> : null}
      </div>
      <div className={'ev-title' + (dimTitle ? ' dim' : '')}>{event.title}</div>
      {event.description ? <div className="ev-desc">{event.description}</div> : null}
      {poster ? <EventPoster photoId={poster} className="ev-poster" /> : null}
      <div className="ev-host">
        <span>создал {event.host.username ? `@${event.host.username}` : event.host.name}</span>
      </div>
    </div>
  )
}
