import { AttendeeRow } from 'endpoint-robot-webapp'
import { attendees } from '../fixture'

/** Резидент: справа бейдж «резидент», времени нет — он просто будет. */
export const Resident = () => (
  <div className="card">
    <AttendeeRow a={attendees[0]!} />
  </div>
)

/** Гость с подтверждённым визитом: под именем время, к которому придёт. */
export const GuestWithTime = () => (
  <div className="card">
    <AttendeeRow a={attendees[2]!} />
  </div>
)

/** Без ника: под именем ничего — ссылки на профиль у такого человека не существует. */
export const NoUsername = () => (
  <div className="card">
    <AttendeeRow a={attendees[1]!} />
  </div>
)
