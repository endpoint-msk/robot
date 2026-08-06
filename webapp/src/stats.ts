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

export const HEAT_STEPS = [0.16, 0.32, 0.5, 0.72, 1]

/** Полосатая заливка «данных нет»: пустая ячейка означает «никого не было», это другое. */
export const HEAT_NO_DATA =
  'repeating-linear-gradient(135deg, rgba(var(--sec),0.16) 0 3px, rgba(var(--sec),0.04) 3px 6px)'

export const heatEmpty = 'rgba(var(--sec),0.07)'

/** Ступень шкалы для ячейки: 5 уровней одного тона, а не радуга. */
export const heatBg = (v: number, max: number, noData = false): string => {
  if (noData) return HEAT_NO_DATA
  if (max <= 0 || v <= 0) return heatEmpty
  const level = Math.min(HEAT_STEPS.length, Math.max(1, Math.ceil((v / max) * HEAT_STEPS.length)))
  return `rgba(10, 132, 255, ${HEAT_STEPS[level - 1]})`
}

/** Аватарка-заглушка: буква на градиенте, цвет детерминирован по userId. */
export const gradientFor = (userId: number): string => {
  const hue = Math.abs(userId * 47) % 360
  return `linear-gradient(135deg, hsl(${hue} 68% 55%), hsl(${(hue + 40) % 360} 68% 45%))`
}

export const initialOf = (label: string): string => {
  const clean = label.replace(/^@/, '').trim()
  return (clean[0] ?? '?').toUpperCase()
}
