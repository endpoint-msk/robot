// Плашка повестки дня под шапкой экрана дня: у резидента и у гостя.

import { icons } from '../icons'
import type { DayAgenda } from '../types'
import { userLabel } from './people'

/**
 * С `onEdit` плашка резидентская: это кнопка правки, и под текстом видно, кто поставил.
 * Без него гостевая, только текст. Автора прячем по экрану, а не по наличию `by`:
 * дев в перспективе гостя получает его от сервера, потому что тот видит в нём резидента.
 */
export function AgendaBanner({ agenda, onEdit }: { agenda: DayAgenda; onEdit?: () => void }) {
  const body = (
    <>
      <div className="ab-icon">{icons.agenda(17, '#fff')}</div>
      <div className="ab-text">
        <div className="ab-title">{agenda.text}</div>
        {onEdit && agenda.by ? <div className="ab-sub">{`поставил ${userLabel(agenda.by)}`}</div> : null}
      </div>
    </>
  )
  return onEdit ? (
    <button type="button" className="agenda-banner" onClick={onEdit}>
      {body}
      {icons.chevron()}
    </button>
  ) : (
    <div className="agenda-banner">{body}</div>
  )
}
