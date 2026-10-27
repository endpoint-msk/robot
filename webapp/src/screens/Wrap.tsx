// Итоги месяца: «Ваш октябрь в спейсе» историей на движке знакомства.
//
// Листалка устроена как в знакомстве (screens/Onboarding.tsx): тон сцены, сдвиг слайдов,
// точки и подпись кнопки считаются от одной дробной позиции и рисуются правками style,
// примитивы движения общие (src/onboarding.ts). Сцена играет на входе в шаг, а дальше
// история стоит: читают её в своём темпе, таймера нет. Числа встают всплытием, счётчиков
// от нуля нет.

import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { dayNum, MONTHS_ABBR, MONTHS_GEN, MONTHS_NOM, plural, WEEKDAYS_FULL, WEEKDAYS_SHORT, weekdayIdx } from '../dates'
import { icons } from '../icons'
import { reducedMotion, stageTint } from '../motion'
import { clamp, crossLabel, E, mix, mixc, palette, pr, prox, rise, toHex, type Ease, type Palette, type Tone } from '../onboarding'
import { pushOverlay } from '../overlays'
import { getState, pop, push, useStore } from '../store'
import { heatLevel, hoursNum, hoursNumWord, hoursWord } from '../stats'
import { applyTheme } from '../theme'
import { haptic, setBottomBarColor, setHeaderColor } from '../telegram'
import { ApiError, type User, type WrapMonth } from '../types'
import { ActionButton, Sep } from '../components/common'
import { Avatar } from '../components/people'
import { AnimContext } from '../components/Screen'

const NB = ' '

const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const DOW_DAT = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям']
const DOW_GEN = ['понедельников', 'вторников', 'сред', 'четвергов', 'пятниц', 'суббот', 'воскресений']

const monthIdxOf = (month: string): number => Number(month.slice(5, 7)) - 1
const monthTitle = (month: string): string => `${MONTHS_NOM[monthIdxOf(month)] ?? ''}${NB}${month.slice(0, 4)}`
const monthLower = (month: string): string => (MONTHS_NOM[monthIdxOf(month)] ?? '').toLowerCase()
const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), monthIdxOf(month) + 1, 0)).getUTCDate()
/** Сколько клеток до первого числа: неделя начинается с понедельника. */
const padOf = (month: string): number => weekdayIdx(`${month}-01`)

const count = (n: number, one: string, few: string, many: string): string => `${n}${NB}${plural(n, one, few, many)}`
const eveningsWord = (n: number): string => count(n, 'вечер', 'вечера', 'вечеров')
const timesWord = (n: number): string => count(n, 'раз', 'раза', 'раз')
const minutesWord = (n: number): string => count(n, 'минута', 'минуты', 'минут')
const hoursPhrase = (minutes: number): string => `${hoursNum(minutes)}${NB}${hoursNumWord(minutes)}`
const together = (minutes: number): string => (minutes < 60 ? minutesWord(minutes) : hoursWord(minutes))
const togetherShort = (minutes: number): string => (minutes < 60 ? `${minutes}${NB}мин` : `${hoursNum(minutes)}${NB}ч`)
/** «С 21 резидентом», но «с 11 резидентами». */
const residentsWith = (n: number): string => `${n}${NB}${n % 10 === 1 && n % 100 !== 11 ? 'резидентом' : 'резидентами'}`

const clock = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Длительность без лишней точности: «почти 6 часов», «больше 2 часов», «45 минут». */
const roughly = (minutes: number): string => {
  if (minutes < 60) return minutesWord(Math.max(1, Math.round(minutes)))
  const whole = Math.round(minutes / 60)
  if (Math.abs(minutes - whole * 60) < 6) return count(whole, 'час', 'часа', 'часов')
  if (minutes < whole * 60) return `почти ${count(whole, 'час', 'часа', 'часов')}`
  const floor = Math.floor(minutes / 60)
  return floor === 1 ? 'больше часа' : `больше ${count(floor, 'часа', 'часов', 'часов')}`
}

// --- шаги ----------------------------------------------------------------------

type SceneId = 'calendar' | 'heat' | 'opened' | 'people'
type Step = { id: SceneId; tone: Tone }

/** «Открыли спейс» и «с кем» бывают не у всех: пустая сцена читалась бы упрёком. */
const buildSteps = (v: WrapMonth): Step[] => [
  { id: 'calendar', tone: 'indigo' },
  { id: 'heat', tone: 'blue' },
  ...(v.opened.count > 0 ? [{ id: 'opened' as const, tone: 'orange' as const }] : []),
  ...(v.companion ? [{ id: 'people' as const, tone: 'green' as const }] : []),
]

const stageColor = (s: Step, C: Palette): string => stageTint(s.tone, C)

/** Высота сцены, как у знакомства: одна на все шаги, на низком экране ниже. */
const stageHeight = (vh: number): number => Math.round(clamp(vh * 0.425, 236, 320))

type Copy = { title: string; lead: string }

const copyOf = (id: SceneId, v: WrapMonth): Copy => {
  const mi = monthIdxOf(v.month)
  const prep = MONTHS_PREP[mi] ?? ''
  switch (id) {
    case 'calendar': {
      const delta = v.minutes - v.prevMinutes
      // Сравнение только в плюс: «меньше, чем в сентябре» в итогах читалось бы упрёком.
      const more = v.prevMinutes > 0 && delta >= 60 ? `, на ${hoursWord(delta)} больше, чем в ${MONTHS_PREP[(mi + 11) % 12]}` : ''
      const longest =
        v.evenings.length > 1 ? ` Самый долгий был ${dayNum(v.longest.dateKey)}${NB}${MONTHS_GEN[mi]}: ${roughly(v.longest.minutes)}.` : ''
      return { title: `${hoursPhrase(v.minutes)} в спейсе`, lead: `${eveningsWord(v.evenings.length)} в ${prep}${more}.${longest}` }
    }
    case 'heat': {
      const u = v.usual
      const at = `к${NB}${u.arrival}`
      const leave =
        u.leave >= 24 * 60 + 30
          ? 'Уходите обычно за полночь.'
          : u.leave >= 23 * 60
            ? 'Уходите обычно ближе к полуночи.'
            : `Уходите обычно к${NB}${clock(u.leave)}.`
      if (u.dow === null) return { title: `Обычно приходите ${at}`, lead: `В разные дни недели. ${leave}` }
      const share = u.count >= u.of ? 'вы не пропустили ни одного' : `вы были в ${u.count} из ${u.of}${NB}${DOW_GEN[u.dow]}`
      return { title: `Обычно по ${DOW_DAT[u.dow]} ${at}`, lead: `${WEEKDAYS_FULL[u.dow]} ваш день: ${share}. ${leave}` }
    }
    case 'opened': {
      const o = v.opened
      const closed = o.closed > 0 ? `, а ${timesWord(o.closed)} дверь закрывали вы` : ''
      return {
        title: `Открыли спейс ${timesWord(o.count)}`,
        lead: `${o.count === 1 ? 'В этот вечер' : 'В эти вечера'} до вас внутри никого не было${closed}.`,
      }
    }
    case 'people': {
      const c = v.companion
      if (!c) return { title: '', lead: '' }
      const more = v.companions > 1 ? ` Всего в ${prep} вы пересеклись с ${residentsWith(v.companions)}.` : ''
      return { title: `Чаще всего вместе с${NB}${c.label}`, lead: `${together(c.minutes)} в одно время.${more}` }
    }
  }
}

// --- сцены ---------------------------------------------------------------------

const qa = (el: Element, s: string): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(s))

type Scene = { dur: number; render: (st: HTMLElement, t: number) => void }

/** Сцена шага: сколько длится и как выглядит в момент t (Infinity - конечный кадр). */
const SCENES: Record<SceneId, Scene> = {
  // Месяц и дни недели встают, ячейки рядами, вечера загораются по одному, по датам.
  calendar: {
    dur: 2300,
    render: (st, t) => {
      qa(st, '.wrap-cal-top').forEach((el, i) => rise(el, t, i * 40, 380, 10))
      let order = 0
      for (const el of qa(st, '.wrap-day')) {
        const i = Number(el.dataset.i)
        rise(el, t, 70 + Math.floor(i / 7) * 55 + (i % 7) * 12, 360, 10)
        const k = Number(el.dataset.k ?? 0)
        const fill = el.firstElementChild as HTMLElement | null
        if (!k || !fill) continue
        const a = 420 + order * 45
        order++
        fill.style.opacity = (pr(t, a, 200) * k).toFixed(3)
        fill.style.transform = `scale(${(0.5 + 0.5 * Math.max(0, pr(t, a, 420, E.back))).toFixed(4)})`
      }
    },
  },
  // Карта волной слева направо, потом кольцо вокруг вашего часа и подпись.
  heat: {
    dur: 1100,
    render: (st, t) => {
      for (const el of qa(st, '.wrap-hc')) el.style.opacity = pr(t, 60 + Number(el.dataset.c) * 28, 260).toFixed(3)
      for (const el of qa(st, '.wrap-heat-dow')) el.style.opacity = pr(t, 0, 260).toFixed(3)
      for (const el of qa(st, '.wrap-heat-x')) el.style.opacity = pr(t, 200, 260).toFixed(3)
      for (const el of qa(st, '.wrap-ring')) {
        el.style.opacity = pr(t, 520, 160).toFixed(3)
        el.style.transform = `scale(${(1.6 - 0.6 * Math.max(0, pr(t, 520, 460, E.back))).toFixed(4)})`
      }
      for (const el of qa(st, '.wrap-chip')) {
        const p = pr(t, 640, 380)
        el.style.opacity = p.toFixed(3)
        el.style.transform = `translate(-50%, ${((1 - p) * 8).toFixed(2)}px)`
      }
    },
  },
  // Полосы вечеров: ваша растёт первой, остальные следом.
  opened: {
    dur: 1100,
    render: (st, t) => {
      for (const el of qa(st, '.wrap-axis')) el.style.opacity = pr(t, 0, 300).toFixed(3)
      qa(st, '.wrap-strip').forEach((row, i) => {
        rise(row, t, 40 + i * 70, 360, 10)
        qa(row, '.wrap-lane i').forEach((bar, k) => {
          bar.style.transform = `scaleX(${pr(t, 180 + i * 70 + k * 90, 420).toFixed(4)})`
        })
      })
    },
  },
  // Вы, нить по общим часам, второй человек и подписи.
  people: {
    dur: 1100,
    render: (st, t) => {
      const node = (el: HTMLElement | null, a: number): void => {
        if (!el) return
        el.style.opacity = pr(t, a, 160).toFixed(3)
        el.style.transform = `translate(-50%, -50%) scale(${Math.max(0, pr(t, a, 520, E.back)).toFixed(4)})`
      }
      node(st.querySelector<HTMLElement>('.wrap-node.me'), 40)
      node(st.querySelector<HTMLElement>('.wrap-node.with'), 380)
      const line = st.querySelector<SVGLineElement>('.wrap-net line')
      if (line) line.style.strokeDashoffset = (Number(line.dataset.len) * (1 - pr(t, 220, 420, E.inOut))).toFixed(2)
      qa(st, '.wrap-tag').forEach((el, i) => rise(el, t, i === 0 ? 260 : 560, 320, 6))
    },
  },
}

function CalendarScene({ v }: { v: WrapMonth }) {
  const pad = padOf(v.month)
  const nights = new Map(v.evenings.map((e) => [dayNum(e.dateKey), e.minutes]))
  const max = Math.max(1, ...nights.values())
  const best = dayNum(v.longest.dateKey)
  // Неделя, когда роутер не отвечал, штрихуется целиком: часы за неё могли не записаться.
  const gapRows = new Set(v.gapDays.map((k) => Math.floor((pad + dayNum(k) - 1) / 7)))
  const cells: ReactNode[] = []
  for (let i = 0; i < pad + daysInMonth(v.month); i++) {
    const day = i - pad + 1
    if (day < 1) {
      cells.push(<span key={i} className="wrap-pad" />)
      continue
    }
    const minutes = nights.get(day)
    cells.push(
      <span
        key={i}
        className={
          'wrap-day' +
          (minutes ? ' on' : gapRows.has(Math.floor(i / 7)) ? ' gap' : '') +
          (minutes && day === best && nights.size > 1 ? ' best' : '')
        }
        data-i={i}
        data-k={minutes ? (0.5 + 0.5 * (minutes / max)).toFixed(3) : undefined}
      >
        <i />
        <b>{day}</b>
      </span>,
    )
  }
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="wrap-cal">
        <div className="wrap-cal-in">
          <div className="wrap-cal-top wrap-cal-m">{monthTitle(v.month)}</div>
          <div className="wrap-cal-top wrap-cal-h">
            {WEEKDAYS_SHORT.map((d) => (
              <b key={d}>{d}</b>
            ))}
          </div>
          <div className="wrap-cal-g">{cells}</div>
        </div>
      </div>
    </div>
  )
}

/** Геометрия карты: клетка, зазор и колонка подписей - как в CSS (.wrap-heat-g). */
const HEAT_CELL = 19
const HEAT_STEP = HEAT_CELL + 4
const HEAT_LEFT = 26

function HeatScene({ v }: { v: WrapMonth }) {
  const max = Math.max(...v.heat.flat())
  const { ring, dow, arrival } = v.usual
  const x = HEAT_LEFT + ring.bucket * HEAT_STEP
  // День не повторялся - обводить нечего: подпись встаёт над колонкой часа прихода.
  const y = dow === null ? 0 : ring.dow * HEAT_STEP
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="wrap-heat">
        <div className="wrap-heat-g">
          {v.heat.map((row, d) => (
            <Fragment key={d}>
              <b className="wrap-heat-dow">{WEEKDAYS_SHORT[d]}</b>
              {row.map((n, b) => {
                const level = heatLevel(n, max)
                return (
                  <span
                    key={b}
                    className={'wrap-hc' + (level ? '' : ' zero')}
                    data-c={b}
                    style={level ? { background: `var(--heat-${level})` } : undefined}
                  />
                )
              })}
            </Fragment>
          ))}
        </div>
        <div className="wrap-heat-x">
          {['00', '04', '08', '12', '16', '20'].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {dow === null ? null : <span className="wrap-ring" style={{ left: x, top: y }} />}
        <span className="wrap-chip" style={{ left: x + HEAT_CELL / 2, top: y - 34 }}>
          {dow === null ? `к${NB}${arrival}` : `${WEEKDAYS_SHORT[dow]}, к${NB}${arrival}`}
        </span>
      </div>
    </div>
  )
}

/** Высота строки вечера и подписей оси - как в CSS (.wrap-strip, .wrap-axis). */
const STRIP_H = 52
const AXIS_H = 16

function StripsScene({ v }: { v: WrapMonth }) {
  const strips = v.opened.strips
  // Окно оси - от часа до первого прихода до последнего ухода, но не уже шести часов.
  const lo = Math.min(...strips.map((s) => s.me[0]))
  const hi = Math.max(...strips.flatMap((s) => [s.me[1], ...s.others.map((o) => o[1])]))
  const from = Math.max(0, Math.floor(lo / 60) * 60 - 60)
  const span = Math.max(6 * 60, Math.ceil(hi / 60) * 60 - from)
  const at = (m: number): number => clamp((m - from) / span, 0, 1) * 100
  const bar = (a: number, b: number) => ({ left: `${at(a).toFixed(2)}%`, width: `${(at(b) - at(a)).toFixed(2)}%` })
  const ticks = [0, 0.5, 1].map((k) => Math.round((from + span * k) / 60) * 60)
  const mi = monthIdxOf(v.month)
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="wrap-strips" style={{ top: Math.max(8, (292 - AXIS_H - strips.length * STRIP_H) / 2) }}>
        <div className="wrap-axis">
          {ticks.map((m, i) => (
            <span key={i} style={{ left: `${at(m).toFixed(2)}%` }}>
              {clock(m)}
            </span>
          ))}
        </div>
        {strips.map((s) => (
          <div className="wrap-strip" key={s.dateKey}>
            <div className="wrap-strip-l">
              <b>{`${dayNum(s.dateKey)}${NB}${MONTHS_ABBR[mi]}`}</b>
              <span>{clock(s.me[0])}</span>
            </div>
            <div className="wrap-lane">
              <i className="me" style={bar(s.me[0], s.me[1])} />
              {s.others.map((o, k) => (
                <i key={k} style={{ ...bar(o[0], o[1]), top: 22 + k * 9 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Где стоят вы и второй человек на холсте сцены 393×320. */
const NET = { me: { x: 108, y: 140 }, with: { x: 285, y: 140 } }

function PeopleScene({ v, me }: { v: WrapMonth; me: User }) {
  const c = v.companion
  if (!c) return null
  const len = Math.hypot(NET.with.x - NET.me.x, NET.with.y - NET.me.y)
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="wrap-net">
        <svg width="393" height="320" viewBox="0 0 393 320">
          <line
            x1={NET.me.x}
            y1={NET.me.y}
            x2={NET.with.x}
            y2={NET.with.y}
            data-len={len.toFixed(1)}
            style={{ strokeDasharray: len.toFixed(1) }}
          />
        </svg>
        <div className="wrap-node me" style={{ left: NET.me.x, top: NET.me.y }}>
          <Avatar user={me} />
        </div>
        <div className="wrap-node with" style={{ left: NET.with.x, top: NET.with.y }}>
          <Avatar user={{ userId: c.userId, username: c.username, name: c.label.replace(/^@/, '') }} />
        </div>
        <span className="wrap-tag-at" style={{ left: NET.me.x, top: NET.me.y + 54 }}>
          <span className="wrap-tag me">Вы</span>
        </span>
        <span className="wrap-tag-at" style={{ left: NET.with.x, top: NET.with.y + 46 }}>
          <span className="wrap-tag">{togetherShort(c.minutes)}</span>
        </span>
      </div>
    </div>
  )
}

// --- листалка ---------------------------------------------------------------------

type Key = 'p' | 'press'
type Anim = { key: Key; from: number; to: number; t0: number; d: number; e: Ease }

type PagerOpts = {
  root: HTMLElement
  pg: HTMLElement
  bg: HTMLElement
  close: HTMLElement
  dots: HTMLElement
  primary: HTMLElement
  footBg: HTMLElement
  lbA: HTMLElement
  lbB: HTMLElement
  slides: HTMLElement[]
  stages: HTMLElement[]
  texts: HTMLElement[]
  steps: Step[]
  reduce: boolean
  labelOf: (i: number) => string
  onStep: (i: number) => void
}

type Pager = {
  goTo: (i: number) => void
  next: () => void
  press: (down: boolean) => void
  kick: () => void
  destroy: () => void
}

function createPager(o: PagerOpts): Pager {
  const n = o.steps.length
  const last = n - 1
  const S = {
    p: 0,
    press: 0,
    /** Куда листалка едет: тап по «Дальше» во время доводки листает от него, а не от середины. */
    target: 0,
    anims: [] as Anim[],
    slides: o.steps.map(() => ({ start: null as number | null, vis: false, h: 320 })),
    width: 393,
    step: 0,
    raf: 0,
    drag: null as { x0: number; y0: number; p0: number; lx: number; lt: number; v: number; id: number; dir: 0 | 1 } | null,
    draggedAt: 0,
  }

  const sceneTime = (i: number, now: number): number => {
    const start = S.slides[i]?.start ?? null
    if (start === null) return 0
    return o.reduce ? Infinity : now - start
  }

  const measure = (): void => {
    S.width = o.pg.clientWidth || 393
    const stageH = stageHeight(o.root.clientHeight || window.innerHeight)
    o.root.style.setProperty('--ob-stage-h', `${stageH}px`)
    o.root.style.setProperty('--ob-k', Math.min(1, stageH / 320, S.width / 393).toFixed(4))
    o.slides.forEach((el, i) => {
      const meta = S.slides[i]!
      el.style.display = 'flex'
      el.style.visibility = 'hidden'
      meta.h = o.stages[i]?.offsetHeight || stageH
      el.style.display = 'none'
      el.style.visibility = ''
      meta.vis = false
    })
  }

  const render = (now: number): void => {
    const C = palette()
    const p = clamp(S.p, -0.3, n - 0.7)
    const pp = clamp(p, 0, last)
    const i0 = Math.floor(pp)
    const i1 = Math.min(last, i0 + 1)
    const f = pp - i0
    const A = o.steps[i0]!
    const B = o.steps[i1]!
    const stage = mixc(stageColor(A, C), stageColor(B, C), f)
    const tone = mixc(C.tones[A.tone], C.tones[B.tone], f)

    // Подложка сцены одна на все слайды: цвет плывёт вместе со свайпом.
    const scroll = mix(o.slides[i0]!.scrollTop, o.slides[i1]!.scrollTop, f)
    const bh = mix(S.slides[i0]!.h, S.slides[i1]!.h, f)
    o.bg.style.background = stage
    o.bg.style.height = `${bh.toFixed(1)}px`
    o.bg.style.transform = `translateY(${(-scroll).toFixed(1)}px)`
    o.pg.style.setProperty('--ring', stage)

    o.dots.style.top = `${(bh - 22 - scroll).toFixed(1)}px`
    const passed = mixc(tone, 'rgba(255,255,255,0)', 0.55)
    Array.from(o.dots.children).forEach((el, j) => {
      const dot = el as HTMLElement
      const pj = prox(pp, j)
      dot.style.width = `${(6 + 12 * pj).toFixed(2)}px`
      dot.style.background = mixc(j < pp ? passed : C.dotOff, tone, pj)
    })

    // Слайды едут целиком, сцена чуть отстаёт и тускнеет.
    o.steps.forEach((s, i) => {
      const el = o.slides[i]!
      const st = o.stages[i]!
      const meta = S.slides[i]!
      const d = i - p
      const ad = Math.abs(d)
      if (ad >= 1) {
        if (meta.vis) {
          el.style.display = 'none'
          meta.vis = false
        }
        meta.start = null
        return
      }
      if (!meta.vis) {
        el.style.display = 'flex'
        meta.vis = true
      }
      // Сцена начинает играть, когда слайд въехал хотя бы на четверть.
      if (meta.start === null && ad < 0.75) meta.start = now
      el.style.transform = `translateX(${(d * S.width).toFixed(2)}px)`
      st.style.opacity = (1 - 0.35 * ad).toFixed(3)
      st.style.transform = `scale(${(1 - 0.06 * ad).toFixed(4)})`
      const text = o.texts[i]
      if (text) text.style.opacity = clamp(1 - ad * 1.6, 0, 1).toFixed(3)
      SCENES[s.id].render(st, sceneTime(i, now))
    })

    crossLabel(o.lbA, o.lbB, o.labelOf(i0), o.labelOf(i1), f)
    o.primary.style.transform = `scale(${(1 - 0.025 * S.press).toFixed(4)})`
    o.primary.style.filter = `brightness(${(1 - 0.1 * S.press).toFixed(3)})`

    const c = Math.round(pp)
    if (c !== S.step) {
      S.step = c
      o.onStep(c)
    }
  }

  const busy = (now: number): boolean =>
    S.anims.length > 0 ||
    S.drag !== null ||
    o.steps.some((s, i) => {
      const start = S.slides[i]!.start
      return S.slides[i]!.vis && start !== null && !o.reduce && now - start < SCENES[s.id].dur + 150
    })

  const frame = (now: number): void => {
    S.raf = 0
    S.anims = S.anims.filter((a) => {
      const k = clamp((now - a.t0) / a.d, 0, 1)
      S[a.key] = mix(a.from, a.to, a.e(k))
      return k < 1
    })
    render(now)
    if (busy(now)) S.raf = requestAnimationFrame(frame)
  }

  const kick = (): void => {
    if (!S.raf) S.raf = requestAnimationFrame(frame)
  }

  const anim = (key: Key, to: number, d: number, e: Ease = E.out): void => {
    S.anims = S.anims.filter((a) => a.key !== key)
    S.anims.push({ key, from: S[key], to, t0: performance.now(), d, e })
    kick()
  }

  const goTo = (i: number, underFinger = false): void => {
    const to = clamp(Math.round(i), 0, last)
    // Щелчок на решении, а не в конце доводки: палец уже знает, куда поедет шаг.
    if (underFinger && to !== S.target) haptic.tick()
    S.target = to
    if (o.reduce) {
      S.anims = S.anims.filter((a) => a.key !== 'p')
      S.p = to
      kick()
      return
    }
    anim('p', to, 420 + 110 * Math.min(Math.abs(to - S.p), 4), E.inOut)
  }

  // Свайп листает шаги. Направление решается по первым 8px: вертикаль отдаётся
  // прокрутке слайда, и только горизонталь захватывает указатель.
  const onDown = (e: PointerEvent): void => {
    if (e.button > 0) return
    S.drag = { x0: e.clientX, y0: e.clientY, p0: S.p, lx: e.clientX, lt: performance.now(), v: 0, id: e.pointerId, dir: 0 }
  }
  const onMove = (e: PointerEvent): void => {
    const d = S.drag
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.dir === 0) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        S.drag = null
        return
      }
      d.dir = 1
      S.anims = S.anims.filter((a) => a.key !== 'p')
      try {
        o.pg.setPointerCapture(e.pointerId)
      } catch {
        /* указатель уже отпущен */
      }
    }
    const w = S.width || 393
    let raw = d.p0 - dx / w
    if (raw < 0) raw *= 0.35
    else if (raw > last) raw = last + (raw - last) * 0.35
    S.p = raw
    const now = performance.now()
    d.v = ((e.clientX - d.lx) / Math.max(1, now - d.lt) / w) * 1000
    d.lx = e.clientX
    d.lt = now
    kick()
  }
  const onUp = (e: PointerEvent): void => {
    const d = S.drag
    if (!d || e.pointerId !== d.id) return
    S.drag = null
    if (d.dir !== 1) return
    S.draggedAt = performance.now()
    goTo(S.p - clamp(d.v * 0.18, -0.6, 0.6), true)
  }
  // Отпущенный после свайпа палец не должен нажать кнопку, над которой оказался.
  const onClickCapture = (e: MouseEvent): void => {
    if (performance.now() - S.draggedAt < 300) {
      e.stopPropagation()
      e.preventDefault()
    }
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight') goTo(S.target + 1)
    else if (e.key === 'ArrowLeft') goTo(S.target - 1)
  }
  const onScroll = (): void => kick()
  const ro = new ResizeObserver(() => {
    measure()
    render(performance.now())
    kick()
  })

  o.pg.addEventListener('pointerdown', onDown)
  o.pg.addEventListener('pointermove', onMove)
  o.pg.addEventListener('pointerup', onUp)
  o.pg.addEventListener('pointercancel', onUp)
  o.pg.addEventListener('click', onClickCapture, true)
  window.addEventListener('keydown', onKey)
  o.slides.forEach((el) => el.addEventListener('scroll', onScroll, { passive: true }))
  ro.observe(o.root)

  measure()
  render(performance.now())
  kick()

  return {
    goTo: (i) => goTo(i),
    next: () => goTo(S.target + 1),
    press: (down) => anim('press', down ? 1 : 0, down ? 90 : 180),
    kick,
    destroy: () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      ro.disconnect()
      o.pg.removeEventListener('pointerdown', onDown)
      o.pg.removeEventListener('pointermove', onMove)
      o.pg.removeEventListener('pointerup', onUp)
      o.pg.removeEventListener('pointercancel', onUp)
      o.pg.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('keydown', onKey)
      o.slides.forEach((el) => el.removeEventListener('scroll', onScroll))
    },
  }
}

// --- данные --------------------------------------------------------------------

let fetched: { month: string; promise: Promise<WrapMonth> } | null = null

/**
 * Итоги грузятся с тапа по строке, ещё до экрана: пока он въезжает, ответ уже едет.
 * Повторное открытие за сессию берёт тот же ответ, неудачный забывается.
 */
const loadWrap = (month: string): Promise<WrapMonth> => {
  if (fetched && fetched.month === month) return fetched.promise
  const entry = { month, promise: api<WrapMonth>('wrap.month') }
  fetched = entry
  void (async () => {
    try {
      await entry.promise
    } catch {
      if (fetched === entry) fetched = null
    }
  })()
  return entry.promise
}

// --- вход ------------------------------------------------------------------------

/** Строка в «Статистике»: история прошлого месяца. */
export function WrapRow() {
  const { data } = useStore()
  const info = data?.wrap ?? null
  if (!info) return null
  return (
    <>
      <Sep inset="icon" />
      <button
        type="button"
        className="row tappable"
        onClick={() => {
          void loadWrap(info.month)
          push('wrap')
        }}
      >
        <div className="row-icon" style={{ background: 'var(--orange)' }}>
          {icons.sparkles(17, '#fff')}
        </div>
        <span className="row-label">{`Ваш ${monthLower(info.month)} в спейсе`}</span>
        <div className="row-right">
          <span className="dues-amount stat-count" style={{ color: 'var(--text-3)' }}>
            {`${hoursNum(info.minutes)}${NB}ч`}
          </span>
          {icons.chevron()}
        </div>
      </button>
    </>
  )
}

// --- экран -----------------------------------------------------------------------

export function Wrap() {
  const { data, theme, stack } = useStore()
  const anim = useContext(AnimContext)
  const boot = data!
  const me: User = { userId: boot.me.id, username: boot.me.username, name: boot.me.name }

  const [view, setView] = useState<WrapMonth | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState(0)
  const [reduce] = useState(reducedMotion)
  const [month] = useState(() => boot.wrap?.month ?? '')
  const steps = useMemo(() => (view ? buildSteps(view) : []), [view])
  const last = steps.length - 1

  const prev = stack[stack.length - 2]?.name
  const backLabel = prev === 'stats' ? 'К статистике' : 'Закрыть'
  const labelOf = (i: number): string => (i < last ? 'Дальше' : backLabel)

  const rootRef = useRef<HTMLDivElement>(null)
  const pgRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLDivElement>(null)
  const footBgRef = useRef<HTMLDivElement>(null)
  const lbARef = useRef<HTMLSpanElement>(null)
  const lbBRef = useRef<HTMLSpanElement>(null)
  const slideRefs = useRef<HTMLDivElement[]>([])
  const stageRefs = useRef<HTMLDivElement[]>([])
  const textRefs = useRef<HTMLDivElement[]>([])
  const pager = useRef<Pager | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const v = await loadWrap(month)
        if (alive) setView(v)
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err : new ApiError((err as Error).message))
      }
    })()
    return () => {
      alive = false
    }
  }, [attempt])

  // Пока итоги едут, подложка первой сцены уже стоит своей высоты.
  useLayoutEffect(() => {
    if (view) return
    const root = rootRef.current
    if (root) root.style.setProperty('--ob-stage-h', `${stageHeight(root.clientHeight || window.innerHeight)}px`)
  }, [view])

  useLayoutEffect(() => {
    if (!view) return
    const eng = createPager({
      root: rootRef.current!,
      pg: pgRef.current!,
      bg: bgRef.current!,
      close: closeRef.current!,
      dots: dotsRef.current!,
      primary: primaryRef.current!,
      footBg: footBgRef.current!,
      lbA: lbARef.current!,
      lbB: lbBRef.current!,
      slides: slideRefs.current,
      stages: stageRefs.current,
      texts: textRefs.current,
      steps,
      reduce,
      labelOf,
      onStep: setStep,
    })
    pager.current = eng
    return () => {
      eng.destroy()
      pager.current = null
    }
  }, [view])

  // Тема сменилась (клиент Telegram переключился) - перекрашиваем кадр.
  useEffect(() => pager.current?.kick(), [theme])

  // Шапку и нижнюю панель Telegram красим в тон шага, когда он встал, как в знакомстве.
  useEffect(() => {
    const C = palette()
    const s = steps[step]
    const c = toHex(s ? stageColor(s, C) : stageTint('indigo', C))
    setHeaderColor(c)
    setBottomBarColor(c)
  }, [step, theme, steps])
  useEffect(() => () => applyTheme(getState().theme), [])

  // «Назад» Telegram (и Escape) листает на шаг назад; с первого шага уводит с экрана.
  useEffect(() => {
    if (step === 0) return
    return pushOverlay(() => pager.current?.goTo(step - 1))
  }, [step])

  const goNext = (): void => {
    if (step < last) {
      pager.current?.next()
      return
    }
    pop()
  }

  const scene = (s: Step, v: WrapMonth): ReactNode => {
    switch (s.id) {
      case 'calendar':
        return <CalendarScene v={v} />
      case 'heat':
        return <HeatScene v={v} />
      case 'opened':
        return <StripsScene v={v} />
      case 'people':
        return <PeopleScene v={v} me={me} />
    }
  }

  const cls = 'ob wrap' + (anim === 'in-fade' || anim === 'in-forward' ? ' ob-in' : '')
  const noWrap = error?.code === 'no_wrap'

  return (
    <div className={cls} ref={rootRef}>
      <div className="ob-pager" ref={pgRef}>
        <div className="ob-bg" ref={bgRef} style={view ? undefined : { background: stageTint('indigo') }} />
        {view
          ? steps.map((s, i) => {
              const copy = copyOf(s.id, view)
              return (
                <div
                  key={s.id}
                  className="ob-slide"
                  aria-hidden={i !== step}
                  ref={(el) => {
                    if (el) slideRefs.current[i] = el
                  }}
                >
                  <div
                    className="ob-stage"
                    ref={(el) => {
                      if (el) stageRefs.current[i] = el
                    }}
                  >
                    {scene(s, view)}
                  </div>
                  <div
                    className="ob-text"
                    ref={(el) => {
                      if (el) textRefs.current[i] = el
                    }}
                  >
                    <h2 className="ob-title">{copy.title}</h2>
                    {copy.lead ? <p className="ob-lead">{copy.lead}</p> : null}
                  </div>
                </div>
              )
            })
          : null}
        {!view && !error ? (
          <div className="wrap-wait">
            <div className="spinner" />
          </div>
        ) : null}
        {error ? (
          <div className="ob-slide wrap-fail">
            <div className="ob-stage" />
            <div className="ob-text">
              <h2 className="ob-title">{noWrap ? 'Итогов нет' : 'Не получилось загрузить'}</h2>
              <p className="ob-lead">{error.message}</p>
            </div>
          </div>
        ) : null}
        <button type="button" className="ob-skip" ref={closeRef} onClick={() => pop()}>
          Закрыть
        </button>
        {view ? (
          <>
            <div className="ob-dots" ref={dotsRef} aria-hidden="true">
              {steps.map((s) => (
                <i key={s.id} />
              ))}
            </div>
            <div className="ob-foot-bg" ref={footBgRef} />
            <div className="ob-foot">
              {/* Нажатие и подъём кнопки рисует листалка на обёртке: ожидание отправки
                  живёт в самой кнопке (ActionButton), и её transform занимать нельзя. */}
              <div
                className="wrap-primary"
                ref={primaryRef}
                onPointerDown={() => pager.current?.press(true)}
                onPointerUp={() => pager.current?.press(false)}
                onPointerLeave={() => pager.current?.press(false)}
              >
                <ActionButton className="primary-btn" onClick={goNext} label={labelOf(step)}>
                  <span className="ob-lb" ref={lbARef} />
                  <span className="ob-lb" ref={lbBRef} />
                </ActionButton>
              </div>
            </div>
          </>
        ) : error ? (
          <div className="ob-foot">
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                if (noWrap) {
                  pop()
                  return
                }
                setError(null)
                setAttempt((n) => n + 1)
              }}
            >
              {noWrap ? backLabel : 'Повторить'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
