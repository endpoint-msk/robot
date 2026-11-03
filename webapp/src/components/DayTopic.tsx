// Тема дня строкой шапки дня: под датой, тем же кеглем, что тема в карточке «Сегодня» на
// главной. У резидента она пишется прямо здесь, без листа: строка «Тема дня» в карточке
// «День» и касание самой темы ставят курсор в шапку. У гостя это только текст. Автора здесь
// нет: резиденты видят его подписью строки «Тема дня» в карточке «День».

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { action } from '../api'
import { growField, markOwnTap, reducedMotion } from '../motion'

/** Столько же держит сервер. */
const MAX_TOPIC = 200

// Какой день пишется сейчас и что ушло на сервер, пока он не ответил: шапка держит
// набранное, а не мигает прежней темой до ответа.
type EditState = { editing: string | null; pending: { dateKey: string; text: string } | null }
let edit: EditState = { editing: null, pending: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<EditState>): void => {
  edit = { ...edit, ...next }
  for (const l of listeners) l()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const fields = new Map<string, HTMLTextAreaElement>()

export function useTopicEdit(dateKey: string): { editing: boolean; pending: string | null } {
  const s = useSyncExternalStore(subscribe, () => edit)
  return { editing: s.editing === dateKey, pending: s.pending?.dateKey === dateKey ? s.pending.text : null }
}

/** Строка темы в шапке есть, пока тему пишут или она есть (с учётом ушедшей на сервер). */
export function useTopicShown(dateKey: string, hasTopic: boolean): boolean {
  const { editing, pending } = useTopicEdit(dateKey)
  return editing || (pending !== null ? pending !== '' : hasTopic)
}

/**
 * Ставит курсор в тему дня. Поле монтируется синхронно (`flushSync`) и получает фокус в том
 * же касании: iOS поднимает клавиатуру только на фокус внутри жеста. Прокрутка к шапке идёт
 * отдельно, фокус её не делает.
 */
export const startTopicEdit = (dateKey: string): void => {
  markOwnTap()
  flushSync(() => emit({ editing: dateKey }))
  const el = fields.get(dateKey)
  if (!el) return
  el.focus({ preventScroll: true })
  el.setSelectionRange(el.value.length, el.value.length)
  if (el.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

const save = async (dateKey: string, text: string, current: string): Promise<void> => {
  emit({ editing: null })
  if (text === current) return
  markOwnTap()
  emit({ pending: { dateKey, text } })
  await action('day.agenda', { dateKey, text }, { quiet: true })
  if (edit.pending?.dateKey === dateKey) emit({ pending: null })
}

/** Поле темы на месте строки: тот же кегль, без рамки. */
function TopicField({ dateKey, current }: { dateKey: string; current: string }) {
  const [value, setValue] = useState(current)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const saving = useRef(false)
  const typed = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    growField(el, { still: !typed.current })
    typed.current = false
  }, [value])
  // Ушли с экрана, не закончив: снятое с узла поле blur не присылает.
  useEffect(
    () => () => {
      if (edit.editing === dateKey) emit({ editing: null })
    },
    [dateKey],
  )
  return (
    <textarea
      ref={(el) => {
        if (el) fields.set(dateKey, el)
        else if (fields.get(dateKey) === ref.current) fields.delete(dateKey)
        ref.current = el
      }}
      className="dpg-topic-t dpg-topic-in"
      rows={1}
      value={value}
      maxLength={MAX_TOPIC}
      placeholder="Что в этот день в спейсе?"
      enterKeyHint="done"
      aria-label="Тема дня"
      onChange={(e) => {
        const raw = e.target.value
        // Клавиатуры Android присылают «Готово» переносом в тексте, а не нажатием Enter.
        if (raw.length === value.length + 1 && raw.replace('\n', '') === value) {
          saving.current = true
          e.currentTarget.blur()
          return
        }
        typed.current = true
        // Тема одной строкой смысла: перенос из вставки становится пробелом.
        setValue(raw.replace(/\s*\n\s*/g, ' '))
      }}
      onKeyDown={(e) => {
        // Сохраняет только «Готово» (Enter): тема сразу видна гостям и уходит на доску в
        // чаты, а «Вернуть» у неё нет. Уход из поля и Escape закрывают правку без сохранения.
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
        if (saving.current) void save(dateKey, value.trim(), current)
        else emit({ editing: null })
      }}
    />
  )
}

/** Тема строкой шапки; `editable` - у резидента касание ставит в неё курсор. */
export function DayTopic({ text, dateKey, editable = false }: { text: string; dateKey: string; editable?: boolean }) {
  const { editing, pending } = useTopicEdit(dateKey)
  const shown = pending ?? text
  const cls = 'dpg-topic'
  if (editable && editing) {
    return (
      <div className={cls + ' editing'}>
        <TopicField dateKey={dateKey} current={text} />
      </div>
    )
  }
  const body = <span className="dpg-topic-t">{shown}</span>
  return editable ? (
    <button type="button" className={cls} onClick={() => startTopicEdit(dateKey)}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
