import { Avatar } from 'endpoint-robot-webapp'
import { anya, dasha, misha } from '../fixture'

// Размер аватарки задаёт контекст, а не сам компонент: у `.avatar` есть форма и
// градиент, но нет ширины. Поэтому все ячейки — реальные обвязки из миниаппа.

/** Строка заявки: 40px (класс .req-avatar), тап ведёт в профиль по нику. */
export const InRequestRow = () => (
  <div className="card">
    <div className="row">
      <Avatar user={misha} className="req-avatar" profile />
      <div className="req-main">
        <div className="req-name">{misha.name}</div>
        <div className="req-sub">@{misha.username}</div>
      </div>
    </div>
  </div>
)

/** Пилл «одобрил»: 20px внутри .pill. */
export const InPill = () => (
  <div className="card">
    <div className="row">
      <span className="row-label">Захостил</span>
      <div className="row-right">
        <div className="approver">
          <span className="approver-label">одобрил</span>
          <div className="pill">
            <Avatar user={dasha} />
            <span className="pill-name">@{dasha.username}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
)

/** Палитра: цвет считается по userId, поэтому у человека он всегда один и тот же. */
export const Gradients = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Avatar user={misha} className="req-avatar" />
    <Avatar user={anya} className="req-avatar" />
    <Avatar user={dasha} className="req-avatar" />
  </div>
)
