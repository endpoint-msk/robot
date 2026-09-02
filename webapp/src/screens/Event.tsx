// Редактор ивента: что будет, когда, для кого + живое превью карточки.
// Вход двойной — «Создать ивент» на экране дня и заготовка из пересланного в личку
// поста канала (тогда поля уже заполнены, см. params.draft).

import { useState, type ChangeEvent } from 'react'
import { action, uploadEventPhoto } from '../api'
import { addDays, fmtDayMonth, fmtShortDate, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { compressImage } from '../image'
import { linkedText } from '../linkify'
import { confirmDialog, showAlert, showImage } from '../modals'
import { haptic, initData, openUrl, tg } from '../telegram'
import { pop, setBusy, useParams, useStore } from '../store'
import type { SpaceEvent } from '../types'
import { BackRow, Footnote, Header, SectionTitle, Switch } from '../components/common'
import { DateField } from '../components/DateField'
import { defaultTimeFor, isPastForToday } from '../components/forms'
import { Screen } from '../components/Screen'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 2000
/** Столько же держит сервер (MAX_EVENT_PHOTOS): ивент — анонс, а не фотоальбом. */
const MAX_PHOTOS = 6
/** Столько же держит сервер (EVENT_DAYS_AHEAD): дальше даты не выставить. */
const MAX_DAYS_AHEAD = 365
/** Шаг стрелок времени: получасовой, как в афишах («в 19:00», «в 19:30»). */
const STEP_MINUTES = 30
/** Последний слот суток: заворачивать стрелку через полночь нельзя — это сменило бы день. */
const LAST_SLOT_MINUTES = 23 * 60 + 30

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':')
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

const fromMinutes = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

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

  // Экран дня открывает редактор уже на своём дне; из заготовки дня нет — берём ближайший.
  const initialDay = existing?.dateKey ?? (params.dateKey as string | undefined) ?? days[0]!.dateKey

  const [title, setTitle] = useState(existing?.title ?? draft?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? draft?.description ?? '')
  const [dateKey, setDateKey] = useState(initialDay)
  // Фиксированные «19:00» на сегодня к восьми вечера уже прошли — стартуем с ближайшего
  // слота, как форма заявки (defaultTimeFor).
  const [time, setTime] = useState(existing?.time ?? defaultTimeFor(initialDay))
  const [residentsOnly, setResidentsOnly] = useState(existing?.residentsOnly ?? false)

  // Афиши — список id файлов: у заготовки это её картинка, у нового ивента список
  // копится заливкой (файл лежит на сервере ничей, пока ивент не сохранён).
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? (draft?.hasPhoto ? [`draft-${data!.me.id}`] : []))
  const canSave = title.trim().length > 0

  // Правку и удаление сервер отдаёт автору либо деву (canEditEvent) — чужой ивент
  // открывается на чтение, иначе резидент правил бы его до отказа сервера.
  if (existing && existing.host.userId !== data!.me.id && !data!.me.isDev) {
    return (
      <Screen>
        <BackRow label={params.backLabel || 'День'} />
        <Header
          title={existing.title}
          subtitle={`${fmtShortDate(existing.dateKey)} · в ${existing.time}`}
        />
        <EventCard event={existing} calendar />
        <Footnote>Править ивент может только тот, кто его создал.</Footnote>
      </Screen>
    )
  }

  // Прошедший слот запрещаем только новому ивенту: идущий всё ещё нужно уметь поправить
  // (сервер думает так же, см. canEditEvent).
  const guardPast = !existing
  const pastSlot = isPastForToday(dateKey, time)

  const selectDay = (next: string): void => {
    setDateKey(next)
    // Переключились на сегодня, а выбранное время уже прошло — подтягиваем ближайшее.
    if (guardPast && isPastForToday(next, time)) setTime(defaultTimeFor(next))
  }

  const canStep = (deltaSteps: number): boolean => {
    const next = toMinutes(time) + deltaSteps * STEP_MINUTES
    if (next < 0 || next > LAST_SLOT_MINUTES) return false
    return !guardPast || !isPastForToday(dateKey, fromMinutes(next))
  }

  const step = (deltaSteps: number): void => {
    if (canStep(deltaSteps)) setTime(fromMinutes(toMinutes(time) + deltaSteps * STEP_MINUTES))
  }

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
      confirmLabel: 'Удалить ивент',
      cancelLabel: 'Оставить',
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
              <input type="file" accept="image/*" multiple aria-label="Добавить фото" onChange={addPhotos} />
            </label>
          ) : null}
        </div>
      </div>

      <SectionTitle>Когда</SectionTitle>
      {/* Чипы — быстрый выбор ближайшей недели, всё остальное берётся в календаре
          строкой ниже. Дальний день не подсвечивает ни один чип: дату видно в строке. */}
      <div className="day-chips">
        {days.map((d) => (
          <button
            key={d.dateKey}
            className={'day-chip' + (d.dateKey === dateKey ? ' selected' : '')}
            onClick={() => selectDay(d.dateKey)}
          >
            <span className="dc-dow">{WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]}</span>
            <span className="dc-num">{fmtDayMonth(d.dateKey).split(' ')[0]}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row">
          <span className="row-label">Дата</span>
          <div className="row-right">
            <DateField
              value={dateKey}
              min={data!.todayKey}
              max={addDays(data!.todayKey, MAX_DAYS_AHEAD - 1)}
              onChange={selectDay}
            />
          </div>
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="row">
          <span className="row-label">Начало в</span>
          <div className="row-right ev-time">
            <button className="ev-step" aria-label="Раньше" disabled={!canStep(-1)} onClick={() => step(-1)}>
              {icons.minus()}
            </button>
            <span className="ev-time-value">{time}</span>
            <button className="ev-step" aria-label="Позже" disabled={!canStep(1)} onClick={() => step(1)}>
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
          <Switch on={residentsOnly} onToggle={() => setResidentsOnly(!residentsOnly)} label="Только резидентам" />
        </div>
      </div>
      {guardPast && dateKey === data!.todayKey ? (
        <Footnote>{`Сегодня ивент можно поставить не раньше ${data!.nowTime}: анонсировать то, что уже началось, некому.`}</Footnote>
      ) : null}
      {/* Дальний ивент никуда не пропадает, но живёт до своей недели отдельным списком:
          доска и дни показывают только ближайшие семь дней. */}
      {!days.some((d) => d.dateKey === dateKey) ? (
        <Footnote>
          Эта дата дальше ближайшей недели: до неё ивент будет виден в разделе «Позже», а на доску в чате и в дни
          обзора выйдет за неделю до начала.
        </Footnote>
      ) : null}

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
      <button
        className="primary-btn"
        style={{ marginTop: 22 }}
        disabled={!canSave || (guardPast && pastSlot)}
        onClick={save}
      >
        {existing ? 'Сохранить' : 'Опубликовать'}
      </button>
    </Screen>
  )
}

/**
 * Карточка ивента — одна и та же в превью редактора и в «Активности»,
 * чтобы резидент видел ровно то, что увидят остальные.
 */
/**
 * Карточка ивента.
 *
 * `calendar` - показать «В календарь». В превью редактора её нет: там ивента ещё не
 * существует, и ссылка вела бы в никуда.
 */
export function EventCard({
  event,
  dimTitle = false,
  calendar = false,
}: {
  event: SpaceEvent
  dimTitle?: boolean
  calendar?: boolean
}) {
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
      {/* .ics отдаёт сервер (GET /event.ics) - та же подписанная ссылка, что у визита. */}
      {calendar ? (
        <button
          className="ev-source"
          onClick={() => {
            const url =
              `${location.origin}/event.ics?id=${encodeURIComponent(event.id)}` +
              `&initData=${encodeURIComponent(initData())}`
            try {
              tg!.openLink(url)
            } catch {
              window.open(url, '_blank')
            }
          }}
        >
          {icons.calendarPlus(15, '#bf5af2')}
          В календарь
        </button>
      ) : null}
      <div className="ev-host">
        <span>создал {event.host.username ? `@${event.host.username}` : event.host.name}</span>
      </div>
    </div>
  )
}
