// Общее для экранов журнала присутствия: форматирование длительностей и шкала
// тепловой карты. Цвета считаются в JS, потому что в градиент и в inline-стиль
// ячейки CSS-переменную темы подставить нельзя.

import { plural } from './dates'

/** Часы одним числом: «148», «7,5». Для крупных цифр в карточках. */
export const hoursNum = (minutes: number): string => {
  const hours = minutes / 60
  if (hours >= 10) return String(Math.round(hours))
  return (Math.round(hours * 10) / 10).toString().replace('.', ',')
}

/**
 * Слово к крупной цифре из `hoursNum`. Дробное число требует родительного падежа
 * единственного числа («7,5 часа»), целое склоняется обычным правилом. Считаем по
 * той же строке, что и показываем: иначе округление 6,98 → «7» разошлось бы со
 * словом, посчитанным по исходным минутам.
 */
export const hoursNumWord = (minutes: number): string => {
  const shown = Number(hoursNum(minutes).replace(',', '.'))
  return Number.isInteger(shown) ? plural(shown, 'час', 'часа', 'часов') : 'часа'
}

export const hoursWord = (minutes: number): string => {
  const n = Math.round(minutes / 60)
  return `${n} ${plural(n, 'час', 'часа', 'часов')}`
}

/** «3 ч 20 мин», «45 мин» — длительность визита в строке списка. */
export const fmtDuration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  if (h === 0) return `${m} мин`
  const rest = m % 60
  return rest > 0 ? `${h} ч ${rest} мин` : `${h} ч`
}

/** Минуты от полуночи → 'HH:MM'. */
export const fmtMinutes = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const HEAT_LEVELS = 5

/**
 * Ступень шкалы: 0 — никого не было, 1..5 — сколько.
 *
 * Ноль отдельным уровнем, а не самой светлой ступенью: раньше «пусто» и «людей
 * было мало» отличались на 1.08:1 в светлой теме и 1.02:1 в тёмной, то есть
 * ровно то различие, ради которого карта нарисована, она и теряла.
 */
export const heatLevel = (v: number, max: number): number => {
  if (max <= 0 || v <= 0) return 0
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((v / max) * HEAT_LEVELS)))
}

/**
 * Класс и стиль ячейки карты. Три состояния читаются структурой, а не оттенком:
 * штриховка — данных нет, пустая клетка с контуром — никого, заливка — были.
 */
export const heatCell = (
  level: number,
  noData = false,
): { className: string; style?: { background: string } } => {
  if (noData) return { className: 'heat-cell nodata' }
  if (level <= 0) return { className: 'heat-cell zero' }
  return { className: 'heat-cell', style: { background: `var(--heat-${level})` } }
}

/** Человекочасы ячейки словами: «1,3 чел.». Без единицы цифра в подсказке нечитаема. */
export const heatValue = (v: number): string => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} чел.`

/** Двухчасовой интервал ячейки: «14–16». */
export const heatSlot = (bucket: number): string =>
  `${String(bucket * 2).padStart(2, '0')}–${String((bucket * 2 + 2) % 24).padStart(2, '0')}`

/**
 * Человек журнала в виде, который понимает `Avatar`: имён Telegram в сессиях нет,
 * там только ник — он же идёт и в букву заглушки, пока не приедет фото.
 */
export const statsAvatarUser = (p: { userId: number; username: string | null }) => ({
  userId: p.userId,
  username: p.username,
  name: p.username ?? 'Без ника',
})
