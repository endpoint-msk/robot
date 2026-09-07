// Общие UI-атомы: шапка, карточки-строки, разделители, свитч, пустые состояния,
// нижняя панель (в портал вне анимируемого экрана) и дев-чипы.

import { useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from '../barContext'
import { cooldownSnapshot, subscribeCooldown } from '../cooldown'
import { icons } from '../icons'
import { pop, push, setPerspective, useStore } from '../store'
import { screenTitle } from '../titles'

export function Sep({ left }: { left?: number }) {
  return <div className="sep" style={left !== undefined ? { marginLeft: left } : undefined} />
}

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="section-title">{children}</div>
)

export function Header({ title, subtitle, chip }: { title: ReactNode; subtitle?: ReactNode; chip?: ReactNode }) {
  return (
    <div className="header">
      {chip ? <div className="header-chip-row">{chip}</div> : null}
      <div className="title">{title}</div>
      {subtitle ? <div className="subtitle">{subtitle}</div> : null}
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

/** `label` обязателен: у тумблера нет ни текста, ни иконки, и без имени он
    озвучивается как «переключатель, включён» и ничего больше. */
export function Switch({
  on,
  onToggle,
  label,
}: {
  on: boolean
  onToggle: () => void | Promise<unknown>
  label: string
}) {
  // Ползунок переключается сразу и держится до ответа сервера: раньше он ждал
  // целый bootstrap под блокирующим оверлеем, то есть тап «не срабатывал»
  // примерно полсекунды. Отказ откатывает его сам — данные не изменились.
  const [pending, setPending] = useState<boolean | null>(null)
  const shown = pending ?? on
  useEffect(() => setPending(null), [on])

  // Обёртка — только зона тапа: сам тумблер остаётся нативных 51×31, а промах
  // чуть выше или ниже раньше не давал ничего (см. .switch-hit).
  return (
    <span className="switch-hit">
      <button
        type="button"
        className={'switch' + (shown ? ' on' : '')}
        role="switch"
        aria-checked={shown}
        aria-label={label}
        onClick={async () => {
          setPending(!shown)
          try {
            await onToggle()
          } finally {
            setPending(null)
          }
        }}
      />
    </span>
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
      {wait > 0 ? `Подождите ${wait} с` : children}
    </button>
  )
}

export function BottomBar({ children }: { children: ReactNode }) {
  const node = useContext(BarContext)
  if (!node) return null
  return createPortal(<div className="bottom-bar">{children}</div>, node)
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
