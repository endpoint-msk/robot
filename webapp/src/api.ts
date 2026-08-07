// API и мутации. api() — низкоуровневый POST /api/*; action() — мутация,
// возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.

import { setBusy, setData } from './store'
import { initData } from './telegram'
import { showAlert } from './modals'
import { ApiError, type Bootstrap } from './types'

/** Сбой сети — такая же ошибка приложения, как и отказ сервера: без этого наружу
    летел техтекст браузера («Failed to fetch») и попадал прямо в алерт. */
const NETWORK_ERROR = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'

export async function api<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData(), ...(params ?? {}) }),
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
    res = await fetch('/event-photo.jpg?initData=' + encodeURIComponent(initData()), {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
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
