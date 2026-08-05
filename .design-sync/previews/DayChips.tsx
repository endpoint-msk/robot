import { DayChips } from 'endpoint-robot-webapp'
import { DAY_KEYS, days } from '../fixture'

/** Выбор дня в форме заявки: под числом — сколько всего заявок и сколько одобрено. */
export const WithCounts = () => (
  <DayChips days={days} selected={DAY_KEYS[0]} onSelect={() => {}} />
)

/** Другой выбранный день — синяя плашка едет за выбором. */
export const OtherSelected = () => (
  <DayChips days={days} selected={DAY_KEYS[2]} onSelect={() => {}} />
)

/** Без счётчиков — так чипы выглядят в модалке переноса. */
export const NoCounts = () => (
  <DayChips days={days} selected={DAY_KEYS[1]} onSelect={() => {}} showCounts={false} />
)
