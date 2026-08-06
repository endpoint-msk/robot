import { Avatar, SwipeRow, icons } from 'endpoint-robot-webapp'
import { misha } from '../fixture'

// В покое видно только строку: панель действий выезжает жестом влево (палец,
// зажатая мышь или трекпад), поэтому на статичной карточке её нет.

export const RequestActions = () => (
  <div className="card">
    <SwipeRow
      actions={[
        { key: 'note', label: 'Заметка', icon: icons.note(21, '#fff'), tone: 'neutral', onSelect: () => {} },
        { key: 'reschedule', label: 'Перенести', icon: icons.clock(21, '#fff'), onSelect: () => {} },
        { key: 'close', label: 'Закрыть заявку', icon: icons.xmark(21, '#fff'), tone: 'orange', onSelect: () => {} },
        { key: 'block', label: 'Заблокировать', icon: icons.ban(21, '#fff'), tone: 'red', onSelect: () => {} },
      ]}
    >
      <div className="row req-row">
        <div className="req-top">
          <Avatar user={misha} className="req-avatar" />
          <div className="req-main">
            <div className="req-name">{misha.name}</div>
            <div className="req-sub">@{misha.username} · к 19:00</div>
          </div>
          <button className="host-btn">Захостить</button>
        </div>
      </div>
    </SwipeRow>
  </div>
)

export const SingleAction = () => (
  <div className="card">
    <SwipeRow actions={[{ key: 'note', label: 'Заметка', icon: icons.note(21, '#fff'), tone: 'neutral', onSelect: () => {} }]}>
      <div className="row">
        <span className="row-label">
          Заметка о госте
          <span className="row-sublabel">Общая память резидентов</span>
        </span>
      </div>
    </SwipeRow>
  </div>
)
