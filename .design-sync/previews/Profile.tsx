import { Avatar, Profile } from 'endpoint-robot-webapp'
import { anya, misha } from '../fixture'

/** С ником: строка тапается и ведёт в профиль Telegram (t.me/@ник). */
export const Tappable = () => (
  <div className="card">
    <div className="row">
      <Avatar user={misha} className="req-avatar" />
      <div className="req-main">
        <Profile user={misha} className="req-name">
          {misha.name}
        </Profile>
        <div className="req-sub">@{misha.username}</div>
      </div>
    </div>
  </div>
)

/** Без ника ссылки не существует — обёртка не тапается и выглядит обычным текстом. */
export const NotTappable = () => (
  <div className="card">
    <div className="row">
      <Avatar user={anya} className="req-avatar" />
      <div className="req-main">
        <Profile user={anya} className="req-name">
          {anya.name}
        </Profile>
        <div className="req-sub">без ника</div>
      </div>
    </div>
  </div>
)
