// Загрузка данных дочернего экрана. Состояний три, а не два: раньше ошибка запроса
// гасилась в `null` и рисовалась пустым состоянием, то есть экран утверждал про
// спейс то, чего в этот момент не знал («Сбор выключен» на упавшей сети).

import { useCallback, useEffect, useState } from 'react'

/**
 * Пока запрос укладывается в это время, скелет не показывается вовсе: на быстром
 * ответе он успевал мигнуть и экран дёргался на каждом открытии. Ждать пустую
 * шапку четверть секунды глазу спокойнее, чем поймать вспышку каркаса.
 */
const SKELETON_DELAY_MS = 320

export type Remote<T> = {
  data: T | null
  /** Запрос не дошёл или сервер ответил ошибкой. Данные при этом могут быть от прошлой загрузки. */
  error: boolean
  loading: boolean
  /** Запрос затянулся — пора показывать скелет. Не то же самое, что `loading`. */
  pending: boolean
  reload: () => void
}

/**
 * `load` пересоздаётся на каждом рендере, поэтому в зависимости идёт не он, а
 * `deps` вызывающего — как в обычном `useEffect` с запросом внутри.
 */
export function useRemote<T>(load: () => Promise<T>, deps: unknown[]): Remote<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    setPending(false)
    const timer = window.setTimeout(() => {
      if (alive) setPending(true)
    }, SKELETON_DELAY_MS)
    const run = async (): Promise<void> => {
      try {
        const res = await load()
        if (alive) setData(res)
      } catch {
        if (alive) setError(true)
      } finally {
        if (alive) {
          setLoading(false)
          setPending(false)
        }
      }
    }
    void run()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  return { data, error, loading, pending, reload: useCallback(() => setAttempt((n) => n + 1), []) }
}
