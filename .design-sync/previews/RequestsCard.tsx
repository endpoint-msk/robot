import { RequestsCard } from 'endpoint-robot-webapp'
import { approvedRequest, pendingRequest, proposedByGuestRequest } from '../fixture'

/** Заявки дня: строки в одной карточке, разделители с отступом под аватарку. */
export const DayList = () => (
  <RequestsCard list={[approvedRequest, pendingRequest, proposedByGuestRequest]} />
)

/** Одна заявка — разделителей нет. */
export const Single = () => <RequestsCard list={[pendingRequest]} />

/** Архив недели: то же самое, но только чтение. */
export const Archive = () => <RequestsCard list={[approvedRequest, pendingRequest]} archive />
