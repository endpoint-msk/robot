// Заметка резидентов о госте: одна на человека, общая — правит любой резидент.
// Открывается свайпом по строке заявки (и тапом по иконке-флажку в ней).

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { action, mutate } from '../api'
import { fmtIsoDay } from '../dates'
import { capture, scatter } from '../dust'
import { markOwnTap } from '../motion'
import { pop, setData, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import { offerUndo, type Undoable } from '../undo'
import { BackRow, BottomBar, Footnote, Header, SectionTitle } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import type { User } from '../types'

const MAX_NOTE_LENGTH = 1000

export function GuestNote() {
  const params = useParams()
  const { data } = useStore()
  const guest = params.guest as User
  const note = (data!.notes || []).find((n) => n.userId === guest.userId) || null
  const [text, setText] = useState(note ? note.text : '')
  const fieldRef = useRef<HTMLDivElement>(null)
  // Пока текст разлетается, подсказка пустого поля не встаёт под него.
  const [scattering, setScattering] = useState(false)

  // Без вопроса: удаление обратимо. Текст рассыпается прямо в поле, поле остаётся пустым
  // для новой заметки, а «Вернуть» собирает текст обратно.
  const remove = async (): Promise<void> => {
    if (!note) return
    markOwnTap()
    haptic.impact('medium')
    const kept = note.text
    const field = fieldRef.current
    const dust = field ? await capture(field, { ink: true }) : null
    setText('')
    if (dust && field) {
      setScattering(true)
      window.setTimeout(() => setScattering(false), 1100)
      scatter(field, dust)
    }
    const res = await mutate<Undoable>('note.set', { userId: guest.userId, text: '' })
    if (!res) {
      setText(kept)
      return
    }
    setData(res)
    offerUndo('Заметка удалена', res.undo, (data) => {
      flushSync(() => {
        setData(data)
        setText(kept)
      })
      const el = fieldRef.current
      if (el && dust) scatter(el, dust, true)
    })
  }

  const save = async (value: string): Promise<void> => {
    const done = await action('note.set', { userId: guest.userId, text: value })
    if (done) {
      haptic.notify('success')
      pop()
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow />
      <Header title="Заметка" subtitle="Видна всем резидентам" />
      <div className="card">
        <div className="row">
          <Avatar user={guest} className="req-avatar" profile />
          <span className="row-label">
            {guest.name}
            {guest.username ? <span className="row-sublabel">@{guest.username}</span> : null}
          </span>
        </div>
      </div>
      <SectionTitle>Текст</SectionTitle>
      <div className="card">
        <div className="kv-block" ref={fieldRef}>
          <textarea
            className={'note-input' + (scattering ? ' scattering' : '')}
            placeholder="Что стоит помнить об этом госте"
            rows={5}
            maxLength={MAX_NOTE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
      {note ? (
        <div className="note-meta">{`Последним правил ${userLabel(note.by)} · ${fmtIsoDay(note.updatedAt)}`}</div>
      ) : null}
      <Footnote>Гость заметку не видит — она только для резидентов.</Footnote>
      {note ? (
        <>
          <div style={{ height: 22 }} />
          <button className="destructive-btn" onClick={() => void remove()}>
            Удалить заметку
          </button>
        </>
      ) : null}
      <BottomBar>
        {/* Пустой текст на сохранении = удаление заметки (так же трактует сервер). */}
        <button className="primary-btn" disabled={text.trim() === (note ? note.text : '')} onClick={() => save(text)}>
          Сохранить
        </button>
      </BottomBar>
    </Screen>
  )
}
