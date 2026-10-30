import { Fragment, useState, type ReactNode } from 'react'
import { action, mutate, openOnboarding, subscribeToEvents } from '../api'
import { icons } from '../icons'
import { CHOICE_LABEL, choiceOf, notifyBanners, prefsFor, type NotifyChoice } from '../notifyPreview'
import { markOwnTap } from '../motion'
import { push, setData, setThemeFrom, useStore } from '../store'
import { botCanWrite, haptic, openUrl, requestWriteAccess } from '../telegram'
import { accent } from '../theme'
import type { Settings as SettingsData, ThemeChoice } from '../types'
import { BackRow, Header, NotifyIcon, SectionTitle, Sep, SwitchRow } from '../components/common'
import { MacSheet } from '../components/MacSheet'
import { MenuItems, useRowMenu } from '../components/RowMenu'
import { Notification } from '../components/OnboardingScenes'
import { Screen } from '../components/Screen'
import { bringBack, dustRow, offerUndo, removeRow, type Undoable } from '../undo'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Как в Telegram' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

/** Тема одной строкой с меню, как «Новые заявки»: три строки с галочкой говорили то же. */
function ThemeSection() {
  const { theme } = useStore()
  const menu = useRowMenu<'theme'>()
  return (
    <>
      <SectionTitle>Оформление</SectionTitle>
      <div className="nt-host" ref={menu.hostRef}>
        <div className="card">
          <div className="row">
            <span className="row-label">Тема</span>
            <button
              type="button"
              className="ob-popup"
              aria-haspopup="menu"
              aria-expanded={menu.openFor === 'theme'}
              onClick={(e) => menu.open('theme', e.currentTarget)}
            >
              {THEMES.find((t) => t.value === theme)?.label}
              {icons.updown()}
            </button>
          </div>
        </div>
        <MenuItems
          open={menu.openFor === 'theme'}
          place={menu.place}
          items={THEMES}
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
      <span className="row-label">Ивенты и визиты в календаре</span>
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
      <div className="radio-check">{prefs.mode === o.mode ? icons.check(16, accent(), 2.2) : null}</div>
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
        {CHOICE_LABEL[choiceOf(prefs)]}
        {icons.updown()}
      </button>
    </div>
  )

  return (
    <>
      <SectionTitle>Уведомления</SectionTitle>
      <div className="nt-host" ref={menu.hostRef}>
        <div className="nt-stage" aria-hidden="true">
          {notifyBanners(s, data!.todayKey).map((b) => (
            <Notification key={b.key} botName={botName} time={b.time} text={b.text} className={'ob-nb' + (b.off ? ' off' : '')} />
          ))}
        </div>
        <div className="card">
          {row('req', 'Новые заявки', 'var(--orange)', s.notify)}
          <Sep inset="icon" />
          {row('ev', 'Новые ивенты', 'var(--purple)', s.eventNotify)}
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
      <SectionTitle>Уведомления</SectionTitle>
      <NotifyCard
        prefs={data!.attendNotify}
        method="notify.attend"
        title="Придут резиденты"
        color="var(--green)"
        options={[
          { mode: 'near', label: 'Сегодня и завтра', sublabel: 'Кто собрался на ближайшие два дня' },
          { mode: 'week', label: 'Вся неделя', sublabel: 'Кто собрался на любой день' },
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
  const [sheet, setSheet] = useState(false)
  // Без вопроса: отвязка обратима. Строка рассыпается, внизу пять секунд «Вернуть».
  const removeMac = async (mac: string): Promise<void> => {
    markOwnTap()
    haptic.impact('soft')
    const key = 'mac-' + mac
    const res = await removeRow(dustRow(key), mutate<Undoable>('mac.remove', { mac }))
    if (!res) return
    setData(res.data)
    offerUndo('Устройство отвязано', res.data.undo, (data) => bringBack(key, res.dust, () => setData(data)))
  }
  return (
    <>
      <SectionTitle>Отметки</SectionTitle>
      <div className="card ctl-card">
        {s.macs.map((m) => (
          <Fragment key={m.mac}>
            <div className="row" data-dust={'mac-' + m.mac}>
              <span className="row-label">
                {m.label || 'Устройство'}
                <span className="row-sublabel mono">{m.mac}</span>
              </span>
              <div className="row-right">
                {m.online ? <span className="ob-tag green">в сети</span> : null}
                <button
                  className="remove-btn"
                  aria-label="Убрать устройство"
                  onClick={() => void removeMac(m.mac)}
                >
                  {icons.minusCircle()}
                </button>
              </div>
            </div>
            <Sep inset="text" />
          </Fragment>
        ))}
        <button type="button" className="row tappable" onClick={() => setSheet(true)}>
          <div className="icon-plus-circle">{icons.plusSmall()}</div>
          <span className="add-row-label">Добавить устройство</span>
        </button>
        <Sep inset="text" />
        <SwitchRow
          className={'row' + (s.macs.length === 0 ? ' rows-disabled' : '')}
          disabled={s.macs.length === 0}
          label="Отмечаться без ника"
          sub="В списке будет «Без ника»"
          on={s.macAnon}
          onToggle={() => action('mac.anon', { anon: !s.macAnon }, { quiet: true })}
        />
        <Sep inset="text" />
        <SwitchRow
          label="Вести историю визитов"
          sub="Для статистики спейса"
          on={s.logVisits}
          onToggle={() => action('presence.log', { enabled: !s.logVisits }, { quiet: true })}
        />
      </div>
      {sheet ? <MacSheet onClose={() => setSheet(false)} /> : null}
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
        <Header title="Настройки" />
        <AttendNotifySection />
        <ThemeSection />
        <BuildSign />
      </Screen>
    )
  }

  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
      <Header title="Настройки" />
      <SectionTitle>Профиль</SectionTitle>
      <div className="card">
        <button
          type="button"
          className="row tappable"
          onClick={() => push('residentProfile', { userId: data!.me.id, name: data!.me.name, username: data!.me.username })}
        >
          <span className="row-label">
            Мой профиль
            <span className="row-sublabel">{data!.me.isDev ? 'Права и интеграции' : 'Визиты и статистика'}</span>
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep inset="text" />
        <button type="button" className="row tappable" onClick={() => void openOnboarding()}>
          <span className="row-label">
            Знакомство с ботом
            <span className="row-sublabel">Что умеет бот для резидентов</span>
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>
      <PresenceCard s={s} />
      <NotifySection s={s} />
      <ThemeSection />
      <BuildSign />
    </Screen>
  )
}
