import { Avatar, Sep } from 'endpoint-robot-webapp'
import { anya, misha } from '../fixture'

/** Разделитель во всю ширину — между простыми рядами. */
export const FullWidth = () => (
  <div className="card">
    <div className="row">
      <span className="row-label">Уведомления о заявках</span>
    </div>
    <Sep />
    <div className="row">
      <span className="row-label">Уведомления об ивентах</span>
    </div>
  </div>
)

/** С отступом слева: линия начинается под текстом, а не под аватаркой (left={66}). */
export const Inset = () => (
  <div className="card">
    <div className="row">
      <Avatar user={misha} className="req-avatar" />
      <div className="req-main">
        <div className="req-name">{misha.name}</div>
        <div className="req-sub">@{misha.username}</div>
      </div>
    </div>
    <Sep left={66} />
    <div className="row">
      <Avatar user={anya} className="req-avatar" />
      <div className="req-main">
        <div className="req-name">{anya.name}</div>
        <div className="req-sub">к 15:30</div>
      </div>
    </div>
  </div>
)
