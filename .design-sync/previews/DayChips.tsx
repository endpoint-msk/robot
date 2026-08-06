import { DayChips } from 'endpoint-robot-webapp'
import { DAY_KEYS, days } from '../fixture'

export const WithCounts = () => (
  <DayChips days={days} selected={DAY_KEYS[0]} onSelect={() => {}} />
)

export const OtherSelected = () => (
  <DayChips days={days} selected={DAY_KEYS[2]} onSelect={() => {}} />
)

export const NoCounts = () => (
  <DayChips days={days} selected={DAY_KEYS[1]} onSelect={() => {}} showCounts={false} />
)
