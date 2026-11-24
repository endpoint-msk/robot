import { useRef, useState } from 'react'
import { mutate } from '../api'
import { tr } from '../i18n'
import { icons } from '../icons'
import { openUrl } from '../telegram'

export function IssuesChannelRow() {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)

  async function openChannel() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const invite = await mutate<{ url: string }>('issues.invite')
      if (invite) openUrl(invite.url, '_self')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <button type="button" className="row tappable" disabled={busy} aria-busy={busy} onClick={openChannel}>
      <span className="row-label">
        {tr('Канал «ищью»', 'Issues channel')}
        <span className="row-sublabel">
          {busy ? tr('Получаем приглашение…', 'Getting your invite…') : tr('Вопросы и предложения о спейсе. Разовая ссылка на час.', 'Questions and proposals about the space. One-use invite, valid for an hour.')}
        </span>
      </span>
      <span className="row-right">{icons.external()}</span>
    </button>
  )
}
