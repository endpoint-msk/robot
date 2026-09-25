// Знакомство нового резидента с ботом: обложка, короткие шаги и «Готово».
//
// Листалка сделана по образу экрана Telegram Premium: всё, что меняется между
// шагами (цвет сцены и точек, сдвиг слайдов, подпись кнопки), считается от одной
// дробной позиции p, поэтому свайп и кнопка выглядят одинаково. Кадры рисует
// движок из src/onboarding.ts прямыми правками style; React отвечает за
// содержимое шагов, которое зависит от данных.

import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { action, api, subscribeToEvents } from '../api'
import { addDays, fmtShortDate, MONTHS_GEN, MONTHS_NOM, weekdayIdx } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import {
  attachHiveDrag,
  clamp,
  createHive,
  E,
  mix,
  mixc,
  palette,
  pr,
  resetLineHeights,
  SCENES,
  toHex,
  type Ease,
  type HiveState,
  type Palette,
  type SceneName,
  type Tone,
} from '../onboarding'
import { pushOverlay } from '../overlays'
import { getState, resetRoot, setData, useParams, useStore } from '../store'
import { applyTheme, sec } from '../theme'
import { haptic, initData, openBotSection, setHeaderColor, switchInline, tg } from '../telegram'
import type { Bootstrap, NotifyPrefs, OnboardingPerson, User } from '../types'
import { Sep, Switch } from '../components/common'
import { AnimContext } from '../components/Screen'
import { MacSheet } from '../components/MacSheet'
import {
  BotScene,
  CoverScene,
  DoneScene,
  DuesScene,
  EventsScene,
  GuestsScene,
  MacScene,
  NotifyScene,
  PresenceScene,
  type Banner,
  type BoardData,
  type EventCardData,
} from '../components/OnboardingScenes'
import { Avatar } from '../components/people'

/** `art` - своя картинка под сценой вместо тона: обои Telegram или радужная подложка карты. */
type Step = { id: SceneName; tone: Tone; flat?: boolean; art?: 'wall' | 'pass' }

/** Шаг взносов есть, только если с человека вообще спрашивают взнос. */
const hasDuesStep = (d: Bootstrap): boolean => Boolean(d.dues && d.dues.enabled && d.dues.me.amount > 0)

const buildSteps = (d: Bootstrap): Step[] => [
  { id: 'cover', tone: 'blue' },
  { id: 'presence', tone: 'green' },
  { id: 'mac', tone: 'blue' },
  { id: 'notify', tone: 'indigo' },
  // Фото двери и обои чата: шапка над ними остаётся цвета фона, а не тона.
  { id: 'guests', tone: 'orange', flat: true },
  { id: 'events', tone: 'purple' },
  ...(hasDuesStep(d) ? [{ id: 'dues' as const, tone: 'green' as const }] : []),
  { id: 'bot', tone: 'gray', flat: true, art: 'wall' },
  { id: 'done', tone: 'green', flat: true, art: 'pass' },
]

const stageColor = (s: Step, C: Palette): string => (s.art ? C[s.art] : mixc(C.bg, C.tones[s.tone], C.mixp))
const headColor = (s: Step, C: Palette): string => (s.flat ? C.bg : stageColor(s, C))

/** Близость дробной позиции к шагу i: 1 на самом шаге, 0 на соседнем. */
const prox = (p: number, i: number): number => clamp(1 - Math.abs(p - i), 0, 1)

/** В сотах рядом с вами те, кто сейчас в спейсе, дальше все по имени. */
const orderPeople = (list: OnboardingPerson[]): OnboardingPerson[] =>
  [...list].sort((a, b) => Number(b.inside) - Number(a.inside) || a.name.localeCompare(b.name, 'ru'))

const labelOf = (s: Step, bound: boolean): string =>
  s.id === 'cover' ? 'Начать' : s.id === 'done' ? 'К ближайшим дням' : s.id === 'mac' && !bound ? 'Привязать телефон' : 'Дальше'

// --- движок листалки -----------------------------------------------------------

type Key = 'p' | 'bound' | 'press'
type Anim = { key: Key; from: number; to: number; t0: number; d: number; e: Ease; cb?: () => void }

type EngineOpts = {
  root: HTMLElement
  pg: HTMLElement
  bg: HTMLElement
  skip: HTMLElement
  dots: HTMLElement
  primary: HTMLElement
  footBg: HTMLElement
  lbA: HTMLElement
  lbB: HTMLElement
  second: HTMLElement
  slides: HTMLElement[]
  stages: HTMLElement[]
  intros: HTMLElement[]
  doneVar: HTMLElement | null
  steps: Step[]
  cover: HiveState
  bound: number
  reduce: boolean
  onStep: (i: number) => void
  /** Открыта шторка или меню: стрелки и свайп шаги не листают. */
  blocked: () => boolean
}

type Engine = {
  goTo: (i: number) => void
  anim: (key: Key, to: number, d: number, e?: Ease) => void
  kick: () => void
  destroy: () => void
}

function createEngine(o: EngineOpts): Engine {
  const n = o.steps.length
  const last = n - 1
  const macIdx = o.steps.findIndex((s) => s.id === 'mac')
  const guestsIdx = o.steps.findIndex((s) => s.id === 'guests')
  const S = {
    p: 0,
    bound: o.bound,
    press: 0,
    anims: [] as Anim[],
    slides: o.steps.map(() => ({ start: null as number | null, vis: false, h: 320 })),
    width: 393,
    hiveK: 1,
    footH: 88,
    /** Размеры поменялись, пока была открыта шторка: пересчитать, когда закроется. */
    dirty: false,
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
    const vh = o.root.clientHeight || window.innerHeight
    // Сцена одной высоты на всех шагах, чтобы заголовок не прыгал при листании; на
    // низком экране она ужимается, а содержимое сцены масштабируется следом.
    const stageH = Math.round(clamp(vh * 0.425, 236, 320))
    o.root.style.setProperty('--ob-stage-h', `${stageH}px`)
    o.root.style.setProperty('--ob-k', Math.min(1, stageH / 320, S.width / 393).toFixed(4))
    resetLineHeights(o.root)
    o.slides.forEach((el, i) => {
      const meta = S.slides[i]!
      el.style.display = 'flex'
      el.style.visibility = 'hidden'
      meta.h = o.stages[i]?.offsetHeight || stageH
      el.style.display = 'none'
      el.style.visibility = ''
      meta.vis = false
    })
    // Соты рассчитаны на обложку высотой около 480px: на низком экране они
    // ужимаются целиком, иначе внешнее кольцо ложится на «Пропустить».
    S.hiveK = clamp((S.slides[0]?.h ?? 480) / 480, 0.62, 1)
    // Карта резидента на «Готово» рассчитана на 240×390 и ужимается под свою сцену.
    const passH = S.slides[last]?.h ?? stageH
    o.root.style.setProperty('--ob-pass-k', clamp(Math.min((passH - 44) / 390, (S.width - 48) / 240), 0.4, 1).toFixed(4))
    S.footH = o.footBg.offsetHeight || 88
    o.root.style.setProperty('--ob-hive-k', S.hiveK.toFixed(4))
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
    const photo = guestsIdx >= 0 ? prox(pp, guestsIdx) : 0
    const white = 'rgba(255,255,255,1)'

    // Подложка сцены одна на все слайды: цвет плывёт вместе со свайпом, а у
    // прокрученного слайда она уезжает вверх вместе с его сценой.
    const scroll = mix(o.slides[i0]!.scrollTop, o.slides[i1]!.scrollTop, f)
    const bh = mix(S.slides[i0]!.h, S.slides[i1]!.h, f)
    o.bg.style.background = stage
    o.bg.style.height = `${bh.toFixed(1)}px`
    o.bg.style.transform = `translateY(${(-scroll).toFixed(1)}px)`
    o.pg.style.setProperty('--ring', stage)

    o.dots.style.top = `${(bh - 22 - scroll).toFixed(1)}px`
    o.dots.style.opacity = String(clamp(pp, 0, 1) * clamp(last - pp, 0, 1))
    const off = mixc(C.dotOff, 'rgba(255,255,255,.5)', photo)
    const on = mixc(tone, white, photo)
    const doneC = mixc(mixc(tone, 'rgba(255,255,255,0)', 0.55), 'rgba(255,255,255,.8)', photo)
    Array.from(o.dots.children).forEach((el, k) => {
      const dot = el as HTMLElement
      const j = k + 1
      const pj = prox(pp, j)
      dot.style.width = `${(6 + 12 * pj).toFixed(2)}px`
      dot.style.background = mixc(j < pp ? doneC : off, on, pj)
    })

    o.skip.style.opacity = String(clamp(last - pp, 0, 1))
    o.skip.style.visibility = pp > last - 0.02 ? 'hidden' : 'visible'
    o.skip.style.color = mixc(C.text2, white, photo)
    o.skip.style.textShadow = `0 1px 6px rgba(0,0,0,${(0.5 * photo).toFixed(2)})`

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
      const to = clamp(1 - ad * 1.6, 0, 1)
      const intro = o.intros[i]
      if (intro) {
        const v = to * (i === macIdx ? 1 - S.bound : 1)
        intro.style.opacity = v.toFixed(3)
        intro.style.pointerEvents = v > 0.5 ? '' : 'none'
      }
      if (i === macIdx && o.doneVar) {
        const v = to * S.bound
        o.doneVar.style.opacity = v.toFixed(3)
        o.doneVar.style.pointerEvents = v > 0.5 ? '' : 'none'
      }
      SCENES[s.id].render(st, sceneTime(i, now), o.cover)
    })

    // Подпись кнопки меняется наплывом: старая уходит вверх, новая приходит снизу.
    const bound = S.bound > 0.5
    const la = labelOf(A, bound)
    const lb = labelOf(B, bound)
    if (la === lb) {
      o.lbA.textContent = la
      o.lbA.style.opacity = '1'
      o.lbA.style.transform = ''
      o.lbB.style.opacity = '0'
    } else {
      const kl = pr(f, 0.3, 0.4, E.inOut)
      o.lbA.textContent = la
      o.lbB.textContent = lb
      o.lbA.style.opacity = String(clamp(1 - kl * 1.6, 0, 1))
      o.lbA.style.transform = `translateY(${(-10 * kl).toFixed(2)}px)`
      o.lbB.style.opacity = String(clamp(kl * 1.6 - 0.6, 0, 1))
      o.lbB.style.transform = `translateY(${(10 * (1 - kl)).toFixed(2)}px)`
    }
    // У шага «Телефон» кнопка поднимается, под ней появляется «Не сейчас».
    const mp = macIdx >= 0 ? prox(pp, macIdx) * (1 - S.bound) : 0
    o.primary.style.transform = `translateY(${(-44 * mp).toFixed(2)}px) scale(${(1 - 0.025 * S.press).toFixed(4)})`
    o.primary.style.filter = `brightness(${(1 - 0.1 * S.press).toFixed(3)})`
    o.second.style.opacity = mp.toFixed(3)
    o.second.style.visibility = mp > 0.02 ? 'visible' : 'hidden'
    o.footBg.style.transform = `scaleY(${((S.footH + 44 * mp) / S.footH).toFixed(4)})`

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
    if (S.dirty && !o.blocked()) {
      S.dirty = false
      measure()
    }
    const finished: (() => void)[] = []
    S.anims = S.anims.filter((a) => {
      const k = clamp((now - a.t0) / a.d, 0, 1)
      S[a.key] = mix(a.from, a.to, a.e(k))
      if (k < 1) return true
      if (a.cb) finished.push(a.cb)
      return false
    })
    finished.forEach((cb) => cb())
    render(now)
    if (busy(now)) S.raf = requestAnimationFrame(frame)
  }

  const kick = (): void => {
    if (!S.raf) S.raf = requestAnimationFrame(frame)
  }

  const anim = (key: Key, to: number, d: number, e: Ease = E.out, cb?: () => void): void => {
    S.anims = S.anims.filter((a) => a.key !== key)
    S.anims.push({ key, from: S[key], to, t0: performance.now(), d, e, ...(cb ? { cb } : {}) })
    kick()
  }

  const goTo = (i: number): void => {
    const to = clamp(i, 0, last)
    anim('p', to, 420 + 110 * Math.min(Math.abs(to - S.p), 4), E.inOut)
  }

  // Соты обложки двигаются своим циклом: листалка в это время может стоять.
  const coverStage = o.stages[0]!
  const renderCover = (): void => {
    const t = sceneTime(0, performance.now())
    SCENES.cover.render(coverStage, t > SCENES.cover.dur ? Infinity : t, o.cover)
  }
  const detachHive = attachHiveDrag(coverStage, o.cover, renderCover, () => S.hiveK)

  // Свайп листает шаги. Направление решается по первым 8px: вертикаль отдаётся
  // прокрутке слайда, и только горизонталь захватывает указатель - иначе тапы по
  // кнопкам внутри слайда доставались бы листалке.
  const onDown = (e: PointerEvent): void => {
    if (e.button > 0 || o.blocked()) return
    if ((e.target as Element).closest('input, textarea, .ob-menu')) return
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
    goTo(Math.round(S.p - clamp(d.v * 0.18, -0.6, 0.6)))
  }
  // Отпущенный после свайпа палец не должен нажать кнопку, над которой оказался.
  const onClickCapture = (e: MouseEvent): void => {
    if (performance.now() - S.draggedAt < 300) {
      e.stopPropagation()
      e.preventDefault()
    }
  }
  const onKey = (e: KeyboardEvent): void => {
    if (o.blocked() || (e.target as Element | null)?.closest?.('input, textarea')) return
    if (e.key === 'ArrowRight') goTo(Math.round(S.p) + 1)
    else if (e.key === 'ArrowLeft') goTo(Math.round(S.p) - 1)
  }
  const onScroll = (): void => kick()
  // Клавиатура поля MAC меняет высоту вьюпорта: пересчёт под шторкой дёрнул бы всю
  // раскладку, поэтому он ждёт её закрытия. Кадр рисуем сразу, иначе мигнёт пустым.
  const ro = new ResizeObserver(() => {
    if (o.blocked()) {
      S.dirty = true
      return
    }
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
    goTo,
    anim: (key, to, d, e) => anim(key, to, d, e),
    kick,
    destroy: () => {
      if (S.raf) cancelAnimationFrame(S.raf)
      detachHive()
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

// --- данные шагов --------------------------------------------------------------

/** Ближайшая суббота от сегодняшнего дня (сегодня, если суббота). */
const nextSaturday = (today: string): string => addDays(today, (5 - weekdayIdx(today) + 7) % 7)

const DEMO_EVENT = { title: 'Грокаем алгоритмы', desc: 'Собираемся дружной компанией и решаем задачи тысячелетия', time: '16:00' }

/**
 * Ивент для сцены: настоящий, если он и правда сделан из поста канала, иначе пример.
 * Настоящий без поста на этой сцене соврал бы: она показывает, как пост становится ивентом.
 */
const pickEvent = (d: Bootstrap): EventCardData => {
  const real = [...d.days.flatMap((day) => day.events), ...d.laterEvents].find((e) => e.sourceUrl)
  const dateKey = real ? real.dateKey : nextSaturday(d.todayKey)
  const time = real ? real.time : DEMO_EVENT.time
  const photoId = real?.photos[0]
  const desc = real ? real.description.replace(/\s+/g, ' ').trim() : DEMO_EVENT.desc
  return {
    title: real ? real.title : DEMO_EVENT.title,
    short: `${fmtShortDate(dateKey).split(',')[0]!.toLowerCase()} ${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}, ${time}`,
    when: `${fmtShortDate(dateKey)} к ${time}`,
    desc: desc.length > 140 ? `${desc.slice(0, 140).trimEnd()}…` : desc,
    photo: photoId
      ? `${location.origin}/event-photo.jpg?id=${encodeURIComponent(photoId)}&initData=${encodeURIComponent(initData())}`
      : null,
  }
}

/**
 * Следующий сбор взноса. Сбор с 1-го числа называется своим месяцем, с другого дня -
 * следующим: он за него и собирается (так же считает сервер, см. `duesPeriodLabel`).
 */
const nextDues = (today: string, day: number): { date: string; label: string } => {
  const [y, m, dd] = today.split('-').map(Number) as [number, number, number]
  let year = y
  let month = m
  if (dd >= day) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  const openDay = Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())
  const covered = day === 1 ? month : (month % 12) + 1
  return { date: `${openDay} ${MONTHS_GEN[month - 1]}`, label: MONTHS_NOM[covered - 1]!.toLowerCase() }
}

/** Дата вступления для карты: '2026-09-23' по часам телефона. */
const isoDay = (iso: string): string | null => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** «Заявки на сегодня, ивенты, взносы»: что придёт в личку после знакомства. */
const notifySummary = (s: { notify: NotifyPrefs; eventNotify: NotifyPrefs }, dues: boolean | null): string => {
  const parts: string[] = []
  if (s.notify.enabled) parts.push(s.notify.mode === 'today' ? 'заявки на сегодня' : 'все заявки')
  if (s.eventNotify.enabled) parts.push(s.eventNotify.mode === 'today' ? 'ивенты на сегодня' : 'ивенты')
  if (dues) parts.push('взносы')
  const text = parts.join(', ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

type NotifyChoice = 'today' | 'all' | 'off'
const choiceOf = (p: NotifyPrefs): NotifyChoice => (p.enabled ? p.mode : 'off')
const CHOICE_LABEL: Record<NotifyChoice, string> = { today: 'Только сегодня', all: 'Любой день', off: 'Выкл' }

/** Строки знакомства: иконка слева, подпись с пояснением, справа стрелка или значение. */
function InfoRow({ icon, color, label, sub, right }: { icon: ReactNode; color: string; label: string; sub?: string; right?: ReactNode }) {
  return (
    <>
      <div className="row-icon" style={{ background: color }}>
        {icon}
      </div>
      <span className="row-label">
        {label}
        {sub ? <span className="row-sublabel">{sub}</span> : null}
      </span>
      {right ?? null}
    </>
  )
}

// --- экран ---------------------------------------------------------------------

export function Onboarding() {
  const { data, theme } = useStore()
  const params = useParams()
  const anim = useContext(AnimContext)
  const d = data!
  const settings = d.settings
  const info = d.onboarding
  const bot = info?.bot ?? null
  const botName = info?.botName || 'Endpoint Robot'
  const me: User = { userId: d.me.id, username: d.me.username, name: d.me.name }

  const [people] = useState<OnboardingPerson[]>(() => orderPeople((params.people as OnboardingPerson[] | undefined) ?? []))
  const insideTotal = typeof params.insideTotal === 'number' ? params.insideTotal : 0
  const [steps] = useState(() => buildSteps(d))
  const [step, setStep] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [menuFor, setMenuFor] = useState<'req' | 'ev' | null>(null)
  const [menuTop, setMenuTop] = useState(0)
  const [reduce] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })

  const cover = useMemo(() => createHive(people), [people])

  const rootRef = useRef<HTMLDivElement>(null)
  const pgRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<HTMLButtonElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const footBgRef = useRef<HTMLDivElement>(null)
  const lbARef = useRef<HTMLSpanElement>(null)
  const lbBRef = useRef<HTMLSpanElement>(null)
  const secondRef = useRef<HTMLButtonElement>(null)
  const extraRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<HTMLDivElement[]>([])
  const stageRefs = useRef<HTMLDivElement[]>([])
  const introRefs = useRef<HTMLDivElement[]>([])
  const doneVarRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const blockedRef = useRef(false)
  blockedRef.current = sheet || menuFor !== null
  const marked = useRef(false)

  const bound = (settings?.macs.length ?? 0) > 0
  const macIdx = steps.findIndex((s) => s.id === 'mac')
  const last = steps.length - 1

  useLayoutEffect(() => {
    const eng = createEngine({
      root: rootRef.current!,
      pg: pgRef.current!,
      bg: bgRef.current!,
      skip: skipRef.current!,
      dots: dotsRef.current!,
      primary: primaryRef.current!,
      footBg: footBgRef.current!,
      lbA: lbARef.current!,
      lbB: lbBRef.current!,
      second: secondRef.current!,
      slides: slideRefs.current,
      stages: stageRefs.current,
      intros: introRefs.current,
      doneVar: doneVarRef.current,
      steps,
      cover,
      bound: bound ? 1 : 0,
      reduce,
      onStep: setStep,
      blocked: () => blockedRef.current,
    })
    engine.current = eng
    return () => {
      eng.destroy()
      engine.current = null
    }
  }, [])

  // Привязали телефон - шаг «Телефон» перетекает в «Телефон привязан».
  const firstBound = useRef(true)
  useEffect(() => {
    if (firstBound.current) {
      firstBound.current = false
      return
    }
    engine.current?.anim('bound', bound ? 1 : 0, 420, E.inOut)
  }, [bound])

  // Тема сменилась (клиент Telegram переключился) - перекрашиваем кадр; закрылась
  // шторка или меню - досчитываем отложенные размеры.
  useEffect(() => engine.current?.kick(), [theme, sheet, menuFor])

  // Шапку Telegram красим в тон шага, когда он встал: плавно вместе со свайпом она
  // умеет перекрашиваться только в полноэкранном режиме.
  useEffect(() => {
    const s = steps[step]
    if (s) setHeaderColor(toHex(headColor(s, palette())))
  }, [step, theme])
  useEffect(() => () => applyTheme(getState().theme), [])

  // «Назад» Telegram (и Escape) листает на шаг назад; с обложки уводит туда, откуда
  // знакомство открыли, а если некуда - кнопки нет, и на её месте «Закрыть».
  useEffect(() => {
    try {
      if (step > 0 || getState().stack.length > 1) tg?.BackButton.show()
      else tg?.BackButton.hide()
    } catch {
      /* старый клиент */
    }
    if (step === 0) return
    return pushOverlay(() => engine.current?.goTo(step - 1))
  }, [step])
  useEffect(
    () => () => {
      try {
        if (getState().stack.length > 1) tg?.BackButton.show()
        else tg?.BackButton.hide()
      } catch {
        /* старый клиент */
      }
    },
    [],
  )

  // Дошёл до «Готово» - знакомство пройдено, даже если дальше просто закроет
  // миниапп. Повторный проход из настроек отметку не трогает.
  useEffect(() => {
    setMenuFor(null)
    if (steps[step]?.id !== 'done' || marked.current || !getState().data?.onboarding?.show) return
    marked.current = true
    void (async () => {
      try {
        setData(await api<Bootstrap>('onboarding.done'))
      } catch {
        // Не записалось - знакомство откроется ещё раз, это не беда.
      }
    })()
  }, [step])

  // Меню уведомлений закрывается тапом мимо и системной «Назад».
  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element).closest('.ob-menu, .ob-popup')) setMenuFor(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    const un = pushOverlay(() => setMenuFor(null))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      un()
    }
  }, [menuFor])

  const goNext = (): void => {
    const i = step
    const s = steps[i]
    if (!s) return
    if (s.id === 'mac' && !bound) {
      setSheet(true)
      return
    }
    if (s.id === 'done') {
      resetRoot()
      return
    }
    engine.current?.goTo(i + 1)
  }

  const openMenu = (key: 'req' | 'ev', btn: HTMLElement): void => {
    if (menuFor === key) {
      setMenuFor(null)
      return
    }
    const host = extraRef.current?.getBoundingClientRect()
    const r = btn.getBoundingClientRect()
    setMenuTop(host ? r.bottom - host.top + 4 : 0)
    setMenuFor(key)
  }

  const pickNotify = (choice: NotifyChoice): void => {
    if (!settings || !menuFor) return
    const method = menuFor === 'req' ? 'notify' : 'notify.events'
    const cur = menuFor === 'req' ? settings.notify : settings.eventNotify
    const next = choice === 'off' ? { enabled: false, mode: cur.mode } : { enabled: true, mode: choice }
    haptic('success')
    setTimeout(() => setMenuFor(null), 140)
    void action(method, next, { quiet: true })
  }

  // --- данные для сцен ---

  const nicks = people.filter((p) => p.inside && p.username).map((p) => p.username!)
  const board: BoardData = { nicks, total: Math.max(insideTotal, nicks.length), me: d.me.username, time: d.nowTime }
  const dues = d.dues ?? null
  const duesStep = hasDuesStep(d)
  const nextCollection = dues ? nextDues(d.todayKey, dues.day) : null
  const ev = useMemo(() => pickEvent(d), [])
  const pending = d.days.flatMap((day) => (day.requests ?? []).filter((r) => r.status === 'pending'))
  const count = people.length + 1

  const banners: Banner[] = settings
    ? [
        {
          key: 'req',
          time: 'сейчас',
          text:
            settings.notify.mode === 'today'
              ? `🚪 Новая заявка на визит: ${fmtShortDate(d.todayKey)} к 18:30 (сегодня). Гость: Оля.`
              : `🚪 Новая заявка на визит: ${fmtShortDate(addDays(d.todayKey, 2))} к 14:00. Гость: Дима.`,
          off: !settings.notify.enabled,
        },
        {
          key: 'ev',
          time: '1 ч назад',
          text:
            settings.eventNotify.mode === 'today'
              ? '📅 Новый ивент: Кино в спейсе. Сегодня к 20:00.'
              : `📅 Новый ивент: ${DEMO_EVENT.title}. ${fmtShortDate(nextSaturday(d.todayKey))} к ${DEMO_EVENT.time}.`,
          off: !settings.eventNotify.enabled,
        },
        ...(duesStep && dues
          ? [
              {
                key: 'dues',
                time: nextCollection ? nextCollection.date : '',
                text: `💸 Открыт сбор резидентского взноса за ${nextCollection?.label ?? ''}. С тебя ${money(dues.me.amount, dues.currency)}.`,
                off: !dues.notify,
              },
            ]
          : []),
      ]
    : []

  const scene = (s: Step): ReactNode => {
    switch (s.id) {
      case 'cover':
        return <CoverScene people={people} me={me} />
      case 'presence':
        return <PresenceScene board={board} botName={botName} dayLabel={fmtShortDate(d.todayKey)} />
      case 'mac':
        return <MacScene board={board} />
      case 'notify':
        return <NotifyScene banners={banners} botName={botName} />
      case 'guests':
        return <GuestsScene botName={botName} />
      case 'events':
        return <EventsScene ev={ev} />
      case 'dues':
        return dues && nextCollection ? (
          <DuesScene
            label={`Взнос за ${nextCollection.label}`}
            amount={money(dues.me.amount, dues.currency)}
            sub={`Бот напишет ${nextCollection.date}`}
          />
        ) : null
      case 'bot':
        return <BotScene printer={info?.printer ?? false} time={d.nowTime} finish={finishAt(d.nowTime)} board={board} />
      case 'done':
        return (
          <DoneScene me={me} number={people.length > 0 ? count : null} since={info?.joinedAt ? isoDay(info.joinedAt) : null} />
        )
    }
  }

  const text = (title: string, lead: string): ReactNode => (
    <div className="ob-text">
      <h2 className="ob-title">{title}</h2>
      <p className="ob-lead">{lead}</p>
    </div>
  )

  const macRows = settings ? (
    <div className="ob-extra">
      <div className="card">
        {settings.macs.map((m, i) => (
          <Fragment key={m.mac}>
            {i > 0 ? <Sep left={14} /> : null}
            <div className="row">
              <span className="row-label">
                {m.label || 'Устройство'}
                <span className="row-sublabel mono">{m.mac}</span>
              </span>
              {settings.macPresenceActive ? <span className="ob-tag green">в сети</span> : null}
            </div>
          </Fragment>
        ))}
        <Sep left={14} />
        <button type="button" className="row tappable" onClick={() => setSheet(true)}>
          <div className="icon-plus-circle">{icons.plusSmall()}</div>
          <span className="add-row-label">Добавить устройство</span>
        </button>
      </div>
      <div className="card ob-card-gap">
        <div className="row">
          <span className="row-label">
            Отмечаться без ника
            <span className="row-sublabel">В списке будет «Без ника»</span>
          </span>
          <Switch
            label="Отмечаться без ника"
            on={settings.macAnon}
            onToggle={() => action('mac.anon', { anon: !settings.macAnon }, { quiet: true })}
          />
        </div>
      </div>
    </div>
  ) : null

  const body = (s: Step): ReactNode => {
    switch (s.id) {
      case 'cover':
        return text(
          'Добро пожаловать в резиденты',
          `${people.length > 0 ? `Теперь нас ${count}. ` : ''}Дальше коротко о том, что умеет бот, и две настройки: авто-отметка и уведомления.`,
        )
      case 'presence':
        return (
          <>
            {text('Отмечайтесь, когда пришли', 'Отметка попадает на доску в чате спейса: видно, что спейс открыт, и можно подтянуться.')}
            {bot ? (
              <div className="ob-extra">
                <div className="card">
                  <button type="button" className="row tappable" onClick={() => openBotSection(bot, 'presence')}>
                    <InfoRow
                      icon={icons.chat(18, '#fff')}
                      color="var(--green)"
                      label="Отметиться в боте"
                      sub="/menu, кнопка «Отметиться»"
                      right={<span className="row-right">{icons.external(sec(0.3))}</span>}
                    />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )
      case 'mac':
        return (
          <>
            {text('Отметка без кнопок', 'Привяжите телефон: пока он в спейсе, бот сам держит отметку и снимает её через 10 минут после ухода.')}
            <div className="ob-extra">
              <div className="card">
                <div className="row">
                  <InfoRow icon={icons.wifi()} color="var(--gray)" label="Только в спейсе" sub="Вне спейса бот телефон не видит" />
                </div>
                <Sep left={54} />
                <div className="row">
                  <InfoRow
                    icon={icons.eyeOff(18, '#fff', 'var(--gray)')}
                    color="var(--gray)"
                    label="Невидимка"
                    sub="Выключает авто-отметку, когда нужно"
                  />
                </div>
              </div>
            </div>
          </>
        )
      case 'notify':
        return (
          <>
            {text('Что присылать в личку', 'Включено то, что нужно почти всем. Поменять можно в настройках.')}
            {settings ? (
              <div className="ob-extra" ref={extraRef}>
                <div className="card">
                  <div className="row">
                    <InfoRow
                      icon={icons.bell()}
                      color="var(--orange)"
                      label="Новые заявки"
                      right={
                        <button type="button" className="ob-popup" onClick={(e) => openMenu('req', e.currentTarget)}>
                          {CHOICE_LABEL[choiceOf(settings.notify)]}
                          {icons.updown()}
                        </button>
                      }
                    />
                  </div>
                  <Sep left={54} />
                  <div className="row">
                    <InfoRow
                      icon={icons.bell()}
                      color="var(--purple)"
                      label="Новые ивенты"
                      right={
                        <button type="button" className="ob-popup" onClick={(e) => openMenu('ev', e.currentTarget)}>
                          {CHOICE_LABEL[choiceOf(settings.eventNotify)]}
                          {icons.updown()}
                        </button>
                      }
                    />
                  </div>
                  {duesStep && dues ? (
                    <>
                      <Sep left={54} />
                      <div className="row">
                        <InfoRow
                          icon={icons.rub(17, '#fff')}
                          color="var(--green)"
                          label="Взносы"
                          right={
                            <Switch
                              label="Взносы"
                              on={dues.notify}
                              onToggle={() => action('dues.notify', { enabled: !dues.notify }, { quiet: true })}
                            />
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className={'ob-menu' + (menuFor ? ' open' : '')} style={{ top: menuTop }} role="menu">
                  {(['today', 'all', 'off'] as NotifyChoice[]).map((c) => {
                    const cur = menuFor === 'ev' ? settings.eventNotify : settings.notify
                    return (
                      <Fragment key={c}>
                        {c === 'off' ? <div className="ob-menu-gap" /> : null}
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={choiceOf(cur) === c}
                          onClick={() => pickNotify(c)}
                        >
                          <span className="ob-mk">{icons.check(14, 'currentColor', 2.2)}</span>
                          {CHOICE_LABEL[c]}
                        </button>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </>
        )
      case 'guests':
        return (
          <>
            {text(
              'Гостей встречают резиденты',
              'Гость оставляет заявку на день и время. Кто первым нажал «Захостить», тот и встречает, а бот напишет, когда гость у двери.',
            )}
            {pending.length > 0 ? (
              <div className="ob-extra">
                <div className="section-title">{`Ждут ответа · ${pending.length}`}</div>
                <div className="card">
                  {pending.slice(0, 2).map((r, i) => {
                    const stats = d.guestStats?.[String(r.guest.userId)]
                    return (
                      <Fragment key={r.id}>
                        {i > 0 ? <Sep left={64} /> : null}
                        <div className="row">
                          <Avatar user={r.guest} className="ob-guest-av" />
                          <span className="row-label">
                            <span className="ob-guest-name">
                              {r.guest.name}
                              {stats && stats.past === 0 ? <span className="visit-chip first">впервые</span> : null}
                              {stats && stats.past > 0 ? <span className="visit-chip">{stats.past + 1}-й</span> : null}
                            </span>
                            <span className="row-sublabel">
                              {`${r.dateKey === d.todayKey ? 'Сегодня' : fmtShortDate(r.dateKey)} к ${r.time}`}
                            </span>
                          </span>
                        </div>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </>
        )
      case 'events':
        return (
          <>
            {text(
              'Ивенты заводят резиденты',
              'Создайте ивент на экране дня или перешлите боту пост из канала: название, описание и афиша заполнятся сами.',
            )}
            <div className="ob-extra">
              <div className="card">
                <button type="button" className="row tappable" onClick={() => void subscribeToEvents()}>
                  <InfoRow
                    icon={icons.calendar(18, '#fff')}
                    color="var(--purple)"
                    label="Подписаться на ивенты"
                    sub="По желанию: новые появятся в календаре"
                    right={<span className="row-right">{icons.chevron()}</span>}
                  />
                </button>
              </div>
            </div>
          </>
        )
      case 'dues': {
        if (!dues) return null
        const status =
          dues.me.status === 'paid'
            ? { text: 'Внесён', color: 'var(--green)' }
            : dues.me.status === 'claimed'
              ? { text: 'Ждёт сверки', color: 'var(--text-2)' }
              : { text: 'Не внесён', color: 'var(--orange)' }
        return (
          <>
            {text(
              'Взнос раз в месяц',
              `${dues.day}-го числа бот пришлёт сумму и реквизиты. Переведите и нажмите «Я внёс»: взнос засчитают после сверки с выпиской.`,
            )}
            <div className="ob-extra">
              <div className="card">
                <div className="row">
                  <span className="row-label">Ваша ставка</span>
                  <span className="row-right ob-row-value">{`${money(dues.me.amount, dues.currency)} в месяц`}</span>
                </div>
                {dues.periodKey && dues.me.inRoster ? (
                  <>
                    <Sep left={14} />
                    <div className="row">
                      <span className="row-label">{`За ${dues.periodLabel.split(' ')[0]!.toLowerCase()}`}</span>
                      <span className="row-right ob-row-value" style={{ color: status.color }}>
                        {status.text}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </>
        )
      }
      case 'bot':
        return (
          <>
            {text('Бот в личке', 'Для быстрых дел открывать миниапп не нужно.')}
            {bot ? (
              <div className="ob-extra">
                <div className="card">
                  <CmdRow cmd="/menu" what="Отметки и телефон" onClick={() => openBotSection(bot, 'menu')} />
                  <Sep left={14} />
                  <CmdRow cmd="/inside" what="Кто сейчас в спейсе" onClick={() => openBotSection(bot, 'inside')} />
                  {info?.printer ? (
                    <>
                      <Sep left={14} />
                      <CmdRow cmd="/printer" what="Принтер и камера" onClick={() => openBotSection(bot, 'printer')} />
                    </>
                  ) : null}
                  <Sep left={14} />
                  <CmdRow
                    cmd={`@${bot}`}
                    what="Доска в любом чате"
                    onClick={() => {
                      if (!switchInline()) openBotSection(bot, 'menu')
                    }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )
      case 'done': {
        const phone = settings?.macs[0]
        const summary = settings ? notifySummary(settings, duesStep && dues ? dues.notify : null) : ''
        return (
          <>
            {text('Всё готово', 'Знакомство можно открыть снова в настройках.')}
            <div className="ob-extra">
              <div className="card">
                <div className="row">
                  {phone ? (
                    <InfoRow
                      icon={icons.check(14, '#fff', 2.2)}
                      color="var(--green)"
                      label="Телефон"
                      sub={`${phone.label || 'Устройство'}, отметка ставится сама`}
                    />
                  ) : (
                    <InfoRow
                      icon={icons.wifi()}
                      color="var(--gray)"
                      label="Телефон"
                      sub="Не привязан"
                      right={
                        <button type="button" className="small-btn blue" onClick={() => setSheet(true)}>
                          Привязать
                        </button>
                      }
                    />
                  )}
                </div>
                <Sep left={54} />
                <div className="row">
                  {summary ? (
                    <InfoRow icon={icons.check(14, '#fff', 2.2)} color="var(--green)" label="Уведомления" sub={summary} />
                  ) : (
                    <InfoRow icon={icons.bell()} color="var(--gray)" label="Уведомления" sub="Выключены" />
                  )}
                </div>
              </div>
            </div>
          </>
        )
      }
    }
  }

  return (
    <div className={'ob' + (anim === 'in-fade' || anim === 'in-forward' ? ' ob-in' : '')} ref={rootRef}>
      <div className="ob-pager" ref={pgRef}>
        <div className="ob-bg" ref={bgRef} />
        {steps.map((s, i) => (
          <div
            key={s.id}
            className={'ob-slide' + (i === macIdx && !bound ? ' has-sec' : '')}
            aria-hidden={i !== step}
            ref={(el) => {
              if (el) slideRefs.current[i] = el
            }}
          >
            <div
              className={
                'ob-stage' +
                (s.id === 'cover' ? ' cover' : '') +
                (s.id === 'done' ? ' tall' : '') +
                (s.id === 'guests' ? ' photo' : '') +
                (s.art === 'wall' ? ' ob-wall' : s.art === 'pass' ? ' ob-pass-bg' : '')
              }
              ref={(el) => {
                if (el) stageRefs.current[i] = el
              }}
            >
              {scene(s)}
            </div>
            <div className="ob-var-wrap">
              <div
                className="ob-var"
                ref={(el) => {
                  if (el) introRefs.current[i] = el
                }}
              >
                {body(s)}
              </div>
              {s.id === 'mac' ? (
                <div className="ob-var ob-var-done" ref={doneVarRef}>
                  {text('Телефон привязан', 'Когда придёте в спейс, отметка поставится сама.')}
                  {macRows}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <button type="button" className="ob-skip" ref={skipRef} onClick={() => engine.current?.goTo(last)}>
          Пропустить
        </button>
        <div className="ob-dots" ref={dotsRef} aria-hidden="true">
          {steps.slice(1, -1).map((s) => (
            <i key={s.id} />
          ))}
        </div>
        <div className="ob-foot-bg" ref={footBgRef} />
        <div className="ob-foot">
          <button
            type="button"
            className="primary-btn"
            ref={primaryRef}
            onClick={goNext}
            onPointerDown={() => engine.current?.anim('press', 1, 90)}
            onPointerUp={() => engine.current?.anim('press', 0, 180)}
            onPointerLeave={() => engine.current?.anim('press', 0, 180)}
            aria-label={steps[step] ? labelOf(steps[step]!, bound) : undefined}
          >
            <span className="ob-lb" ref={lbARef} />
            <span className="ob-lb" ref={lbBRef} />
          </button>
          <button type="button" className="ob-second" ref={secondRef} onClick={() => engine.current?.goTo(macIdx + 1)}>
            Не сейчас
          </button>
        </div>
      </div>
      {sheet ? <MacSheet onClose={() => setSheet(false)} /> : null}
    </div>
  )
}

/** Строка команды бота: сама команда моноширинным, что она делает - справа. */
function CmdRow({ cmd, what, onClick }: { cmd: string; what: string; onClick: () => void }) {
  return (
    <button type="button" className="row tappable ob-cmd-row" onClick={onClick}>
      <span className="ob-cmd">{cmd}</span>
      <span className="ob-cmd-what">{what}</span>
      {icons.external(sec(0.3))}
    </button>
  )
}

/** Время окончания печати в примере: через час двадцать от «сейчас». */
const finishAt = (now: string): string => {
  const [h, m] = now.split(':').map(Number) as [number, number]
  const total = ((h * 60 + m + 80) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
