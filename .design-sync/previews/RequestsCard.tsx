import { RequestsCard } from 'endpoint-robot-webapp'
import { approvedRequest, pendingRequest, proposedByGuestRequest } from '../fixture'

export const DayList = () => (
  <RequestsCard list={[approvedRequest, pendingRequest, proposedByGuestRequest]} />
)

export const Single = () => <RequestsCard list={[pendingRequest]} />

export const Archive = () => <RequestsCard list={[approvedRequest, pendingRequest]} archive />
