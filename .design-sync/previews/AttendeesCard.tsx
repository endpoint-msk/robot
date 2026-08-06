import { AttendeesCard } from 'endpoint-robot-webapp'
import { attendees } from '../fixture'

export const Day = () => <AttendeesCard list={attendees} />

export const Single = () => <AttendeesCard list={[attendees[2]!]} />
