import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { action } from '../api'
import { icons } from '../icons'
import { confirmDialog } from '../modals'
import { setTheme, useStore } from '../store'
import { haptic } from '../telegram'
import type { Settings as SettingsData, ThemeChoice } from '../types'
import { BackRow, Footnote, Header, SectionTitle, Sep, Switch } from '../components/common'
import { Screen } from '../components/Screen'

function ThemeSection() {
  const { theme } = useStore()
  const row = (label: string, sublabel: string | null, value: ThemeChoice): ReactNode => (
    <div className="row tappable" onClick={() => { if (theme !== value) setTheme(value) }}>
      <span className="row-label">
        {label}
        {sublabel ? <span className="row-sublabel">{sublabel}</span> : null}
      </span>
      <div className="radio-check">{theme === value ? icons.check(16, '#007aff', 2.2) : null}</div>
    </div>
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

function NotifyCard({ s }: { s: SettingsData }) {
  const radioRow = (label: string, sublabel: string, mode: 'today' | 'all'): ReactNode => (
    <div
      className="row tappable"
      onClick={() => {
        if (s.notify.mode !== mode) void action('notify', { enabled: s.notify.enabled, mode })
      }}
    >
      <span className="row-label">
        {label}
        <span className="row-sublabel">{sublabel}</span>
      </span>
      <div className="radio-check">{s.notify.mode === mode ? icons.check(16, '#007aff', 2.2) : null}</div>
    </div>
  )
  return (
    <div className="card">
      <div className="row">
        <div className="row-icon" style={{ background: '#ff9500' }}>
          {icons.bell()}
        </div>
        <span className="row-label">Новые заявки</span>
        <Switch
          on={s.notify.enabled}
          onToggle={() => void action('notify', { enabled: !s.notify.enabled, mode: s.notify.mode })}
        />
      </div>
      <Sep left={54} />
      <div className={s.notify.enabled ? undefined : 'rows-disabled'}>
        {radioRow('Только на сегодня', 'Заявки на текущий день', 'today')}
        <Sep left={14} />
        {radioRow('Все заявки', 'На любой день', 'all')}
      </div>
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
                  { confirmLabel: 'Убрать', destructive: true },
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
        <div className="row tappable" onClick={() => setShowForm(true)}>
          <div className="icon-plus-circle">{icons.plusSmall()}</div>
          <span className="add-row-label">Добавить устройство</span>
        </div>
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
                  haptic('success')
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
  // s === null у гостя: уведомления и MAC — только резидентам, а тема нужна всем.
  // Сервер присылает settings по реальному резидентству и про перспективу не знает,
  // поэтому дев-вид «как гость» гасим здесь — иначе он бы не был честным.
  const { data, perspective } = useStore()
  const s = perspective === 'guest' ? null : data!.settings

  if (!s) {
    return (
      <Screen>
        <BackRow label="Назад" />
        <Header title="Настройки" />
        <ThemeSection />
      </Screen>
    )
  }

  return (
    <Screen>
      <BackRow label="Обзор" />
      <Header title="Настройки" />
      <ThemeSection />
      <SectionTitle>Уведомления о заявках</SectionTitle>
      <NotifyCard s={s} />
      <Footnote>Придут в личку бота. По умолчанию - только заявки на сегодня.</Footnote>
      <SectionTitle>Авто-отметка по MAC</SectionTitle>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="row">
          <div className="row-icon" style={{ background: '#007aff' }}>
            {icons.wifi()}
          </div>
          <span className="row-label">
            Мои устройства
            <span className="row-sublabel">
              {s.macPresenceActive ? 'Сейчас ты отмечен по MAC' : 'Авто-отметка сейчас не активна'}
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
          <Switch on={s.macAnon} onToggle={() => void action('mac.anon', { anon: !s.macAnon })} />
        </div>
      </div>
      <Footnote>
        Пока устройство в сети спейса, бот сам ставит отметку «внутри». Выключи ротацию (рандомизацию) MAC для Wi-Fi
        спейса — иначе адрес будет меняться. Команды /bindmac, /unbindmac и /settings в боте работают как раньше и
        синхронизированы с этим списком.
      </Footnote>
    </Screen>
  )
}
