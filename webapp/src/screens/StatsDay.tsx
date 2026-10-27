// Один день журнала: сколько спейс был открыт и кто когда внутри был.
// Таймлайн строится по сырым сессиям, поэтому доступен, пока живут месячные файлы.

import { useRef, useState, type ReactNode } from 'react'
import { api, prefetchOnTouch } from '../api'
import { fmtWeekdayDate, plural } from '../dates'
import { nb } from '../format'
import { clamp } from '../motion'
import { useRemote } from '../remote'
import { push, useParams } from '../store'
import { dayEnd, fmtDuration, fmtMinutes, statsAvatarUser, useScrub } from '../stats'
import { haptic } from '../telegram'
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

/** Конец суток пишем как 24:00: «00:00» в конце дорожки читалось как её начало. */
const clock = (minutes: number): string => (minutes >= 24 * 60 ? '24:00' : fmtMinutes(minutes))

/** Провалы роутера: двухчасовые интервалы, как у клеток карты, соседние склеены. */
const gapRanges = (gaps: number[]): { from: number; to: number }[] => {
  const out: { from: number; to: number }[] = []
  for (const b of [...gaps].sort((x, y) => x - y)) {
    const last = out[out.length - 1]
    if (last && last.to === b * 120) last.to += 120
    else out.push({ from: b * 120, to: b * 120 + 120 })
  }
  return out
}

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

/** Кто был внутри в минуту `m`: люди, у которых визит её накрывает. */
const insideAt = (people: PersonRow[], m: number): number[] =>
  people.filter((p) => p.visits.some((v) => v.fromMin <= m && m < v.toMin)).map((p) => p.userId)

/**
 * Карточка «Кто когда был». По дорожкам ведут пальцем: линия встаёт на минуту под
 * пальцем, над ней время и сколько было внутри, строки тех, кто был, остаются, остальные
 * гаснут. Пик одновременно из карточки выше виден прямо здесь, и видно, кто его сделал.
 * Отпустили, и всё гаснет: линия, оставшаяся без пальца, читалась бы забытой меткой.
 */
function DayTimeline({ data }: { data: StatsDayView }) {
  // Кто внутри в минуту под пальцем. null: пальца на дорожках нет.
  const [inside, setInside] = useState<Set<number> | null>(null)
  const [scrub, setScrub] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const geo = useRef({ left: 0, track: 0, width: 1, area: 0 })
  const crowd = useRef<string | null>(null)

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
  // Провал внутри окна штрихуется прямо на дорожках, как клетка карты: пустая дорожка
  // там утверждала бы, что никого не было, а мы этого не знаем.
  const shownGaps = gapRanges(data.gaps)
    .map((g) => ({ from: Math.max(g.from, start), to: Math.min(g.to, end) }))
    .filter((g) => g.to > g.from)

  const show = (x: number, first: boolean): void => {
    const g = geo.current
    const frac = clamp((x - g.left - g.track) / g.width, 0, 1)
    // Последняя минута окна, а не его конец: на самом краю дорожки все визиты уже кончились.
    const m = Math.min(end - 1, Math.round(start + frac * span))
    const ids = insideAt(people, m)
    const key = ids.join(',')
    if (first || key !== crowd.current) {
      crowd.current = key
      haptic.tick()
      setInside(new Set(ids))
    }
    const line = lineRef.current
    const pill = pillRef.current
    if (!line || !pill) return
    const lx = g.track + frac * g.width
    line.style.transform = `translateX(${lx.toFixed(1)}px)`
    pill.textContent = `${clock(m)} · ${ids.length > 0 ? `внутри ${ids.length}` : 'никого'}`
    const w = pill.offsetWidth
    pill.style.transform = `translate(${clamp(lx - w / 2, g.track - 6, g.area - w).toFixed(1)}px, -6px)`
  }

  useScrub(areaRef, {
    start(x) {
      const area = areaRef.current
      if (!area) return
      const box = area.getBoundingClientRect()
      const tracks = area.querySelectorAll<HTMLElement>('.tl-row .tl-track')
      const first = tracks[0]?.getBoundingClientRect()
      const last = tracks[tracks.length - 1]?.getBoundingClientRect()
      if (!first || !last) return
      geo.current = { left: box.left, track: first.left - box.left, width: Math.max(1, first.width), area: box.width }
      if (lineRef.current) {
        lineRef.current.style.top = `${(first.top - box.top - 4).toFixed(1)}px`
        lineRef.current.style.height = `${(last.bottom - first.top + 8).toFixed(1)}px`
      }
      setScrub(true)
      show(x, true)
    },
    move(x) {
      show(x, false)
    },
    end() {
      crowd.current = null
      setScrub(false)
      setInside(null)
    },
  })

  return (
    <div className="card stats-card">
      <div className="stats-card-title">Кто когда был</div>
      <div
        className={'tl-scrub' + (scrub ? ' scrubbing' : '') + (inside ? ' lit' : '')}
        data-scrub=""
        ref={areaRef}
      >
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
                {clock(t)}
              </span>
            ))}
          </div>
          <div className="tl-when" />
        </div>
        {people.map((p) => (
          <button
            type="button"
            className={'tl-row' + (inside ? (inside.has(p.userId) ? ' in' : ' out') : '')}
            key={p.userId}
            {...prefetchOnTouch('stats.person', { userId: p.userId, period: 'quarter' })}
            onClick={() =>
              push('statsPerson', {
                userId: p.userId,
                // Карточки этого дня листаются в порядке дорожек.
                people: people.map((x) => ({ userId: x.userId, label: x.label, username: x.username })),
                backLabel: 'Назад',
              })
            }
          >
            <div className="tl-name">
              <Avatar user={statsAvatarUser(p)} className="stat-avatar small" />
              <span>{p.label}</span>
            </div>
            <div className="tl-track">
              {ticks.slice(1, -1).map((t) => (
                <i className="tl-grid" key={t} style={{ left: `${pct(t)}%` }} />
              ))}
              {shownGaps.map((g) => (
                <i
                  className="tl-gap"
                  key={`gap-${g.from}`}
                  style={{ left: `${pct(g.from)}%`, width: `${pct(g.to) - pct(g.from)}%` }}
                />
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
            <div className="tl-when">{`${clock(p.fromMin)}–${clock(p.toMin)}`}</div>
          </button>
        ))}
        <i className="tl-line" ref={lineRef} />
        <div className="tl-pill" ref={pillRef} aria-hidden="true" />
      </div>
      <div className="tl-legend">
        <span>
          <i className="tl-swatch" />
          отметился сам
        </span>
        <span>
          <i className="tl-swatch mac" />
          по MAC
        </span>
        {shownGaps.length > 0 ? (
          <span>
            <i className="tl-swatch gap" />
            роутер был недоступен
          </span>
        ) : null}
      </div>
    </div>
  )
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
  const { dateKey } = useParams() as { dateKey: string }
  const { data, error, loading, pending, reload } = useRemote(
    () => api<StatsDayView>('stats.day', { dateKey }),
    [dateKey],
  )

  // Шапка одна на все состояния, меняется только тело — его и подменяет Swap:
  // каркас гаснет поверх проявляющихся данных, а не исчезает рывком.
  const frame = (body: ReactNode) => (
    <Screen>
      <BackRow />
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

  const gapSpans = gapRanges(data.gaps).map((g) => nb(`с ${clock(g.from)} до ${clock(g.to)}`))

  return frame(
    <>
      <div className="card stats-card">
        <div className="stats-figure">
          <span className="sf-main sf-mid">{fmtDuration(data.openMinutes)}</span>
        </div>
        <div className="stats-note">{nb(`Открыт с ${data.from} до ${dayEnd(data.to)}`)}</div>
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

      <DayTimeline data={data} />

      {gapSpans.length > 0 ? (
        <Footnote>
          {`Часть дня данных не было: роутер не отвечал в ${gapSpans.length > 1 ? 'промежутках' : 'промежутке'} ${
            gapSpans.length > 1 ? `${gapSpans.slice(0, -1).join(', ')} и ${gapSpans[gapSpans.length - 1]}` : gapSpans[0]
          }. Отметок в это время могло быть больше.`}
        </Footnote>
      ) : null}
    </>,
  )
}
