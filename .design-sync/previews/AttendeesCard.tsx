import { AttendeesCard } from 'endpoint-robot-webapp'
import { attendees } from '../fixture'

/** «Кто придёт»: резиденты первыми, потом подтверждённые гости со временем. */
export const Day = () => <AttendeesCard list={attendees} />

/** Один человек — карточка без разделителей. */
export const Single = () => <AttendeesCard list={[attendees[2]!]} />
