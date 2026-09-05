// Заполнение формы-заявки гостем. Управляемый компонент: значение — карта ответов по
// id блока, наружу отдаёт onChange. Пустой ответ на обязательный блок валидирует
// вызывающий (см. isFormComplete).

import { icons } from '../icons'
import type { EventFormField } from '../types'

export type FieldAnswer = { text?: string; optionIds?: string[]; writeIn?: string }
export type AnswerMap = Record<string, FieldAnswer>

/** Все ли обязательные блоки заполнены (та же проверка, что на сервере). */
export const isFormComplete = (fields: EventFormField[], answers: AnswerMap): boolean =>
  fields.every((f) => {
    if (!f.required) return true
    const a = answers[f.id] ?? {}
    if (f.type === 'text') return Boolean((a.text ?? '').trim())
    return (a.optionIds ?? []).length > 0
  })

function Choice({
  field,
  answer,
  disabled,
  onChange,
}: {
  field: EventFormField
  answer: FieldAnswer
  disabled: boolean
  onChange: (a: FieldAnswer) => void
}) {
  const selected = answer.optionIds ?? []
  const options = field.options ?? []
  const toggle = (id: string): void => {
    if (disabled) return
    if (field.multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
      onChange({ ...answer, optionIds: next })
    } else {
      onChange({ ...answer, optionIds: selected.includes(id) ? [] : [id] })
    }
  }
  const writeInOpen = options.some((o) => o.writeIn && selected.includes(o.id))
  return (
    <div className="ff-options">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            className={'ff-option' + (on ? ' on' : '')}
            disabled={disabled}
            onClick={() => toggle(o.id)}
          >
            <span className={'ff-mark' + (field.multi ? ' box' : '')}>{on ? icons.check(12, '#fff', 2.6) : null}</span>
            <span className="ff-option-label">{o.label}</span>
          </button>
        )
      })}
      {writeInOpen ? (
        <input
          className="ff-input"
          placeholder="Свой вариант"
          maxLength={200}
          disabled={disabled}
          value={answer.writeIn ?? ''}
          onChange={(e) => onChange({ ...answer, writeIn: e.target.value })}
        />
      ) : null}
    </div>
  )
}

export function FormFill({
  fields,
  value,
  disabled = false,
  onChange,
}: {
  fields: EventFormField[]
  value: AnswerMap
  disabled?: boolean
  onChange: (v: AnswerMap) => void
}) {
  const set = (id: string, a: FieldAnswer): void => onChange({ ...value, [id]: a })
  return (
    <div className="ff-form">
      {fields.map((f) => {
        const a = value[f.id] ?? {}
        return (
          <div className="ff-field" key={f.id}>
            <div className="ff-label">
              {f.label || '—'}
              {f.required ? <span className="ff-req"> *</span> : null}
            </div>
            {f.type === 'text' ? (
              <textarea
                className="ff-input ff-textarea"
                placeholder="Ответ"
                rows={2}
                maxLength={1000}
                disabled={disabled}
                value={a.text ?? ''}
                onChange={(e) => set(f.id, { ...a, text: e.target.value })}
              />
            ) : (
              <Choice field={f} answer={a} disabled={disabled} onChange={(next) => set(f.id, next)} />
            )}
          </div>
        )
      })}
    </div>
  )
}
