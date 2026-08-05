import { SpinnerCenter } from 'endpoint-robot-webapp'

/** Загрузка экрана: спиннер по центру, с отступами сверху и снизу. */
export const Default = () => <SpinnerCenter />

/** Вместо содержимого карточки, пока данные едут с сервера. */
export const InCard = () => (
  <div className="card">
    <SpinnerCenter />
  </div>
)
