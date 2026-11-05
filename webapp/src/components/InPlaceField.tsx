// Поле на месте текста: цель визита, заметка о госте. Тот же уговор, что у темы дня
// (DayTopic.tsx): сохраняет только «Готово» (Enter, у Android перенос в тексте), уход из
// поля и Escape закрывают правку без сохранения.

import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { growField, markOwnTap, reducedMotion } from '../motion'

export function InPlaceField({
  initial,
  maxLength,
  placeholder,
  label,
  className,
  fieldRef,
  onDone,
  onCancel,
}: {
  initial: string
  maxLength: number
  placeholder: string
  label: string
  className: string
  fieldRef: (el: HTMLTextAreaElement | null) => void
  onDone: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const saving = useRef(false)
  const typed = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    growField(el, { still: !typed.current })
    typed.current = false
  }, [value])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        fieldRef(el)
      }}
      className={className}
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      enterKeyHint="done"
      aria-label={label}
      onChange={(e) => {
        const raw = e.target.value
        // Клавиатуры Android присылают «Готово» переносом в тексте, а не нажатием Enter.
        if (raw.length === value.length + 1 && raw.replace('\n', '') === value) {
          saving.current = true
          e.currentTarget.blur()
          return
        }
        typed.current = true
        setValue(raw)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          saving.current = true
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        if (saving.current) onDone(value.trim())
        else onCancel()
      }}
    />
  )
}

/**
 * Включает правку и ставит курсор в конец поля в том же касании: iOS поднимает
 * клавиатуру только на фокус внутри жеста, поэтому поле монтируется синхронно.
 */
export function focusInPlace(open: () => void, field: () => HTMLTextAreaElement | null): void {
  markOwnTap()
  flushSync(open)
  const el = field()
  if (!el) return
  el.focus({ preventScroll: true })
  el.setSelectionRange(el.value.length, el.value.length)
  const r = el.getBoundingClientRect()
  if (r.bottom > window.innerHeight || r.top < 0) el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
}
