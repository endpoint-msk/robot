import { useState, type ChangeEvent } from 'react'
import { action, uploadEventPhoto } from '../api'
import { addDays } from '../dates'
import { icons } from '../icons'
import { compressImage } from '../image'
import { showAlert } from '../modals'
import { haptic } from '../telegram'
import { pop, setBusy, useParams, useStore } from '../store'
import type { VoteView } from '../types'
import { BackRow, BottomBar, Footnote, Header, PrimaryButton, SectionTitle, Switch } from '../components/common'
import { DateField } from '../components/DateField'
import { TimeField } from '../components/TimeField'
import { defaultTimeFor, isPastForToday } from '../components/forms'
import { Screen } from '../components/Screen'
import { VotePoster } from './Vote'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 2000
const MAX_OPTION = 100
const MIN_OPTIONS = 2
const MAX_OPTIONS = 10
const MAX_PHOTOS = 6
const MAX_DAYS_AHEAD = 365

type Opt = { id: string; label: string }
const uid = (): string => Math.random().toString(36).slice(2, 10)

export function VoteEdit() {
  const params = useParams()
  const { data } = useStore()
  const existing = params.vote as VoteView | undefined
  // Варианты/множественность/анонимность привязаны к уже поданным голосам — правятся,
  // только пока никто не проголосовал (сервер думает так же).
  const locked = Boolean(existing && existing.totalVoters > 0)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [options, setOptions] = useState<Opt[]>(
    existing ? existing.options.map((o) => ({ id: o.id, label: o.label })) : [{ id: uid(), label: '' }, { id: uid(), label: '' }],
  )
  const [multi, setMulti] = useState(existing?.multi ?? false)
  const [anon, setAnon] = useState(existing?.anon ?? false)
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? [])

  const [hasDeadline, setHasDeadline] = useState<boolean>(Boolean(existing?.endsAtLocal))
  const initDay = existing?.endsAtLocal?.dateKey ?? addDays(data!.todayKey, 3)
  const [dateKey, setDateKey] = useState(initDay)
  const [time, setTime] = useState(existing?.endsAtLocal?.time ?? defaultTimeFor(initDay))

  const filledOptions = options.filter((o) => o.label.trim().length > 0)
  const deadlinePast = hasDeadline && isPastForToday(dateKey, time)
  const canSave = title.trim().length > 0 && filledOptions.length >= MIN_OPTIONS && !deadlinePast

  const selectDay = (next: string): void => {
    setDateKey(next)
    if (isPastForToday(next, time)) setTime(defaultTimeFor(next))
  }

  const setOption = (id: string, label: string): void =>
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, label } : o)))
  const removeOption = (id: string): void => setOptions((prev) => prev.filter((o) => o.id !== id))
  const addOption = (): void => setOptions((prev) => [...prev, { id: uid(), label: '' }])

  const addPhotos = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    const room = MAX_PHOTOS - photos.length
    setBusy(true)
    try {
      const added: string[] = []
      for (const file of picked.slice(0, room)) added.push(await uploadEventPhoto(await compressImage(file)))
      setPhotos((prev) => [...prev, ...added])
      haptic('success')
      if (picked.length > room) showAlert(`Можно приложить не больше ${MAX_PHOTOS} фото.`)
    } catch (err) {
      showAlert(err instanceof Error && err.message ? err.message : 'Не получилось загрузить фото.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!canSave) return
    const payload = {
      title,
      description,
      options: filledOptions.map((o) => ({ id: o.id, label: o.label })),
      multi,
      anon,
      photos,
      deadline: hasDeadline ? { dateKey, time } : null,
    }
    const done = existing
      ? await action('vote.update', { id: existing.id, ...payload })
      : await action('vote.create', payload)
    if (done) {
      haptic('success')
      pop()
    }
  }

  return (
    <Screen>
      <BackRow />
      <Header title={existing ? 'Голосование' : 'Новое голосование'} subtitle={anon ? 'Анонимное' : 'Открытое'} />

      <SectionTitle>Вопрос</SectionTitle>
      <div className="card">
        <div className="ev-field">
          <input
            className="ev-title-input"
            placeholder="О чём голосуем?"
            maxLength={MAX_TITLE}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="ev-field">
          <textarea
            className="ev-desc-input"
            placeholder="Описание: контекст, зачем это, что учесть (необязательно)"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="ev-photos">
          {photos.map((id) => (
            <div className="ev-thumb" key={id}>
              <VotePoster photoId={id} className="ev-thumb-img" />
              <button
                className="ev-thumb-del"
                aria-label="Убрать фото"
                onClick={(e) => {
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

      <SectionTitle>Варианты</SectionTitle>
      <div className={'card' + (locked ? ' rows-disabled' : '')}>
        {options.map((o, i) => (
          <div key={o.id}>
            {i > 0 ? <div className="sep" style={{ marginLeft: 14 }} /> : null}
            <div className="vopt-edit">
              <input
                className="vopt-input"
                placeholder={`Вариант ${i + 1}`}
                maxLength={MAX_OPTION}
                value={o.label}
                disabled={locked}
                onChange={(e) => setOption(o.id, e.target.value)}
              />
              {options.length > MIN_OPTIONS && !locked ? (
                <button type="button" className="vopt-del" aria-label="Убрать вариант" onClick={() => removeOption(o.id)}>
                  {icons.minusCircle()}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {options.length < MAX_OPTIONS && !locked ? (
          <>
            <div className="sep" style={{ marginLeft: 14 }} />
            <button type="button" className="vote-add-row" onClick={addOption}>
              <span className="vopt-add-icon">{icons.plusSmall()}</span>
              Добавить вариант
            </button>
          </>
        ) : null}
      </div>
      {locked ? <Footnote>Кто-то уже проголосовал — варианты и тип голосования менять нельзя.</Footnote> : null}

      <SectionTitle>Настройки</SectionTitle>
      <div className={'card' + (locked ? ' rows-disabled' : '')}>
        <div className="row">
          <span className="row-label">
            Несколько ответов
            <span className="row-sublabel">Можно выбрать больше одного варианта</span>
          </span>
          <Switch on={multi} onToggle={() => { if (!locked) setMulti(!multi) }} label="Несколько ответов" />
        </div>
        <div className="sep" style={{ marginLeft: 14 }} />
        <div className="row">
          <span className="row-label">
            Анонимно
            <span className="row-sublabel">Кто как проголосовал, не увидит никто — только итоги</span>
          </span>
          <Switch on={anon} onToggle={() => { if (!locked) setAnon(!anon) }} label="Анонимно" />
        </div>
      </div>

      <SectionTitle>Окончание</SectionTitle>
      <div className="card">
        <div className="row">
          <span className="row-label">
            Закрыть по времени
            <span className="row-sublabel">Иначе закроешь вручную</span>
          </span>
          <Switch on={hasDeadline} onToggle={() => setHasDeadline(!hasDeadline)} label="Закрыть по времени" />
        </div>
        {hasDeadline ? (
          <>
            <div className="sep" style={{ marginLeft: 14 }} />
            <div className="row">
              <span className="row-label">Дата</span>
              <div className="row-right">
                <DateField value={dateKey} min={data!.todayKey} max={addDays(data!.todayKey, MAX_DAYS_AHEAD - 1)} onChange={selectDay} />
              </div>
            </div>
            <div className="sep" style={{ marginLeft: 14 }} />
            <div className="row">
              <span className="row-label">Время</span>
              <div className="row-right">
                <TimeField
                  value={time}
                  min={dateKey === data!.todayKey ? data!.nowTime : undefined}
                  onChange={setTime}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
      {deadlinePast ? <Footnote>Это время уже прошло — выбери время позже текущего.</Footnote> : null}

      <BottomBar>
        <PrimaryButton onClick={save} disabled={!canSave}>
          {existing ? 'Сохранить' : 'Опубликовать'}
        </PrimaryButton>
      </BottomBar>
      <div style={{ height: 84 }} />
    </Screen>
  )
}
