import { PurposeInput, Sep } from 'endpoint-robot-webapp'

// Поле прозрачное и без рамки — его рамка это карточка вокруг (.card > .kv-block),
// ровно так оно стоит в форме заявки.

/** Пустое: плейсхолдер говорит, что цель визита необязательна. */
export const Empty = () => (
  <div className="card">
    <div className="row" style={{ padding: '6px 14px' }}>
      <span style={{ fontSize: 16 }}>Приду к</span>
      <input className="time-input" type="time" defaultValue="19:00" readOnly />
    </div>
    <Sep left={14} />
    <div className="kv-block">
      <PurposeInput value="" onChange={() => {}} />
    </div>
  </div>
)

/** Заполненное: поле растёт под текст, потолок — 300 символов. */
export const Filled = () => (
  <div className="card">
    <div className="kv-block">
      <PurposeInput
        value="Хочу напечатать корпус для датчика — пластик свой, принесу с собой. Если получится, заодно посмотрю станок."
        onChange={() => {}}
      />
    </div>
  </div>
)

/** Свой плейсхолдер — то же поле собирает описание ивента. */
export const CustomPlaceholder = () => (
  <div className="card">
    <div className="kv-block">
      <PurposeInput value="" onChange={() => {}} placeholder="О чём ивент и что взять с собой" />
    </div>
  </div>
)
