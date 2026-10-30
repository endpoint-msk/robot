// Загрузка данных дочернего экрана. Состояний три, а не два: раньше ошибка запроса
// гасилась в `null` и рисовалась пустым состоянием, то есть экран утверждал про
// спейс то, чего в этот момент не знал («Сбор выключен» на упавшей сети).

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { EntryContext, SnapContext } from './screenContext'

/**
 * Пока запрос укладывается в это время, скелет не показывается вовсе: на быстром
 * ответе он успевал мигнуть и экран дёргался на каждом открытии. Ждать пустую
 * шапку четверть секунды глазу спокойнее, чем поймать вспышку каркаса.
 */
const SKELETON_DELAY_MS = 320

/**
 * Последний ответ каждого экрана, который ещё лежит в стеке. «Назад» монтирует экран
 * заново, и без этого он вставал бы каркасом: прокрутке было бы не к чему вернуться, а
 * строке, в которую садится карточка, негде стоять. Свежий ответ догоняет без каркаса.
 */
const cache = new Map<string, unknown>()

/** Записи, ушедшие из стека, больше не вернутся: их ответы не нужны. */
export function pruneRemote(alive: Set<number>): void {
  for (const key of cache.keys()) {
    if (!alive.has(Number(key.slice(0, key.indexOf('|'))))) cache.delete(key)
  }
}

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
  const entry = useContext(EntryContext)
  const depsKey = deps.map(String).join('\u0001')
  const cacheKey = `${entry}|${depsKey}`
  const cached = cache.has(cacheKey) ? (cache.get(cacheKey) as T) : null
  const [data, setData] = useState<T | null>(cached)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(cached === null)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Экран встал на «назад» со снимком (App.tsx): свежий ответ ждёт, пока он не возьмёт
  // свежие данные, и смена играет вместе с ними, а не под переходом. Пустой экран не ждёт.
  const held = useContext(SnapContext) !== null
  const heldRef = useRef(held)
  heldRef.current = held && data !== null
  const late = useRef<{ res: T } | null>(null)
  useEffect(() => {
    const l = late.current
    if (held || !l) return
    late.current = null
    setData(l.res)
  }, [held])

  // Смена deps — это другой запрос, а не повтор того же: прошлые данные под уже
  // переключённым сегментом («Год» в подписи, числа за месяц под ней) экран
  // выдаёт за правду. Сбрасываем прямо в рендере, иначе кадр со старыми числами
  // всё равно успевает показаться. На reload (attempt) данные, наоборот, остаются:
  // там запрос тот же самый, и мигать содержимым незачем.
  const [seenKey, setSeenKey] = useState(depsKey)
  if (seenKey !== depsKey) {
    setSeenKey(depsKey)
    setData(cached)
    setError(false)
    setLoading(cached === null)
  }

  useEffect(() => {
    let alive = true
    // Ответ из стека уже на экране: новый запрос идёт тихо и подменяет его на месте.
    const quiet = cache.has(cacheKey)
    if (!quiet) setLoading(true)
    setError(false)
    setPending(false)
    const timer = quiet
      ? 0
      : window.setTimeout(() => {
          if (alive) setPending(true)
        }, SKELETON_DELAY_MS)
    const run = async (): Promise<void> => {
      try {
        const res = await load()
        cache.set(cacheKey, res)
        if (alive && heldRef.current) late.current = { res }
        else if (alive) setData(res)
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
