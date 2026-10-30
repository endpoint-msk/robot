import { Fragment, useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react'
import { fmtRange, requestsWord } from '../dates'
import { icons } from '../icons'
import { animate, clamp, pr, reducedMotion } from '../motion'
import { push, useStore } from '../store'
import { haptic } from '../telegram'
import { resolvedTheme } from '../theme'
import { DevChips, Header, Sep } from '../components/common'
import { DayRow, TodayCard } from '../components/DayRow'
import { LaterEvents } from '../components/EventRow'
import { Screen } from '../components/Screen'

/** Сколько код домофона остаётся открытым: главную часто скриншотят в чаты. */
const DOOR_REVEAL_MS = 60_000

/** Код как на панели: буквы клавиш в рамке, цифры группами. */
function DoorCodeView({ code, ghost = false, ref }: { code: string; ghost?: boolean; ref?: Ref<HTMLSpanElement> }) {
  const parts = code.match(/\d+|\D/g) ?? []
  return (
    <span className={'door-code' + (ghost ? ' door-ghost' : '')} ref={ref} aria-hidden={ghost || undefined}>
      {parts.map((p, i) => (/\d/.test(p) ? <span key={i}>{p}</span> : <span key={i} className="door-k">{p}</span>))}
    </span>
  )
}

/** Насколько холст пелены больше кода с каждой стороны: точки разлетаются дальше, чем лежат. */
const DUST_PAD = 26
/** Точек на квадратный пиксель пелены. */
const DUST_DENSITY = 0.3
/** Ступени прозрачности: точки одной ступени рисуются одним путём, а не каждая своим. */
const DUST_LEVELS = 8
const DUST_MS = 1060

/**
 * Точка пелены: место, размер, яркость, разлёт от тапа (скорость v, отклонение j,
 * задержка d) и дрейф, пока код скрыт (скорость vx, vy в px/с, мерцание tw с фазой ph).
 */
type Speck = { x: number; y: number; r: number; a: number; v: number; j: number; d: number; vx: number; vy: number; tw: number; ph: number }

/** Точки пелены над кодом w×h. Зерно постоянное: перерисовка кладёт ту же пелену, а не новую рябь. */
function makeSpecks(w: number, h: number): Speck[] {
  let seed = 11
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  return Array.from({ length: Math.round((w + 8) * (h + 6) * DUST_DENSITY) }, () => {
    const ang = rnd() * Math.PI * 2
    const speed = 2.5 + rnd() * 6
    return {
      x: -4 + rnd() * (w + 8),
      y: -3 + rnd() * (h + 6),
      r: 0.35 + rnd() * 0.3,
      a: 0.35 + rnd() * 0.65,
      v: 12 + rnd() * 30,
      j: (rnd() - 0.5) * 0.9,
      d: rnd(),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      tw: 1.2 + rnd() * 2.6,
      ph: rnd() * Math.PI * 2,
    }
  })
}

const wrap = (v: number, lo: number, span: number): number => lo + ((((v - lo) % span) + span) % span)

/** Холст под размер кода и плотность экрана, очищенный, с цветом текста темы. */
function dustContext(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const cw = w + DUST_PAD * 2
  const ch = h + DUST_PAD * 2
  cv.width = Math.round(cw * dpr)
  cv.height = Math.round(ch * dpr)
  Object.assign(cv.style, { left: `${-DUST_PAD}px`, top: `${-DUST_PAD}px`, width: `${cw}px`, height: `${ch}px` })
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, DUST_PAD * dpr, DUST_PAD * dpr)
  ctx.fillStyle = getComputedStyle(cv).color
  return ctx
}

/**
 * Пелена. `drift` — секунды дрейфа: точки плывут в своих направлениях, переходя через
 * край на другую сторону, и мерцают. Без `from` это всё; с ним точки разлетаются волной
 * от касания из того места, где их застал тап: ближние срываются первыми и гаснут на
 * лету, `t` — время после тапа.
 */
function drawDust(
  ctx: CanvasRenderingContext2D,
  specks: Speck[],
  w: number,
  h: number,
  drift: number,
  from: { x: number; y: number } | null,
  t: number,
): void {
  ctx.clearRect(-DUST_PAD, -DUST_PAD, w + DUST_PAD * 2, h + DUST_PAD * 2)
  // Волна проходит пелену за одно время при любой длине кода.
  const far = from ? Math.max(Math.hypot(from.x + 4, from.y + 3), Math.hypot(w + 4 - from.x, h + 3 - from.y), Math.hypot(from.x + 4, h + 3 - from.y), Math.hypot(w + 4 - from.x, from.y + 3)) : 1
  const paths = Array.from({ length: DUST_LEVELS }, () => new Path2D())
  for (const s of specks) {
    let x = wrap(s.x + s.vx * drift, -4, w + 8)
    let y = wrap(s.y + s.vy * drift, -3, h + 6)
    let a = s.a * (0.6 + 0.4 * Math.sin(s.ph + s.tw * drift))
    if (from) {
      const k = pr(t, (Math.hypot(x - from.x, y - from.y) / far) * 360 + s.d * 60, 620)
      if (k > 0) {
        const ang = Math.atan2(y - from.y, x - from.x) + s.j
        x += Math.cos(ang) * s.v * k
        y += Math.sin(ang) * s.v * k - 5 * k
        a *= 1 - k
      }
    }
    const path = paths[Math.min(DUST_LEVELS - 1, Math.floor(a * DUST_LEVELS))]
    if (a < 0.03 || !path) continue
    path.rect(x - s.r, y - s.r, s.r * 2, s.r * 2)
  }
  paths.forEach((path, i) => {
    ctx.globalAlpha = (i + 0.5) / DUST_LEVELS
    ctx.fill(path)
  })
  ctx.globalAlpha = 1
}

/**
 * Код под пеленой, как спойлер в сообщениях Telegram: точки плывут и мерцают, пока код
 * скрыт, и разлетаются от тапа. Плывут, только пока строка на экране и вкладка видна, а
 * при «уменьшении движения» стоят. Под пеленой лежит не код, а заглушка той же ширины,
 * так что до тапа его нет ни на экране, ни на скриншоте, ни в дереве доступности.
 */
function DoorSpoiler({ code, shown, tap }: { code: string; shown: boolean; tap: RefObject<{ x: number; y: number } | null> }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const dustRef = useRef<HTMLCanvasElement>(null)
  const codeRef = useRef<HTMLSpanElement>(null)
  const was = useRef(shown)
  // Сколько пелена успела проплыть: тап рассыпает её из того места, где застал.
  const drift = useRef(0)
  // Пелена нарисована цветом текста: смена темы её перерисовывает.
  const theme = resolvedTheme()
  const ghost = code.replace(/\d/g, '0').replace(/\D/g, 'К')

  useLayoutEffect(() => {
    const prev = was.current
    was.current = shown
    const box = boxRef.current
    const cv = dustRef.current
    if (!box || !cv) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    const ctx = dustContext(cv, w, h)
    if (!ctx) return
    const specks = makeSpecks(w, h)
    if (!shown) {
      drawDust(ctx, specks, w, h, drift.current, null, 0)
      if (reducedMotion()) return
      let raf = 0
      let seen = true
      let last = performance.now()
      // Шаг кадра ограничен: после паузы (строка уезжала за экран) пелена не прыгает.
      const tick = (now: number): void => {
        raf = 0
        drift.current += Math.min(0.05, (now - last) / 1000)
        last = now
        drawDust(ctx, specks, w, h, drift.current, null, 0)
        go()
      }
      const go = (): void => {
        if (raf || !seen || document.hidden) return
        raf = requestAnimationFrame(tick)
      }
      const io = new IntersectionObserver((entries) => {
        seen = entries.some((e) => e.isIntersecting)
        go()
      })
      io.observe(box)
      document.addEventListener('visibilitychange', go)
      go()
      return () => {
        if (raf) cancelAnimationFrame(raf)
        io.disconnect()
        document.removeEventListener('visibilitychange', go)
      }
    }
    // Открытый код без нового тапа (сменилась тема) пелены уже не имеет.
    if (prev) return
    const p = tap.current
    tap.current = null
    const r = box.getBoundingClientRect()
    const from = p ? { x: clamp(p.x - r.left, 0, w), y: clamp(p.y - r.top, 0, h) } : { x: w / 2, y: h / 2 }
    const el = codeRef.current
    const reset = (): void => {
      ctx.clearRect(-DUST_PAD, -DUST_PAD, w + DUST_PAD * 2, h + DUST_PAD * 2)
      if (el) {
        el.style.opacity = ''
        el.style.filter = ''
      }
    }
    const at = drift.current
    const stop = animate(
      DUST_MS,
      (t) => {
        drawDust(ctx, specks, w, h, at, from, t)
        if (!el) return
        const k = pr(t, 80, 420)
        el.style.opacity = String(k)
        el.style.filter = k < 1 ? `blur(${((1 - k) * 3).toFixed(2)}px)` : ''
      },
      reset,
    )
    return () => {
      stop()
      reset()
    }
  }, [shown, theme, ghost])

  return (
    <span className="door-spoiler" ref={boxRef}>
      {shown ? <DoorCodeView code={code} ref={codeRef} /> : <DoorCodeView code={ghost} ghost />}
      <canvas className="door-dust" ref={dustRef} aria-hidden="true" />
    </span>
  )
}

/** Код домофона: скрыт, пока не попросили, и через минуту прячется сам, без движения. */
function DoorRow() {
  const { data } = useStore()
  const door = data!.door ?? null
  const [shown, setShown] = useState(false)
  const tap = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(false), DOOR_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [shown])
  if (!door) return null
  return (
    <>
      <button
        type="button"
        className="row tappable"
        aria-label={shown ? `Код домофона ${door.code}` : 'Показать код домофона'}
        onClick={(e) => {
          if (shown) {
            haptic.impact('soft')
            setShown(false)
            return
          }
          haptic.impact('light')
          // Пелена рассыпается от пальца; с клавиатуры точки касания нет, тогда от середины.
          tap.current = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null
          setShown(true)
        }}
      >
        <div className="row-icon" style={{ background: 'var(--orange)' }}>
          {icons.door(18, '#fff')}
        </div>
        <span className="row-label">
          Домофон
          {door.note ? <span className="row-sublabel">{door.note}</span> : null}
        </span>
        <div className="row-right">
          <DoorSpoiler code={door.code} shown={shown} tap={tap} />
        </div>
      </button>
      <Sep inset="icon" />
    </>
  )
}

export function Overview() {
  const { data } = useStore()
  const days = data!.days
  const total = days.reduce((sum, d) => sum + d.total, 0)
  const first = days[0]!.dateKey
  const last = days[days.length - 1]!.dateKey
  const today = days.find((d) => d.dateKey === data!.todayKey) ?? null
  const week = days.filter((d) => d !== today)

  return (
    <Screen>
      <Header title="Ближайшие дни" subtitle={`${fmtRange(first, last)} · ${requestsWord(total)}`} chip={<DevChips />} />
      {today ? <TodayCard day={today} onOpen={() => push('day', { dateKey: today.dateKey })} /> : null}
      <div className="card">
        {week.map((day, i) => (
          <Fragment key={day.dateKey}>
            {i > 0 ? <Sep inset={72} /> : null}
            <DayRow
              day={day}
              tappable
              onOpen={() => push('day', { dateKey: day.dateKey })}
            />
          </Fragment>
        ))}
      </div>
      <LaterEvents backLabel="Ближайшие дни" />
      <div style={{ height: 22 }} />
      <div className="card">
        <DoorRow />
        {/* Статистика, взносы и настройки - вкладки (components/TabBar.tsx). */}
        <button type="button" className="row tappable" onClick={() => push('archive')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.archiveBox()}
          </div>
          <span className="row-label">Архив</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>
    </Screen>
  )
}
