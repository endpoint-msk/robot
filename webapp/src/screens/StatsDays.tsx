// История по дням. Месяцы — свёрнутые группы: за год журнала выходит триста строк,
// и прокрутить их до нужной даты нереально. Раскрыт последний, остальные тапом.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { dayNum, MONTHS_NOM, monthIdx, peopleWord, plural, WEEKDAYS_SHORT, weekdayIdx, yearOf } from '../dates'
import { icons } from '../icons'
import { push } from '../store'
import { fmtDuration, hoursNum } from '../stats'
import type { StatsDaySummary, StatsDaysView } from '../types'
import { BackRow, EmptyState, Header, Sep, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

type Group = { key: string; title: string; days: StatsDaySummary[]; minutes: number }

const groupByMonth = (days: StatsDaySummary[]): Group[] => {
  const out: Group[] = []
  for (const day of days) {
    const key = day.dateKey.slice(0, 7)
    const last = out[out.length - 1]
    if (last && last.key === key) {
      last.days.push(day)
      last.minutes += day.openMinutes
    } else {
      out.push({
        key,
        title: `${MONTHS_NOM[monthIdx(day.dateKey)]} ${yearOf(day.dateKey)}`,
        days: [day],
        minutes: day.openMinutes,
      })
    }
  }
  return out
}

export function StatsDays() {
  const [data, setData] = useState<StatsDaysView | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const days = await api<StatsDaysView>('stats.days')
        if (!alive) return
        setData(days)
        // Раскрыт свежий месяц: за ним приходят чаще всего.
        const first = days.days[0]?.dateKey.slice(0, 7)
        if (first) setOpen([first])
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) {
    return (
      <Screen>
        <BackRow label="Статистика" />
        <SpinnerCenter />
      </Screen>
    )
  }
  if (!data || data.days.length === 0) {
    return (
      <Screen>
        <BackRow label="Статистика" />
        <Header title="История по дням" />
        <div className="card">
          <EmptyState title="Дней с отметками пока нет" />
        </div>
      </Screen>
    )
  }

  const groups = groupByMonth(data.days)
  const toggle = (key: string): void =>
    setOpen((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  return (
    <Screen>
      <BackRow label="Статистика" />
      <Header
        title="История по дням"
        subtitle={`${data.days.length} ${plural(data.days.length, 'день', 'дня', 'дней')} с отметками`}
      />
      {groups.map((group) => {
        const isOpen = open.includes(group.key)
        return (
          <div className="card month-group" key={group.key}>
            <div className="row tappable" onClick={() => toggle(group.key)}>
              <span className="row-label">
                {group.title}
                <span className="row-sublabel">
                  {`${group.days.length} ${plural(group.days.length, 'день', 'дня', 'дней')} · ${hoursNum(group.minutes)} ч`}
                </span>
              </span>
              <div className="row-right">
                <span className={'chev' + (isOpen ? ' open' : '')}>{icons.chevron()}</span>
              </div>
            </div>
            <div className={'collapsible' + (isOpen ? ' open' : '')}>
              <div className="collapsible-inner">
                {group.days.map((day) => (
                  <Fragment key={day.dateKey}>
                    <Sep left={14} />
                    <div
                      className="row tappable"
                      onClick={() => push('statsDay', { dateKey: day.dateKey, backLabel: 'История по дням' })}
                    >
                      <div className="date-tile">
                        <span className="dt-num">{dayNum(day.dateKey)}</span>
                        <span className="dt-sub">{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]?.toLowerCase()}</span>
                      </div>
                      <span className="row-label">
                        {fmtDuration(day.openMinutes)}
                        <span className="row-sublabel">
                          {`с ${day.from} до ${day.to} · ${peopleWord(day.people)} · пик ${day.peak}`}
                        </span>
                      </span>
                      <div className="row-right">{icons.chevron()}</div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </Screen>
  )
}
