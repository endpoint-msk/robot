import { ReadonlyBadge } from 'endpoint-robot-webapp'

export const Default = () => <ReadonlyBadge />

export const OnArchiveScreen = () => (
  <>
    <div className="header">
      <div className="title">28 июля – 3 августа</div>
    </div>
    <ReadonlyBadge />
    <div className="card">
      <div className="row">
        <span className="row-label">Миша Коротков</span>
      </div>
    </div>
  </>
)
