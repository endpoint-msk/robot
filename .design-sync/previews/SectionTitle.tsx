import { SectionTitle } from 'endpoint-robot-webapp'

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
