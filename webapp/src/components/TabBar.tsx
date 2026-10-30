// Панель вкладок у нижнего края корня вкладки (App.tsx): капсула разделов, у гостя рядом
// круглая «+». Капсула выбора стоит под вкладкой по номеру (--i) и переезжает CSS-переходом;
// её можно вести пальцем по панели. Значок вкладки, ставшей выбранной, проигрывает своё
// движение (app.css, .tab-ic.play): по ключу он ремаунтится, и анимация начинается заново.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from 'react'
import { icons } from '../icons'
import { clamp, EDGE_ZONE, markOwnTap, reducedMotion } from '../motion'
import { startNewRequest, switchTab, type Anim, type ScreenName } from '../store'
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

const days = svg(
  'ic-days',
  calendar([
    <circle key="d1" className="ic-dot" cx="8.4" cy="14.6" r="1.2" />,
    <circle key="d2" className="ic-dot ic-dot2" cx="12" cy="14.6" r="1.2" />,
    <circle key="d3" className="ic-dot ic-dot3" cx="15.6" cy="14.6" r="1.2" />,
  ]),
)

const ICONS: Partial<Record<ScreenName, ReactElement>> = {
  overview: days,
  // Столбики вырастают от оси по очереди.
  stats: svg('ic-stats', [
    <path key="a" d="M3.5 20.5h17" />,
    <rect key="1" className="ic-bar" x="5.2" y="12.5" width="3.6" height="5.5" rx="1.4" />,
    <rect key="2" className="ic-bar ic-bar2" x="10.2" y="5.5" width="3.6" height="12.5" rx="1.4" />,
    <rect key="3" className="ic-bar ic-bar3" x="15.2" y="9" width="3.6" height="9" rx="1.4" />,
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
  // Активность гостя - та же неделя, что «Дни» у резидента, и значок тот же.
  peek: days,
  // Как пройти: метка опускается на место, тень под ней проступает.
  route: svg('ic-route', [
    <ellipse key="s" className="ic-shadow" cx="12" cy="21.2" rx="3.4" ry="0.9" />,
    <g key="p" className="ic-pin">
      <path d="M12 19.6s-6.2-5.4-6.2-10.4a6.2 6.2 0 0 1 12.4 0c0 5-6.2 10.4-6.2 10.4z" />
      <circle className="ic-hole" cx="12" cy="9.3" r="2.3" />
    </g>,
  ]),
}

const LABELS: Partial<Record<ScreenName, string>> = {
  overview: 'Дни',
  stats: 'Статистика',
  dues: 'Взносы',
  settings: 'Настройки',
  myVisits: 'Визиты',
  peek: 'Активность',
  route: 'Как пройти',
}

/** Палец ведёт капсулу, только сдвинувшись на столько: короче это касание вкладки. */
const DRAG_SLOP = 6

type Drag = { id: number; x0: number; on: boolean; hot: number }

/**
 * `still` - картинка панели под свайпом назад (App.tsx, UnderScreen): без касаний и движения.
 * `anim` - класс въезда корня: без View Transitions панель проявляется вместе с экраном.
 */
export function TabBar({ tabs, active, anim = null, still = false }: { tabs: ScreenName[]; active: ScreenName; anim?: Anim; still?: boolean }) {
  const guest = tabs[0] === 'myVisits'
  const index = Math.max(0, tabs.indexOf(active))
  const capsRef = useRef<HTMLDivElement>(null)
  const selRef = useRef<HTMLElement>(null)
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)
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
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const caps = capsRef.current
    const sel = selRef.current
    if (!d || d.id !== e.pointerId || !caps || !sel) return
    if (!d.on) {
      if (Math.abs(e.clientX - d.x0) < DRAG_SLOP) return
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
        onPointerUp={() => stop(true)}
        onPointerCancel={() => stop(false)}
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
              // Ведение уже выбрало вкладку на отпускании.
              if (dragged.current) {
                dragged.current = false
                return
              }
              select(k)
            }}
          >
            <span className={'tab-ic' + (play?.name === name ? ' play' : '')} key={play?.name === name ? play.n : 0}>
              {ICONS[name]}
            </span>
            <span className="tab-label">{LABELS[name]}</span>
          </button>
        ))}
      </div>
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
