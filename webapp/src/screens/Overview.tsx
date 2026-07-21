import { Fragment } from 'react'
import { fmtRange, requestsWord } from '../dates'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { DevChips, Header, Sep } from '../components/common'
import { DayRow } from '../components/DayRow'
import { Screen } from '../components/Screen'

export function Overview() {
  const { data } = useStore()
  const days = data!.days
  const total = days.reduce((sum, d) => sum + d.total, 0)
  const first = days[0]!.dateKey
  const last = days[days.length - 1]!.dateKey

  return (
    <Screen>
      <Header title="Ближайшие дни" subtitle={`${fmtRange(first, last)} · ${requestsWord(total)}`} chip={<DevChips />} />
      <div className="card">
        {days.map((day, i) => (
          <Fragment key={day.dateKey}>
            {i > 0 ? <Sep left={86} /> : null}
            <DayRow day={day} tappable onOpen={() => push('day', { dateKey: day.dateKey })} />
          </Fragment>
        ))}
      </div>
      <div style={{ height: 22 }} />
      <div className="card">
        <div className="row tappable" onClick={() => push('archive')}>
          <div className="row-icon" style={{ background: '#5856d6' }}>
            {icons.archiveBox()}
          </div>
          <span className="row-label">Архив</span>
          <div className="row-right">{icons.chevron()}</div>
        </div>
        <Sep left={54} />
        <div className="row tappable" onClick={() => push('settings')}>
          <div className="row-icon" style={{ background: '#8e8e93' }}>
            {icons.gear()}
          </div>
          <span className="row-label">Настройки</span>
          <div className="row-right">{icons.chevron()}</div>
        </div>
      </div>
    </Screen>
  )
}
