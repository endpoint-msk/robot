import { Fragment, useState, type ReactNode } from 'react'
import { action, mutate, openOnboarding, subscribeToEvents } from '../api'
import { icons } from '../icons'
import { tr, type LanguageChoice } from '../i18n'
import { CHOICE_LABEL, choiceOf, notifyBanners, prefsFor, type NotifyChoice } from '../notifyPreview'
import { markOwnTap } from '../motion'
import { push, setData, setThemeFrom, useStore } from '../store'
import { botCanWrite, haptic, openUrl, requestWriteAccess } from '../telegram'
import type { Settings as SettingsData, ThemeChoice } from '../types'
import { BackRow, Header, NotifyIcon, RadioCheck, SectionTitle, Sep, SwitchRow } from '../components/common'
import { bindPhone } from '../components/MacSheet'
import { IssuesChannelRow } from '../components/IssuesChannelRow'
import { MorphValue } from '../components/MorphWord'
import { MenuItems, useRowMenu } from '../components/RowMenu'
import { Notification } from '../components/OnboardingScenes'
import { Screen } from '../components/Screen'
import { bringBack, dustRow, offerUndo, removeRow, type Undoable } from '../undo'

function LanguageSection() {
  const { data } = useStore()
  const menu = useRowMenu<'language'>()
  const [saving, setSaving] = useState(false)
  const choice = data?.me.languageChoice ?? 'auto'
  const title = tr('Язык', 'Language')
  const items: { value: LanguageChoice; label: string }[] = [
    { value: 'auto', label: tr('Как в Telegram', 'Same as Telegram') },
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
  ]
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="nt-host" ref={menu.hostRef}>
        <div className="card">
          <div className="row">
            <span className="row-label">{tr('Язык бота и миниаппа', 'Bot and Mini App language')}</span>
            <button
              type="button"
              className="ob-popup"
              aria-label={title}
              aria-haspopup="menu"
              aria-expanded={menu.openFor === 'language'}
              disabled={saving}
              onClick={(e) => menu.open('language', e.currentTarget)}
            >
              <MorphValue text={items.find((item) => item.value === choice)?.label ?? ''} align="end" />
              {icons.updown()}
            </button>
          </div>
        </div>
        <MenuItems
          open={menu.openFor === 'language'}
          place={menu.place}
          items={items}
          value={choice}
          onPick={async (value) => {
            menu.close()
            if (value === choice || saving) return
            setSaving(true)
            try {
              await action('language.set', { choice: value }, { quiet: true })
            } finally {
              setSaving(false)
            }
          }}
        />
      </div>
    </>
  )
}

/** Тема одной строкой с меню, как «Новые заявки»: три строки с галочкой говорили то же. */
function ThemeSection() {
  const { theme } = useStore()
  const menu = useRowMenu<'theme'>()
  const themes: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: tr('Как в Telegram', 'Same as Telegram') },
    { value: 'light', label: tr('Светлая', 'Light') },
    { value: 'dark', label: tr('Тёмная', 'Dark') },
  ]
  return (
    <>
      <SectionTitle>{tr("Оформление", "Appearance")}</SectionTitle>
      <div className="nt-host" ref={menu.hostRef}>
        <div className="card">
          <div className="row">
            <span className="row-label">{tr("Тема", "Theme")}</span>
            <button
              type="button"
              className="ob-popup"
              aria-haspopup="menu"
              aria-expanded={menu.openFor === 'theme'}
              onClick={(e) => menu.open('theme', e.currentTarget)}
            >
              <MorphValue text={themes.find((t) => t.value === theme)?.label ?? ''} align="end" />
              {icons.updown()}
            </button>
          </div>
        </div>
        <MenuItems
          open={menu.openFor === 'theme'}
          place={menu.place}
          items={themes}
          value={theme}
          onPick={(v, e) => {
            menu.close()
            if (v !== theme) setThemeFrom(v, e.clientX, e.clientY)
          }}
        />
      </div>
    </>
  )
}

/**
 * Подписка календаря на ивенты и свои одобренные визиты: строка ведёт на
 * `/events-subscribe`, тот редиректит на ту же ссылку схемой `webcal://`, и календарь
 * заводит подписку, которая дальше обновляется сама. Https-ссылка на `.ics` дала бы
 * разовый импорт, а `webcal://` из вебвью не открыть: `openLink` берёт только http/https.
 */
function CalendarRow() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className={'row tappable' + (busy ? ' rows-disabled' : '')}
      onClick={async () => {
        if (busy) return
        setBusy(true)
        await subscribeToEvents()
        setBusy(false)
      }}
    >
      <div className="row-icon" style={{ background: 'var(--purple)' }}>
        {icons.calendar(17, '#fff')}
      </div>
      <span className="row-label">{tr("Ивенты и визиты в календаре", "Events and visits in your calendar")}</span>
      <div className="row-right">{icons.chevron()}</div>
    </button>
  )
}

type NotifyOption<M extends string> = { mode: M; label: string; sublabel: string }

// Одна карточка на все потоки уведомлений (заявки, ивенты, отметки резидентов для
// гостя): у них общая форма настройки — тумблер + выбор дней, — но разные ручки и
// разные дефолты на сервере.
function NotifyCard<M extends string>({
  prefs,
  method,
  title,
  color,
  options,
  beforeEnable,
}: {
  prefs: { enabled: boolean; mode: M }
  method: string
  title: string
  color: string
  options: NotifyOption<M>[]
  beforeEnable?: () => Promise<unknown>
}) {
  const radioRow = (o: NotifyOption<M>): ReactNode => (
    <button
      type="button"
      className="row tappable"
      onClick={() => {
        if (prefs.mode !== o.mode) void action(method, { enabled: prefs.enabled, mode: o.mode }, { quiet: true })
      }}
    >
      <span className="row-label">
        {o.label}
        <span className="row-sublabel">{o.sublabel}</span>
      </span>
      <RadioCheck on={prefs.mode === o.mode} />
    </button>
  )
  return (
    <div className="card">
      <SwitchRow
        icon={(on) => <NotifyIcon color={color} off={!on} />}
        label={title}
        on={prefs.enabled}
        onToggle={async () => {
          if (!prefs.enabled && beforeEnable) await beforeEnable()
          return action(method, { enabled: !prefs.enabled, mode: prefs.mode }, { quiet: true })
        }}
      />
      <Sep inset="icon" />
      <div className={prefs.enabled ? undefined : 'rows-disabled'}>
        {options.map((o, i) => (
          <Fragment key={o.mode}>
            {i > 0 ? <Sep inset="text" /> : null}
            {radioRow(o)}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * Уведомления о заявках и ивентах одной карточкой, как шаг «Что присылать» в
 * знакомстве: две строки с меню, над ними баннеры, какими эти сообщения придут.
 * Выключенный поток гасит свой баннер, поэтому сноски про личку не нужны.
 */
function NotifySection({ s }: { s: SettingsData }) {
  const { data } = useStore()
  const menu = useRowMenu<'req' | 'ev'>()
  const cur = menu.shownFor === 'ev' ? s.eventNotify : s.notify

  const pick = (choice: NotifyChoice): void => {
    if (!menu.openFor) return
    const which = menu.openFor
    const prefs = which === 'req' ? s.notify : s.eventNotify
    menu.close()
    if (choiceOf(prefs) === choice) return
    void action(which === 'req' ? 'notify' : 'notify.events', prefsFor(choice, prefs), { quiet: true })
  }

  const botName = data!.onboarding?.botName || 'Endpoint Robot'
  const row = (key: 'req' | 'ev', label: string, color: string, prefs: SettingsData['notify']): ReactNode => (
    <div className="row">
      <NotifyIcon color={color} off={!prefs.enabled} />
      <span className="row-label">{label}</span>
      <button
        type="button"
        className="ob-popup"
        aria-haspopup="menu"
        aria-expanded={menu.openFor === key}
        onClick={(e) => menu.open(key, e.currentTarget)}
      >
        <MorphValue text={CHOICE_LABEL[choiceOf(prefs)]} align="end" />
        {icons.updown()}
      </button>
    </div>
  )

  return (
    <>
      <SectionTitle>{tr("Уведомления", "Notifications")}</SectionTitle>
      <div className="nt-host" ref={menu.hostRef}>
        <div className="nt-stage" aria-hidden="true">
          {notifyBanners(s, data!.todayKey).map((b) => (
            <Notification key={b.key} botName={botName} time={b.time} text={b.text} className={'ob-nb' + (b.off ? ' off' : '')} flow />
          ))}
        </div>
        <div className="card">
          {row('req', tr('Новые заявки', "New visit requests"), 'var(--orange)', s.notify)}
          <Sep inset="icon" />
          {row('ev', tr('Новые ивенты', "New events"), 'var(--purple)', s.eventNotify)}
          <Sep inset="icon" />
          <CalendarRow />
        </div>
        <MenuItems
          open={menu.openFor !== null}
          place={menu.place}
          items={(['today', 'all', 'off'] as NotifyChoice[]).map((c) => ({ value: c, label: CHOICE_LABEL[c] }))}
          value={choiceOf(cur)}
          onPick={pick}
          gapBefore="off"
        />
      </div>
    </>
  )
}

function AttendNotifySection() {
  const { data } = useStore()
  return (
    <>
      <SectionTitle>{tr("Уведомления", "Notifications")}</SectionTitle>
      <NotifyCard
        prefs={data!.attendNotify}
        method="notify.attend"
        title={tr("Придут резиденты", "Resident plans")}
        color="var(--green)"
        options={[
          { mode: 'near', label: tr('Сегодня и завтра', "Today and tomorrow"), sublabel: tr('Кто собрался на ближайшие два дня', "Who plans to come in the next two days") },
          { mode: 'week', label: tr('Вся неделя', "Whole week"), sublabel: tr('Кто собрался на любой день', "Who plans to come on any day") },
        ]}
        // Гость, открывший миниапп из чата без /start, иначе подписался бы на тишину:
        // писать ему в личку бот не может.
        beforeEnable={async () => {
          if (!botCanWrite()) await requestWriteAccess()
        }}
      />
      <div className="card" style={{ marginTop: 12 }}>
        <CalendarRow />
      </div>
    </>
  )
}

/**
 * Подпись внизу настроек: на каком коммите крутится бот.
 *
 * Ссылку целиком собирает сервер (только он знает репо и свою сборку); нет коммита —
 * подписи нет вовсе, писать «неизвестно» бессмысленно.
 */
// Фавиконка keetsta.me (20×20 PNG) — вшита data-URI: внешние картинки режет CSP,
// а тянуть её сетевым запросом ради 800 байт незачем.
const KEET_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAALGSURBVHgBzVRdSJNhFD7f97nNzc20+TNTyi6aTmhzxRzMLQUpNcyr1kUEFuhFUDfZnVh3YhQIhRiIXihUF3VTN9GPqHixFFICF85EFkaGuNQ158Tt6d2rm22t8sKLDhy+9zvv4TnnPOecVwAT2kcRaZ/l/wdMS2X8lVZBECgSiXBb9CyKYvz8V8CoUzgcJo/HQ653Lpr1zNL8/Dx5vV7y+/20tbVFKpWKDAYDlZWVkcPhILPZTGq1OhGcRUcgEMDgwCBsNhtkMhmYw560qKgI7e3tmJubQxSHT8ydzk5o1Oo9g6RShUKBpqYm+Hy+6L+wb3NYUlJCiYCMiuysA5Sbe5AWFr7S+vrGtnGb5X/ACdwnDqhUKqijo5Uq7Vbq6uqlb4s+WmTqds/EAXNysujK5UskV8iooEBLn1gD7z8YYA2V2G1kO2iMB7vdjB8BF06e0EMUJGYTYbVWMOIL+TktTUJPTwcqKkzcXxQFvHrZyxpp4vcxnPhga3OySS4nOlSYx5IHj7a25qOz9dX8rNVm0uZmkCYmPsSLlKQw1dRUJtJRbiqHJEnQZKowNfUE3s8vUHvGAp0uC48f3UVzywUeWaWSY2bmDY4W5/PsnOdr2bi5UGkz7mQsQq/Xg4LBIIaHh2GxWGAoPYyhoYdY849gaek1xsb6UHxEFy/n+rWL+Oh+jqfP7uHLwlt0d9+EOkOJ6qoq9Pf1Y3VlFYQdYRsCo9EIuSwN5aZjaGhwQKNRMj53+ZFYZrWnrbh96ypO2Y+jQJeH8fFxhEKhGMwuYFSWl5fReqOVgcp4CbyUGNn8K/IAUTWUlsI9PY1kEZIf2Ojv5PtJamtr4/uMCCi0ucEeBYlTn5+fR80tzeR0OlmjtL+PI1JIdC8bzzWyLCWkK9JZQ1TIUGUgPV2J+rq6hBKTJSXgyvcVaDI0STsrclXIFRgdGf0j4E8ktgAM3uIFFgAAAABJRU5ErkJggg=='

function BuildSign() {
  const { data } = useStore()
  const build = data?.build
  return (
    <div className="build-sign">
      made by{' '}
      <button type="button" className="build-link" onClick={() => openUrl('https://keetsta.me')}>
        <img className="build-fav" src={KEET_FAVICON} alt="" width={13} height={13} />
        Keet
      </button>
      {' · Endpoint robot'}
      {/* Коммита может не быть вовсе (бот не знает своей сборки) — подпись про автора
          от этого не должна пропадать, поэтому хвост про версию необязателен. */}
      {build ? (
        <>
          {', now running '}
          <button type="button" className="build-link mono" onClick={() => openUrl(build.url)}>
            <span className="build-fav">{icons.github(12)}</span>
            {build.commit}
          </button>
        </>
      ) : null}
    </div>
  )
}

/**
 * Отметки одной карточкой, как шаг «Телефон» в знакомстве: устройства с меткой «в сети»,
 * привязка через ту же шторку (вкладка системы, путь до адреса, вставка из буфера), без
 * ника и журнал. Печатать MAC руками больше не нужно.
 */
function PresenceCard({ s }: { s: SettingsData }) {
  // Без вопроса: отвязка обратима. Строка рассыпается, внизу пять секунд «Вернуть».
  const removeMac = async (mac: string): Promise<void> => {
    markOwnTap()
    haptic.impact('soft')
    const key = 'mac-' + mac
    const res = await removeRow(dustRow(key), mutate<Undoable>('mac.remove', { mac }))
    if (!res) return
    setData(res.data)
    offerUndo(tr('Устройство отвязано', "Device unlinked"), res.data.undo, (data) => bringBack(key, res.dust, () => setData(data)))
  }
  return (
    <>
      <SectionTitle>{tr("Отметки", "Check-ins")}</SectionTitle>
      <div className="card ctl-card">
        {s.macs.map((m) => (
          <Fragment key={m.mac}>
            <div className="row" data-dust={'mac-' + m.mac}>
              <span className="row-label">
                {m.label || tr('Устройство', "Device")}
                <span className="row-sublabel mono">{m.mac}</span>
              </span>
              <div className="row-right">
                {m.online ? <span className="ob-tag green">{tr("в сети", "online")}</span> : null}
                <button
                  className="remove-btn"
                  aria-label={tr("Убрать устройство", "Remove device")}
                  onClick={() => void removeMac(m.mac)}
                >
                  {icons.minusCircle()}
                </button>
              </div>
            </div>
            <Sep inset="text" />
          </Fragment>
        ))}
        <button type="button" className="row tappable" onClick={() => void bindPhone()}>
          <div className="icon-plus-circle">{icons.plusSmall()}</div>
          <span className="add-row-label">{tr("Добавить устройство", "Add a device")}</span>
        </button>
        <Sep inset="text" />
        <SwitchRow
          className={'row' + (s.macs.length === 0 ? ' rows-disabled' : '')}
          disabled={s.macs.length === 0}
          label={tr("Отмечаться без ника", "Check in without a username")}
          sub={tr("В списке будет «Без ника»", "You’ll appear as “Anonymous”")}
          on={s.macAnon}
          onToggle={() => action('mac.anon', { anon: !s.macAnon }, { quiet: true })}
        />
        <Sep inset="text" />
        <SwitchRow
          label={tr("Вести историю визитов", "Keep visit history")}
          sub={tr("Для статистики спейса", "Used for space statistics")}
          on={s.logVisits}
          onToggle={() => action('presence.log', { enabled: !s.logVisits }, { quiet: true })}
        />
      </div>
    </>
  )
}

export function Settings() {
  // s === null у гостя: уведомления о заявках и ивентах и MAC — только резидентам, а
  // тема нужна всем. Сервер присылает settings по реальному резидентству и про
  // перспективу не знает, поэтому дев-вид «как гость» гасим здесь — иначе он бы не
  // был честным.
  const { data, perspective } = useStore()
  const s = perspective === 'guest' ? null : data!.settings

  if (!s) {
    return (
      <Screen>
        <BackRow />
        <Header title={tr("Настройки", "Settings")} />
        <LanguageSection />
        <AttendNotifySection />
        <ThemeSection />
        <BuildSign />
      </Screen>
    )
  }

  return (
    <Screen>
      <BackRow label={tr("Ближайшие дни", "Upcoming days")} />
      <Header title={tr("Настройки", "Settings")} />
      <SectionTitle>{tr("Профиль", "Profile")}</SectionTitle>
      <div className="card">
        <button
          type="button"
          className="row tappable"
          onClick={() => push('residentProfile', { userId: data!.me.id, name: data!.me.name, username: data!.me.username })}
        >
          <span className="row-label">{tr("Мой профиль", "My profile")}<span className="row-sublabel">{data!.me.isDev ? tr('Права и интеграции', "Permissions and integrations") : tr('Визиты и статистика', "Visits and stats")}</span>
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep inset="text" />
        <button type="button" className="row tappable" onClick={() => void openOnboarding()}>
          <span className="row-label">{tr("Знакомство с ботом", "Bot tour")}<span className="row-sublabel">{tr("Что умеет бот для резидентов", "See what the bot can do for residents")}</span>
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        {data?.onboarding?.issuesChannel && (
          <>
            <Sep inset="text" />
            <IssuesChannelRow />
          </>
        )}
      </div>
      <LanguageSection />
      <PresenceCard s={s} />
      <NotifySection s={s} />
      <ThemeSection />
      <BuildSign />
    </Screen>
  )
}
