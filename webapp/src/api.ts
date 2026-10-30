// API и мутации. api() — низкоуровневый POST /api/*; action() — мутация,
// возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.

import type { PointerEvent as ReactPointerEvent } from 'react'
import { left as cooldownLeft, startCooldown } from './cooldown'
import { backOnline, setNetState } from './net'
import { markOwnChange, push, setBusy, setData } from './store'
import { haptic, initData, openUrl } from './telegram'
import { showAlert } from './modals'
import { ApiError, type Bootstrap, type OnboardingPeople } from './types'

/** Сбой сети — такая же ошибка приложения, как и отказ сервера: без этого наружу
    летел техтекст браузера («Failed to fetch») и попадал прямо в алерт. */
const NETWORK_ERROR = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'

/** Когда сервер последний раз ответил хоть чем-то: по нему повтор после сбоя сети решает, ждать ли. */
let reachedAt = 0

async function request<T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData(), ...(params ?? {}) }),
      signal,
    })
  } catch {
    throw new ApiError(NETWORK_ERROR, 'network')
  }
  reachedAt = performance.now()
  return readApi<T>(res)
}

export async function api<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
  const key = earlyKey(method, params)
  const hit = early.get(key)
  if (hit) {
    early.delete(key)
    if (performance.now() - hit.at < EARLY_TTL_MS) return hit.res as Promise<T>
  }
  return request<T>(method, params)
}

// --- Данные с касания ---------------------------------------------------------------
// Экран, который откроет строка, начинает грузиться на касании, а не после своего въезда:
// выигрыш - касание и въезд, и каркас часто не успевает мигнуть. Экран забирает летящий
// ответ, вызвав api() с теми же параметрами. Касание, ушедшее в прокрутку, запрос снимает.

const EARLY_TTL_MS = 10_000
/** Палец должен простоять столько, прежде чем запрос уйдёт: лента под пальцем шлёт pointerdown на каждой строке. */
const EARLY_ARM_MS = 50
const early = new Map<string, { at: number; res: Promise<unknown>; abort: AbortController }>()
const earlyKey = (method: string, params?: Record<string, unknown>): string => `${method}\u0001${JSON.stringify(params ?? {})}`

function prefetch(method: string, params?: Record<string, unknown>): () => void {
  const key = earlyKey(method, params)
  const hit = early.get(key)
  if (hit && performance.now() - hit.at < EARLY_TTL_MS) return () => {}
  const abort = new AbortController()
  const res = request(method, params, abort.signal)
  // Ошибку покажет экран, когда заберёт ответ; незабранная шуметь не должна.
  res.catch(() => {})
  early.set(key, { at: performance.now(), res, abort })
  return () => {
    if (early.get(key)?.abort !== abort) return
    early.delete(key)
    abort.abort()
  }
}

let armed: { x: number; y: number; timer: number; fire: () => void; cancel: (() => void) | null } | null = null

const disarm = (drop: boolean): void => {
  if (!armed) return
  clearTimeout(armed.timer)
  if (drop) armed.cancel?.()
  armed = null
}

/** Обработчики строки, по тапу которой откроется экран с запросом `method(params)`. */
export function prefetchOnTouch(method: string, params: Record<string, unknown>) {
  return {
    onPointerDown: (e: ReactPointerEvent): void => {
      disarm(true)
      const a = {
        x: e.clientX,
        y: e.clientY,
        timer: 0,
        cancel: null as (() => void) | null,
        fire: (): void => {
          clearTimeout(a.timer)
          if (!a.cancel) a.cancel = prefetch(method, params)
        },
      }
      a.timer = window.setTimeout(a.fire, EARLY_ARM_MS)
      armed = a
    },
    onPointerMove: (e: ReactPointerEvent): void => {
      if (armed && Math.hypot(e.clientX - armed.x, e.clientY - armed.y) > 8) disarm(true)
    },
    onPointerCancel: (): void => disarm(true),
    // Тап короче задержки: запрос уходит сейчас, экран заберёт его на въезде.
    onPointerUp: (): void => {
      armed?.fire()
      disarm(false)
    },
  }
}

declare global {
  interface Window {
    /** bootstrap, отправленный из index.html ещё до загрузки бандла. */
    __boot?: { initData: string; res: Promise<Response> }
  }
}

/**
 * bootstrap на старте: забирает уже летящий запрос из index.html, если он сделан с той же
 * initData. Берётся один раз, повтор после ошибки идёт обычным путём. Запрос не дошёл -
 * тоже обычный путь: ранний мог уйти раньше, чем поднялась сеть.
 */
export async function bootstrapOnStart(): Promise<Bootstrap> {
  const early = window.__boot
  window.__boot = undefined
  if (early && early.initData === initData()) {
    let res: Response | null = null
    try {
      res = await early.res
    } catch {
      /* ниже обычный запрос */
    }
    if (res) return readApi<Bootstrap>(res)
  }
  return api<Bootstrap>('bootstrap')
}

async function readApi<T>(res: Response): Promise<T> {
  let data: any = {}
  try {
    data = await res.json()
  } catch {
    /* не-JSON — ниже упадём в generic */
  }
  if (!res.ok) {
    // Сервер отдаёт секунды в Retry-After (см. ratelimit.ts). Заголовка нет —
    // минута: полки короткие, и лучше подождать лишнего, чем долбить сервер.
    if (res.status === 429) startCooldown(Number(res.headers.get('Retry-After')) || 60)
    throw new ApiError(data?.message || 'Что-то пошло не так. Попробуйте ещё раз.', data?.error)
  }
  return data as T
}

/**
 * Заливка афиши ивента. Тело — сама картинка, поэтому мимо api(): там JSON и потолок
 * в 64 КБ. Возвращает id файла — редактор кладёт его в список и присылает вместе с
 * ивентом (до сохранения картинка ничьей и не привязана).
 */
export async function uploadEventPhoto(blob: Blob): Promise<string> {
  let res: Response
  try {
    // initData в заголовке, а не в query: URL оседает в логах туннеля.
    res = await fetch('/event-photo.jpg', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', Authorization: 'tma ' + initData() },
      body: blob,
    })
  } catch {
    throw new ApiError(NETWORK_ERROR, 'network')
  }
  let data: any = {}
  try {
    data = await res.json()
  } catch {
    /* не-JSON — ниже упадём в generic */
  }
  if (!res.ok) {
    throw new ApiError(data?.message || 'Не получилось загрузить фото. Попробуйте ещё раз.', data?.error)
  }
  return String(data.id)
}

// Коды, при которых данные разошлись с сервером — подтягиваем актуальные.
const RESYNC_CODES = ['already_approved', 'not_found', 'not_approved', 'no_proposal', 'bad_status', 'stale']

/** Мутация, возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.
    Возвращает null при ошибке (алерт показан внутри). */
/**
 * `quiet` — мутация без блокирующего оверлея. Полноэкранный спиннер осмыслен
 * там, где ответ меняет весь экран (создание заявки, блокировка, рассылка), и
 * бессмыслен на тумблере: он гасит интерфейс ради переключателя, который уже
 * показал новое состояние сам.
 */
export async function action(
  method: string,
  params?: Record<string, unknown>,
  opts?: { quiet?: boolean },
): Promise<Bootstrap | null> {
  const quiet = opts?.quiet === true
  if (!quiet) setBusy(true)
  try {
    const data = await mutate<Bootstrap>(method, params)
    if (data) setData(data)
    return data
  } finally {
    if (!quiet) setBusy(false)
  }
}

/**
 * Мутация без записи в стор: данные кладёт вызывающий, когда сам решит, например когда
 * рассыпалась и свернулась убранная строка. Отказ - как у action: отклик, алерт,
 * подтяжка данных, null.
 */
export async function mutate<T = Bootstrap>(method: string, params?: Record<string, unknown>): Promise<T | null> {
  // Полка ещё идёт — до сервера не ходим вовсе: он ответит тем же отказом и
  // продлит её. Кнопки в это время показывают отсчёт (useCooldown).
  const wait = cooldownLeft()
  if (wait > 0) {
    haptic.notify('warning')
    showAlert(`Слишком часто. Попробуйте через ${wait}\u00a0с.`)
    return null
  }
  try {
    const res = await api<T>(method, params)
    markOwnChange()
    return res
  } catch (err) {
    let e = err as ApiError
    if (e.code === 'network' && RETRY_SAFE.has(method)) {
      try {
        const res = await retryUntilOnline<T>(method, params)
        markOwnChange()
        return res
      } catch (again) {
        e = again as ApiError
      }
    }
    // Отказ сервера должен ощущаться, а не только читаться: успех отзывался
    // haptic'ом, а «слот занят» и «нет связи» приходили молча.
    haptic.notify('error')
    showAlert(e.message)
    if (e.code && RESYNC_CODES.includes(e.code)) {
      try {
        setData(await api<Bootstrap>('bootstrap'))
      } catch {
        /* сеть легла — оставляем как есть */
      }
    }
    return null
  }
}

// --- Ожидание сети -------------------------------------------------------------------
// Сеть пропала посреди своего действия: своя отметка остаётся на месте, шапка говорит
// «Ожидание сети…» (net.ts), и запрос уходит снова, когда сеть вернулась. Только ручкам,
// которым повтор не страшен: они ставят значение, а не прибавляют и не пишут людям.

const RETRY_SAFE = new Set([
  'attend',
  'notify',
  'notify.events',
  'notify.attend',
  'remind.set',
  'day.subscribe',
  'presence.log',
  'mac.anon',
  'dues.notify',
  'visit.mark',
])
/** Сколько ждём события online, прежде чем попробовать снова: оно приходит не всегда. */
const RETRY_MS = 4000
let waiting = 0
let retries: Promise<unknown> = Promise.resolve()

/** По очереди: «вкл, выкл», нажатые без сети, должны дойти в том же порядке. */
function retryUntilOnline<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  waiting++
  setNetState('waiting')
  const failedAt = performance.now()
  const run = async (): Promise<T> => {
    let since = failedAt
    for (;;) {
      if (reachedAt < since) await backOnline(RETRY_MS)
      setNetState('connecting')
      try {
        return await request<T>(method, params)
      } catch (err) {
        if ((err as ApiError).code !== 'network') throw err
        since = performance.now()
        setNetState('waiting')
      }
    }
  }
  const next = retries.then(run, run)
  retries = next.catch(() => {})
  return next.finally(() => {
    waiting--
    if (waiting === 0) setNetState('ok')
  })
}

/**
 * Подписка календаря на ивенты. Ссылка ведёт на `/events-subscribe`, а тот
 * редиректит на неё же схемой `webcal://`: только так календарь заводит подписку,
 * а не разово импортирует файл (из вебвью `webcal://` не открыть).
 */
export async function subscribeToEvents(): Promise<void> {
  try {
    const { token } = await api<{ token: string }>('calendar.link')
    openUrl(`${location.origin}/events-subscribe?token=${encodeURIComponent(token)}`)
  } catch (err) {
    showAlert((err as Error).message)
  }
}

/** Люди для сот знакомства. Не загрузились - знакомство откроется и так, с вами одним в центре. */
export async function loadOnboardingPeople(): Promise<OnboardingPeople> {
  try {
    return await api<OnboardingPeople>('onboarding.people')
  } catch {
    return { people: [], insideTotal: 0 }
  }
}

/** Знакомство из настроек: поверх текущего экрана, «назад» с обложки вернёт обратно. */
export async function openOnboarding(): Promise<void> {
  setBusy(true)
  const people = await loadOnboardingPeople()
  setBusy(false)
  push('onboarding', people)
}
