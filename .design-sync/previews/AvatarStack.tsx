import { AvatarStack } from 'endpoint-robot-webapp'
import { anya, dasha, kostya, misha, zhenya } from '../fixture'

export const InDayRow = () => (
  <div className="card">
    <div className="row">
      <div className="day-col">
        <div className="dow">Ср</div>
        <div className="date">5 августа</div>
      </div>
      <AvatarStack users={[misha, anya, dasha]} />
      <span className="day-count">3 заявки</span>
    </div>
  </div>
)

export const Overflow = () => <AvatarStack users={[misha, anya, dasha, kostya, zhenya]} />

export const MaxFive = () => <AvatarStack users={[misha, anya, dasha, kostya, zhenya]} max={5} />
