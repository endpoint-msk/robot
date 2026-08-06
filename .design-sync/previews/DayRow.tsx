import { DayRow } from 'endpoint-robot-webapp'
import { days } from '../fixture'

export const Today = () => (
  <div className="card">
    <DayRow day={days[0]!} tappable onOpen={() => {}} />
  </div>
)

export const Empty = () => (
  <div className="card">
    <DayRow day={days[4]!} tappable onOpen={() => {}} />
  </div>
)

export const WithEvent = () => (
  <div className="card">
    <DayRow day={days[3]!} tappable onOpen={() => {}} />
  </div>
)

export const Week = () => (
  <div className="card">
    {days.slice(0, 5).map((d, i) => (
      <DayRow key={d.dateKey} day={d} tappable onOpen={() => {}} alwaysApproved={i === 0} />
    ))}
  </div>
)
