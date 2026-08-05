import { DayRow } from 'endpoint-robot-webapp'
import { days } from '../fixture'

/** Сегодня: строка подсвечена, слева день недели, справа счётчик одобренных. */
export const Today = () => (
  <div className="card">
    <DayRow day={days[0]!} tappable onOpen={() => {}} />
  </div>
)

/** Тихий день: «Нет заявок», но строка всё равно открывается — там отмечаются «я приду». */
export const Empty = () => (
  <div className="card">
    <DayRow day={days[4]!} tappable onOpen={() => {}} />
  </div>
)

/** День с ивентом: точка у дня недели, сам ивент виден на экране дня. */
export const WithEvent = () => (
  <div className="card">
    <DayRow day={days[3]!} tappable onOpen={() => {}} />
  </div>
)

/** Неделя целиком — так строка и живёт: список в одной карточке. */
export const Week = () => (
  <div className="card">
    {days.slice(0, 5).map((d, i) => (
      <DayRow key={d.dateKey} day={d} tappable onOpen={() => {}} alwaysApproved={i === 0} />
    ))}
  </div>
)
