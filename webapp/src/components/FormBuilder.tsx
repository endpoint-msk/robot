// Конструктор формы-заявки на ивент (в редакторе ивента). Аналог блоков Google Forms:
// вопрос со свободным ответом и блок выбора (одиночный/множественный, с вариантом «Другое»).
// Плюс выбор круга рецензентов: все резиденты / только автор / выбранные люди.

import { useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { useRemote } from '../remote'
import type { EventFormField, EventFormOption, ReviewerScope, ReviewersResponse, User } from '../types'
import { SectionTitle, Sep, Switch } from './common'
import { Avatar } from './people'

const uid = (): string => Math.random().toString(36).slice(2, 10)

export type BuilderForm = { fields: EventFormField[]; reviewers: ReviewerScope }

/** Пустая форма с одним текстовым вопросом — стартовое состояние при включении. */
export const emptyForm = (): BuilderForm => ({
  fields: [{ id: uid(), type: 'text', label: '', required: true }],
  reviewers: { kind: 'all' },
})

function OptionRow({
  option,
  onChange,
  onRemove,
}: {
  option: EventFormOption
  onChange: (o: EventFormOption) => void
  onRemove: () => void
}) {
  return (
    <div className="fb-option">
      <input
        className="fb-input"
        placeholder="Вариант"
        maxLength={200}
        value={option.label}
        onChange={(e) => onChange({ ...option, label: e.target.value })}
      />
      <button
        type="button"
        className={'fb-writein' + (option.writeIn ? ' on' : '')}
        title="Разрешить свой вариант (поле ввода)"
        onClick={() => onChange({ ...option, writeIn: !option.writeIn })}
      >
        {option.writeIn ? 'своё ✓' : 'своё'}
      </button>
      <button type="button" className="fb-icon-btn" aria-label="Убрать вариант" onClick={onRemove}>
        {icons.xmark(11, 'currentColor')}
      </button>
    </div>
  )
}

function FieldCard({
  field,
  index,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  field: EventFormField
  index: number
  count: number
  onChange: (f: EventFormField) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const setOptions = (options: EventFormOption[]): void => onChange({ ...field, options })
  return (
    <div className="fb-field">
      <div className="fb-field-head">
        <span className="fb-kind">{field.type === 'text' ? 'Свободный ответ' : field.multi ? 'Выбор (несколько)' : 'Выбор (один)'}</span>
        <div className="fb-field-tools">
          <button type="button" className="fb-icon-btn" aria-label="Выше" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="fb-icon-btn" aria-label="Ниже" disabled={index === count - 1} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="fb-icon-btn danger" aria-label="Удалить блок" onClick={onRemove}>
            {icons.xmark(12, 'currentColor')}
          </button>
        </div>
      </div>
      <input
        className="fb-input fb-question"
        placeholder="Текст вопроса"
        maxLength={200}
        value={field.label}
        onChange={(e) => onChange({ ...field, label: e.target.value })}
      />
      {field.type === 'choice' ? (
        <div className="fb-options">
          {(field.options ?? []).map((o) => (
            <OptionRow
              key={o.id}
              option={o}
              onChange={(next) => setOptions((field.options ?? []).map((x) => (x.id === o.id ? next : x)))}
              onRemove={() => setOptions((field.options ?? []).filter((x) => x.id !== o.id))}
            />
          ))}
          <button
            type="button"
            className="fb-add-option"
            onClick={() => setOptions([...(field.options ?? []), { id: uid(), label: '' }])}
          >
            {icons.plusSmall()} Вариант
          </button>
        </div>
      ) : null}
      <div className="fb-field-foot">
        {field.type === 'choice' ? (
          <div className="fb-toggle-row">
            <span>Несколько ответов</span>
            <Switch on={field.multi === true} onToggle={() => onChange({ ...field, multi: !field.multi })} label="Несколько ответов" />
          </div>
        ) : null}
        <div className="fb-toggle-row">
          <span>Обязательный</span>
          <Switch on={field.required} onToggle={() => onChange({ ...field, required: !field.required })} label="Обязательный" />
        </div>
      </div>
    </div>
  )
}

function CirclePicker({ selected, onToggle }: { selected: number[]; onToggle: (id: number) => void }) {
  const { data, error, loading } = useRemote(async () => (await api<ReviewersResponse>('reviewers')).people, [])
  if (loading) return <div className="fb-hint">Загружаем резидентов…</div>
  if (error || !data) return <div className="fb-hint">Не удалось загрузить список резидентов.</div>
  if (data.length === 0) return <div className="fb-hint">Резидентов не нашлось.</div>
  return (
    <div className="card" style={{ marginTop: 8 }}>
      {data.map((u: User, i) => {
        const on = selected.includes(u.userId)
        return (
          <div key={u.userId}>
            {i > 0 ? <Sep left={66} /> : null}
            <button type="button" className="row tappable" onClick={() => onToggle(u.userId)}>
              <Avatar user={u} className="req-avatar" />
              <div className="req-main">
                <div className="req-name">{u.name}</div>
                {u.username ? <div className="req-sub">{'@' + u.username}</div> : null}
              </div>
              <div className="row-right">{on ? icons.check(16, '#34c759', 2.4) : <span className="fb-circle-empty" />}</div>
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function FormBuilder({ value, onChange }: { value: BuilderForm; onChange: (v: BuilderForm) => void }) {
  const [showCircle, setShowCircle] = useState(value.reviewers.kind === 'circle')
  const setFields = (fields: EventFormField[]): void => onChange({ ...value, fields })
  const setReviewers = (reviewers: ReviewerScope): void => onChange({ ...value, reviewers })

  const move = (index: number, dir: -1 | 1): void => {
    const next = [...value.fields]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    setFields(next)
  }

  const addField = (type: 'text' | 'choice'): void => {
    const field: EventFormField =
      type === 'text'
        ? { id: uid(), type: 'text', label: '', required: true }
        : { id: uid(), type: 'choice', label: '', required: true, multi: false, options: [{ id: uid(), label: '' }, { id: uid(), label: '' }] }
    setFields([...value.fields, field])
  }

  const circleIds = value.reviewers.kind === 'circle' ? value.reviewers.userIds : []
  const pickReviewers = (kind: ReviewerScope['kind']): void => {
    setShowCircle(kind === 'circle')
    if (kind === 'all') setReviewers({ kind: 'all' })
    else if (kind === 'creator') setReviewers({ kind: 'creator' })
    else setReviewers({ kind: 'circle', userIds: circleIds })
  }
  const toggleCircle = (id: number): void => {
    const has = circleIds.includes(id)
    setReviewers({ kind: 'circle', userIds: has ? circleIds.filter((x) => x !== id) : [...circleIds, id] })
  }

  const REVIEWER_OPTS: { kind: ReviewerScope['kind']; label: string; sub: string }[] = [
    { kind: 'all', label: 'Все резиденты', sub: 'Любой резидент может принять заявку' },
    { kind: 'circle', label: 'Выбранный круг', sub: 'Только выбранные резиденты' },
    { kind: 'creator', label: 'Только я', sub: 'Заявки рассматриваете вы' },
  ]

  return (
    <>
      <SectionTitle>Блоки формы</SectionTitle>
      <div className="fb-fields">
        {value.fields.map((f, i) => (
          <FieldCard
            key={f.id}
            field={f}
            index={i}
            count={value.fields.length}
            onChange={(next) => setFields(value.fields.map((x) => (x.id === f.id ? next : x)))}
            onRemove={() => setFields(value.fields.filter((x) => x.id !== f.id))}
            onMove={(dir) => move(i, dir)}
          />
        ))}
      </div>
      <div className="fb-add-row">
        <button type="button" className="fb-add-btn" onClick={() => addField('text')}>
          {icons.plusSmall()} Вопрос
        </button>
        <button type="button" className="fb-add-btn" onClick={() => addField('choice')}>
          {icons.plusSmall()} Выбор
        </button>
      </div>

      <SectionTitle>Кто рассматривает заявки</SectionTitle>
      <div className="card">
        {REVIEWER_OPTS.map((o, i) => (
          <div key={o.kind}>
            {i > 0 ? <Sep left={14} /> : null}
            <button type="button" className="row tappable" onClick={() => pickReviewers(o.kind)}>
              <div className="req-main">
                <div className="req-name">{o.label}</div>
                <div className="req-sub">{o.sub}</div>
              </div>
              <div className="row-right">{value.reviewers.kind === o.kind ? icons.check(16, '#34c759', 2.4) : null}</div>
            </button>
          </div>
        ))}
      </div>
      {showCircle ? <CirclePicker selected={circleIds} onToggle={toggleCircle} /> : null}
    </>
  )
}
