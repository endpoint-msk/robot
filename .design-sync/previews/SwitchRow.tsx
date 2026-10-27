import { SwitchRow } from 'endpoint-robot-webapp'

export const On = () => (
  <div className="card">
    <SwitchRow on onToggle={() => {}} label="Уведомления о заявках" sub="Приходят в личку от бота" />
  </div>
)

export const Off = () => (
  <div className="card">
    <SwitchRow on={false} onToggle={() => {}} label="Закрыт для гостей" />
  </div>
)
