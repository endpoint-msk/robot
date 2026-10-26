// Строка на стекле в профиле: имя ушло под край, и сверху проступает оно с маленькой
// аватаркой, как в профиле Telegram. Строка одна на экран: её держит Screen и рисует
// порталом рядом с нижней панелью, потому что внутри .screen transform въезда сделал бы
// экран containing block для position: fixed. Шапка профиля только сообщает, что в
// строке писать и за каким узлом следить.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from '../barContext'
import { reducedMotion } from '../motion'
import { Avatar } from './people'

/** Высота строки без отступа под шапку Telegram, как `--topbar-h` в app.css. */
export const TOPBAR_H = 48
/** Перетекание имени: задержка и длительность проявления у `.tb-layer.in` в app.css. */
const FADE_MS = 380

export type TopBarContent = {
  /** Смена ключа на видимой строке перетекает размытием, а не подменяется. */
  key: string
  title: ReactNode
  subtitle?: ReactNode
  avatar?: { userId: number; name?: string; username?: string | null }
}

type TopBarApi = {
  publish: (owner: object, content: TopBarContent | null) => void
  stick: (owner: object, stuck: boolean, instant: boolean) => void
}

const TopBarContext = createContext<TopBarApi | null>(null)

/** Страница листалки (Pager): строку экрана ведёт только открытая карточка. */
export const PageActiveContext = createContext(true)

/** Низ строки от верха окна: под ней же в полноэкранном режиме лежат кнопки Telegram. */
export const topBarEdge = (): number =>
  TOPBAR_H + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tg-content-safe-area-inset-top')) || 0)

const sameContent = (a: TopBarContent | null, b: TopBarContent): boolean =>
  a !== null &&
  a.key === b.key &&
  Object.is(a.title, b.title) &&
  Object.is(a.subtitle, b.subtitle) &&
  a.avatar?.userId === b.avatar?.userId &&
  a.avatar?.name === b.avatar?.name &&
  a.avatar?.username === b.avatar?.username

function BarLayer({ content, className }: { content: TopBarContent; className?: string }) {
  return (
    <div className={'tb-layer' + (className ? ' ' + className : '')}>
      {content.avatar ? <Avatar user={content.avatar} className="tb-ava" /> : null}
      <div className="tb-text">
        <div className="tb-title">{content.title}</div>
        {content.subtitle ? <div className="tb-sub">{content.subtitle}</div> : null}
      </div>
    </div>
  )
}

/** Хост строки: живёт в Screen, `anim` — класс въезда экрана, строка проявляется с ним в такт. */
export function TopBarHost({ anim, children }: { anim: string | null; children: ReactNode }) {
  const node = useContext(BarContext)
  const [content, setContent] = useState<TopBarContent | null>(null)
  const [leaving, setLeaving] = useState<TopBarContent | null>(null)
  const drawn = useRef<TopBarContent | null>(null)

  const { api, setGlass, isStuck } = useMemo(() => {
    let owner: object | null = null
    let stuck = false
    let glass: HTMLDivElement | null = null
    // Видимость правится классом, а не состоянием: порог пересекают посреди прокрутки, и
    // перерисовывать ради него экран незачем. `instant` ставит строку без перехода: экран
    // вернулся уже прокрученным, и проявляться ей не из чего.
    const paint = (instant: boolean): void => {
      if (!glass) return
      if (instant) glass.classList.add('instant')
      glass.classList.toggle('shown', stuck)
      if (instant) {
        void glass.offsetWidth
        glass.classList.remove('instant')
      }
    }
    const api: TopBarApi = {
      publish(o, c) {
        if (c === null) {
          if (owner !== o) return
          owner = null
          setContent(null)
          return
        }
        owner = o
        setContent((cur) => (sameContent(cur, c) ? cur : c))
      },
      stick(o, v, instant) {
        if (owner !== o || (stuck === v && !instant)) return
        stuck = v
        paint(instant)
      },
    }
    const setGlass = (el: HTMLDivElement | null): void => {
      glass = el
      paint(true)
    }
    return { api, setGlass, isStuck: () => stuck }
  }, [])

  // Сменилась карточка листалки при видимой строке: имя перетекает размытием на месте,
  // как подпись «Захостить» в пилле хоста. Уходит то, что было нарисовано последним,
  // поэтому сверка на каждом рендере, а снимает уходящий слой свой таймер: перерисовка
  // от setLeaving не должна его отменять.
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    const was = drawn.current
    drawn.current = content
    if (!content || !was || was.key === content.key || !isStuck() || reducedMotion()) return
    clearTimeout(fade.current)
    setLeaving(was)
    fade.current = setTimeout(() => setLeaving(null), FADE_MS)
  })
  useEffect(() => () => clearTimeout(fade.current), [])

  return (
    <TopBarContext.Provider value={api}>
      {children}
      {node && content
        ? createPortal(
            <div className={'top-bar' + (anim ? ' ' + anim : '')} aria-hidden="true">
              <div className="tb-glass" ref={setGlass}>
                {leaving && leaving.key !== content.key ? <BarLayer content={leaving} className="out" key={'o' + leaving.key} /> : null}
                <BarLayer content={content} className={leaving ? 'in' : undefined} key={content.key} />
              </div>
            </div>,
            node,
          )
        : null}
    </TopBarContext.Provider>
  )
}

/**
 * Шапка профиля сообщает строке, что в ней писать, и следит за своим узлом: строка видна,
 * пока узел целиком ушёл под неё. Порог ловит IntersectionObserver, а не обработчик
 * прокрутки: строка меняется по порогу, а не на каждом кадре, и скрипт в прокрутке не
 * участвует. Решает положение узла по вертикали, а не факт пересечения: соседние
 * карточки листалки уезжают вбок и обрезаются дорожкой, это не прокрутка.
 */
export function useTopBar(content: TopBarContent | null, sentinel: RefObject<HTMLElement | null>): void {
  const api = useContext(TopBarContext)
  const active = useContext(PageActiveContext)
  const owner = useRef({}).current
  const on = Boolean(api && active && content)

  // Подзаголовок меняется вместе с данными, поэтому содержимое уходит на каждом рендере;
  // хост перерисуется, только если оно и правда другое.
  useLayoutEffect(() => {
    if (on) api!.publish(owner, content)
  })
  useLayoutEffect(() => {
    if (!on) return
    return () => api!.publish(owner, null)
  }, [on, api, owner])

  useLayoutEffect(() => {
    const el = sentinel.current
    if (!on || !el) return
    let alive = true
    let io: IntersectionObserver | null = null
    const below = (bottom: number): boolean => bottom <= topBarEdge()
    const watch = (): void => {
      io?.disconnect()
      io = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1]
          if (e) api!.stick(owner, below(e.boundingClientRect.bottom), false)
        },
        { rootMargin: `${-topBarEdge()}px 0px 0px 0px` },
      )
      io.observe(el)
    }
    // Прокрутку экрана App ставит в своём layout-эффекте, и он идёт после этого: замер
    // ждёт конца коммита, но не кадра, иначе вернувшийся прокрученным экран моргнул бы без строки.
    queueMicrotask(() => {
      if (alive) api!.stick(owner, below(el.getBoundingClientRect().bottom), true)
    })
    watch()
    window.addEventListener('resize', watch)
    return () => {
      alive = false
      io?.disconnect()
      window.removeEventListener('resize', watch)
    }
  }, [on, api, owner, sentinel])
}
