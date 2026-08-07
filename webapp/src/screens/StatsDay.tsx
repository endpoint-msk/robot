// Один день журнала: сколько спейс был открыт и кто когда внутри был.
// Таймлайн строится по сырым сессиям, поэтому доступен, пока живут месячные файлы.

import { api } from '../api'
import { fmtWeekdayDate, plural } from '../dates'
import { useRemote } from '../remote'
import { push, useParams } from '../store'
import { fmtDuration, fmtMinutes, gradientFor, initialOf } from '../stats'
import type { StatsDayView } from '../types'
import { BackRow, EmptyState, ErrorState, Footnote, Header } from '../components/common'
import { Screen } from '../components/Screen'
import { SkBlock, SkCard } from '../components/skeleton'

/**
 * Сколько делений подписываем на шкале. Дорожка делит строку с ником и колонкой
 * времени, на 390px ей достаётся около 150px — семь подписей по 28px там просто
 * слипались в сплошную строку цифр.
 */
const MAX_TICKS = 3

/** Окно таймлайна: от начала первого визита до конца последнего, по целым часам. */
const rangeOf = (data: StatsDayView): { start: number; end: number } => {
  if (data.rows.length === 0) return { start: 8 * 60, end: 24 * 60 }
  const min = Math.min(...data.rows.map((r) => r.fromMin))
  const max = Math.max(...data.rows.map((r) => r.toMin))
  let start = Math.max(0, Math.floor(min / 60) * 60)
  let end = Math.min(24 * 60, Math.ceil(max / 60) * 60)
  if (end - start < 180) {
    start = Math.max(0, start - 60)
    end = Math.min(24 * 60, end + 60)
  }
  return { start, end }
}

/**
 * Полосы скелета: отступ слева и длина в процентах дорожки. Одинаковые интервалы
 * во всех строках читаются как готовая таблица, а не как ожидание.
 */
const SK_BARS = [
  { left: 6, width: 52 },
  { left: 24, width: 34 },
  { left: 2, width: 71 },
  { left: 41, width: 26 },
  { left: 15, width: 45 },
]

/** Скелет: итог дня и таймлайн — те же две карточки, что и с данными. */
function DaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем день">
      <div className="card stats-card">
        <SkBlock w={132} h={28} />
        <SkBlock w="52%" style={{ display: 'block', marginTop: 12 }} />
        <div className="sep" style={{ margin: '14px 0 12px' }} />
        <div className="stats-pair">
          <div>
            <SkBlock w={30} h={22} />
            <SkBlock w={118} h={13} style={{ display: 'block', marginTop: 5 }} />
          </div>
          <div>
            <SkBlock w={30} h={22} />
            <SkBlock w={102} h={13} style={{ display: 'block', marginTop: 5 }} />
          </div>
        </div>
      </div>

      <SkCard title="Кто когда был">
        {/* Строка подписей пустая: место под ось держим, а часы выдумывать нечем — они
            считаются по самим визитам. */}
        <div className="tl-ticks">
          <div className="tl-name" />
          <div className="tl-track" />
          <div className="tl-when" />
        </div>
        {SK_BARS.map((bar, i) => {
          const delay = { animationDelay: `${i * 90}ms` }
          return (
            <div className="tl-row" key={i}>
              <div className="tl-name">
                <SkBlock w={22} h={22} style={{ ...delay, borderRadius: '50%' }} />
                <SkBlock w={`${58 - (i % 3) * 11}%`} h={11} style={delay} />
              </div>
              <div className="tl-track">
                <SkBlock
                  w={`${bar.width}%`}
                  h={12}
                  style={{ ...delay, display: 'block', marginTop: 2, marginLeft: `${bar.left}%` }}
                />
              </div>
              <div className="tl-when">
                <SkBlock w={44} h={9} style={delay} />
              </div>
            </div>
          )
        })}
      </SkCard>
    </div>
  )
}

export function StatsDay() {
  const { dateKey, backLabel } = useParams() as { dateKey: string; backLabel?: string }
  const { data, error, loading, pending, reload } = useRemote(
    () => api<StatsDayView>('stats.day', { dateKey }),
    [dateKey],
  )

  const back = <BackRow label={backLabel ?? 'История по дням'} />

  if (error) {
    return (
      <Screen>
        {back}
        <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />
        <ErrorState onRetry={reload} />
      </Screen>
    )
  }
  if (loading && !data) {
    return (
      <Screen>
        {back}
        <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />
        {pending ? <DaySkeleton /> : null}
      </Screen>
    )
  }
  if (!data || data.rows.length === 0) {
    return (
      <Screen>
        {back}
        <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />
        <div className="card">
          <EmptyState title="В этот день отметок не было" />
        </div>
      </Screen>
    )
  }

  const { start, end } = rangeOf(data)
  const span = Math.max(1, end - start)
  const step = Math.ceil(span / 60 / MAX_TICKS) * 60
  const ticks: number[] = []
  for (let t = start; t <= end; t += step) ticks.push(t)
  const pct = (minutes: number): number => ((minutes - start) / span) * 100

  return (
    <Screen>
      {back}
      <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />

      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main sf-mid">{fmtDuration(data.openMinutes)}</span>
        </div>
        <div className="stats-note">{`Открыт с ${data.from} до ${data.to}`}</div>
        <div className="sep" style={{ margin: '14px 0 12px' }} />
        <div className="stats-pair">
          <div>
            <div className="sp-num">{data.people}</div>
            <div className="sp-label">{`${plural(data.people, 'человек', 'человека', 'человек')} за день`}</div>
          </div>
          <div>
            <div className="sp-num">{data.peak}</div>
            <div className="sp-label">пик одновременно</div>
          </div>
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-title">Кто когда был</div>
        <div className="tl-ticks">
          <div className="tl-name" />
          <div className="tl-track">
            {ticks.map((t, i) => (
              <span
                key={t}
                style={{
                  left: `${pct(t)}%`,
                  // Крайние подписи прижаты к концам дорожки, а не отцентрованы по
                  // делению: иначе первая заезжает под колонку имени, а последняя
                  // вылезает за карточку.
                  ...(i === 0 ? { transform: 'none' } : {}),
                  ...(i === ticks.length - 1 ? { transform: 'translateX(-100%)' } : {}),
                }}
              >
                {fmtMinutes(t)}
              </span>
            ))}
          </div>
          <div className="tl-when" />
        </div>
        {data.rows.map((r, i) => (
          <button
            type="button"
            className="tl-row"
            key={`${r.userId}-${i}`}
            onClick={() => push('statsPerson', { userId: r.userId, backLabel: 'Назад' })}
          >
            <div className="tl-name">
              <div className="avatar-ini small" style={{ background: gradientFor(r.userId) }}>
                {initialOf(r.label)}
              </div>
              <span>{r.label}</span>
            </div>
            <div className="tl-track">
              {ticks.slice(1, -1).map((t) => (
                <i className="tl-grid" key={t} style={{ left: `${pct(t)}%` }} />
              ))}
              <i
                className={'tl-bar' + (r.source === 'mac' ? ' mac' : '')}
                style={{ left: `${pct(r.fromMin)}%`, width: `${Math.max(1.5, pct(r.toMin) - pct(r.fromMin))}%` }}
              />
            </div>
            {/* Интервал отдельной колонкой, а не под ником: в вебвью нет hover, и
                через нативный title время визита было не прочитать вовсе. */}
            <div className="tl-when">{`${fmtMinutes(r.fromMin)}–${fmtMinutes(r.toMin)}`}</div>
          </button>
        ))}
        <div className="tl-legend">
          <span>
            <i className="tl-swatch" />
            отметился сам
          </span>
          <span>
            <i className="tl-swatch mac" />
            по MAC
          </span>
        </div>
      </div>

      {data.gaps.length > 0 ? (
        <Footnote>
          {`Часть дня данных не было: роутер не отвечал (${data.gaps
            .map((b) => `${String(b * 2).padStart(2, '0')}:00`)
            .join(', ')}). Отметок в это время могло быть больше.`}
        </Footnote>
      ) : null}
    </Screen>
  )
}
