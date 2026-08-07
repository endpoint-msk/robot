import { Fragment } from 'react'
import { fmtRange, requestsWord } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { DevChips, Header, Sep } from '../components/common'
import { DayRow } from '../components/DayRow'
import { Screen } from '../components/Screen'

/**
 * Плашка «взнос не отмечен»: висит, пока свой взнос не закрыт, дальше исчезает.
 * Нулевая ставка — освобождение: с человека взнос не спрашивают, и напоминать не о чем.
 */
function DuesBanner() {
  const { data } = useStore()
  const dues = data!.dues
  if (!dues || !dues.enabled || !dues.me.inRoster || dues.me.amount <= 0 || dues.me.status !== 'none') return null
  return (
    <button type="button" className="write-banner" onClick={() => push('dues')}>
      <div className="wb-icon">{icons.rub(17, '#fff')}</div>
      <div className="wb-text">
        <div className="wb-title">{`Взнос за ${dues.periodLabel.split(' ')[0]?.toLowerCase()}, ${money(dues.me.amount, dues.currency)}`}</div>
        <div className="wb-sub">Ещё не отмечен</div>
      </div>
      {icons.chevron()}
    </button>
  )
}

/** Строка входа в раздел взносов со своим статусом справа. */
function DuesRow() {
  const { data } = useStore()
  const dues = data!.dues
  if (!dues) return null
  const status = !dues.enabled
    ? { text: 'Выключены', color: 'var(--text-3)' }
    : !dues.me.inRoster
      ? { text: '', color: 'var(--text-3)' }
      : dues.me.amount <= 0
        ? { text: 'Не требуется', color: 'var(--text-3)' }
        : dues.me.status === 'paid'
          ? { text: 'Внесён', color: 'var(--green)' }
          : dues.me.status === 'claimed'
            ? { text: 'Ждёт сверки', color: 'var(--text-2)' }
            : { text: 'Не внесён', color: 'var(--orange)' }
  return (
    <>
      <button type="button" className="row tappable" onClick={() => push('dues')}>
        <div className="row-icon" style={{ background: 'var(--green)' }}>
          {icons.rub(17, '#fff')}
        </div>
        <span className="row-label">Взносы</span>
        <div className="row-right">
          <span className="dues-amount" style={{ color: status.color }}>
            {status.text}
          </span>
          {icons.chevron()}
        </div>
      </button>
      <Sep left={54} />
    </>
  )
}

export function Overview() {
  const { data } = useStore()
  const days = data!.days
  const total = days.reduce((sum, d) => sum + d.total, 0)
  const first = days[0]!.dateKey
  const last = days[days.length - 1]!.dateKey

  return (
    <Screen>
      <Header title="Ближайшие дни" subtitle={`${fmtRange(first, last)} · ${requestsWord(total)}`} chip={<DevChips />} />
      <DuesBanner />
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
        <button type="button" className="row tappable" onClick={() => push('archive')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.archiveBox()}
          </div>
          <span className="row-label">Архив</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep left={54} />
        <button type="button" className="row tappable" onClick={() => push('stats')}>
          <div className="row-icon" style={{ background: 'var(--blue)' }}>
            {icons.chart()}
          </div>
          <span className="row-label">Статистика</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep left={54} />
        <DuesRow />
        <button type="button" className="row tappable" onClick={() => push('settings')}>
          <div className="row-icon" style={{ background: 'var(--gray)' }}>
            {icons.gear()}
          </div>
          <span className="row-label">Настройки</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>
    </Screen>
  )
}
