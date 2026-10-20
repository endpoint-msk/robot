import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { action, openOnboarding, subscribeToEvents } from '../api'
import { icons } from '../icons'
import { confirmDialog } from '../modals'
import { CHOICE_LABEL, choiceOf, notifyBanners, prefsFor, type NotifyChoice } from '../notifyPreview'
import { pushOverlay } from '../overlays'
import { push, setTheme, useStore } from '../store'
import { botCanWrite, haptic, openUrl, requestWriteAccess } from '../telegram'
import type { Settings as SettingsData, ThemeChoice } from '../types'
import { BackRow, Footnote, Header, SectionTitle, Sep, Switch } from '../components/common'
import { Notification } from '../components/OnboardingScenes'
import { Screen } from '../components/Screen'

function ThemeSection() {
  const { theme } = useStore()
  const row = (label: string, sublabel: string | null, value: ThemeChoice): ReactNode => (
    <button type="button" className="row tappable" onClick={() => { if (theme !== value) setTheme(value) }}>
      <span className="row-label">
        {label}
        {sublabel ? <span className="row-sublabel">{sublabel}</span> : null}
      </span>
      <div className="radio-check">{theme === value ? icons.check(16, '#007aff', 2.2) : null}</div>
    </button>
  )
  return (
    <>
      <SectionTitle>Оформление</SectionTitle>
      <div className="card">
        {row('Системная', 'Как в Telegram', 'system')}
        <Sep left={14} />
        {row('Светлая', null, 'light')}
        <Sep left={14} />
        {row('Тёмная', null, 'dark')}
      </div>
    </>
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
      <div className="radio-check">{prefs.mode === o.mode ? icons.check(16, '#007aff', 2.2) : null}</div>
    </button>
  )
  return (
    <div className="card">
      <div className="row">
        <div className="row-icon" style={{ background: color }}>
          {icons.bell()}
        </div>
        <span className="row-label">{title}</span>
        <Switch
          label={title}
          on={prefs.enabled}
          onToggle={async () => {
            if (!prefs.enabled && beforeEnable) await beforeEnable()
            return action(method, { enabled: !prefs.enabled, mode: prefs.mode }, { quiet: true })
          }}
        />
      </div>
      <Sep left={54} />
      <div className={prefs.enabled ? undefined : 'rows-disabled'}>
        {options.map((o, i) => (
          <Fragment key={o.mode}>
            {i > 0 ? <Sep left={14} /> : null}
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
  const [menuFor, setMenuFor] = useState<'req' | 'ev' | null>(null)
  const [menuTop, setMenuTop] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)

  // Меню закрывается тапом мимо и системной «Назад».
  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element).closest('.ob-menu, .ob-popup')) setMenuFor(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    const un = pushOverlay(() => setMenuFor(null))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      un()
    }
  }, [menuFor])

  const openMenu = (key: 'req' | 'ev', btn: HTMLElement): void => {
    if (menuFor === key) {
      setMenuFor(null)
      return
    }
    const host = hostRef.current?.getBoundingClientRect()
    const r = btn.getBoundingClientRect()
    setMenuTop(host ? r.bottom - host.top + 4 : 0)
    setMenuFor(key)
  }

  const pick = (choice: NotifyChoice): void => {
    if (!menuFor) return
    const cur = menuFor === 'req' ? s.notify : s.eventNotify
    haptic.tick()
    setTimeout(() => setMenuFor(null), 140)
    if (choiceOf(cur) === choice) return
    void action(menuFor === 'req' ? 'notify' : 'notify.events', prefsFor(choice, cur), { quiet: true })
  }

  const botName = data!.onboarding?.botName || 'Endpoint Robot'
  const row = (key: 'req' | 'ev', label: string, color: string, prefs: SettingsData['notify']): ReactNode => (
    <div className="row">
      <div className="row-icon" style={{ background: color }}>
        {icons.bell()}
      </div>
      <span className="row-label">{label}</span>
      <button
        type="button"
        className="ob-popup"
        aria-haspopup="menu"
        aria-expanded={menuFor === key}
        onClick={(e) => openMenu(key, e.currentTarget)}
      >
        {CHOICE_LABEL[choiceOf(prefs)]}
        {icons.updown()}
      </button>
    </div>
  )
  const cur = menuFor === 'ev' ? s.eventNotify : s.notify

  return (
    <>
      <SectionTitle>Уведомления</SectionTitle>
      <div className="nt-host" ref={hostRef}>
        <div className="nt-stage" aria-hidden="true">
          {notifyBanners(s, data!.todayKey).map((b) => (
            <Notification key={b.key} botName={botName} time={b.time} text={b.text} className={'ob-nb' + (b.off ? ' off' : '')} />
          ))}
        </div>
        <div className="card">
          {row('req', 'Новые заявки', 'var(--orange)', s.notify)}
          <Sep left={54} />
          {row('ev', 'Новые ивенты', 'var(--purple)', s.eventNotify)}
        </div>
        <div className={'ob-menu' + (menuFor ? ' open' : '')} style={{ top: menuTop }} role="menu">
          {(['today', 'all', 'off'] as NotifyChoice[]).map((c) => (
            <Fragment key={c}>
              {c === 'off' ? <div className="ob-menu-gap" /> : null}
              <button type="button" role="menuitemradio" aria-checked={choiceOf(cur) === c} onClick={() => pick(c)}>
                <span className="ob-mk">{icons.check(14, 'currentColor', 2.2)}</span>
                {CHOICE_LABEL[c]}
              </button>
            </Fragment>
          ))}
        </div>
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
    </>
  )
}

/**
 * Подписка календаря на ивенты.
 *
 * Кнопка ведёт на `/events-subscribe` — он редиректит на ту же ссылку схемой
 * `webcal://`, и календарь заводит подписку, которая дальше обновляется сама.
 * Отдавать https-ссылку на `.ics` напрямую бесполезно: система разово импортирует
 * ближайшие ивенты и на этом всё. Схему подменяет сервер, потому что из вебвью
 * `webcal://` не открыть — `openLink` берёт только http/https.
 */
function CalendarSection() {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <SectionTitle>Календарь</SectionTitle>
      <div className="card">
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
          <span className="row-label">Подписаться на ивенты</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>
      <Footnote>
        Ссылка добавляется в календарь один раз — дальше новые ивенты появляются в нём сами. Ивенты только для
        резидентов в неё не попадают.
      </Footnote>
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

function MacCard({ s }: { s: SettingsData }) {
  const [showForm, setShowForm] = useState(false)
  const [mac, setMac] = useState('')
  const [label, setLabel] = useState('')
  const macRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showForm) macRef.current?.focus()
  }, [showForm])

  return (
    <div className="card">
      {s.macs.map((m, i) => (
        <Fragment key={m.mac}>
          {i > 0 ? <Sep left={14} /> : null}
          <div className="row">
            <span className="row-label">
              {m.label || 'Устройство'}
              <span className="row-sublabel mono">{m.mac}</span>
            </span>
            <button
              className="remove-btn"
              aria-label="Убрать MAC"
              onClick={async () => {
                const ok = await confirmDialog(
                  `Убрать ${m.label ? '«' + m.label + '» ' : ''}${m.mac}? Авто-отметка по этому устройству перестанет работать.`,
                  { confirmLabel: 'Убрать устройство', cancelLabel: 'Оставить', destructive: true },
                )
                if (ok) void action('mac.remove', { mac: m.mac })
              }}
            >
              {icons.minusCircle()}
            </button>
          </div>
        </Fragment>
      ))}
      {s.macs.length > 0 ? <Sep left={14} /> : null}
      {!showForm ? (
        <button type="button" className="row tappable" onClick={() => setShowForm(true)}>
          <div className="icon-plus-circle">{icons.plusSmall()}</div>
          <span className="add-row-label">Добавить устройство</span>
        </button>
      ) : (
        <>
          <Sep left={14} />
          <div className="row">
            <input
              ref={macRef}
              className="text-input mono"
              placeholder="AA:BB:CC:DD:EE:FF"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={mac}
              onChange={(e) => setMac(e.target.value)}
            />
          </div>
          <Sep left={14} />
          <div className="row">
            <input
              className="text-input"
              placeholder="Название (например, Телефон)"
              autoComplete="off"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="inline-form-actions">
            <button
              className="small-btn blue"
              onClick={async () => {
                const value = mac.trim()
                if (!value) {
                  macRef.current?.focus()
                  return
                }
                const done = await action('mac.add', { mac: value, label })
                if (done) {
                  haptic.notify('success')
                  setShowForm(false)
                  setMac('')
                  setLabel('')
                }
              }}
            >
              Привязать
            </button>
            <button className="small-btn gray" onClick={() => setShowForm(false)}>
              Отмена
            </button>
          </div>
        </>
      )}
    </div>
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
        <ThemeSection />
        <CalendarSection />
        <AttendNotifySection />
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
            <span className="row-sublabel">Права и интеграции</span>
          </span>
          {icons.chevron()}
        </button>
        <Sep left={14} />
        <button type="button" className="row tappable" onClick={() => void openOnboarding()}>
          <span className="row-label">
            Знакомство с ботом
            <span className="row-sublabel">Что умеет бот для резидентов</span>
          </span>
          {icons.chevron()}
        </button>
      </div>
      <ThemeSection />
      <CalendarSection />
      <NotifySection s={s} />
      <SectionTitle>Авто-отметка по MAC</SectionTitle>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="row">
          <div className="row-icon" style={{ background: 'var(--blue)' }}>
            {icons.wifi()}
          </div>
          <span className="row-label">
            Мои устройства
            <span className="row-sublabel">
              {s.macPresenceActive ? 'Сейчас вы отмечены по MAC' : 'Авто-отметка сейчас не активна'}
            </span>
          </span>
        </div>
      </div>
      <MacCard s={s} />
      <div className="card" style={{ marginTop: 8 }}>
        <div className={'row' + (s.macs.length === 0 ? ' rows-disabled' : '')}>
          <span className="row-label">
            Отмечаться без ника
            <span className="row-sublabel">В списке будет «Без ника»</span>
          </span>
          <Switch
            label="Отмечаться без ника"
            on={s.macAnon}
            onToggle={() => action('mac.anon', { anon: !s.macAnon }, { quiet: true })}
          />
        </div>
      </div>
      <Footnote>
        Пока устройство в сети спейса, бот сам ставит отметку «внутри». Выключите ротацию (рандомизацию) MAC для Wi-Fi
        спейса — иначе адрес будет меняться. Команды /bindmac, /unbindmac и /settings в боте работают как раньше и
        синхронизированы с этим списком.
      </Footnote>
      <SectionTitle>Журнал присутствия</SectionTitle>
      <div className="card">
        <div className="row">
          <span className="row-label">
            Не вести историю моих визитов
            <span className="row-sublabel">Отметки продолжат работать, но в статистике вас не будет</span>
          </span>
          <Switch
            label="Не вести историю моих визитов"
            on={!s.logVisits}
            onToggle={() => action('presence.log', { enabled: !s.logVisits }, { quiet: true })}
          />
        </div>
      </div>
      <Footnote>
        Журнал нужен статистике спейса: сколько часов он работал и когда сюда приходят. Уже записанные визиты остаются —
        выключение останавливает запись новых.
      </Footnote>
      <BuildSign />
    </Screen>
  )
}
