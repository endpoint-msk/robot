import { BottomBar } from 'endpoint-robot-webapp'

// Панель рендерится порталом в узел вне анимируемого экрана и якорится к низу
// вьюпорта. Над ней в каждой ячейке — кусок экрана: одна панель без контента
// не показывает, зачем ей градиент под кнопкой.

/** Главное действие экрана — синяя кнопка во всю ширину. */
export const PrimaryAction = () => (
  <>
    <div className="card" style={{ marginBottom: 96 }}>
      <div className="row">
        <span className="row-label">
          Среда, 5 августа
          <span className="row-sublabel">к 19:00</span>
        </span>
      </div>
    </div>
    <BottomBar>
      <button className="primary-btn">Оставить заявку</button>
    </BottomBar>
  </>
)

/** С подсказкой под кнопкой: одна строка о том, что произойдёт после нажатия. */
export const WithHint = () => (
  <>
    <div className="card" style={{ marginBottom: 96 }}>
      <div className="row">
        <span className="row-label">Миша Коротков · к 19:00</span>
      </div>
    </div>
    <BottomBar>
      <button className="primary-btn">Захостить</button>
      <div className="bar-hint">Гостю уйдёт уведомление в личку</div>
    </BottomBar>
  </>
)

/** Деструктивное действие — светлая карточка с красным текстом, не синяя кнопка. */
export const Destructive = () => (
  <>
    <div className="card" style={{ marginBottom: 96 }}>
      <div className="row">
        <span className="row-label">Визит подтверждён</span>
      </div>
    </div>
    <BottomBar>
      <button className="destructive-btn">Отменить визит</button>
    </BottomBar>
  </>
)
