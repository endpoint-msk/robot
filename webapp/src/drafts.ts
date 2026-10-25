// Черновики, как в Telegram: недописанный текст формы переживает закрытие миниаппа и
// приезжает на другое устройство. Лежат в облаке Telegram (CloudStorage, Bot API 6.9):
// наш сервер их не видит. На старом клиенте и вне Telegram живут в localStorage устройства.
//
// Облако отвечает асинхронно, поэтому всё читается один раз на старте в память, а дальше
// формы берут черновик синхронно. Запись идёт в память сразу, а в облако по паузе в наборе.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cloudStorage } from './telegram'

/** Свои ключи в облаке: у бота там может появиться что-то ещё. */
const PREFIX = 'd_'
/**
 * В облаке значение не длиннее 4096 символов, а описание ивента само бывает 4096:
 * длинный черновик ложится кусками `<ключ>__1`, `<ключ>__2`.
 */
const CHUNK = 4000
const PART = /^(.*)__(\d+)$/
const SAVE_DELAY_MS = 800
/** Брошенный черновик (заявку закрыли без него, день прошёл) не копится вечно. */
const MAX_AGE_MS = 30 * 86_400_000
const LOCAL = 'endpoint-draft:'

type Stored = { at: number; v: unknown }

const cache = new Map<string, Stored>()
/** Сколько кусков лежит в облаке у ключа: лишние снимаются при следующей записи. */
const parts = new Map<string, number>()
const timers = new Map<string, number>()
let ready = false
let version = 0
const listeners = new Set<() => void>()

const emit = (): void => {
  version += 1
  for (const l of listeners) l()
}

const local = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const fresh = (s: Stored | null): s is Stored => Boolean(s) && Date.now() - s!.at < MAX_AGE_MS

const parse = (raw: string | undefined): Stored | null => {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Stored
    return s && typeof s.at === 'number' ? s : null
  } catch {
    return null
  }
}

function loadLocal(): void {
  const ls = local()
  if (!ls) return
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (!k || !k.startsWith(LOCAL)) continue
      const s = parse(ls.getItem(k) ?? undefined)
      if (fresh(s)) cache.set(k.slice(LOCAL.length), s)
    }
  } catch {
    /* хранилище недоступно */
  }
}

/** Склеивает куски облака: первый несёт «<число кусков>|». Неполный черновик отбрасывается. */
function assemble(values: Record<string, string>): { live: Map<string, Stored>; stale: string[] } {
  const live = new Map<string, Stored>()
  const stale: string[] = []
  for (const [full, head] of Object.entries(values)) {
    if (!full.startsWith(PREFIX) || PART.test(full)) continue
    const key = full.slice(PREFIX.length)
    const bar = head.indexOf('|')
    const n = Number(head.slice(0, bar))
    let text = head.slice(bar + 1)
    let whole = bar > 0 && Number.isInteger(n) && n >= 1
    for (let i = 1; whole && i < n; i++) {
      const part = values[`${full}__${i}`]
      if (part === undefined) whole = false
      else text += part
    }
    const s = whole ? parse(text) : null
    if (fresh(s)) {
      live.set(key, s)
      parts.set(key, n)
    } else {
      stale.push(full, ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => `${full}__${i + 1}`))
    }
  }
  return { live, stale }
}

function loadCloud(): void {
  const cloud = cloudStorage()
  if (!cloud) {
    loadLocal()
    ready = true
    emit()
    return
  }
  const done = (): void => {
    ready = true
    emit()
  }
  try {
    cloud.getKeys((err, keys) => {
      const ours = (keys ?? []).filter((k) => k.startsWith(PREFIX))
      if (err || ours.length === 0) return done()
      cloud.getItems(ours, (err2, values) => {
        if (!err2 && values) {
          const { live, stale } = assemble(values)
          // Набранное до ответа облака новее облачного: его не перетираем.
          for (const [k, s] of live) if (!cache.has(k)) cache.set(k, s)
          if (stale.length > 0) cloud.removeItems(stale)
        }
        done()
      })
    })
  } catch {
    done()
  }
}

loadCloud()

function persist(key: string): void {
  timers.delete(key)
  const s = cache.get(key) ?? null
  const cloud = cloudStorage()
  if (!cloud) {
    const ls = local()
    try {
      if (s) ls?.setItem(LOCAL + key, JSON.stringify(s))
      else ls?.removeItem(LOCAL + key)
    } catch {
      /* хранилище недоступно или переполнено */
    }
    return
  }
  const full = PREFIX + key
  const had = parts.get(key) ?? 0
  try {
    if (!s) {
      parts.delete(key)
      cloud.removeItems([full, ...Array.from({ length: Math.max(0, had - 1) }, (_, i) => `${full}__${i + 1}`)])
      return
    }
    const text = JSON.stringify(s)
    const n = Math.max(1, Math.ceil(text.length / CHUNK))
    for (let i = n - 1; i >= 0; i--) {
      const chunk = text.slice(i * CHUNK, (i + 1) * CHUNK)
      cloud.setItem(i === 0 ? full : `${full}__${i}`, i === 0 ? `${n}|${chunk}` : chunk)
    }
    if (had > n) cloud.removeItems(Array.from({ length: had - n }, (_, i) => `${full}__${n + i}`))
    parts.set(key, n)
  } catch {
    /* облако отказало: черновик останется в памяти до конца захода */
  }
}

/** Свёрнутый и закрытый миниапп не ждёт паузы в наборе. */
const flush = (): void => {
  for (const [key, t] of timers) {
    window.clearTimeout(t)
    persist(key)
  }
}
window.addEventListener('pagehide', flush)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
})

/** Ивент, который ещё не опубликовали: один на человека, как черновик в чате Telegram. */
export const NEW_EVENT_DRAFT = 'event_new'

export type EventDraft = { title: string; description: string; dateKey: string; time: string; residentsOnly: boolean }

/** Черновик по ключу. Ключи только из латиницы, цифр, `_` и `-`: так требует облако. */
export function readDraft<T>(key: string): T | null {
  const s = cache.get(key)
  return s ? (s.v as T) : null
}

/** null стирает черновик. */
export function saveDraft(key: string, value: unknown | null): void {
  if (value === null) {
    if (!cache.has(key) && !parts.has(key)) return
    cache.delete(key)
  } else {
    cache.set(key, { at: Date.now(), v: value })
  }
  window.clearTimeout(timers.get(key))
  timers.set(key, window.setTimeout(() => persist(key), value === null ? 0 : SAVE_DELAY_MS))
  emit()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Перерисовка, когда черновики дочитались из облака или сменились. */
export const useDrafts = (): number => useSyncExternalStore(subscribe, () => version)

/**
 * Черновик формы. `restore` зовётся один раз: на входе, если облако уже прочитано, или
 * когда дочитается, если человек ещё ничего не тронул. Дальше каждая правка формы
 * пишется в черновик, а пустая (`isEmpty`) его стирает. Ключ null: черновика у формы нет.
 */
export function useDraft<T>(
  key: string | null,
  value: T,
  { restore, isEmpty }: { restore: (v: T) => void; isEmpty: (v: T) => boolean },
): { clear: () => void } {
  const json = JSON.stringify(value)
  const seen = useRef(json)
  const restored = useRef(false)
  const touched = useRef(false)
  const loaded = useDrafts()

  useEffect(() => {
    if (!key || restored.current || touched.current || !ready) return
    restored.current = true
    const saved = readDraft<T>(key)
    if (saved !== null && !isEmpty(saved)) restore(saved)
    // restore и isEmpty живут в теле формы и меняются на каждый рендер: решают ключ и облако.
  }, [key, loaded])

  useEffect(() => {
    if (!key || json === seen.current) return
    seen.current = json
    touched.current = true
    saveDraft(key, isEmpty(value) ? null : value)
  }, [key, json])

  return { clear: () => (key ? saveDraft(key, null) : undefined) }
}
