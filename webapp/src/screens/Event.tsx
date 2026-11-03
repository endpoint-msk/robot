// Ивент. Автор и дев правят его на нём самом: тот же вид, что увидят все, поля на месте
// текста. Остальным он на чтение (EventView). Вход в создание двойной: «Создать ивент» на
// экране дня и заготовка из пересланного в личку поста канала (тогда поля уже заполнены,
// см. params.draft).

import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { action, uploadEventPhoto } from '../api'
import { addDays, dayNum, fmtDayMonth, keyToDate, monthIdx, MONTHS_ABBR, plural, weekdayIdx, WEEKDAYS_FULL, WEEKDAYS_SHORT } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { NEW_EVENT_DRAFT, useDraft, type EventDraft } from '../drafts'
import { compressImage, imageToneAt } from '../image'
import { linkedText } from '../linkify'
import { confirmDialog, showAlert, showImage } from '../modals'
import { eventPhotoUrl, useIcsLink } from '../links'
import { E, growField, markOwnTap, reducedMotion, stageTint, toHex, toneColors } from '../motion'
import { afterHero } from '../hero'
import { UnderContext } from '../screenContext'
import { usePullDismiss } from '../components/usePullDismiss'
import { haptic, openUrl, setClosingConfirmation, setHeaderColor } from '../telegram'
import { getState, pop, push, setBusy, startNewRequest, useParams, useStore } from '../store'
import { applyTheme } from '../theme'
import type { Attendee, ReviewerScope, SpaceEvent, User } from '../types'
import { BackRow, Sep, SwitchRow } from '../components/common'
import { Collapse } from '../components/Collapse'
import { Crossfade } from '../components/Crossfade'
import { DateField } from '../components/DateField'
import { eventTone, toneVars } from '../components/EventRow'
import { FormBuilder, emptyForm, type BuilderForm } from '../components/FormBuilder'
import { ResponsibleSheet } from '../components/ResponsiblePicker'
import { ShareButton, ShareIconButton } from '../components/ShareButton'
import { defaultTimeFor, isPastForToday } from '../components/forms'
import { Avatar, Profile, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { TimeWheels, Unfold } from '../components/TimeField'
import { useReorder } from '../components/useReorder'
import { useDropImages, usePasteImages } from '../usePasteImages'
import { ComingNames, ComingRow, useAttend } from './Day'

const MAX_TITLE = 120
/** Столько же держит сервер (MAX_EVENT_DESCRIPTION): длина сообщения в Telegram. */
const MAX_DESCRIPTION = 4096
/** Столько же держит сервер (MAX_EVENT_PHOTOS): ивент — анонс, а не фотоальбом. */
const MAX_PHOTOS = 6
/** Столько же держит сервер (EVENT_DAYS_AHEAD): дальше даты не выставить. */
const MAX_DAYS_AHEAD = 365

/**
 * Афиша: у ивента — по его id, у заготовки — по ключу владельца. Тап открывает её на
 * весь экран: в карточке картинка обрезана по `object-fit: cover`, и разглядеть на ней
 * что-то (адрес, схему, состав) иначе нельзя.
 */
export function EventPoster({ photoId, className }: { photoId: string; className?: string }) {
  const src = eventPhotoUrl(photoId)
  // Пока снимок грузится, его не видно: рамка залита тоном афиши, а снимок потом
  // проявляется целиком (app.css, .evv-photo.loading), а не прорисовывается полосами.
  // Уже лежащий в кэше встаёт сразу, без проявления.
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth > 0) setLoading(false)
  }, [src])
  return (
    <img
      ref={ref}
      className={(className || 'event-poster') + (loading ? ' loading' : '')}
      src={src}
      alt=""
      onLoad={() => setLoading(false)}
      onClick={(e) => {
        e.stopPropagation()
        showImage(src, 'Афиша ивента')
      }}
    />
  )
}

export function Event() {
  const params = useParams()
  const { data, perspective } = useStore()
  const days = data!.days
  // Перспектива гостя (в т.ч. дев-превью) должна вести себя как гость: гостевая карточка
  // с подачей заявки, а не редактор — даже если человек на самом деле автор/дев.
  const asGuest = perspective === 'guest'
  // Ивент в параметрах - снимок на момент перехода. Своя заявка на экране глубже меняет
  // его в данных, и на «назад» экран берёт свежий, иначе показывал бы прошлое состояние.
  const passed = params.event as SpaceEvent | undefined
  const existing = passed
    ? ([...days.flatMap((d) => d.events), ...(data!.laterEvents ?? [])].find((e) => e.id === passed.id) ?? passed)
    : undefined
  // Заготовка из пересланного поста: текст уже вставлен, афиша лежит под ключом владельца.
  const draft = params.fromDraft ? data!.eventDraft || null : null

  // Экран дня открывает редактор уже на своём дне; из заготовки дня нет — берём ближайший.
  const initialDay = existing?.dateKey ?? (params.dateKey as string | undefined) ?? days[0]!.dateKey

  const [title, setTitle] = useState(existing?.title ?? draft?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? draft?.description ?? '')
  const descRef = useRef<HTMLTextAreaElement>(null)
  const [dateKey, setDateKey] = useState(initialDay)
  // Фиксированные «19:00» на сегодня к восьми вечера уже прошли — стартуем с ближайшего
  // слота, как форма заявки (defaultTimeFor).
  const [time, setTime] = useState(existing?.time ?? defaultTimeFor(initialDay))
  const [residentsOnly, setResidentsOnly] = useState(existing?.residentsOnly ?? false)

  // Ответственные — резиденты или гости; храним полными объектами (нужны для превью),
  // на сервер уходят id. Пикер разворачиваем по кнопке, чтобы не дёргать список на каждый вход.
  const [responsibles, setResponsibles] = useState<User[]>(existing?.responsibles ?? [])
  const [pickOpen, setPickOpen] = useState(false)

  // Форма-заявка: включена, если у ивента она уже есть. reviewers приходит только автору
  // (canReview), поэтому для чужого ивента редактор всё равно недоступен.
  const [formOn, setFormOn] = useState<boolean>(Boolean(existing?.form))
  const [form, setForm] = useState<BuilderForm>(
    existing?.form
      ? { fields: existing.form.fields, reviewers: (existing.form.reviewers as ReviewerScope | undefined) ?? { kind: 'all' } }
      : emptyForm(),
  )

  // Афиши — список id файлов: у заготовки это её картинка, у нового ивента список
  // копится заливкой (файл лежит на сервере ничей, пока ивент не сохранён).
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? (draft?.hasPhoto ? [`draft-${data!.me.id}`] : []))
  // Афиши, добавленные здесь (выбором, вставкой или брошенным файлом): они проявляются, а
  // не встают рывком. Сохранённые раньше стоят на месте с первого кадра.
  const fresh = useRef(new Set<string>())
  const canSave = title.trim().length > 0

  // Тон каждой афиши, которую редактор уже знает: null - насыщенного оттенка нет, нет
  // ключа - ещё не считали. Залитые здесь приносят тон из compressImage, остальные
  // (заготовка из канала, сохранённые раньше) считаются по картинке с сервера.
  const [tones, setTones] = useState<Record<string, string | null>>(() => {
    const head = existing?.photos?.[0]
    return head && existing?.tone ? { [head]: existing.tone } : {}
  })
  const toneLoads = useRef(new Map<string, Promise<string | null>>())
  const toneOf = (id: string): Promise<string | null> => {
    let load = toneLoads.current.get(id)
    if (!load) {
      load = imageToneAt(eventPhotoUrl(id))
      toneLoads.current.set(id, load)
    }
    return load
  }
  const first = photos[0]
  const firstTone = first ? tones[first] : null

  const addFiles = async (picked: File[]): Promise<void> => {
    if (picked.length === 0) return
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) {
      showAlert(`К ивенту можно приложить не больше ${MAX_PHOTOS} фото.`)
      return
    }
    setBusy(true)
    try {
      const added: string[] = []
      const found: Record<string, string | null> = {}
      for (const file of picked.slice(0, room)) {
        const { blob, tone } = await compressImage(file)
        const id = await uploadEventPhoto(blob)
        added.push(id)
        found[id] = tone
      }
      setTones((prev) => ({ ...prev, ...found }))
      for (const id of added) fresh.current.add(id)
      markOwnTap()
      setPhotos((prev) => [...prev, ...added])
      haptic.notify('success')
      if (picked.length > room) showAlert(`К ивенту можно приложить не больше ${MAX_PHOTOS} фото.`)
    } catch (err) {
      showAlert(err instanceof Error && err.message ? err.message : 'Не получилось загрузить фото.')
    } finally {
      setBusy(false)
    }
  }

  // Правку и удаление сервер отдаёт автору либо деву (canEditEvent) — чужой ивент
  // открывается на чтение, иначе резидент правил бы его до отказа сервера.
  const readOnly = Boolean(existing) && (asGuest || (existing!.host.userId !== data!.me.id && !data!.me.isDev))
  // Вставка картинок из буфера (Ctrl/Cmd+V) и брошенный файл на десктопе; в режиме чтения
  // не нужны.
  usePasteImages(addFiles, !readOnly)
  const dropping = useDropImages(addFiles, !readOnly)
  const stripRef = useRef<HTMLDivElement>(null)
  useReorder(stripRef, photos, (next) => {
    markOwnTap()
    setPhotos(next)
  })

  // Недописанный новый ивент переживает закрытие миниаппа, как черновик в Telegram. У правки
  // опубликованного черновика нет: несохранённое выглядело бы сохранённым. У заготовки из
  // пересланного поста черновик свой, серверный. Афиши в него не идут: несохранённая
  // картинка живёт на сервере час (STAGED_TTL_MS).
  const eventDraft = useDraft<EventDraft>(
    readOnly || draft || existing ? null : NEW_EVENT_DRAFT,
    { title, description, dateKey, time, residentsOnly },
    {
      isEmpty: (d) => !d.title.trim() && !d.description.trim(),
      restore: (d) => {
        // День черновика мог пройти, а время сегодняшнего дня уже наступить.
        const day = d.dateKey >= data!.todayKey ? d.dateKey : initialDay
        setTitle(d.title)
        setDescription(d.description)
        setDateKey(day)
        setTime(isPastForToday(day, d.time) ? defaultTimeFor(day) : d.time)
        setResidentsOnly(d.residentsOnly)
      },
    },
  )

  // Первой стоит афиша без известного тона: заготовка из канала, ивент до тонов или
  // первую фото убрали. Считаем по картинке, превью перекрасится, когда он будет.
  useEffect(() => {
    if (readOnly || !first || firstTone !== undefined) return
    void (async () => {
      const tone = await toneOf(first)
      setTones((prev) => ({ ...prev, [first]: tone }))
    })()
  }, [readOnly, first, firstTone])

  // Поле описания растёт по тексту: заготовка из канала приносит весь пост, и в окне на
  // пять строк с прокруткой внутри он выглядел обрезанным. Плавно только за набором:
  // текст заготовки или черновика встаёт сразу.
  const descTyped = useRef(false)
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    growField(el, { still: !descTyped.current })
    descTyped.current = false
  }, [description, readOnly])

  // Несохранённая правка опубликованного ивента: «Сохранить» горит только при ней, и
  // Telegram переспрашивает перед закрытием. Новому ивенту хватает черновика.
  const snapshot = JSON.stringify([
    title,
    description,
    dateKey,
    time,
    residentsOnly,
    photos,
    responsibles.map((u) => u.userId),
    formOn ? form : null,
  ])
  const [baseline] = useState(snapshot)
  const dirty = snapshot !== baseline
  const confirmClose = !readOnly && Boolean(existing) && dirty
  useEffect(() => {
    setClosingConfirmation(confirmClose)
  }, [confirmClose])
  useEffect(() => () => setClosingConfirmation(false), [])

  // Шапка Telegram в тон полосы, как на виде ивента; на выходе возвращаем тему.
  const tone = first ? (firstTone ?? null) : null
  const header = tone ? toneColors(tone).band : toHex(stageTint('purple'))
  useEffect(() => {
    if (!readOnly) afterHero(() => setHeaderColor(header))
  }, [header, readOnly])
  useEffect(
    () => () => {
      if (!readOnly) afterHero(() => applyTheme(getState().theme))
    },
    [readOnly],
  )

  const [whenOpen, setWhenOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = titleRef.current
    if (el) growField(el, { still: true })
  }, [title, readOnly])

  if (readOnly) return <EventView event={existing!} asGuest={asGuest} />

  // Прошедший слот запрещаем только новому ивенту: идущий всё ещё нужно уметь поправить
  // (сервер думает так же, см. canEditEvent).
  const guardPast = !existing
  const pastSlot = isPastForToday(dateKey, time)

  const selectDay = (next: string): void => {
    setDateKey(next)
    // Переключились на сегодня, а выбранное время уже прошло — подтягиваем ближайшее.
    if (guardPast && isPastForToday(next, time)) setTime(defaultTimeFor(next))
  }

  const addPhotos = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(e.target.files ?? [])
    // Сбрасываем input сразу: иначе тот же файл вторым разом не выберется — значение не меняется.
    e.target.value = ''
    void addFiles(picked)
  }
  const pickPhotos = (): void => fileRef.current?.click()

  const save = async (): Promise<void> => {
    if (!canSave) return
    // Тон уходит от первой афиши. Заготовку публикуют и сразу, раньше, чем он досчитался:
    // тогда ждём его, иначе ивент ушёл бы фиолетовым.
    let tone = firstTone ?? null
    if (first && firstTone === undefined) {
      setBusy(true)
      try {
        tone = await toneOf(first)
      } finally {
        setBusy(false)
      }
    }
    // Сервер сам нормализует форму (обрежет пустые блоки/варианты; пустая → null).
    const payload = {
      dateKey,
      time,
      title,
      description,
      residentsOnly,
      photos,
      tone,
      form: formOn ? form : null,
      responsibles: responsibles.map((u) => u.userId),
    }
    const done = existing
      ? await action('event.update', { id: existing.id, ...payload })
      : await action('event.create', { ...payload, fromDraft: Boolean(draft) })
    if (done) {
      eventDraft.clear()
      setClosingConfirmation(false)
      haptic.notify('success')
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
    if (done) pop()
  }

  const host = existing?.host ?? { userId: data!.me.id, username: data!.me.username, name: data!.me.name }
  const tv = toneVars(tone)

  // Экран тот же, что увидят все (EventView): название набирается на афише её кеглем,
  // описание в карточке ведущего, строка даты раскрывает календарь и колесо. Ниже одной
  // карточкой то, чего на виде нет. Превью не нужно: экран и есть превью.
  return (
    <Screen>
      <div className="evv evv-edit">
        <div className="evv-top" style={tv}>
          <div className="evv-band" aria-hidden="true" />
          <BackRow />
          {/* Без фото касание афиши вне названия выбирает фото; с фото оно открывает
              снимок, а выбирает «Афиша» в углу. */}
          <div
            className={'evv-poster' + (photos.length > 0 ? ' photo' : '') + (dropping ? ' drop-on' : '')}
            onClick={(e) => {
              if (photos.length > 0 || e.target === titleRef.current) return
              pickPhotos()
            }}
          >
            {first ? <EventPoster photoId={first} className="evv-photo" /> : null}
            <textarea
              ref={titleRef}
              className="evv-pt evv-pt-in"
              rows={1}
              placeholder="Название"
              aria-label="Название ивента"
              maxLength={MAX_TITLE}
              enterKeyHint="next"
              value={title}
              onChange={(e) => {
                const raw = e.target.value
                // Название одной строкой смысла: перенос («Далее» на клавиатуре Android
                // приходит им же) уводит в описание.
                if (raw.includes('\n')) {
                  setTitle(raw.replace(/\s*\n\s*/g, ' ').trimEnd())
                  descRef.current?.focus()
                  return
                }
                setTitle(raw)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  descRef.current?.focus()
                }
              }}
            />
            <div className="evv-ps">{posterWhen(dateKey, time)}</div>
            {photos.length < MAX_PHOTOS ? (
              <button
                type="button"
                className="evv-addph"
                onClick={(e) => {
                  e.stopPropagation()
                  pickPhotos()
                }}
              >
                {icons.camera(15, 'currentColor')}
                Афиша
              </button>
            ) : null}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Добавить фото" onChange={addPhotos} />
          </div>
          <button
            type="button"
            className="evv-when tappable"
            aria-expanded={whenOpen}
            onClick={() => {
              haptic.impact('light')
              setWhenOpen(!whenOpen)
            }}
          >
            <DateTile dateKey={dateKey} />
            <div className="evv-when-text">
              <div className="evv-wt">
                {`${WEEKDAYS_FULL[weekdayIdx(dateKey)]}, ${fmtDayMonth(dateKey)}`}
                {residentsOnly ? <span className="ev-chip">только резидентам</span> : null}
              </div>
              <div className="evv-ws">{`в ${time} · ${untilWord(data!.todayKey, dateKey)}`}</div>
            </div>
            <span className={'evv-when-chev' + (whenOpen ? ' open' : '')}>{icons.chevron()}</span>
          </button>
          <Unfold open={whenOpen}>
            <div className="card evv-when-card">
              <div className="row time-row">
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
              <Sep inset="text" />
              {/* Новому ивенту на сегодня прошедшее недоступно, идущий правится свободно. */}
              <TimeWheels
                value={time}
                min={guardPast && dateKey === data!.todayKey ? data!.nowTime || '00:00' : undefined}
                onChange={setTime}
              />
            </div>
          </Unfold>
        </div>

        {/* Афиши лентой: порядок в ней и есть порядок показа, первая встаёт на афишу. */}
        <Collapse open={photos.length > 0} ms={320} ease={E.crisp}>
          <div className="card evv-strip">
            <div className={'ev-photos' + (dropping ? ' drop-on' : '')} ref={stripRef}>
              {photos.map((id) => (
                <div
                  className={'ev-thumb' + (fresh.current.has(id) ? ' fresh' : '')}
                  key={id}
                  data-photo={id}
                  onAnimationEnd={(e) => {
                    // Проявилась: перестановка двигает узел, и анимация запустилась бы заново.
                    if (e.target !== e.currentTarget) return
                    fresh.current.delete(id)
                    e.currentTarget.classList.remove('fresh')
                  }}
                >
                  <EventPoster photoId={id} className="ev-thumb-img" />
                  <button
                    className="ev-thumb-del"
                    aria-label="Убрать фото"
                    onClick={(e) => {
                      // Клик по крестику не должен ещё и открывать просмотр под ним.
                      e.stopPropagation()
                      markOwnTap()
                      setPhotos((prev) => prev.filter((p) => p !== id))
                    }}
                  >
                    {icons.xmark(11, '#fff')}
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <button type="button" className="ev-thumb ev-thumb-add" title="Добавить фото" aria-label="Добавить фото" onClick={pickPhotos}>
                  {icons.plusSmall()}
                </button>
              ) : null}
            </div>
          </div>
        </Collapse>

        <div className="card evv-card">
          <div className="row">
            <Avatar user={host} className="req-avatar" />
            <span className="row-label">
              {host.name}
              <span className="row-sublabel">{(host.username ? '@' + host.username + ' · ' : '') + 'ведёт'}</span>
            </span>
          </div>
          <Sep inset="text" />
          <textarea
            ref={descRef}
            className="evv-desc evv-desc-in"
            placeholder="Что будет, кому интересно, что взять с собой"
            aria-label="Описание"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => {
              descTyped.current = true
              setDescription(e.target.value)
            }}
          />
        </div>

        {existing?.canReview && existing.form ? (
          <button className="card row tappable evv-apps" onClick={() => push('eventApps', { event: existing, backLabel: 'Ивент' })}>
            <span className="row-label">Разобрать заявки</span>
            <div className="row-right">
              {existing.applicationsPending ? <span className="ev-count">{existing.applicationsPending}</span> : null}
              {icons.chevron()}
            </div>
          </button>
        ) : null}
        <div className="card ctl-card evv-set">
          <SwitchRow
            on={residentsOnly}
            onToggle={() => setResidentsOnly(!residentsOnly)}
            label="Только резидентам"
            sub="Гости не увидят ивент в «Активности»"
          />
          <Sep inset="text" />
          <button type="button" className="row tappable" onClick={() => setPickOpen(true)}>
            <span className="row-label">
              Ответственные
              <span className="row-sublabel">
                {responsibles.length
                  ? responsibles.map((u) => (u.username ? '@' + u.username : u.name)).join(', ')
                  : 'Резиденты или гости — видят только резиденты'}
              </span>
            </span>
            <div className="row-right">{icons.chevron()}</div>
          </button>
          <Sep inset="text" />
          <SwitchRow
            on={formOn}
            onToggle={() => setFormOn(!formOn)}
            label="Принимать заявки по форме"
            sub="Гость попадёт на ивент только через заявку"
          />
        </div>
        {pickOpen ? (
          <ResponsibleSheet selected={responsibles} onChange={setResponsibles} onClose={() => setPickOpen(false)} />
        ) : null}
        {formOn ? <FormBuilder value={form} onChange={setForm} /> : null}

        {existing ? (
          <button className="destructive-btn" style={{ marginTop: 22 }} onClick={remove}>
            Удалить ивент
          </button>
        ) : null}
        <button
          className="primary-btn"
          style={{ marginTop: 16 }}
          disabled={!canSave || (guardPast && pastSlot) || (Boolean(existing) && !dirty)}
          onClick={save}
        >
          {existing ? 'Сохранить' : 'Опубликовать'}
        </button>
      </div>
    </Screen>
  )
}

/** «вт 01.12, 12:00»: подпись на афише, как у поста в сцене ивентов знакомства. */
const posterWhen = (dateKey: string, time: string): string => {
  const d = keyToDate(dateKey)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${WEEKDAYS_SHORT[weekdayIdx(dateKey)]!.toLowerCase()} ${dd}.${mm}, ${time}`
}

/** «сегодня», «завтра», «через 41 день». */
export const untilWord = (todayKey: string, dateKey: string): string => {
  const n = Math.round((keyToDate(dateKey).getTime() - keyToDate(todayKey).getTime()) / 86_400_000)
  if (n <= 0) return 'сегодня'
  if (n === 1) return 'завтра'
  return `через\u00a0${n}\u00a0${plural(n, 'день', 'дня', 'дней')}`
}

/** Дата плиткой: месяц и число крупно, как листок календаря. */
export function DateTile({ dateKey, small = false }: { dateKey: string; small?: boolean }) {
  return (
    <div className={'ev-tile' + (small ? ' small' : '')} aria-hidden="true">
      <span>{MONTHS_ABBR[monthIdx(dateKey)]}</span>
      <b>{dayNum(dateKey)}</b>
    </div>
  )
}

/**
 * Ивент на чтение. Открывается афишей во всю ширину: название живёт на ней одной, а не в
 * шапке экрана, в карточке и снова на картинке. Без фото афиша рисуется из названия тем
 * же языком, что пост в знакомстве. Под ней дата плиткой, кто придёт и ведущий.
 */
function EventView({ event, asGuest }: { event: SpaceEvent; asGuest: boolean }) {
  const { data, stack } = useStore()
  const photos = event.photos ?? []
  const rootRef = useRef<HTMLDivElement>(null)
  const posterRef = useRef<HTMLDivElement>(null)
  const under = useContext(UnderContext)
  // Потянули экран вниз: ивент уходит карточкой в свою строку.
  usePullDismiss(rootRef, { enabled: !under && stack.length > 1 })
  // При прокрутке снимок внутри рамки едет медленнее страницы: у афиши появляется глубина.
  useEffect(() => {
    if (under || reducedMotion()) return
    const photo = posterRef.current?.querySelector<HTMLElement>('.evv-photo')
    if (!photo) return
    const onScroll = (): void => {
      const y = Math.max(0, window.scrollY)
      const h = posterRef.current?.offsetHeight ?? 212
      photo.style.transform = y > 0 ? `translate3d(0, ${Math.min(y * 0.25, h * 0.08).toFixed(1)}px, 0)` : ''
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [under, photos.length])
  const openIcs = useIcsLink('event', event.id, true)
  const day = data!.days.find((d) => d.dateKey === event.dateKey) ?? null
  // Резидент отмечается прямо под афишей: это та же отметка дня, отдельной у ивента нет.
  // Дня вне обзора сервер не примет, там ряд лиц остаётся без кнопки.
  const attend = useAttend(day)
  const canAttend = !asGuest && day !== null
  // Тон афиши ложится на каждый блок с цветом ивента: своего style у экрана нет.
  const tone = eventTone(event)
  const tv = toneVars(tone)

  // Шапка Telegram в тон полосы, как на экране дня; на выходе возвращаем тему. Цвет
  // считается под текущую тему, поэтому сам и служит условием перекраски.
  // Под верхним экраном (жест «вниз») ивент только картинка: шапка остаётся за верхним.
  const header = tone ? toneColors(tone).band : toHex(stageTint('purple'))
  useEffect(() => {
    if (!under) afterHero(() => setHeaderColor(header))
  }, [header, under])
  useEffect(
    () => () => {
      if (!under) afterHero(() => applyTheme(getState().theme))
    },
    [under],
  )

  // Кто придёт в этот день: ивент и есть повод, а решают, глядя на людей. У ивента с
  // формой к ним добавляются принятые заявители. День вне обзора людей не знает.
  const people: Attendee[] = [...(day?.attendees ?? [])]
  for (const u of event.approvedAttendees ?? []) {
    if (!people.some((a) => a.userId === u.userId)) people.push({ ...u, resident: false, time: null })
  }
  const names = people.map((a) => (a.userId === data!.me.id ? 'вы' : userLabel(a)))

  // «Хочу прийти» у гостя и есть заявка на день ивента: форма открывается уже с днём и
  // временем. Заявка на этот день уже есть: вместо кнопки она сама.
  const mine = asGuest ? (data!.myRequests ?? []).find((r) => r.dateKey === event.dateKey) ?? null : null
  const canAsk = asGuest && !event.form && Boolean(day) && !day!.lock && !isPastForToday(event.dateKey, event.time)
  // Пересылается то же, что анонсируется в общих чатах: ивент «только резидентам» нет.
  const canShare = !event.residentsOnly && !isPastForToday(event.dateKey, event.time)
  const shareTarget = { kind: 'event' as const, id: event.id }

  const poster = (
    <div className={'evv-poster' + (photos.length > 0 ? ' photo' : '')} ref={posterRef}>
      {photos.length > 0 ? <EventPoster photoId={photos[0]!} className="evv-photo" /> : null}
      <div className="evv-pt">{event.title}</div>
      <div className="evv-ps">{posterWhen(event.dateKey, event.time)}</div>
    </div>
  )

  return (
    <Screen>
      <div className="evv" ref={rootRef}>
      <div className="evv-top" style={tv}>
        <div className="evv-band" aria-hidden="true" />
        <BackRow />
        {poster}
        <div className="evv-when">
          <DateTile dateKey={event.dateKey} />
          <div className="evv-when-text">
            <div className="evv-wt">
              {`${WEEKDAYS_FULL[weekdayIdx(event.dateKey)]}, ${fmtDayMonth(event.dateKey)}`}
              {event.residentsOnly ? <span className="ev-chip">только резидентам</span> : null}
            </div>
            <div className="evv-ws">{`в\u00a0${event.time} · ${untilWord(data!.todayKey, event.dateKey)}`}</div>
          </div>
        </div>
        {canAttend ? (
          <ComingRow attendees={people} coming={attend.coming} onToggle={() => void attend.toggle()} className="evv-coming" />
        ) : day || people.length > 0 ? (
          <div className="dpg-coming evv-coming">
            <div className="dpg-faces" aria-hidden="true">
              {people.length === 0 ? (
                <span className="dpg-myslot">
                  <span className="dpg-slot" />
                </span>
              ) : (
                people.slice(0, 4).map((a, i, faces) => (
                  <span key={a.userId} className="dpg-face" style={{ zIndex: faces.length - i }}>
                    <Avatar user={a} />
                  </span>
                ))
              )}
            </div>
            <div className="dpg-coming-text">
              <div className="dpg-coming-k">{`Придут · ${people.length}`}</div>
              <ComingNames names={names} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="card evv-card">
        <Profile user={event.host} className="row">
          <Avatar user={event.host} className="req-avatar" />
          <span className="row-label">
            {event.host.name}
            <span className="row-sublabel">{(event.host.username ? '@' + event.host.username + ' · ' : '') + 'ведёт'}</span>
          </span>
        </Profile>
        {/* Ответственные приходят только резидентам: у гостя этих строк нет. */}
        {(event.responsibles ?? []).map((u) => (
          <Fragment key={u.userId}>
            <Sep inset="avatar" />
            <Profile user={u} className="row">
              <Avatar user={u} className="req-avatar" />
              <span className="row-label">
                {u.name}
                <span className="row-sublabel">{(u.username ? '@' + u.username + ' · ' : '') + 'отвечает'}</span>
              </span>
            </Profile>
          </Fragment>
        ))}
        {event.description ? (
          <>
            <Sep inset="text" />
            <div className="evv-desc">{linkedText(event.description)}</div>
          </>
        ) : null}
        {event.sourceUrl ? (
          <>
            <Sep inset="text" />
            <button type="button" className="row tappable" onClick={() => openUrl(event.sourceUrl!)}>
              <span className="row-label">Пост в канале</span>
              <div className="row-right">{icons.external('#bf5af2')}</div>
            </button>
          </>
        ) : null}
      </div>
      {photos.length > 1 ? (
        <div className="ev-gallery evv-gallery">
          {photos.slice(1).map((id) => (
            <EventPoster key={id} photoId={id} className="ev-poster ev-gallery-item" />
          ))}
        </div>
      ) : null}
      {/* Своя заявка на экране формы: на «назад» кнопка подачи перетекает в её статус. */}
      {event.form ? (
        <Crossfade id={event.myApplication?.status ?? 'none'}>
          <EventFormActions event={event} />
        </Crossfade>
      ) : null}
      {mine ? (
        <div className="card evv-mine">
          <button type="button" className="row tappable" onClick={() => push('visit', { id: mine.id })}>
            <span className="row-label">
              Ваша заявка
              <span className="row-sublabel">{nb(`к ${mine.time} · ${mine.status === 'approved' ? 'подтверждена' : 'ждёт ответа'}`)}</span>
            </span>
            <div className="row-right">{icons.chevron()}</div>
          </button>
        </div>
      ) : null}
      {canAsk && !mine ? (
        <div className="evv-acts" style={tv}>
          <button type="button" className="primary-btn" onClick={() => startNewRequest({ dateKey: event.dateKey, time: event.time })}>
            Хочу прийти
          </button>
          <button type="button" className="evv-cal" aria-label="В календарь" title="В календарь" onClick={() => void openIcs()}>
            {icons.calendarPlus(20, 'currentColor')}
          </button>
          {canShare ? <ShareIconButton target={shareTarget} /> : null}
        </div>
      ) : canShare ? (
        <div className="evv-pair">
          <button type="button" className="secondary-btn evv-cal-wide" style={tv} onClick={() => void openIcs()}>
            {icons.calendarPlus(18, 'currentColor')}
            В календарь
          </button>
          <ShareButton target={shareTarget} style={tv} />
        </div>
      ) : (
        <button type="button" className="secondary-btn evv-cal-wide" style={tv} onClick={() => void openIcs()}>
          {icons.calendarPlus(18, 'currentColor')}
          В календарь
        </button>
      )}
      </div>
    </Screen>
  )
}

/** Блок заявок в карточке: «кто придёт», кнопка рецензента «Заявки · N» или подача гостя. */
function EventFormActions({ event }: { event: SpaceEvent }) {
  const { perspective } = useStore()
  const approved = event.approvedAttendees ?? []
  const count = event.approvedCount ?? approved.length
  const app = event.myApplication ?? null
  const names = approved.map((u) => (u.username ? '@' + u.username : u.name)).join(', ')
  // В гостевой перспективе (в т.ч. дев-превью) рецензентскую кнопку прячем — гость подаёт заявку.
  const canReview = event.canReview && perspective !== 'guest'
  return (
    <div className="ev-apps">
      {count > 0 ? (
        <div className="ev-going">
          {icons.check(13, '#34c759', 2.4)}
          <span>
            Придут: {count}
            {names ? <span className="ev-going-names"> · {names}</span> : null}
          </span>
        </div>
      ) : null}
      {canReview ? (
        <button className="primary-btn" onClick={() => push('eventApps', { event, backLabel: 'Ивент' })}>
          Заявки{event.applicationsPending ? ` · ${event.applicationsPending}` : ''}
        </button>
      ) : app ? (
        <button className="ev-status-btn" onClick={() => push('eventApply', { event, backLabel: 'Ивент' })}>
          {app.status === 'approved' ? 'Вы участвуете · открыть' : 'Заявка на рассмотрении · изменить'}
        </button>
      ) : (
        <button className="primary-btn" onClick={() => push('eventApply', { event, backLabel: 'Ивент' })}>
          Оставить заявку
        </button>
      )}
    </div>
  )
}
