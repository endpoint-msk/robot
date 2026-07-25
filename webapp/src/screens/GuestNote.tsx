// Заметка резидентов о госте: одна на человека, общая — правит любой резидент.
// Открывается свайпом по строке заявки (и тапом по иконке-флажку в ней).

import { useState } from 'react'
import { action } from '../api'
import { fmtIsoDay } from '../dates'
import { confirmDialog } from '../modals'
import { pop, useParams, useStore } from '../store'
import { haptic } from '../telegram'
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

  const save = async (value: string): Promise<void> => {
    const done = await action('note.set', { userId: guest.userId, text: value })
    if (done) {
      haptic('success')
      pop()
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow label={params.backLabel || 'Назад'} />
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
        <div className="kv-block">
          <textarea
            className="note-input"
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
          <button
            className="destructive-btn"
            onClick={async () => {
              const ok = await confirmDialog(`Удалить заметку о ${guest.name}?`, {
                confirmLabel: 'Удалить',
                destructive: true,
              })
              if (ok) await save('')
            }}
          >
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
