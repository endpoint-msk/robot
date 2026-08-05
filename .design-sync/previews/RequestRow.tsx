import { RequestRow } from 'endpoint-robot-webapp'
import {
  approvedRequest,
  pendingRequest,
  proposedByGuestRequest,
  proposedByResidentRequest,
} from '../fixture'

/** Ничья заявка: справа «Захостить», её может взять любой резидент. */
export const Pending = () => (
  <div className="card">
    <RequestRow r={pendingRequest} />
  </div>
)

/** Захостили: справа пилл того, кто взял визит (свой — с крестиком отмены). */
export const Approved = () => (
  <div className="card">
    <RequestRow r={approvedRequest} />
  </div>
)

/** Гость предложил другое время — адресату видна кнопка «Принять». */
export const GuestProposal = () => (
  <div className="card">
    <RequestRow r={proposedByGuestRequest} />
  </div>
)

/** Предложение резидента: плашка «ждём гостя», кнопки принять нет. */
export const ResidentProposal = () => (
  <div className="card">
    <RequestRow r={proposedByResidentRequest} />
  </div>
)

/** Архив: только чтение — ни свайпа, ни кнопок. */
export const Archive = () => (
  <div className="card">
    <RequestRow r={approvedRequest} archive />
  </div>
)
