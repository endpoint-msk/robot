import { AvatarStack } from 'endpoint-robot-webapp'
import { anya, dasha, kostya, misha, zhenya } from '../fixture'

/** Стопка в строке дня: 26px, с нахлёстом и обводкой цвета карточки. */
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

/** По умолчанию видно троих — остальные схлопываются. */
export const Overflow = () => <AvatarStack users={[misha, anya, dasha, kostya, zhenya]} />

/** Больше лиц в стопке: max поднимает потолок. */
export const MaxFive = () => <AvatarStack users={[misha, anya, dasha, kostya, zhenya]} max={5} />
