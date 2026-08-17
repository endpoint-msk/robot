import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { action, api } from '../api'
import { icons } from '../icons'
import { confirmDialog, showAlert } from '../modals'
import { setTheme, useStore } from '../store'
import { haptic } from '../telegram'
import type { NotifyPrefs, Settings as SettingsData, ThemeChoice } from '../types'
import { BackRow, Footnote, Header, SectionTitle, Sep, Switch } from '../components/common'
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

// Одна карточка на оба потока уведомлений (заявки и ивенты): у них общая форма
// настройки — тумблер + выбор дня, — но разные ручки и разные дефолты на сервере.
function NotifyCard({
  prefs,
  method,
  title,
  color,
  todaySublabel,
  allLabel,
  allSublabel,
}: {
  prefs: NotifyPrefs
  method: string
  title: string
  color: string
  todaySublabel: string
  allLabel: string
  allSublabel: string
}) {
  const radioRow = (label: string, sublabel: string, mode: 'today' | 'all'): ReactNode => (
    <button
      type="button"
      className="row tappable"
      onClick={() => {
        if (prefs.mode !== mode) void action(method, { enabled: prefs.enabled, mode })
      }}
    >
      <span className="row-label">
        {label}
        <span className="row-sublabel">{sublabel}</span>
      </span>
      <div className="radio-check">{prefs.mode === mode ? icons.check(16, '#007aff', 2.2) : null}</div>
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
          onToggle={() => void action(method, { enabled: !prefs.enabled, mode: prefs.mode })}
        />
      </div>
      <Sep left={54} />
      <div className={prefs.enabled ? undefined : 'rows-disabled'}>
        {radioRow('Только на сегодня', todaySublabel, 'today')}
        <Sep left={14} />
        {radioRow(allLabel, allSublabel, 'all')}
      </div>
    </div>
  )
}

/** Сколько строка держит галочку после копирования (как в «Как пройти»). */
const COPIED_MS = 1600

/**
 * Подписка календаря на ивенты: ссылка на ICS-фид, которую человек один раз кладёт
 * в свой календарь.
 *
 * Тап копирует ссылку, а не открывает её: подписка живёт на схеме `webcal://`, а из
 * вебвью её открыть нечем - `openLink` берёт только http/https, остальное Telegram
 * молча проглатывает (та же история, что с `tg://user?id=`).
 *
 * Токен тянем на монтировании экрана, а не по тапу: после `await` Safari уже не
 * считает клик «живым» жестом и запрещает запись в буфер обмена.
 */
function CalendarSection() {
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { token } = await api<{ token: string }>('calendar.link')
        if (alive) setLink(`${location.origin}/events.ics?token=${encodeURIComponent(token)}`)
      } catch {
        // Ссылку покажем при следующем открытии настроек — алерт тут был бы шумом.
      }
    })()
    return () => {
      alive = false
      window.clearTimeout(timer.current ?? undefined)
    }
  }, [])

  const copy = (): void => {
    if (!link) return
    navigator.clipboard.writeText(link).then(
      () => {
        haptic('success')
        setCopied(true)
        window.clearTimeout(timer.current ?? undefined)
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      },
      // В вебвью буфер обмена может быть недоступен — тогда показываем саму ссылку,
      // выделить и скопировать её руками всё равно можно.
      () => showAlert(link),
    )
  }

  return (
    <>
      <SectionTitle>Календарь</SectionTitle>
      <div className="card">
        <button type="button" className={'row tappable' + (link ? '' : ' rows-disabled')} onClick={copy}>
          <div className="row-icon" style={{ background: 'var(--purple)' }}>
            {icons.calendar(17, '#fff')}
          </div>
          <span className="row-label">
            Подписаться на ивенты
            {copied ? <span className="row-sublabel">Ссылка скопирована</span> : null}
          </span>
          <div className="row-right">
            <div className={'route-copy' + (copied ? ' done' : '')}>
              {copied ? icons.check(15, '#34c759', 2.6) : icons.copy(15, '#007aff')}
            </div>
          </div>
        </button>
      </div>
      <Footnote>
        Ссылка добавляется в календарь один раз — дальше новые ивенты появляются в нём сами. Ивенты только для
        резидентов в неё не попадают.
      </Footnote>
    </>
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
        <CalendarSection />
      </Screen>
    )
  }

  return (
    <Screen>
      <BackRow label="Ближайшие дни" />
      <Header title="Настройки" />
      <ThemeSection />
      <CalendarSection />
      <SectionTitle>Уведомления о заявках</SectionTitle>
      <NotifyCard
        prefs={s.notify}
        method="notify"
        title="Новые заявки"
        color="var(--orange)"
        todaySublabel="Заявки на текущий день"
        allLabel="Все заявки"
        allSublabel="На любой день"
      />
      <Footnote>Придут в личку бота. По умолчанию - только заявки на сегодня.</Footnote>
      <SectionTitle>Уведомления об ивентах</SectionTitle>
      <NotifyCard
        prefs={s.eventNotify}
        method="notify.events"
        title="Новые ивенты"
        color="var(--purple)"
        todaySublabel="Ивенты на текущий день"
        allLabel="Все ивенты"
        allSublabel="На любой день"
      />
      <Footnote>Придут в личку бота, когда резидент заводит ивент. По умолчанию - на любой день.</Footnote>
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
            onToggle={() => void action('mac.anon', { anon: !s.macAnon })}
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
            onToggle={() => void action('presence.log', { enabled: !s.logVisits })}
          />
        </div>
      </div>
      <Footnote>
        Журнал нужен статистике спейса: сколько часов он работал и когда сюда приходят. Уже записанные визиты остаются —
        выключение останавливает запись новых.
      </Footnote>
    </Screen>
  )
}
