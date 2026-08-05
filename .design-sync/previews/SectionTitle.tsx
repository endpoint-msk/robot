import { SectionTitle } from 'endpoint-robot-webapp'

/** Подпись над карточкой — так секция и начинается. */
export const AboveCard = () => (
  <>
    <SectionTitle>Заявки на сегодня</SectionTitle>
    <div className="card">
      <div className="row">
        <span className="row-label">Миша Коротков</span>
      </div>
    </div>
  </>
)

/** Две секции подряд: между карточкой и следующей подписью свой отступ. */
export const TwoSections = () => (
  <>
    <SectionTitle>Кто придёт</SectionTitle>
    <div className="card">
      <div className="row">
        <span className="row-label">Даша Ильина</span>
      </div>
    </div>
    <SectionTitle>Ивенты</SectionTitle>
    <div className="card">
      <div className="row">
        <span className="row-label">Ремонт-кафе</span>
      </div>
    </div>
  </>
)
