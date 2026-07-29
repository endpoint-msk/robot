// Редактор ивента: что будет, когда, для кого + живое превью карточки.
// Вход двойной — «Создать ивент» на экране дня и заготовка из пересланного в личку
// поста канала (тогда поля уже заполнены, см. params.draft).

import { useState, type ChangeEvent } from 'react'
import { action, uploadEventPhoto } from '../api'
import { fmtDayMonth, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { compressImage } from '../image'
import { linkedText } from '../linkify'
import { confirmDialog, showAlert, showImage } from '../modals'
import { haptic, openUrl } from '../telegram'
import { pop, setBusy, useParams, useStore } from '../store'
import { initData } from '../telegram'
import type { SpaceEvent } from '../types'
import { BackRow, Header, SectionTitle, Switch } from '../components/common'
import { Screen } from '../components/Screen'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 2000
/** Столько же держит сервер (MAX_EVENT_PHOTOS): ивент — анонс, а не фотоальбом. */
const MAX_PHOTOS = 6
/** Шаг стрелок времени: получасовой, как в афишах («в 19:00», «в 19:30»). */
const STEP_MINUTES = 30

const stepTime = (time: string, deltaSteps: number): string => {
  const [h, m] = time.split(':')
  const total = (Number(h) || 0) * 60 + (Number(m) || 0) + deltaSteps * STEP_MINUTES
  // Заворачиваем по суткам, чтобы стрелки не упирались в 00:00 и 23:30.
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/**
 * Афиша: у ивента — по его id, у заготовки — по ключу владельца. Тап открывает её на
 * весь экран: в карточке картинка обрезана по `object-fit: cover`, и разглядеть на ней
 * что-то (адрес, схему, состав) иначе нельзя.
 */
export function EventPoster({ photoId, className }: { photoId: string; className?: string }) {
  const src = `${location.origin}/event-photo.jpg?id=${encodeURIComponent(photoId)}&initData=${encodeURIComponent(initData())}`
  return (
    <img
      className={className || 'event-poster'}
      src={src}
      alt=""
      onClick={(e) => {
        e.stopPropagation()
        showImage(src, 'Афиша ивента')
      }}
    />
  )
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

  // Афиши — список id файлов: у заготовки это её картинка, у нового ивента список
  // копится заливкой (файл лежит на сервере ничей, пока ивент не сохранён).
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? (draft?.hasPhoto ? [`draft-${data!.me.id}`] : []))
  const canSave = title.trim().length > 0

  const addPhotos = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(e.target.files ?? [])
    // Сбрасываем input сразу: иначе тот же файл вторым разом не выберется — значение не меняется.
    e.target.value = ''
    if (picked.length === 0) return
    const room = MAX_PHOTOS - photos.length
    setBusy(true)
    try {
      const added: string[] = []
      for (const file of picked.slice(0, room)) added.push(await uploadEventPhoto(await compressImage(file)))
      setPhotos((prev) => [...prev, ...added])
      haptic('success')
      if (picked.length > room) showAlert(`К ивенту можно приложить не больше ${MAX_PHOTOS} фото.`)
    } catch (err) {
      showAlert(err instanceof Error && err.message ? err.message : 'Не получилось загрузить фото.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!canSave) return
    const payload = { dateKey, time, title, description, residentsOnly, photos }
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
        <div className="sep" style={{ marginLeft: 14 }} />
        {/* Афиши: лента миниатюр, последняя плитка — «добавить». Порядок в ленте
            и есть порядок показа в карточке. */}
        <div className="ev-photos">
          {photos.map((id) => (
            <div className="ev-thumb" key={id}>
              <EventPoster photoId={id} className="ev-thumb-img" />
              <button
                className="ev-thumb-del"
                aria-label="Убрать фото"
                onClick={(e) => {
                  // Клик по крестику не должен ещё и открывать просмотр под ним.
                  e.stopPropagation()
                  setPhotos((prev) => prev.filter((p) => p !== id))
                }}
              >
                {icons.xmark(11, '#fff')}
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <label className="ev-thumb ev-thumb-add" title="Добавить фото">
              {icons.plusSmall()}
              <input type="file" accept="image/*" multiple onChange={addPhotos} />
            </label>
          ) : null}
        </div>
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
          photos,
          host: existing?.host ?? { userId: data!.me.id, username: data!.me.username, name: data!.me.name },
          createdAt: '',
        }}
        dimTitle={title.trim().length === 0}
      />

      {existing ? (
        <button className="destructive-btn" style={{ marginTop: 22 }} onClick={remove}>
          Удалить ивент
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
export function EventCard({ event, dimTitle = false }: { event: SpaceEvent; dimTitle?: boolean }) {
  const photos = event.photos ?? []
  return (
    <div className="event-card">
      <div className="ev-head">
        {icons.calendar(14, '#bf5af2')}
        <span className="ev-kicker">Ивент · в {event.time}</span>
        {event.residentsOnly ? <span className="ev-chip">только резидентам</span> : null}
      </div>
      <div className={'ev-title' + (dimTitle ? ' dim' : '')}>{event.title}</div>
      {/* Описание часто приезжает из поста канала — там ссылки на регистрацию и подробности. */}
      {event.description ? <div className="ev-desc">{linkedText(event.description)}</div> : null}
      {/* Одна афиша — просто картинка, несколько — лента с прокруткой по снапу:
          карусель со стрелками в вебвью только мешает жестам. */}
      {photos.length === 1 ? <EventPoster photoId={photos[0]!} className="ev-poster" /> : null}
      {photos.length > 1 ? (
        <div className="ev-gallery">
          {photos.map((id) => (
            <EventPoster key={id} photoId={id} className="ev-poster ev-gallery-item" />
          ))}
        </div>
      ) : null}
      {/* Ивент из пересланного поста: в канале лежит полный анонс — с версткой и обсуждением. */}
      {event.sourceUrl ? (
        <button className="ev-source" onClick={() => openUrl(event.sourceUrl!)}>
          {icons.external('#bf5af2')}
          Пост в канале
        </button>
      ) : null}
      <div className="ev-host">
        <span>создал {event.host.username ? `@${event.host.username}` : event.host.name}</span>
      </div>
    </div>
  )
}
