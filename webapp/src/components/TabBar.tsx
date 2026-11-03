// Панель вкладок у нижнего края корня вкладки (App.tsx): капсула разделов, у гостя рядом
// круглая «+». Капсула выбора стоит под вкладкой по номеру (--i) и переезжает CSS-переходом;
// её можно вести пальцем по панели. Значок вкладки, ставшей выбранной, проигрывает своё
// движение (app.css, .tab-ic.play): по ключу он ремаунтится, и анимация начинается заново.
// Красная точка на вкладке - там ждёт ваше дело, как непрочитанное в Telegram.

import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from 'react'
import { dayNum } from '../dates'
import { icons } from '../icons'
import type { Bootstrap } from '../types'
import { clamp, EDGE_ZONE, markOwnTap, ownTapRecent, reducedMotion } from '../motion'
import { pushOverlay } from '../overlays'
import { getState, push, setPerspective, startNewRequest, switchTab, useStore, type Anim, type ScreenName } from '../store'
import { haptic } from '../telegram'

const svg = (cls: string, children: ReactElement | ReactElement[]): ReactElement => (
  <svg className={'tab-svg ' + cls} width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
)

// Календарь: шапка заливается у выбранной вкладки, кольца приседают, дни проступают по очереди.
const calendar = (inner: ReactElement[]): ReactElement[] => [
  <path key="h" className="ic-head" d="M3.5 9.6V9a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v.6z" />,
  <rect key="b" x="3.5" y="5" width="17" height="15.5" rx="4" />,
  <path key="r" d="M3.5 9.6h17" />,
  <path key="r1" className="ic-ring" d="M8 3.2v3.4" />,
  <path key="r2" className="ic-ring ic-ring2" d="M16 3.2v3.4" />,
  ...inner,
]

// Сегодняшнее число вместо точек, как значок «Календаря» в iOS. Меняется в полночь по поясу
// спейса вместе с todayKey, без движения.
const days = (n: number): ReactElement =>
  svg(
    'ic-days',
    calendar([
      <text key="n" className="ic-date" x="12" y="18.3" textAnchor="middle">
        {n}
      </text>,
    ]),
  )

const ICONS: Partial<Record<ScreenName, ReactElement>> = {
  // Столбики вырастают по очереди. Между ними просвет: без него залитые столбики выбранной
  // вкладки сливаются в одно пятно. Высоты не лесенкой: лесенка читается значком связи.
  stats: svg('ic-stats', [
    <rect key="1" className="ic-bar" x="3.4" y="9.9" width="3.6" height="10.2" rx="1.1" />,
    <rect key="2" className="ic-bar ic-bar2" x="10.2" y="14.4" width="3.6" height="5.7" rx="1.1" />,
    <rect key="3" className="ic-bar ic-bar3" x="17" y="4.9" width="3.6" height="15.2" rx="1.1" />,
  ]),
  // Монета переворачивается: знак проходит ребро и встаёт лицом.
  dues: svg(
    'ic-dues',
    <g className="ic-coin">
      <circle cx="12" cy="12" r="8.6" />
      <path className="ic-rub" d="M10.2 16.6V7.6h2.9a2.35 2.35 0 0 1 0 4.7H8.8M8.8 14.4h4.6" />
    </g>,
  ),
  // Ползунки разъезжаются по местам.
  settings: svg('ic-set', [
    <path key="l" d="M4 8h16M4 16h16" />,
    <circle key="k1" className="ic-knob ic-knob1" cx="9" cy="8" r="2.5" />,
    <circle key="k2" className="ic-knob ic-knob2" cx="15" cy="16" r="2.5" />,
  ]),
  // Свои визиты: билет встаёт ровно, галочка в нём дорисовывается.
  myVisits: svg('ic-visits', [
    <path key="t" className="ic-ticket" d="M5 6h14a2 2 0 0 1 2 2v2.2a1.8 1.8 0 0 0 0 3.6V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.2a1.8 1.8 0 0 0 0-3.6V8a2 2 0 0 1 2-2z" />,
    <path key="c" className="ic-check" d="M9.2 12.3l2 2 3.8-4.1" pathLength={1} />,
  ]),
  // Как пройти: метка опускается на место, тень под ней проступает.
  route: svg('ic-route', [
    <ellipse key="s" className="ic-shadow" cx="12" cy="21.2" rx="3.4" ry="0.9" />,
    <g key="p" className="ic-pin">
      <path d="M12 19.6s-6.2-5.4-6.2-10.4a6.2 6.2 0 0 1 12.4 0c0 5-6.2 10.4-6.2 10.4z" />
      <circle className="ic-hole" cx="12" cy="9.3" r="2.3" />
    </g>,
  ]),
}

const iconOf = (name: ScreenName, today: number): ReactElement | undefined =>
  // Активность гостя - та же неделя, что «Дни» у резидента, и значок тот же.
  name === 'overview' || name === 'peek' ? days(today) : ICONS[name]

const LABELS: Partial<Record<ScreenName, string>> = {
  overview: 'Дни',
  stats: 'Статистика',
  dues: 'Взносы',
  settings: 'Настройки',
  myVisits: 'Визиты',
  peek: 'Активность',
  route: 'Как пройти',
}

/** Сколько после вступления точка на «Настройках» зовёт привязать телефон. */
const PHONE_DOT_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Вкладки с точкой. «Взносы» - свой взнос не отмечен; нулевая ставка - освобождение, звать
 * не к чему. «Настройки» - неделю после вступления, пока телефон не привязан: это
 * приглашение для тех, кто пропустил привязку в знакомстве.
 */
function dotsOf(data: Bootstrap | null): ScreenName[] {
  if (!data) return []
  const out: ScreenName[] = []
  const dues = data.dues
  if (dues && dues.enabled && dues.me.inRoster && dues.me.amount > 0 && dues.me.status === 'none') out.push('dues')
  const joinedAt = data.onboarding?.joinedAt
  const fresh = joinedAt ? Date.now() - Date.parse(joinedAt) < PHONE_DOT_MS : false
  if (data.settings && fresh && data.settings.macs.length === 0) out.push('settings')
  return out
}

/** Точка гаснет по эталону, только если дело сделано своим касанием; иначе просто пропадает. */
function TabDot({ on }: { on: boolean }) {
  const [shown, setShown] = useState(on)
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (on) {
      setShown(true)
      setOut(false)
    } else if (ownTapRecent() && !reducedMotion()) setOut(true)
    else setShown(false)
  }, [on])
  if (!shown) return null
  return <i className={'tab-dot' + (out ? ' out' : '')} aria-hidden="true" onAnimationEnd={() => setShown(false)} />
}

/** Палец ведёт капсулу, только сдвинувшись на столько: короче это касание вкладки. */
const DRAG_SLOP = 6
/** Столько держат «Настройки» дева, чтобы поднялось меню перспективы. */
const HOLD_MS = 420

type DevPick = 'resident' | 'guest' | 'dev'
const DEV_ITEMS: { value: DevPick; label: string }[] = [
  { value: 'resident', label: 'Как резидент' },
  { value: 'guest', label: 'Как гость' },
  { value: 'dev', label: 'Dev' },
]

/**
 * Меню дева над «Настройками», как смена аккаунта в Telegram: удержание вкладки поднимает
 * его, палец ведёт по пунктам и отпускает на нужном. Отпустили мимо пунктов - меню стоит,
 * пункт выбирается касанием. В Desktop его открывает правый клик по вкладке.
 */
function DevMenu({ open, hot, onPick }: { open: boolean; hot: DevPick | null; onPick: (v: DevPick) => void }) {
  const { perspective } = useStore()
  return (
    <div className={'ob-menu up dev-menu' + (open ? ' open' : '')} role="menu">
      {DEV_ITEMS.map((it) => (
        <Fragment key={it.value}>
          {it.value === 'dev' ? <div className="ob-menu-gap" /> : null}
          <button
            type="button"
            role={it.value === 'dev' ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.value === 'dev' ? undefined : perspective === it.value}
            data-pick={it.value}
            className={hot === it.value ? 'hot' : undefined}
            tabIndex={open ? undefined : -1}
            onClick={() => onPick(it.value)}
          >
            <span className="ob-mk">{icons.check(14, 'currentColor', 2.2)}</span>
            {it.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

type Drag = { id: number; x0: number; on: boolean; hot: number }

/**
 * `still` - картинка панели под свайпом назад (App.tsx, UnderScreen): без касаний и движения.
 * `anim` - класс въезда корня: без View Transitions панель проявляется вместе с экраном.
 */
export function TabBar({ tabs, active, anim = null, still = false }: { tabs: ScreenName[]; active: ScreenName; anim?: Anim; still?: boolean }) {
  const { data } = useStore()
  const dots = dotsOf(data)
  const today = data ? dayNum(data.todayKey) : new Date().getDate()
  const guest = tabs[0] === 'myVisits'
  const index = Math.max(0, tabs.indexOf(active))
  const capsRef = useRef<HTMLDivElement>(null)
  const selRef = useRef<HTMLElement>(null)
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)
  const isDev = Boolean(data?.me.isDev) && !still
  const devTab = tabs.indexOf('settings')
  const hold = useRef<number | null>(null)
  // Меню поднято; `held` - палец ещё на стекле с удержания и ведёт по пунктам.
  const [menu, setMenu] = useState<{ held: boolean; hot: DevPick | null } | null>(null)
  const menuOpen = menu !== null
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: globalThis.PointerEvent): void => {
      if (!(e.target as Element).closest('.dev-menu')) setMenu(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    const un = pushOverlay(() => setMenu(null))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      un()
    }
  }, [menuOpen])
  const cancelHold = (): void => {
    if (hold.current !== null) window.clearTimeout(hold.current)
    hold.current = null
  }
  useEffect(() => cancelHold, [])
  const pickDev = (v: DevPick): void => {
    haptic.tick()
    markOwnTap()
    setMenu(null)
    if (v === 'dev') push('dev')
    else if (v !== getState().perspective) setPerspective(v)
  }
  const hotUnder = (x: number, y: number): DevPick | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.dev-menu [data-pick]')
    return (el?.dataset.pick as DevPick | undefined) ?? null
  }
  // Класс въезда берётся один раз: панель живёт между вкладками, и новый класс на смене
  // вкладки проявил бы её заново.
  const [enter] = useState(anim)
  // Значок играет, когда вкладка сменилась своим действием: касание или ведение по панели,
  // плашка взноса, кнопка «Настройки» Telegram. На первом показе панели он просто стоит.
  const [play, setPlay] = useState<{ name: ScreenName; n: number } | null>(null)
  const shown = useRef(active)
  useEffect(() => {
    if (shown.current === active) return
    shown.current = active
    if (!still && !reducedMotion()) setPlay((p) => ({ name: active, n: (p?.n ?? 0) + 1 }))
  }, [active, still])

  const select = (k: number): void => {
    const name = tabs[k]
    if (!name) return
    markOwnTap()
    // Своя вкладка, как в iOS: наверх.
    if (name === active) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
      return
    }
    haptic.tick()
    switchTab(name)
  }

  const slot = (): { left: number; width: number; w: number } => {
    const r = capsRef.current!.getBoundingClientRect()
    return { left: r.left, width: r.width, w: (r.width - 8) / tabs.length }
  }
  const hotAt = (k: number): void => {
    capsRef.current?.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('hot', i === k))
  }
  const stop = (pick: boolean): void => {
    const d = drag.current
    drag.current = null
    if (!d?.on) return
    const caps = capsRef.current
    const sel = selRef.current
    // Классы и сдвиг снимаются в одном кадре: капсула доезжает переходом от пальца до вкладки.
    caps?.classList.remove('dragging')
    hotAt(-1)
    if (sel) sel.style.transform = ''
    // Клик после ведения, если клиент его пришлёт, уже не выбирает: вкладку выбрало
    // отпускание. Позже клавиатура снова выбирает с первого нажатия.
    dragged.current = true
    window.setTimeout(() => {
      dragged.current = false
    }, 400)
    if (pick) select(d.hot)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragged.current = false
    // Левый край забирает свайп Telegram iOS: оттуда только касание, без ведения.
    if (still || e.button !== 0 || e.clientX < EDGE_ZONE) return
    drag.current = { id: e.pointerId, x0: e.clientX, on: false, hot: index }
    if (!isDev || devTab < 0 || menuOpen) return
    const { left, w } = slot()
    if (Math.floor((e.clientX - left - 4) / w) !== devTab) return
    const id = e.pointerId
    const caps = capsRef.current
    hold.current = window.setTimeout(() => {
      hold.current = null
      drag.current = null
      // Клик после удержания, если клиент его пришлёт, вкладку не выбирает.
      dragged.current = true
      try {
        caps?.setPointerCapture(id)
      } catch {
        /* палец уже ушёл */
      }
      haptic.impact('medium')
      markOwnTap()
      setMenu({ held: true, hot: null })
    }, HOLD_MS)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (menu?.held) {
      const hot = hotUnder(e.clientX, e.clientY)
      if (hot !== menu.hot) {
        if (hot) haptic.tick()
        setMenu({ held: true, hot })
      }
      return
    }
    const d = drag.current
    const caps = capsRef.current
    const sel = selRef.current
    if (!d || d.id !== e.pointerId || !caps || !sel) return
    if (!d.on) {
      if (Math.abs(e.clientX - d.x0) < DRAG_SLOP) return
      cancelHold()
      d.on = true
      caps.setPointerCapture(e.pointerId)
      caps.classList.add('dragging')
    }
    const { left, width, w } = slot()
    const x = clamp(e.clientX - left - w / 2, 4, width - 4 - w)
    sel.style.transform = `translateX(${(x - 4).toFixed(1)}px)`
    const hot = clamp(Math.round((x - 4) / w), 0, tabs.length - 1)
    if (hot !== d.hot) {
      d.hot = hot
      haptic.tick()
    }
    hotAt(hot)
  }

  const caps = { '--i': index, '--n': tabs.length } as CSSProperties
  return (
    <nav className={'tab-bar' + (still ? ' still' : ' live') + (enter && !still ? ' ' + enter : '')} aria-label="Разделы">
      <div
        className="tab-caps"
        ref={capsRef}
        style={caps}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          cancelHold()
          if (menu?.held) {
            const hot = hotUnder(e.clientX, e.clientY)
            if (hot) pickDev(hot)
            else setMenu({ held: false, hot: null })
            return
          }
          stop(true)
        }}
        onPointerCancel={() => {
          cancelHold()
          if (menu?.held) setMenu({ held: false, hot: null })
          stop(false)
        }}
      >
        <i className="tab-sel" ref={selRef} aria-hidden="true" />
        {tabs.map((name, k) => (
          <button
            key={name}
            type="button"
            className={'tab' + (name === active ? ' on' : '')}
            aria-current={name === active ? 'page' : undefined}
            tabIndex={still ? -1 : undefined}
            onClick={() => {
              // Ведение уже выбрало вкладку на отпускании, удержание подняло меню.
              if (dragged.current) {
                dragged.current = false
                return
              }
              select(k)
            }}
            onContextMenu={
              isDev && name === 'settings'
                ? (e) => {
                    // Android шлёт contextmenu и на долгое касание, уже после открывшего меню
                    // удержания: только открываем, закрывают касание мимо и «Назад».
                    e.preventDefault()
                    cancelHold()
                    if (menuOpen) return
                    markOwnTap()
                    setMenu({ held: false, hot: null })
                  }
                : undefined
            }
          >
            <span className={'tab-ic' + (play?.name === name ? ' play' : '')} key={play?.name === name ? play.n : 0}>
              {iconOf(name, today)}
            </span>
            <span className="tab-label">{LABELS[name]}</span>
            <TabDot on={dots.includes(name)} />
          </button>
        ))}
      </div>
      {isDev ? <DevMenu open={menuOpen} hot={menu?.hot ?? null} onPick={pickDev} /> : null}
      {guest ? (
        <button
          type="button"
          className="tab-plus"
          aria-label="Новая заявка"
          tabIndex={still ? -1 : undefined}
          // Круг вырастает в кнопку формы на её месте (hero.ts, ключ cta); у картинки под
          // свайпом ключа нет, иначе имя перехода досталось бы двум узлам.
          {...(still ? {} : { 'data-hero': 'cta', 'data-hero-part': 'cta' })}
          onClick={() => {
            haptic.impact('light')
            startNewRequest()
          }}
        >
          <span className="cta-label" {...(still ? {} : { 'data-hero-part': 'cta-label' })}>
            {icons.plus()}
          </span>
        </button>
      ) : null}
    </nav>
  )
}
