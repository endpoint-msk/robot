import { AttendeeRow } from 'endpoint-robot-webapp'
import { attendees } from '../fixture'

export const Resident = () => (
  <div className="card">
    <AttendeeRow a={attendees[0]!} />
  </div>
)

export const GuestWithTime = () => (
  <div className="card">
    <AttendeeRow a={attendees[2]!} />
  </div>
)

export const NoUsername = () => (
  <div className="card">
    <AttendeeRow a={attendees[1]!} />
  </div>
)
