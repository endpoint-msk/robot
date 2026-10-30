// Тема дня строкой шапки дня: под датой, тем же кеглем, что тема в карточке «Сегодня» на
// главной. У резидента строка открывает правку, у гостя это только текст. Автора здесь нет:
// резиденты видят его подписью строки «Тема дня» в карточке «День».

import { useEffect, useState } from 'react'
import { OWN_TAP_WINDOW_MS, reducedMotion } from '../motion'

// Тема, поставленная своим тапом: на какой день и когда. Общего «был свой тап» мало: тема
// другого резидента, пришедшая с данными сразу после своего касания где угодно, тоже
// проступала бы, а чужое изменение встаёт без движения.
let ownTopic: { dateKey: string; at: number } | null = null

export const markOwnTopic = (dateKey: string): void => {
  ownTopic = { dateKey, at: performance.now() }
}

/** Своя тема проступает на месте по эталону «Захостить»: из размытия и масштаба. */
export function DayTopic({ text, dateKey, onEdit }: { text: string; dateKey: string; onEdit?: () => void }) {
  const [fresh] = useState(
    () => ownTopic !== null && ownTopic.dateKey === dateKey && performance.now() - ownTopic.at < OWN_TAP_WINDOW_MS && !reducedMotion(),
  )
  useEffect(() => {
    if (fresh) ownTopic = null
  }, [fresh])
  const cls = 'dpg-topic' + (fresh ? ' fresh' : '')
  const body = <span className="dpg-topic-t">{text}</span>
  return onEdit ? (
    <button type="button" className={cls} onClick={onEdit}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
