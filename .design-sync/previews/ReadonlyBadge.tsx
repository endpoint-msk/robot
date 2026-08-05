import { ReadonlyBadge } from 'endpoint-robot-webapp'

/** Плашка архива: замок + «только просмотр». Ставится под заголовком экрана. */
export const Default = () => <ReadonlyBadge />

/** На своём месте: между заголовком недели и карточкой с заявками. */
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
