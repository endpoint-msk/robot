import { useEffect, useState } from 'react'
import { api } from '../api'
import { plural } from '../dates'
import { confirmDialog, showAlert } from '../modals'
import { pop, setBusy } from '../store'
import { haptic } from '../telegram'
import type { AnnounceLatest, AnnounceSendResult } from '../types'
import { BackRow, EmptyState, Header, SectionTitle, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'

function AnnounceForm({ info }: { info: AnnounceLatest }) {
  const [text, setText] = useState(info.defaultText || '')
  const targets = info.targetChats
  const trimmed = text.trim()

  const already = info.release && info.lastAnnouncedVersion === info.release.version
  const status = info.release
    ? `Последний релиз: ${info.release.version}` +
      (already
        ? ' · уже анонсирован'
        : info.lastAnnouncedVersion
          ? ` · анонсирован ${info.lastAnnouncedVersion}`
          : ' · ещё не анонсирован')
    : 'Релизов пока нет — можно разослать произвольный текст.'

  const submit = async (): Promise<void> => {
    const t = text.trim()
    if (!t) {
      showAlert('Текст анонса пуст.')
      return
    }
    if (targets === 0) {
      showAlert('Нет чатов для рассылки — все замьючены.')
      return
    }
    const ok = await confirmDialog(`Разослать анонс в ${targets} ${plural(targets, 'чат', 'чата', 'чатов')}?`, {
      confirmLabel: 'Разослать',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await api<AnnounceSendResult>('announce.send', {
        text: t,
        version: (info.release && info.release.version) || '',
      })
      haptic('success')
      const tail = res.failed ? `, не дошло в ${res.failed}` : ''
      showAlert(`Отправлено в ${res.sent} ${plural(res.sent, 'чат', 'чата', 'чатов')}${tail}.`)
      pop()
    } catch (err) {
      showAlert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="announce-status">{status}</div>
      <SectionTitle>Текст</SectionTitle>
      <div className="card announce-card">
        <textarea
          className="announce-text"
          rows={8}
          maxLength={3500}
          placeholder="Текст анонса"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <SectionTitle>Превью</SectionTitle>
      <div className="card">
        <div className={'announce-preview' + (trimmed ? '' : ' is-placeholder')}>
          {trimmed || 'Здесь появится текст анонса…'}
        </div>
      </div>
      <div style={{ padding: '18px 0 8px' }}>
        <button className="primary-btn" onClick={submit}>
          {targets === 0 ? 'Нет чатов для рассылки' : `Разослать в ${targets} ${plural(targets, 'чат', 'чата', 'чатов')}`}
        </button>
      </div>
    </>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; info: AnnounceLatest }
  | { status: 'error'; message: string }

export function Announce() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    api<AnnounceLatest>('announce.latest')
      .then((info) => {
        if (!cancelled) setState({ status: 'ok', info })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  let body
  if (state.status === 'loading') body = <SpinnerCenter />
  else if (state.status === 'error')
    body = (
      <div className="card">
        <EmptyState title="Не получилось загрузить" text={state.message} />
      </div>
    )
  else body = <AnnounceForm info={state.info} />

  return (
    <Screen>
      <BackRow label="Dev" />
      <Header title="Анонс" subtitle="Рассылка обновлений и объявлений в чаты" />
      {body}
    </Screen>
  )
}
