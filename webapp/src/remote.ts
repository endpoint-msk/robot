// Загрузка данных дочернего экрана. Состояний три, а не два: раньше ошибка запроса
// гасилась в `null` и рисовалась пустым состоянием, то есть экран утверждал про
// спейс то, чего в этот момент не знал («Сбор выключен» на упавшей сети).

import { useCallback, useEffect, useState } from 'react'

export type Remote<T> = {
  data: T | null
  /** Запрос не дошёл или сервер ответил ошибкой. Данные при этом могут быть от прошлой загрузки. */
  error: boolean
  loading: boolean
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
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    const run = async (): Promise<void> => {
      try {
        const res = await load()
        if (alive) setData(res)
      } catch {
        if (alive) setError(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  return { data, error, loading, reload: useCallback(() => setAttempt((n) => n + 1), []) }
}
