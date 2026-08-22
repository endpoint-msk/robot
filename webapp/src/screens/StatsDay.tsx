// Один день журнала: сколько спейс был открыт и кто когда внутри был.
// Таймлайн строится по сырым сессиям, поэтому доступен, пока живут месячные файлы.

import type { ReactNode } from 'react'
import { api } from '../api'
import { fmtWeekdayDate, plural } from '../dates'
import { useRemote } from '../remote'
import { push, useParams } from '../store'
import { fmtDuration, fmtMinutes, statsAvatarUser } from '../stats'
import type { StatsDayRow, StatsDayView } from '../types'
import { BackRow, EmptyState, ErrorState, Footnote, Header } from '../components/common'
import { Avatar } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkBlock, SkCard } from '../components/skeleton'

/**
 * Сколько делений подписываем на шкале — ровно столько, первое в начале дорожки,
 * последнее в конце. Дорожка делит строку с ником и колонкой времени, на 390px ей
 * достаётся около 150px — семь подписей по 28px там просто слипались в сплошную
 * строку цифр.
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

/** Человек на таймлайне: все его визиты за день — отрезки одной дорожки. */
type PersonRow = {
  userId: number
  username: string | null
  label: string
  visits: StatsDayRow[]
  fromMin: number
  toMin: number
}

/**
 * Строка таймлайна — человек, а не визит. Отлучка длиннее склейки (15 мин) режет день
 * на несколько сессий, и каждая занимала свою строку: один человек с перерывом на обед
 * выглядел как двое, споря с «1 человек за день» в карточке выше. Порядок людей — по
 * первому приходу, он уже задан сортировкой строк с сервера.
 */
const groupByPerson = (rows: StatsDayRow[]): PersonRow[] => {
  const byUser = new Map<number, PersonRow>()
  const out: PersonRow[] = []
  for (const r of rows) {
    const seen = byUser.get(r.userId)
    if (seen) {
      seen.visits.push(r)
      seen.fromMin = Math.min(seen.fromMin, r.fromMin)
      seen.toMin = Math.max(seen.toMin, r.toMin)
      continue
    }
    const person: PersonRow = {
      userId: r.userId,
      username: r.username,
      label: r.label,
      visits: [r],
      fromMin: r.fromMin,
      toMin: r.toMin,
    }
    byUser.set(r.userId, person)
    out.push(person)
  }
  return out
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

  // Шапка одна на все состояния, меняется только тело — его и подменяет Swap:
  // каркас гаснет поверх проявляющихся данных, а не исчезает рывком.
  const frame = (body: ReactNode) => (
    <Screen>
      <BackRow label={backLabel ?? 'История по дням'} />
      <Header title={fmtWeekdayDate(dateKey)} subtitle="Журнал присутствия" />
      <Swap loading={loading && !data} skeleton={pending ? <DaySkeleton /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  if (error) return frame(<ErrorState onRetry={reload} />)
  if (loading && !data) return frame(null)
  if (!data || data.rows.length === 0) {
    return frame(
      <div className="card">
        <EmptyState title="В этот день отметок не было" />
      </div>,
    )
  }

  const { start, end } = rangeOf(data)
  const span = Math.max(1, end - start)
  // Делим окно на равные части, а не шагаем круглыми часами от начала: шаг, не
  // делящий окно нацело, не доводил подписи до конца дорожки (14:00 → 00:00 шагом
  // 4 ч упирается в 22:00), а последняя подпись всё равно прижималась к правому
  // краю — и уезжала от своего деления на всю свою ширину. Окно кратно часу,
  // поэтому деления попадают на :00 или :30.
  const step = span / (MAX_TICKS - 1)
  const ticks: number[] = []
  for (let i = 0; i < MAX_TICKS; i++) ticks.push(start + step * i)
  const pct = (minutes: number): number => ((minutes - start) / span) * 100
  const people = groupByPerson(data.rows)

  return frame(
    <>
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
        {people.map((p) => (
          <button
            type="button"
            className="tl-row"
            key={p.userId}
            onClick={() => push('statsPerson', { userId: p.userId, backLabel: 'Назад' })}
          >
            <div className="tl-name">
              <Avatar user={statsAvatarUser(p)} className="stat-avatar small" />
              <span>{p.label}</span>
            </div>
            <div className="tl-track">
              {ticks.slice(1, -1).map((t) => (
                <i className="tl-grid" key={t} style={{ left: `${pct(t)}%` }} />
              ))}
              {p.visits.map((v, j) => (
                <i
                  key={`${v.fromMin}-${j}`}
                  className={'tl-bar' + (v.source === 'mac' ? ' mac' : '')}
                  style={{ left: `${pct(v.fromMin)}%`, width: `${Math.max(1.5, pct(v.toMin) - pct(v.fromMin))}%` }}
                />
              ))}
            </div>
            {/* Интервал отдельной колонкой, а не под ником: в вебвью нет hover, и
                через нативный title время визита было не прочитать вовсе. У нескольких
                визитов это от первого прихода до последнего ухода — перерывы видно по
                самой дорожке. */}
            <div className="tl-when">{`${fmtMinutes(p.fromMin)}–${fmtMinutes(p.toMin)}`}</div>
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
    </>,
  )
}
