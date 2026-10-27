// История по дням. Месяцы — свёрнутые группы: за год журнала выходит триста строк,
// и прокрутить их до нужной даты нереально. Раскрыт последний, остальные тапом.

import { Fragment, useState, type ReactNode } from 'react'
import { api } from '../api'
import { dayNum, MONTHS_NOM, monthIdx, peopleWord, plural, WEEKDAYS_SHORT, weekdayIdx, yearOf } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { useRemote } from '../remote'
import { push } from '../store'
import { dayEnd, fmtDuration, heatLevel, hoursNum } from '../stats'
import type { StatsDaySummary, StatsDaysView } from '../types'
import { BackRow, EmptyState, ErrorState, Header, Sep } from '../components/common'
import { FloatingMonth } from '../components/FloatingMonth'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'

type Group = { key: string; title: string; days: StatsDaySummary[]; minutes: number }

/**
 * Верх шкалы ячеек дня: двое на весь двухчасовой интервал. Шкала одна на все дни, иначе
 * тихий день и людный выглядели бы одинаково; по самому людному дню бледнели бы все.
 */
const DAY_CELL_FULL = 240

/**
 * Сутки строкой: двенадцать ячеек по два часа в ступенях тепловой карты. Стоят вместо
 * «с … до …», которые при трёх часах из девятнадцати прятали, когда было людно. Пустая
 * ячейка с провалом роутера штрихуется, как в карте.
 */
function DayStrip({ day }: { day: StatsDaySummary }) {
  const gaps = new Set(day.gaps ?? [])
  return (
    <span className="day12" role="img" aria-label={nb(`с ${day.from} до ${dayEnd(day.to)}`)}>
      {day.buckets!.map((v, i) => {
        const level = heatLevel(v, DAY_CELL_FULL)
        if (level > 0) return <i key={i} style={{ background: `var(--heat-${level})` }} />
        return <i key={i} className={gaps.has(i) ? 'nodata' : undefined} />
      })}
    </span>
  )
}

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

/**
 * Скелет повторяет свёрнутый список: свежий месяц раскрыт днями, остальные —
 * одной строкой. Дни с плиткой даты, поэтому у них кружок-заглушка слева.
 */
function DaysSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем историю по дням">
      <div className="card month-group">
        <SkRows count={1} card={false} />
        <SkRows count={5} avatar card={false} />
      </div>
      <div className="card month-group">
        <SkRows count={1} card={false} />
      </div>
      <div className="card month-group">
        <SkRows count={1} card={false} />
      </div>
    </div>
  )
}

export function StatsDays() {
  const { data, error, loading, pending, reload } = useRemote(() => api<StatsDaysView>('stats.days'), [])
  // Только то, что человек раскрыл или свернул сам; остальное считается от данных.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  // Раскрыт свежий месяц: за ним приходят чаще всего. Считается при отрисовке, а не
  // эффектом после загрузки: эффект раскрывал месяц уже на экране, и список выезжал
  // сам, без тапа. После «Повторить» выбор так же идёт за пришедшими данными.
  const freshMonth = data?.days[0]?.dateKey.slice(0, 7)

  // Шапка держится на месте, подменяется только тело: каркас гаснет поверх
  // проявляющихся данных, а не исчезает в том же кадре.
  const frame = (subtitle: string | undefined, body: ReactNode) => (
    <Screen>
      <BackRow label="Статистика" />
      <Header title="История по дням" subtitle={subtitle} />
      <Swap loading={loading && !data} skeleton={pending ? <DaysSkeleton /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  if (error) return frame(undefined, <ErrorState onRetry={reload} />)
  if (loading && !data) return frame(undefined, null)
  if (!data || data.days.length === 0) {
    return frame(
      undefined,
      <div className="card">
        <EmptyState title="Дней с отметками пока нет" />
      </div>,
    )
  }

  const groups = groupByMonth(data.days)
  const toggle = (key: string, isOpen: boolean): void => setToggled((cur) => ({ ...cur, [key]: !isOpen }))

  return frame(
    nb(`${data.days.length} ${plural(data.days.length, 'день', 'дня', 'дней')} с отметками`),
    <>
      <FloatingMonth />
      {groups.map((group) => {
        const isOpen = toggled[group.key] ?? group.key === freshMonth
        return (
          <div className="card month-group stats-list" key={group.key} data-month={group.title}>
            <button
              type="button"
              className="row tappable month-head"
              onClick={() => toggle(group.key, isOpen)}
              aria-expanded={isOpen}
            >
              <span className="row-label">
                {group.title}
                <span className="row-sublabel">
                  {nb(`${group.days.length} ${plural(group.days.length, 'день', 'дня', 'дней')} · ${hoursNum(group.minutes)} ч`)}
                </span>
              </span>
              <div className="row-right">
                <span className={'chev' + (isOpen ? ' open' : '')}>{icons.chevron()}</span>
              </div>
            </button>
            <div className={'collapsible' + (isOpen ? ' open' : '')}>
              <div className="collapsible-inner">
                {group.days.map((day, i) => (
                  <Fragment key={day.dateKey}>
                    {/* Под строкой месяца разделитель от края текста, между днями - после плитки даты. */}
                    <Sep inset={i > 0 ? 42 : 'text'} />
                    <button
                      type="button"
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
                          {day.buckets?.length === 12
                            ? nb(`${peopleWord(day.people)} · пик ${day.peak}`)
                            : nb(`с ${day.from} до ${dayEnd(day.to)} · ${peopleWord(day.people)} · пик ${day.peak}`)}
                        </span>
                      </span>
                      <div className="row-right">
                        {day.buckets?.length === 12 ? <DayStrip day={day} /> : null}
                        {icons.chevron()}
                      </div>
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </>,
  )
}
