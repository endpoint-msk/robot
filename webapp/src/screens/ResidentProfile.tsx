// Карточка резидента: выдача админки в «чате»/каналах, member tag «resident» и аккаунт
// в Authentik. Всё — только dev (сервер гейтит admin.* и account.* через requireDev, здесь
// прячем управление от не-dev).
// Свой профиль из настроек - карточка журнала, как «Мои визиты»: без неё резидент без
// прав дева видел бы только свою аватарку. Права дева идут под ней.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { confirmDialog, showAlert } from '../modals'
import { markOwnTap } from '../motion'
import { useParams, useStore } from '../store'
import { haptic, hasProfile, openProfile } from '../telegram'
import type { AccountResponse, AccountStatus, AdminStatus } from '../types'
import { icons } from '../icons'
import { BackRow, ErrorState, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { ProfileHead } from '../components/ProfileHead'
import { MorphWord } from '../components/RequestRow'
import { Screen } from '../components/Screen'
import { PersonPage } from './StatsPerson'

const RESIDENT_TAG = 'resident'

/**
 * Выдача и снятие права одной кнопкой: подпись перетекает буквами, как «Захостить», пилл
 * растягивается под новое слово, заливка зеленеет, галочка раскрывается последней.
 */
function PermPill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    const [a, b] = box ? Array.from(box.querySelectorAll<HTMLElement>('.hb-l')) : []
    if (box && a && b) box.style.width = `${(on ? b : a).offsetWidth}px`
  }, [on, label])
  return (
    <button type="button" className={'perm-pill' + (on ? ' on' : '')} aria-label={on ? label : 'Выдать'} onClick={onClick}>
      <span className="hb-labels pp-labels" ref={ref} aria-hidden="true">
        <MorphWord text="Выдать" on={!on} />
        <MorphWord text={label} on={on} />
      </span>
      <span className="pp-check" aria-hidden="true">
        {icons.check(13, '#34c759', 2.6)}
      </span>
    </button>
  )
}

// Без аккаунта под строкой id: его вписывают старому аккаунту атрибутом telegram_id.
const accountLine = (a: AccountStatus): string =>
  a.error ??
  (!a.exists
    ? `telegram_id ${a.telegramId}`
    : !a.active
      ? 'выключен'
      : !a.inGroup
        ? `без группы «${a.group}»`
        : (a.email ?? `группа «${a.group}»`))

export function ResidentProfile() {
  const { userId, name, username } = useParams() as { userId: number; name?: string; username?: string | null }
  const { data: boot } = useStore()
  const isDev = boot!.me.isDev

  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [account, setAccount] = useState<AccountResponse | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  // Права и аккаунт - один экран и один каркас: ждём оба ответа, а не рисуем их по очереди.
  const load = () =>
    Promise.all([api<AdminStatus>('admin.status', { userId }), api<AccountResponse>('account.status', { userId })])

  useEffect(() => {
    if (!isDev) return
    let alive = true
    setError(false)
    void (async () => {
      try {
        const [s, a] = await load()
        if (!alive) return
        setStatus(s)
        setAccount(a)
      } catch {
        if (alive) setError(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [userId, isDev])

  const retry = async () => {
    setError(false)
    setStatus(null)
    setAccount(null)
    try {
      const [s, a] = await load()
      setStatus(s)
      setAccount(a)
    } catch {
      setError(true)
    }
  }

  // Право, которое меняют сейчас: пилл встаёт в новое положение на тапе, свежий статус из
  // ответа его подтверждает, отказ возвращает прежнее.
  const [want, setWant] = useState<Record<string, boolean>>({})

  // Мутация возвращает свежий статус — обновляем экран прямо из ответа, без повторного
  // тяжёлого запроса. Второй запрос, пока летит первый, не уходит.
  const run = async (method: string, body: Record<string, unknown>, key: string, next: boolean): Promise<void> => {
    if (busy) return
    markOwnTap()
    haptic.impact('light')
    setWant((w) => ({ ...w, [key]: next }))
    setBusy(true)
    try {
      const s = await api<AdminStatus>(method, { userId, ...body })
      setStatus(s)
    } catch (e) {
      haptic.notify('error')
      showAlert((e as Error).message)
    } finally {
      setWant((w) => {
        const rest = { ...w }
        delete rest[key]
        return rest
      })
      setBusy(false)
    }
  }

  const runAccount = async (method: 'account.create' | 'account.delete'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      setAccount(await api<AccountResponse>(method, { userId }))
      haptic.notify('success')
    } catch (e) {
      haptic.notify('error')
      showAlert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const face = { userId, name: name ?? '', username: username ?? null }
  const label = name || (username ? '@' + username : 'Резидент')
  const frame = (body: ReactNode) =>
    userId === boot!.me.id ? (
      <Screen>
        <BackRow />
        <PersonPage
          userId={userId}
          known={{ userId, label: username ? '@' + username : label, username: username ?? null }}
          profile={{ name: label, username: username ?? null }}
          extra={body}
        />
      </Screen>
    ) : (
      <Screen>
        <BackRow />
        <ProfileHead
          user={face}
          name={label}
          sub={username ? `@${username}` : undefined}
          actions={
            hasProfile(face)
              ? [{ key: 'tg', label: 'Telegram', icon: icons.telegram(22, 'currentColor'), onClick: () => openProfile(face) }]
              : []
          }
        />
        {body}
      </Screen>
    )

  if (!isDev) return frame(null)
  if (error) return frame(<ErrorState onRetry={() => void retry()} />)
  if (!status || !account) return frame(<SpinnerCenter />)

  const tagTarget = status.targets.find((t) => t.canTag)
  const acc = account.account

  const removeAccount = async (a: AccountStatus) => {
    const login = a.username ?? ''
    const ok = await confirmDialog(`Удалить аккаунт ${login}? Он пропадёт из Authentik вместе с сессиями.`, {
      confirmLabel: 'Удалить',
      destructive: true,
      subject: { user: face, line: login },
    })
    if (ok) await runAccount('account.delete')
  }

  return frame(
    <>
      {status.targets.length > 0 ? (
        <>
          <SectionTitle>Администратор</SectionTitle>
          <div className="card">
            {status.targets.map((t, i) => (
              <Fragment key={t.key}>
                {i > 0 ? <Sep inset="text" /> : null}
                <div className="row">
                  <span className="row-label">{t.label}</span>
                  {t.error ? (
                    <span className="perm-state">нет доступа</span>
                  ) : t.creator ? (
                    <span className="perm-state">владелец</span>
                  ) : !t.present ? (
                    <span className="perm-state">не в чате</span>
                  ) : t.admin && !t.canEdit && want[t.key] === undefined ? (
                    <span className="perm-state">админ, выдал не бот</span>
                  ) : (
                    <PermPill
                      on={want[t.key] ?? t.admin}
                      label="Админ"
                      onClick={() => {
                        const on = want[t.key] ?? t.admin
                        void run(on ? 'admin.revoke' : 'admin.grant', { target: t.key }, t.key, !on)
                      }}
                    />
                  )}
                </div>
              </Fragment>
            ))}
          </div>

          {tagTarget ? (
            <>
              <SectionTitle>Тег «{RESIDENT_TAG}»</SectionTitle>
              <div className="card">
                <div className="row">
                  <span className="row-label">Тег в чате</span>
                  {tagTarget.error ? (
                    <span className="perm-state">нет доступа</span>
                  ) : !tagTarget.present ? (
                    <span className="perm-state">не в чате</span>
                  ) : (
                    <PermPill
                      on={want['#tag'] ?? Boolean(tagTarget.tag)}
                      label={tagTarget.tag || RESIDENT_TAG}
                      onClick={() => {
                        const on = want['#tag'] ?? Boolean(tagTarget.tag)
                        void run('admin.tag', { on: !on }, '#tag', !on)
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {acc ? (
        <>
          <SectionTitle>Аккаунт</SectionTitle>
          <div className="card">
            <div className="row">
              <span className="row-label">
                {acc.username ?? 'Нет аккаунта'}
                <span className="row-sublabel">{accountLine(acc)}</span>
              </span>
              {acc.error ? (
                <span className="perm-state">нет доступа</span>
              ) : acc.exists && acc.active && acc.inGroup ? (
                <span className="perm-state">включён</span>
              ) : (
                <button type="button" className="perm-pill" disabled={busy} onClick={() => void runAccount('account.create')}>
                  {acc.exists ? 'Включить' : 'Создать'}
                </button>
              )}
            </div>
          </div>
          {acc.exists ? (
            <button
              type="button"
              className="destructive-btn"
              style={{ marginTop: 14 }}
              disabled={busy}
              onClick={() => void removeAccount(acc)}
            >
              Удалить аккаунт
            </button>
          ) : null}
        </>
      ) : null}
    </>,
  )
}
