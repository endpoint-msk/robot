// Карточка человека в журнале: сколько бывает, когда приходит, последние визиты.
// Открывается и на себя (строка «Мои визиты»), и на любого резидента из топа.

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { action, api } from '../api'
import {
  addDays,
  dayNum,
  fmtDayMonth,
  keyToDate,
  MONTHS_ABBR,
  MONTHS_NOM,
  monthIdx,
  plural,
  weekdayIdx,
  WEEKDAYS_SHORT,
  yearOf,
} from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { datePrompt } from '../modals'
import { useRemote } from '../remote'
import { mixc, palette } from '../motion'
import { push, setTopParams, useParams, useStore } from '../store'
import { fmtDuration, heatCell, heatLevel, hoursNum, hoursNumWord, statsAvatarUser } from '../stats'
import { haptic, hasProfile, openProfile, openUrl } from '../telegram'
import type { StatsPersonView } from '../types'
import { BackRow, ErrorState, Footnote, Sep, Units } from '../components/common'
import { avatarTone } from '../components/people'
import { Pager } from '../components/Pager'
import { ProfileHead, type ProfileAction } from '../components/ProfileHead'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkCard, SkGrid, SkProfile, SkQuad, SkRows } from '../components/skeleton'
import { useLoupe } from '../components/useLoupe'

const DOT_WEEKS = 12

/** Маркер «резидент с самого начала» вместо ключа дня (см. RESIDENT_SINCE_ORIGIN на бэке). */
const ORIGIN = 'origin'

/** Ячейка полосы визита - два часа: полная, если человек был все два. */
const VISIT_CELL_MIN = 120

const minuteOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Визит строкой суток, как день в «Истории по дням» (.day12): двенадцать ячеек по два
 * часа, тон по минутам визита в ячейке. Видно, вечером он был или днём; время целиком
 * уходит в подпись для экранного чтеца. Визит через полночь доходит в полосе до 24:00,
 * длительность в строке полная.
 */
function VisitStrip({ from, to }: { from: string; to: string }) {
  const a = minuteOf(from)
  const b = minuteOf(to) < a ? 24 * 60 : minuteOf(to)
  return (
    <span className="day12" role="img" aria-label={nb(`с ${from} до ${to}`)}>
      {Array.from({ length: 12 }, (_, i) => {
        const level = heatLevel(Math.min(b, (i + 1) * VISIT_CELL_MIN) - Math.max(a, i * VISIT_CELL_MIN), VISIT_CELL_MIN)
        return <i key={i} style={level > 0 ? { background: `var(--heat-${level})` } : undefined} />
      })}
    </span>
  )
}

/**
 * «Когда приходит»: двенадцать недель по дням. Отвечает пальцу, как карта статистики:
 * клетка обведена, день недели слева подсвечен, над пальцем лупа с датой и временем
 * визита. Касание ничего не открывает, а будущие дни не берутся вовсе. На листаемой
 * карточке (`paged`) лупа встаёт удержанием: свайп вбок по карте листает людей.
 */
function DotsCard({ dots, from, todayIndex, paged }: { dots: number[]; from: string; todayIndex: number; paged: boolean }) {
  const [picked, setPicked] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { scrub, loupe, loupeRef, tailRef, place } = useLoupe<number>(gridRef, {
    cells: '.dot[data-i]',
    read: (el) => Number(el.dataset.i),
    same: (a, b) => a === b,
    onPick: setPicked,
    hold: paged,
  })
  // С клеткой меняется подпись в лупе, а с ней ширина: ставим лупу, когда подпись в DOM.
  useLayoutEffect(() => {
    if (scrub) place()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, picked])

  const max = Math.max(...dots, 1)
  // Столбец — неделя, строка — день недели: как в сетке дизайна (grid-auto-flow: column).
  const cells = Array.from({ length: DOT_WEEKS * 7 }, (_, i) => dots[i] ?? 0)
  // Подпись месяца над колонкой, в которой он начинается: без неё сетка показывает
  // ритм, но не отвечает, когда это было. Берём середину недели — месяц, которому
  // принадлежит большая её часть.
  const monthLabels = (() => {
    const seen = new Set<number>()
    return Array.from({ length: DOT_WEEKS }, (_, w) => {
      const month = monthIdx(addDays(from, w * 7 + 3))
      if (seen.has(month)) return ''
      seen.add(month)
      // Именительный падеж: MONTHS_ABBR держит «мая» под плитку «5 мая», а на оси
      // нужен «май».
      return MONTHS_NOM[month]?.slice(0, 3).toLowerCase() ?? ''
    })
  })()
  const dayText = (i: number): string => {
    const key = addDays(from, i)
    return `${WEEKDAYS_SHORT[weekdayIdx(key)]}, ${fmtDayMonth(key)}`
  }
  const spent = (v: number): string => (v > 0 ? fmtDuration(v) : 'без визита')
  const lens = picked !== null ? heatCell(heatLevel(cells[picked] ?? 0, max)) : null

  return (
    <div className="card stats-card">
      <div className="stats-card-title">Когда приходит</div>
      <div className="dots-months">
        {monthLabels.map((label, i) => (
          <div key={i}>{label}</div>
        ))}
      </div>
      <div className="dots" data-scrub={paged ? 'hold' : ''} ref={gridRef}>
        <div className="dots-labels">
          {WEEKDAYS_SHORT.map((d, r) => (
            <div key={d} className={scrub && picked !== null && picked % 7 === r ? 'on' : undefined}>
              {d}
            </div>
          ))}
        </div>
        <div className="dots-grid">
          {cells.map((v, i) => {
            // Дни после сегодняшнего в сетку не попадают: «ещё не наступило» и «не
            // приходил» — разные вещи, а рисовались они одинаково пустой клеткой.
            if (i > todayIndex) return <div key={i} className="dot future" />
            const level = heatLevel(v, max)
            return (
              <div
                key={i}
                className={'dot' + (level === 0 ? ' zero' : '') + (scrub && picked === i ? ' picked' : '')}
                style={level > 0 ? { background: `var(--heat-${level})` } : undefined}
                data-i={i}
                role="img"
                aria-label={`${dayText(i)}: ${spent(v)}`}
              />
            )
          })}
        </div>
      </div>
      <div className="heat-legend">
        <span>{nb('Последние 12 недель')}</span>
        <div className="heat-scale">
          <span>меньше</span>
          {[1, 2, 3, 4, 5].map((level) => (
            <i key={level} style={{ background: `var(--heat-${level})` }} />
          ))}
          <span>больше</span>
        </div>
      </div>
      {loupe && picked !== null && lens
        ? createPortal(
            <div className="stats-loupe" ref={loupeRef} aria-hidden="true">
              <i className={lens.className} style={lens.style} />
              <div className="stats-loupe-text">
                <b>{dayText(picked)}</b>
                <span>{spent(cells[picked] ?? 0)}</span>
              </div>
              <i className="stats-tail" ref={tailRef} />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/** Скелет карточки: шапка, четыре показателя, сетка визитов и список последних. */
function PersonSkeleton({ head }: { head: boolean }) {
  return (
    <div aria-busy="true" aria-label="Загружаем карточку резидента">
      {head ? <SkProfile /> : null}
      <SkQuad />
      <SkCard title="Когда приходит">
        <SkGrid rows={7} cols={DOT_WEEKS} />
      </SkCard>
      <div className="section-title">Последние визиты</div>
      <SkRows count={4} avatar />
    </div>
  )
}

/**
 * «Резидент с 12 марта». Источников три, в порядке убывания доверия: ручная дата
 * (`manualSince`, её ставит dev), вступление в чат резидентов (`joinedSince` —
 * точный ответ, но Telegram не отдаёт его для создателя чата) и первый визит в
 * журнале — он моложе спейса и у старожилов врёт. У основателей даты нет вовсе —
 * для них `ORIGIN`.
 */
const since = (sinceKey: string): string => {
  if (sinceKey === ORIGIN) return 'Резидент с самого начала'
  if (!sinceKey) return 'Визитов в журнале пока нет'
  const year = yearOf(sinceKey)
  const now = new Date().getUTCFullYear()
  return nb(`Резидент с ${fmtDayMonth(sinceKey)}${year === now ? '' : ` ${year}`}`)
}

/** Человек из списка, откуда открыли карточку: шапка рисуется сразу, до ответа сервера. */
export type PersonRef = { userId: number; label: string; username: string | null }

/** Тон полосы под шапкой — второй цвет градиента аватарки, тем же смешением, что тон дня. */
const personTone = (userId: number): string => {
  const C = palette()
  return mixc(C.bg, avatarTone(userId), C.mixp)
}

/**
 * Карточки листаются, если их открыли из списка (`people` в параметрах): «Кто держит спейс
 * открытым», «Мои визиты» (вы первым) или дорожки дня. Порядок того списка, из которого
 * пришли, запомнен в момент открытия: смена периода в статистике его не перетасует.
 */
export function StatsPerson() {
  const params = useParams()
  const userId = params.userId as number
  const people = (params.people as PersonRef[] | undefined) ?? null
  const index = people ? people.findIndex((p) => p.userId === userId) : -1
  if (!people || index < 0 || people.length < 2) {
    return (
      <Screen>
        <BackRow />
        <PersonPage userId={userId} known={people?.[index] ?? null} />
      </Screen>
    )
  }
  return (
    <Screen>
      <Pager
        items={people}
        index={index}
        keyOf={(p) => String(p.userId)}
        onCommit={(i) => setTopParams({ ...params, userId: people[i]!.userId })}
        tone={(p) => personTone(p.userId)}
        top={<BackRow />}
        renderPage={(p) => <PersonPage userId={p.userId} known={p} paged />}
      />
    </Screen>
  )
}

/**
 * Карточка одного человека. `profile` делает из неё свой профиль в настройках: в шапке имя
 * и ник вместо «Мои визиты», а `extra` (права дева) стоит под ней, пока грузится журнал.
 */
export function PersonPage({
  userId,
  known,
  profile,
  extra,
  paged = false,
}: {
  userId: number
  known: PersonRef | null
  profile?: { name: string; username: string | null }
  extra?: ReactNode
  /** Карточка в листалке людей: вбок её листают. */
  paged?: boolean
}) {
  const { data: boot } = useStore()
  const { data, error, pending, reload } = useRemote(
    () => api<StatsPersonView>('stats.person', { userId, period: 'quarter' }),
    [userId],
  )
  const isMe = boot!.me.id === userId
  const who = data?.user ?? known
  const face = who ? statsAvatarUser(who) : null
  const accountUrl = boot!.accountUrl
  // Свой профиль в Telegram себе открывать незачем, а из своего профиля в настройках
  // ведёт кабинет аккаунта спейса.
  const actions: ProfileAction[] = isMe
    ? profile && accountUrl
      ? [{ key: 'account', label: 'Кабинет', icon: icons.account(22, 'currentColor'), onClick: () => openUrl(accountUrl) }]
      : []
    : face && hasProfile(face)
      ? [{ key: 'tg', label: 'Telegram', icon: icons.telegram(22, 'currentColor'), onClick: () => openProfile(face) }]
      : []

  const sinceText = data ? since(data.manualSince || data.joinedSince || data.firstDateKey) : null
  const sub = !sinceText
    ? '\u00a0'
    : profile?.username
      ? `@${profile.username} · ${sinceText.charAt(0).toLowerCase()}${sinceText.slice(1)}`
      : sinceText

  // Шапка стоит сразу, если человека знает список, из которого пришли: по ней листалка
  // меряет полосу. Подменяется только тело:
  // каркас гаснет поверх проявляющейся карточки, а не пропадает в том же кадре.
  const frame = (body: ReactNode) => (
    <>
      {who && face ? (
        <ProfileHead
          user={face}
          name={profile ? profile.name : isMe ? 'Мои визиты' : who.label}
          sub={sub}
          actions={actions}
        />
      ) : null}
      <Swap loading={!data && !error} skeleton={pending ? <PersonSkeleton head={!who} /> : null}>
        {body}
      </Swap>
      {extra}
    </>
  )

  if (error) return frame(<ErrorState onRetry={reload} />)
  // Данных нет только пока идёт первый запрос: `reload` из «Резидент с» держит
  // прошлый ответ на экране, чтобы карточка не мигала спиннером после правки.
  if (!data) return frame(null)

  const sinceKey = data.manualSince || data.joinedSince || data.firstDateKey
  const sinceSource = data.manualSince
    ? 'выставлено вручную'
    : data.joinedSince
      ? 'вступление в чат резидентов'
      : 'первый визит в журнале'

  const setSince = async (dateKey: string | null) => {
    const done = await action('stats.residentSince', { userId, dateKey: dateKey ?? '' })
    if (done) {
      haptic.notify('success')
      reload()
    }
  }

  const askSince = async () => {
    const picked = await datePrompt({
      text: 'Резидент с',
      initial: (sinceKey === ORIGIN ? data.joinedSince || data.firstDateKey : sinceKey) || boot!.todayKey,
      max: boot!.todayKey,
    })
    if (picked) await setSince(picked)
  }

  const todayIndex = Math.round((keyToDate(boot!.todayKey).getTime() - keyToDate(data.dotsFrom).getTime()) / 86_400_000)

  return frame(
    <>
      <div className="card stats-quad">
        <div className="sq-row">
          <div className="sq-cell">
            <div className="sq-num">{data.visits}</div>
            <div className="sq-label">{nb(`${plural(data.visits, 'визит', 'визита', 'визитов')} за 3 месяца`)}</div>
          </div>
          <div className="sq-vsep" />
          <div className="sq-cell">
            <div className="sq-num">{hoursNum(data.minutes)}</div>
            <div className="sq-label">{`${hoursNumWord(data.minutes)} внутри`}</div>
          </div>
        </div>
        <div className="sep" style={{ margin: '0 16px' }} />
        <div className="sq-row">
          <div className="sq-cell">
            <div className="sq-num small">{data.avgMinutes > 0 ? <Units text={fmtDuration(data.avgMinutes)} /> : '—'}</div>
            <div className="sq-label">средний визит</div>
          </div>
          <div className="sq-vsep" />
          <div className="sq-cell">
            <div className="sq-num small">{data.favArrival || '—'}</div>
            <div className="sq-label">обычно приходит</div>
          </div>
        </div>
        {data.hostedGuests > 0 ? (
          <>
            <div className="sep" style={{ margin: '0 16px' }} />
            <div className="sq-row">
              <div className="sq-cell">
                <div className="sq-num small">{data.hostedGuests}</div>
                <div className="sq-label">захостил гостей за всё время</div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <DotsCard dots={data.dots} from={data.dotsFrom} todayIndex={todayIndex} paged={paged} />

      {data.lastVisits.length > 0 ? (
        <>
          <div className="section-title">Последние визиты</div>
          <div className="card stats-list">
            {data.lastVisits.map((v, i) => (
              <Fragment key={`${v.dateKey}-${v.from}`}>
                {i > 0 ? <Sep inset={42} /> : null}
                <button
                  type="button"
                  className="row tappable"
                  onClick={() => push('statsDay', { dateKey: v.dateKey, backLabel: 'Назад' })}
                >
                  <div className="date-tile">
                    <span className="dt-num">{dayNum(v.dateKey)}</span>
                    <span className="dt-sub">{MONTHS_ABBR[monthIdx(v.dateKey)]}</span>
                  </div>
                  <span className="row-label">
                    {fmtDuration(v.minutes)}
                    <span className="row-sublabel">{v.source === 'mac' ? 'по MAC' : 'отметился сам'}</span>
                  </span>
                  <div className="row-right">
                    <VisitStrip from={v.from} to={v.to} />
                    {icons.chevron()}
                  </div>
                </button>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}

      {isMe && boot!.settings && !boot!.settings.logVisits ? (
        <Footnote>Журнал ваших визитов выключен в настройках, поэтому новые визиты сюда не попадают.</Footnote>
      ) : null}

      {boot!.me.isDev ? (
        <>
          <div className="section-title">Резидент с</div>
          <div className="card">
            <button type="button" className="row tappable" onClick={() => void askSince()}>
              <span className="row-label">
                Дата
                <span className="row-sublabel">{sinceSource}</span>
              </span>
              <div className="row-right">
                <span className={'row-value' + (sinceKey ? '' : ' muted')}>
                  {sinceKey === ORIGIN
                    ? 'с самого начала'
                    : sinceKey
                      ? `${fmtDayMonth(sinceKey)} ${yearOf(sinceKey)}`
                      : '—'}
                </span>
                {icons.chevron()}
              </div>
            </button>
            {data.manualSince === ORIGIN ? null : (
              <>
                <Sep inset="text" />
                <button type="button" className="row tappable" onClick={() => void setSince(ORIGIN)}>
                  <span className="row-label" style={{ color: 'var(--blue)' }}>
                    С самого начала
                  </span>
                </button>
              </>
            )}
            {data.manualSince ? (
              <>
                <Sep inset="text" />
                <button type="button" className="row tappable" onClick={() => void setSince(null)}>
                  <span className="row-label" style={{ color: 'var(--blue)' }}>
                    Считать автоматически
                  </span>
                </button>
              </>
            ) : null}
          </div>
          <Footnote>
            По умолчанию берётся вступление в чат резидентов, а если Telegram даты не отдал — первый визит в журнале.
            Ручная дата нужна тем, кто пришёл в спейс раньше и того и другого, а «с самого начала» — тем, с кого спейс
            начинался.
          </Footnote>
        </>
      ) : null}
    </>,
  )
}
