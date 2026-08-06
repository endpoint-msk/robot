import { RequestRow } from 'endpoint-robot-webapp'
import {
  approvedRequest,
  pendingRequest,
  proposedByGuestRequest,
  proposedByResidentRequest,
} from '../fixture'

export const Pending = () => (
  <div className="card">
    <RequestRow r={pendingRequest} />
  </div>
)

export const Approved = () => (
  <div className="card">
    <RequestRow r={approvedRequest} />
  </div>
)

export const GuestProposal = () => (
  <div className="card">
    <RequestRow r={proposedByGuestRequest} />
  </div>
)

export const ResidentProposal = () => (
  <div className="card">
    <RequestRow r={proposedByResidentRequest} />
  </div>
)

export const Archive = () => (
  <div className="card">
    <RequestRow r={approvedRequest} archive />
  </div>
)
