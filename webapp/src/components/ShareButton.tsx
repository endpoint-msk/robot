// «Переслать», как пересылка сообщения в Telegram: свой выбор чата клиента (shareMessage,
// Bot API 8.0), и туда уходит карточка от бота с кнопкой «Хочу прийти». Карточку сервер
// готовит на касании кнопки, а не на входе в экран: за каждой стоит вызов Telegram, а к
// щелчку она обычно уже готова. Клиент старше 8.0 получает ту же ссылку t.me в буфер.

import { useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { markOwnTap } from '../motion'
import { useStore } from '../store'
import { haptic, shareMessage, shareSupported } from '../telegram'
import { useCopyFeedback } from './CopyFeedback'
import { MorphWord } from './RequestRow'

export type ShareTarget = { kind: 'event'; id: string } | { kind: 'day'; dateKey: string }

type Prepared = { id: string; expireDate: number }

/** Адрес места для ссылки t.me, как у кнопок бота (src/deeplink.ts). */
const targetOf = (t: ShareTarget): string => (t.kind === 'event' ? `event-${t.id}` : `new-${t.dateKey}`)

function useShare(target: ShareTarget) {
  const { data } = useStore()
  const [sent, setSent] = useState(false)
  const prepared = useRef<Promise<Prepared | null> | null>(null)
  const failure = useRef<string | null>(null)
  const clip = useCopyFeedback(16)
  const native = shareSupported()

  const prepare = (): Promise<Prepared | null> => {
    if (prepared.current) return prepared.current
    const load = api<Prepared>('share.prepare', { ...target }).catch((err: Error) => {
      failure.current = err.message
      // Отказ не кэшируем: следующий тап попробует снова.
      if (prepared.current === load) prepared.current = null
      return null
    })
    prepared.current = load
    return load
  }

  /** Палец лёг на кнопку: карточку начинают готовить, пока он не отпущен. */
  const arm = (): void => {
    if (native) void prepare()
  }

  /** Клиенту без выбора чата та же ссылка t.me уходит в буфер. */
  const copyLink = async (e: MouseEvent): Promise<void> => {
    const link = data?.bot ? `https://t.me/${data.bot}?startapp=${targetOf(target)}` : null
    if (link && !(await clip.copy(link, e))) showAlert(link)
  }

  const share = async (e: MouseEvent): Promise<void> => {
    markOwnTap()
    haptic.impact('light')
    if (!native) {
      await copyLink(e)
      return
    }
    let card = await prepare()
    // Карточка живёт ограниченно: протухшую готовим заново.
    if (card && card.expireDate * 1000 < Date.now() + 10_000) {
      prepared.current = null
      card = await prepare()
    }
    if (!card) {
      showAlert(failure.current ?? 'Не получилось подготовить карточку. Попробуйте ещё раз.')
      return
    }
    const sent = await shareMessage(card.id)
    // Клиент не открыл выбор чата: без ссылки тап остался бы без ответа.
    if (sent === null) await copyLink(e)
    if (sent) {
      // Отправленную карточку второй раз не шлём: следующий тап готовит новую.
      prepared.current = null
      haptic.notify('success')
      setSent(true)
    }
  }

  return { sent, arm, share, toast: clip.toast }
}

/** Подпись меняется буквами, как у «Захостить», значок пересылки тает в галочку. */
function Label({ text, sent }: { text: string; sent: boolean }) {
  return (
    <>
      <span className={'share-ico' + (sent ? ' sent' : '')} aria-hidden="true">
        <span className="si-a">{icons.forward(19, 'currentColor')}</span>
        <span className="si-b">{icons.check(16, 'currentColor', 2.4)}</span>
      </span>
      <span className="hb-labels" aria-hidden="true">
        <MorphWord text={text} on={!sent} />
        <MorphWord text="Отправлено" on={sent} />
      </span>
    </>
  )
}

/** Широкая кнопка рядом с «В календарь» на экране ивента. */
export function ShareButton({ target, style }: { target: ShareTarget; style?: CSSProperties }) {
  const s = useShare(target)
  return (
    <>
      <button
        type="button"
        className={'secondary-btn evv-cal-wide share-btn' + (s.sent ? ' sent' : '')}
        style={style}
        aria-label={s.sent ? 'Отправлено' : 'Переслать'}
        onPointerDown={s.arm}
        onClick={(e) => void s.share(e)}
      >
        <Label text="Переслать" sent={s.sent} />
      </button>
      {s.toast}
    </>
  )
}

/** Квадратная кнопка в ряду с «Хочу прийти» у гостя. */
export function ShareIconButton({ target, style }: { target: ShareTarget; style?: CSSProperties }) {
  const s = useShare(target)
  return (
    <>
      <button
        type="button"
        className={'evv-cal share-btn' + (s.sent ? ' sent' : '')}
        style={style}
        aria-label={s.sent ? 'Отправлено' : 'Переслать'}
        title="Переслать"
        onPointerDown={s.arm}
        onClick={(e) => void s.share(e)}
      >
        <span className={'share-ico' + (s.sent ? ' sent' : '')} aria-hidden="true">
          <span className="si-a">{icons.forward(20, 'currentColor')}</span>
          <span className="si-b">{icons.check(17, 'currentColor', 2.4)}</span>
        </span>
      </button>
      {s.toast}
    </>
  )
}

/** Строка «Из контактов Telegram» на экране «Позвать в спейс». */
export function ShareRow({ target, label }: { target: ShareTarget; label: string }) {
  const s = useShare(target)
  return (
    <>
      <button
        type="button"
        className="row tappable share-row"
        aria-label={s.sent ? 'Отправлено' : label}
        onPointerDown={s.arm}
        onClick={(e) => void s.share(e)}
      >
        <div className="row-icon" style={{ background: 'var(--blue)' }}>
          {icons.forward(17, '#fff')}
        </div>
        <span className="row-label">
          <span className="hb-labels share-row-labels" aria-hidden="true">
            <MorphWord text={label} on={!s.sent} />
            <MorphWord text="Отправлено" on={s.sent} />
          </span>
        </span>
      </button>
      {s.toast}
    </>
  )
}
