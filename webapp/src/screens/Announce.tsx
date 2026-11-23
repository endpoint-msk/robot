import { plural, tr } from '../i18n'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { nb } from '../format'
import { confirmDialog, showAlert } from '../modals'
import { pop, setBusy } from '../store'
import { haptic } from '../telegram'
import type { AnnounceLatest, AnnounceSendResult } from '../types'
import { BackRow, EmptyState, Header, SectionTitle, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'

const chatCount = (n: number): string => `${n} ${plural(n, ['чат', 'чата', 'чатов'], ['chat', 'chats'])}`

function AnnounceForm({ info }: { info: AnnounceLatest }) {
  const [text, setText] = useState(info.defaultText || '')
  const targets = info.targetChats
  const trimmed = text.trim()

  const already = info.release && info.lastAnnouncedVersion === info.release.version
  const status = info.release
    ? tr(`Последний релиз: ${info.release.version}`, `Latest release: ${info.release.version}`) +
      (already
        ? tr(' · уже анонсирован', ' · already announced')
        : info.lastAnnouncedVersion
          ? tr(` · анонсирован ${info.lastAnnouncedVersion}`, ` · announced version ${info.lastAnnouncedVersion}`)
          : tr(' · ещё не анонсирован', ' · announcement pending'))
    : tr('Релизов пока нет — можно разослать произвольный текст.', 'There are no releases yet. You can send a custom announcement.')

  const submit = async (): Promise<void> => {
    const t = text.trim()
    if (!t) {
      showAlert(tr('Текст анонса пуст.', 'Enter an announcement first.'))
      return
    }
    if (targets === 0) {
      showAlert(tr('Нет чатов для рассылки — все замьючены.', 'Announcements are muted in all chats.'))
      return
    }
    const ok = await confirmDialog(tr(`Разослать анонс в ${chatCount(targets)}?`, `Send this announcement to ${chatCount(targets)}?`), {
      confirmLabel: tr('Разослать', 'Send announcement'),
      cancelLabel: tr('Не рассылать', 'Cancel'),
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await api<AnnounceSendResult>('announce.send', {
        text: t,
        version: (info.release && info.release.version) || '',
      })
      haptic.notify('success')
      const tail = res.failed ? nb(tr(`, не дошло в ${res.failed}`, `, failed in ${res.failed}`)) : ''
      showAlert(tr(`Отправлено в ${chatCount(res.sent)}${tail}.`, `Sent to ${chatCount(res.sent)}${tail}.`))
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
      <SectionTitle>{tr('Текст', 'Text')}</SectionTitle>
      <div className="card announce-card">
        <textarea
          className="announce-text"
          rows={8}
          maxLength={3500}
          placeholder={tr('Текст анонса', 'Announcement text')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <SectionTitle>{tr('Превью', 'Preview')}</SectionTitle>
      <div className="card">
        <div className={'announce-preview' + (trimmed ? '' : ' is-placeholder')}>
          {trimmed || tr('Здесь появится текст анонса…', 'Your announcement will appear here…')}
        </div>
      </div>
      <div style={{ padding: '18px 0 8px' }}>
        <button className="primary-btn" onClick={submit}>
          {targets === 0 ? tr('Нет чатов для рассылки', 'No chats to send to') : nb(tr(`Разослать в ${chatCount(targets)}`, `Send to ${chatCount(targets)}`))}
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
  if (state.status === 'loading') body = null
  else if (state.status === 'error')
    body = (
      <div className="card">
        <EmptyState title={tr('Не получилось загрузить', "Couldn't load the data")} text={state.message} />
      </div>
    )
  else body = <AnnounceForm info={state.info} />

  return (
    <Screen>
      <BackRow label="Dev" />
      <Header title={tr('Анонс', 'Announcement')} subtitle={tr('Рассылка обновлений и объявлений в чаты', 'Send updates and announcements to chats')} />
      <Swap loading={state.status === 'loading'} skeleton={<SpinnerCenter />}>
        {body}
      </Swap>
    </Screen>
  )
}
