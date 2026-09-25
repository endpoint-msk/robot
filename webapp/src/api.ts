// API и мутации. api() — низкоуровневый POST /api/*; action() — мутация,
// возвращающая свежий bootstrap: обновляет стор и перерисовывает экран.

import { left as cooldownLeft, startCooldown } from './cooldown'
import { push, setBusy, setData } from './store'
import { haptic, initData, openUrl } from './telegram'
import { showAlert } from './modals'
import { ApiError, type Bootstrap, type OnboardingPeople } from './types'

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
  // Полка ещё идёт — до сервера не ходим вовсе: он ответит тем же отказом и
  // продлит её. Кнопки в это время показывают отсчёт (useCooldown).
  const wait = cooldownLeft()
  if (wait > 0) {
    haptic('error')
    showAlert(`Слишком часто. Попробуйте через ${wait} с.`)
    return null
  }
  const quiet = opts?.quiet === true
  if (!quiet) setBusy(true)
  try {
    const data = await api<Bootstrap>(method, params)
    setData(data)
    return data
  } catch (err) {
    const e = err as ApiError
    // Отказ сервера должен ощущаться, а не только читаться: успех отзывался
    // haptic'ом, а «слот занят» и «нет связи» приходили молча.
    haptic('error')
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
    if (!quiet) setBusy(false)
  }
}

/**
 * Подписка календаря на ивенты. Ссылка ведёт на `/events-subscribe`, а тот
 * редиректит на неё же схемой `webcal://`: только так календарь заводит подписку,
 * а не разово импортирует файл (из вебвью `webcal://` не открыть).
 */
export async function subscribeToEvents(): Promise<void> {
  try {
    const { token } = await api<{ token: string }>('calendar.link')
    haptic('success')
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
