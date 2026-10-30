// Общие UI-атомы: шапка, карточки-строки, разделители, свитч, пустые состояния,
// нижняя панель (в портал вне анимируемого экрана) и дев-чипы.

import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from '../barContext'
import { cooldownSnapshot, subscribeCooldown } from '../cooldown'
import { nb } from '../format'
import { icons } from '../icons'
import { markOwnTap } from '../motion'
import { netLabel, useNetState } from '../net'
import { pop, push, setPerspective, useStore } from '../store'
import { haptic, nativeBack } from '../telegram'
import { screenTitle } from '../titles'
import { AnimContext } from './Screen'

/** Ширина ведущего элемента строки: иконки .row-icon и аватарки .req-avatar. */
const LEAD = { text: 0, icon: 30, avatar: 40 }

/**
 * Разделитель начинается там же, где текст строки: отступ строки (--row-x), ведущий
 * элемент и зазор .row после него. `inset` - имя ведущего элемента или его ширина, если
 * он свой (плитка дня, отметка взноса). Готовым числом отступ не задаётся: при смене
 * отступа строк сотня литералов разъехалась бы с текстом. Без `inset` - во всю ширину.
 */
export function Sep({ inset }: { inset?: keyof typeof LEAD | number }) {
  if (inset === undefined) return <div className="sep" />
  const lead = typeof inset === 'number' ? inset : LEAD[inset]
  return <div className="sep" style={{ marginLeft: lead ? `calc(var(--row-x) + ${lead + 10}px)` : 'var(--row-x)' }} />
}

/** `month` - начало месяца для плавающей плашки (FloatingMonth): с заголовка, а не с карточки под ним. */
export const SectionTitle = ({ children, month }: { children: ReactNode; month?: string }) => (
  <div className="section-title" data-month={month}>
    {children}
  </div>
)

/**
 * Совпадение запроса в тексте цветом акцента, как найденное в поиске Telegram. Ищет так же,
 * как фильтры поисков: первое вхождение без учёта регистра.
 */
export function Found({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const low = text.toLowerCase()
  const at = q ? low.indexOf(q) : -1
  // У пары букв строчная форма другой длины («İ»): индексы разошлись бы с самим текстом.
  if (at < 0 || low.length !== text.length) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="found">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

/** Строка, по которой ищут: без регистра и без «@» в начале - ник вводят и так, и так. */
export const searchNeedle = (query: string): string => query.trim().replace(/^@+/, '').toLowerCase()

/**
 * Поле поиска, как в списках iOS: серая плашка, лупа, крестик. Одно на все поиски, чтобы
 * архив, «Позвать», «Без заявки», резиденты и ответственные выглядели и вели себя одинаково.
 */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-field">
      {icons.search()}
      <input type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" className="search-clear" aria-label="Очистить" onClick={() => onChange('')}>
          {icons.xmark(11, '#fff')}
        </button>
      ) : null}
    </div>
  )
}

export function Header({ title, subtitle, chip }: { title: ReactNode; subtitle?: ReactNode; chip?: ReactNode }) {
  // Пока своё действие ждёт сети, подзаголовок говорит об этом, как шапка Telegram.
  const net = netLabel(useNetState())
  return (
    <div className="header">
      {chip ? <div className="header-chip-row">{chip}</div> : null}
      <div className="title">{title}</div>
      {net ? <div className="subtitle net-wait">{net}</div> : subtitle ? <div className="subtitle">{subtitle}</div> : null}
    </div>
  )
}

/**
 * Кнопка «назад». Без `label` подписывается заголовком экрана, на который
 * возвращает: подпись — это навигация, и слово, которого нет в предыдущем
 * заголовке, только сбивает. Явный `label` остаётся для случаев, где заголовок
 * длиннее, чем нужно в строке.
 */
export function BackRow({ label }: { label?: string }) {
  const { stack, data } = useStore()
  const prev = stack[stack.length - 2]
  if (nativeBack) return null
  return (
    <button type="button" className="back-row" onClick={pop}>
      {icons.back()}
      {label ?? (prev ? screenTitle(prev, data) : 'Назад')}
    </button>
  )
}

export function EmptyState({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div className="es-icon">{icon}</div> : null}
      <div className="es-title">{title}</div>
      {text ? <div className="es-text">{text}</div> : null}
    </div>
  )
}

/**
 * Ошибка загрузки — своё состояние, а не пустой список: «данных нет» и «запрос не
 * дошёл» это разные утверждения, и второе экран делать не вправе. Кнопка нужна
 * потому, что иначе повторить попытку можно только закрыв и открыв экран.
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="es-title">Не удалось загрузить</div>
        <div className="es-text">Проверьте связь и попробуйте ещё раз.</div>
        <button type="button" className="retry-btn" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </div>
  )
}

export const SpinnerCenter = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
    <div className="spinner" />
  </div>
)

export const Footnote = ({ children }: { children: ReactNode }) => (
  <div className="footnote">
    {icons.info()}
    {children}
  </div>
)

export const ReadonlyBadge = () => (
  <div className="readonly-badge">
    {icons.lock()}
    Архив · только просмотр
  </div>
)

/**
 * Значок потока уведомлений в строке с выбором: у выключенного плитка серая, а колокольчик
 * перечёркнут, как bell.slash в iOS. Иначе «Выкл» читался только по подписи справа.
 */
export function NotifyIcon({ color, off }: { color: string; off: boolean }) {
  return (
    <div className={'row-icon notify-icon' + (off ? ' off' : '')} style={{ background: color }}>
      <i className="ni-gray" />
      {icons.bell()}
      <svg className="ni-slash" viewBox="0 0 30 30" aria-hidden="true">
        <path className="ni-cut" d="M8.6 7.4l13.6 15.2" pathLength={1} />
        <path className="ni-line" d="M8.6 7.4l13.6 15.2" pathLength={1} />
      </svg>
    </div>
  )
}

/**
 * Строка с тумблером целиком - один переключатель, как в Telegram для Android и Desktop:
 * касание по подписи переключает его же, а мышь в паре пикселей от тумблера больше не
 * проходит мимо. Сам тумблер нарисован внутри и кнопкой не является: кнопка в кнопке
 * недопустима. `className` заменяет `row` (компактная строка конструктора формы).
 */
export function SwitchRow({
  on,
  onToggle,
  label,
  sub,
  icon,
  disabled,
  className = 'row',
}: {
  on: boolean
  onToggle: () => void | Promise<unknown>
  label: ReactNode
  sub?: ReactNode
  // Значок, который зависит от положения (NotifyIcon), получает показанное положение:
  // ползунок встаёт на тапе, и значок по данным отставал бы от него до ответа сервера.
  icon?: ReactNode | ((on: boolean) => ReactNode)
  disabled?: boolean
  className?: string
}) {
  // Ползунок переключается сразу и держится до ответа сервера: раньше он ждал
  // целый bootstrap под блокирующим оверлеем, то есть тап «не срабатывал»
  // примерно полсекунды. Отказ откатывает его сам — данные не изменились.
  const [pending, setPending] = useState<boolean | null>(null)
  const shown = pending ?? on
  useEffect(() => setPending(null), [on])

  return (
    <button
      type="button"
      className={className + ' tappable switch-row'}
      role="switch"
      aria-checked={shown}
      disabled={disabled}
      onClick={async () => {
        haptic.impact(shown ? 'soft' : 'light')
        markOwnTap()
        setPending(!shown)
        try {
          await onToggle()
        } finally {
          setPending(null)
        }
      }}
    >
      {typeof icon === 'function' ? icon(shown) : icon}
      <span className="row-label">
        {label}
        {sub ? <span className="row-sublabel">{sub}</span> : null}
      </span>
      <span className={'switch' + (shown ? ' on' : '')} aria-hidden="true" />
    </button>
  )
}

/**
 * Главная кнопка экрана. Своя обёртка над `.primary-btn` ради одной вещи: после
 * отказа по рейтлимиту кнопка обязана показывать отсчёт, а не выглядеть рабочей —
 * иначе человек жмёт её по кругу и сам продлевает себе полку.
 */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  const wait = useSyncExternalStore(subscribeCooldown, cooldownSnapshot, cooldownSnapshot)
  return (
    <button
      type="button"
      className={'primary-btn' + (className ? ' ' + className : '')}
      disabled={disabled || wait > 0}
      onClick={onClick}
    >
      {wait > 0 ? nb(`Подождите ${wait} с`) : children}
    </button>
  )
}

/**
 * Кнопка, которая ждёт сервер сама, вместо оверлея на весь экран: ответ меняет одну
 * строку, и гасить ради неё интерфейс значит прятать то, на что человек смотрит.
 * Подпись тускнеет сразу, крутилка встаёт через 320 мс, как каркас (SKELETON_DELAY_MS):
 * быстрый ответ её не покажет. Ждёт, только если onClick вернул промис.
 */
export function ActionButton({
  className,
  onClick,
  children,
  disabled,
  label,
  hero,
  submit = false,
}: {
  className: string
  onClick: () => unknown
  children: ReactNode
  disabled?: boolean
  label?: string
  /** Кнопка — общая часть перехода между экранами (hero.ts): та же на соседнем экране. */
  hero?: string
  /**
   * Её жмёт Ctrl+Enter из поля ввода (Root.tsx). Только там, где отправка набранного
   * ничего не рассылает: у формы заявки да, у публикации ивента и анонса нет.
   */
  submit?: boolean
}) {
  const [pending, setPending] = useState(false)
  // Успешный ответ часто уносит кнопку вместе со строкой.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return (
    <button
      type="button"
      className={className + ' pend' + (pending ? ' pending' : '')}
      disabled={disabled}
      {...(hero ? { 'data-hero': hero, 'data-hero-screen': hero, 'data-hero-part': hero } : {})}
      {...(submit ? { 'data-submit': '' } : {})}
      aria-busy={pending || undefined}
      aria-label={label}
      title={label}
      onClick={async () => {
        if (pending) return
        const r = onClick()
        if (!(r instanceof Promise)) return
        setPending(true)
        try {
          await r
        } finally {
          if (alive.current) setPending(false)
        }
      }}
    >
      <span className="pend-label" data-hero-part={hero ? `${hero}-label` : undefined}>
        {children}
      </span>
      <span className="pend-spin" aria-hidden="true" />
    </button>
  )
}

export function BottomBar({ children }: { children: ReactNode }) {
  const node = useContext(BarContext)
  // Панель живёт вне .screen и без класса перехода стояла бы целиком, пока экран над
  // ней ещё прозрачный.
  const anim = useContext(AnimContext)
  // Экран под верхним на время жеста «вниз» получает свой узел в картинке (App.tsx).
  if (!node) return null
  return createPortal(<div className={'bottom-bar' + (anim ? ' ' + anim : '')}>{children}</div>, node)
}

/** Дев-панель в шапке: переключатель перспективы «резидент ↔ гость» + вход в dev-меню.
    Видна только аккаунтам из DEV_USER_IDS (сервер проверяет это сам). */
export function DevChips() {
  const { data, perspective } = useStore()
  if (!data?.me.isDev) return null
  const other = perspective === 'resident' ? 'guest' : 'resident'
  return (
    <div className="dev-chips">
      <button type="button" className="dev-chip" onClick={() => setPerspective(other)}>
        {icons.eye()}
        {other === 'guest' ? 'Как гость' : 'Как резидент'}
      </button>
      <button type="button" className="dev-chip" onClick={() => push('dev')}>
        {'🛠'}
        {'Dev'}
      </button>
    </div>
  )
}
