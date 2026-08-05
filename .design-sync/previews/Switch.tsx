import { Switch } from 'endpoint-robot-webapp'

/** Ряд настройки — то место, где свитч и живёт (см. AnonRow, экран настроек). */
export const InRow = () => (
  <div className="card">
    <div className="row">
      <span className="row-label">
        Уведомления о заявках
        <span className="row-sublabel">Приходят в личку от бота</span>
      </span>
      <Switch on onToggle={() => {}} />
    </div>
  </div>
)

export const On = () => <Switch on onToggle={() => {}} />

export const Off = () => <Switch on={false} onToggle={() => {}} />
