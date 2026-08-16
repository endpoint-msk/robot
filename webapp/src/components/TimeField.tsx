// Поле времени вместо <input type="time">. Нативный инпут рисует am/pm, когда
// локаль браузера/системы английская, а формат ему не задать ничем: он берётся
// из локали, а не из lang/атрибутов. Спейс живёт в 24-часовом времени, поэтому
// часы и минуты выбираются двумя <select> — на телефоне это то же нативное
// колесо, что и у старого инпута, но подписи наши и всегда 00–23.

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_STEP = 5

const split = (value: string): [string, string] => {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  return m ? [m[1]!, m[2]!] : ['15', '00']
}

/**
 * Шаг в 5 минут покрывает живые сценарии, но в списке всегда есть и текущее
 * значение, и нижняя граница `min` — иначе выбранное «18:37» или запрет «не
 * раньше 14:37» оказались бы невыбираемыми.
 */
const minuteOptions = (...extra: (string | null)[]): string[] => {
  const set = new Set<string>()
  for (let m = 0; m < 60; m += MINUTE_STEP) set.add(String(m).padStart(2, '0'))
  for (const v of extra) if (v) set.add(v)
  return [...set].sort()
}

export function TimeField({
  value,
  onChange,
  min,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** Нижняя граница `HH:MM` (слот «на сегодня» не должен быть в прошлом). */
  min?: string | undefined
  className?: string
}) {
  const [hour, minute] = split(value)
  const [minHour, minMinute] = min ? split(min) : [null, null]
  const atMinHour = minHour !== null && hour === minHour
  const minutes = minuteOptions(minute, atMinHour ? minMinute : null)

  const setHour = (next: string): void => {
    // Съехали на граничный час — минуты могли остаться в прошлом.
    const bump = minHour !== null && next === minHour && minMinute !== null && minute < minMinute
    onChange(next + ':' + (bump ? minMinute : minute))
  }

  return (
    <span className={'time-input time-field' + (className ? ' ' + className : '')}>
      <select className="tf-select" aria-label="Часы" value={hour} onChange={(e) => setHour(e.target.value)}>
        {HOURS.map((h) => (
          <option key={h} value={h} disabled={minHour !== null && h < minHour}>
            {h}
          </option>
        ))}
      </select>
      <span className="tf-colon">:</span>
      <select
        className="tf-select"
        aria-label="Минуты"
        value={minute}
        onChange={(e) => onChange(hour + ':' + e.target.value)}
      >
        {minutes.map((m) => (
          <option key={m} value={m} disabled={atMinHour && minMinute !== null && m < minMinute}>
            {m}
          </option>
        ))}
      </select>
    </span>
  )
}
