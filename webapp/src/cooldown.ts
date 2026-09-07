// Отсчёт после отказа по рейтлимиту. Раньше 429 показывался обычной модалкой,
// после которой кнопка снова выглядела рабочей: человек жал её по кругу, каждый
// раз получая тот же отказ и продлевая себе полку.
//
// Автоповтора здесь нет намеренно: за отказом стоит полка на сервере, и запрос,
// отправленный «за человека», только продлил бы её. Ждём, показываем сколько,
// решает всё равно он.

let until = 0
const listeners = new Set<() => void>()
let timer: number | null = null

const emit = (): void => listeners.forEach((l) => l())

const tick = (): void => {
  if (left() > 0) return
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  emit()
}

/** Секунд до конца полки. 0 — можно работать. */
export function left(): number {
  const ms = until - Date.now()
  return ms > 0 ? Math.ceil(ms / 1000) : 0
}

export function startCooldown(seconds: number): void {
  const next = Date.now() + Math.max(1, seconds) * 1000
  if (next <= until) return
  until = next
  if (timer === null) timer = window.setInterval(tick, 500)
  emit()
}

export const subscribeCooldown = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Сколько секунд ждать — для подписи на кнопке. */
export const cooldownSnapshot = (): number => left()
