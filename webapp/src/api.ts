// API и мутации. api() — низкоуровневый POST /api/*; action() — мутация,
// возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.

import { setBusy, setData } from './store'
import { initData } from './telegram'
import { showAlert } from './modals'
import { ApiError, type Bootstrap } from './types'

export async function api<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: initData(), ...(params ?? {}) }),
  })
  let data: any = {}
  try {
    data = await res.json()
  } catch {
    /* не-JSON — ниже упадём в generic */
  }
  if (!res.ok) {
    throw new ApiError(data?.message || 'Что-то пошло не так. Попробуй ещё раз.', data?.error)
  }
  return data as T
}

// Коды, при которых данные разошлись с сервером — подтягиваем актуальные.
const RESYNC_CODES = ['already_approved', 'not_found', 'not_approved', 'no_proposal', 'bad_status', 'stale']

/** Мутация, возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.
    Возвращает null при ошибке (алерт показан внутри). */
export async function action(method: string, params?: Record<string, unknown>): Promise<Bootstrap | null> {
  setBusy(true)
  try {
    const data = await api<Bootstrap>(method, params)
    setData(data)
    return data
  } catch (err) {
    const e = err as ApiError
    showAlert(e.message)
    if (e.code && RESYNC_CODES.includes(e.code)) {
      try {
        setData(await api<Bootstrap>('bootstrap'))
      } catch {
        /* сеть легла — оставляем как есть */
      }
    }
    return null
  } finally {
    setBusy(false)
  }
}
