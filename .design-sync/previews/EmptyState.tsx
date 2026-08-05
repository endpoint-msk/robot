import { EmptyState, icons } from 'endpoint-robot-webapp'

/** Пусто внутри карточки — заголовок и объяснение, что делать. */
export const WithText = () => (
  <div className="card">
    <EmptyState title="Заявок нет" text="Гости оставляют их в миниаппе, за день-два до визита." />
  </div>
)

/** С иконкой: она задаёт тон — календарь для дня, коробка для архива. */
export const WithIcon = () => (
  <div className="card">
    <EmptyState
      title="Ничего не запланировано"
      text="Отметьтесь «я приду», и день перестанет быть пустым."
      icon={icons.calendar(28, '#c7c7cc')}
    />
  </div>
)

/** Только заголовок — когда объяснять нечего. */
export const TitleOnly = () => (
  <div className="card">
    <EmptyState title="Пока никого" />
  </div>
)
