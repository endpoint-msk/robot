// Заметка резидентов о госте: одна на человека, общая, правит любой резидент; гостю не
// уходит никогда. Читается и пишется на месте, в строке гостя на дне и в его профиле,
// отдельного экрана нет. Пустой текст на «Готово» удаляет заметку: текст рассыпается,
// внизу «Вернуть».

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { action, mutate } from '../api'
import { fmtIsoDay } from '../dates'
import { capture, scatter } from '../dust'
import { markOwnTap } from '../motion'
import { setData } from '../store'
import { haptic } from '../telegram'
import type { GuestNote, User } from '../types'
import { offerUndo, type Undoable } from '../undo'
import { focusInPlace, InPlaceField } from './InPlaceField'
import { userLabel } from './people'

/** Столько же держит сервер. */
const MAX_NOTE = 1000

// Какое место пишется сейчас и что ушло на сервер, пока он не ответил: строка держит
// набранное, а не мигает прежним текстом до ответа. Место, а не человек: листалка дня
// рисует и соседние дни, и тот же гость бывает в нескольких строках сразу.
type EditState = { editing: string | null; pending: { userId: number; text: string } | null }
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
const texts = new Map<string, HTMLElement>()

export function useNoteEdit(place: string, userId: number): { editing: boolean; pending: string | null } {
  const s = useSyncExternalStore(subscribe, () => edit)
  return { editing: s.editing === place, pending: s.pending?.userId === userId ? s.pending.text : null }
}

/** Ставит курсор в заметку в том же касании; `also` раскрывает место под неё. */
export const startNoteEdit = (place: string, also?: () => void): void =>
  focusInPlace(
    () => {
      also?.()
      emit({ editing: place })
    },
    () => fields.get(place) ?? null,
  )

const save = async (place: string, userId: number, text: string, current: string): Promise<void> => {
  if (text === current) {
    emit({ editing: null })
    return
  }
  markOwnTap()
  if (text || !current) {
    emit({ editing: null, pending: { userId, text } })
    await action('note.set', { userId, text }, { quiet: true })
    if (edit.pending?.userId === userId) emit({ pending: null })
    return
  }
  // Удаление без вопроса, оно обратимо: поле закрывается на прежнем тексте, и он рассыпается.
  haptic.impact('medium')
  flushSync(() => emit({ editing: null }))
  const el = texts.get(place)
  const dust = el ? await capture(el, { ink: true }) : null
  emit({ pending: { userId, text: '' } })
  if (el && dust) scatter(el, dust)
  const res = await mutate<Undoable>('note.set', { userId, text: '' })
  if (edit.pending?.userId === userId) emit({ pending: null })
  if (!res) return
  setData(res)
  offerUndo('Заметка удалена', res.undo, (data) => setData(data))
}

/**
 * Текст заметки с подписью, кто и когда правил; касание ставит в него курсор. Без заметки
 * ничего не рисует, кроме `empty`: подсказки, которую можно нажать.
 */
export function GuestNoteText({ place, guest, note, empty }: { place: string; guest: User; note: GuestNote | null; empty?: string }) {
  const { editing, pending } = useNoteEdit(place, guest.userId)
  const current = note?.text ?? ''
  const shown = pending ?? current
  if (editing) {
    return (
      <div className="gnote editing">
        <InPlaceField
          initial={current}
          maxLength={MAX_NOTE}
          placeholder="Что стоит помнить об этом госте"
          label="Заметка о госте"
          className="gnote-t gnote-in"
          fieldRef={(el) => {
            if (el) fields.set(place, el)
            else fields.delete(place)
          }}
          onDone={(v) => void save(place, guest.userId, v, current)}
          onCancel={() => emit({ editing: null })}
        />
      </div>
    )
  }
  if (!shown && !empty) return null
  return (
    <button type="button" className="gnote" onClick={() => startNoteEdit(place)}>
      <span
        className={'gnote-t' + (shown ? '' : ' gnote-empty')}
        ref={(el) => {
          if (el) texts.set(place, el)
        }}
      >
        {shown || empty}
      </span>
      {note && shown && pending === null ? <span className="gnote-by">{`${userLabel(note.by)} · ${fmtIsoDay(note.updatedAt)}`}</span> : null}
    </button>
  )
}
