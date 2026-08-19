// Плавная подмена каркаса данными.
//
// Скелет и содержимое рисуются в одном слое: пришедшие данные проявляются, а
// отработавший каркас гаснет поверх них. Уходящий слой при этом `position: absolute`
// — оставь он место в потоке, экран на время перехода распирало бы до суммы высот,
// и «плавно» превратилось бы в прыжок. Раньше подмены не было вовсе: скелет исчезал
// в том же кадре, в котором появлялись данные.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Держим уходящий каркас ровно столько, сколько длится его затухание в CSS. */
const FADE_MS = 260

export function Swap({
  loading,
  skeleton,
  fadeOnly = false,
  children,
}: {
  loading: boolean
  /** Каркас. null — запрос успел ответить быстро и показывать его не стали. */
  skeleton?: ReactNode
  /**
   * Только прозрачность, без подъезда на 6px. Нужно там, где внутри есть
   * `position: fixed` (нижняя панель приложения): анимируемый `transform` создаёт для
   * неё containing block, и на время перехода она считает координаты не от окна.
   */
  fadeOnly?: boolean
  children: ReactNode
}) {
  // Последний показанный каркас: на кадре с данными `skeleton` уже не приходит,
  // а гасить нужно именно то, что человек видел.
  const shown = useRef<ReactNode>(null)
  // Было ли вообще ожидание. Экран, у которого данные уже лежали в bootstrap, ничего
  // не ждёт - проявлять там нечего, а лишнее проявление наложилось бы на анимацию
  // перехода между экранами.
  const waited = useRef(false)
  const [leaving, setLeaving] = useState<ReactNode>(null)
  if (loading) {
    shown.current = skeleton ?? null
    waited.current = true
  }

  // Именно layout-эффект: обычный `useEffect` доставил бы гаснущий слой кадром позже,
  // и между исчезновением каркаса и его появлением поверх данных успевал бы моргнуть
  // пустой экран - ровно то, ради чего всё это и делается.
  useLayoutEffect(() => {
    if (loading || !shown.current) return
    setLeaving(shown.current)
    shown.current = null
    const timer = window.setTimeout(() => setLeaving(null), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [loading])

  if (loading) return <div className="swap">{skeleton}</div>
  return (
    <div className="swap">
      <div className={waited.current ? 'swap-in' + (fadeOnly ? ' fade-only' : '') : undefined}>{children}</div>
      {leaving ? <div className="swap-out">{leaving}</div> : null}
    </div>
  )
}
