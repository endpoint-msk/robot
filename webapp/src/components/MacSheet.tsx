// Лист привязки телефона для авто-отметки: где найти MAC на своей платформе и поле для
// него. Открывается из знакомства и из настроек.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { action } from '../api'
import { icons } from '../icons'
import { Actions, Question, sheetPrompt } from '../modals'
import { haptic, tg } from '../telegram'
import { Sep } from './common'

type Os = 'ios' | 'android' | 'mac' | 'win'

type How = {
  tab: string
  /** Куда идти в настройках. */
  path: ReactNode
  /** Копия двух строк экрана настроек: переключатель случайного адреса и сам адрес. */
  k1: string
  v1: string
  k2: string
  v2: string
  note: string
  /** Что сказать, если введённый адрес случайный (бит локального адреса). */
  random: string
  /** Название устройства по умолчанию. */
  label: string
}

// Подписи сверены с системными: у Apple «Частный адрес Wi-Fi» с вариантами
// «Постоянный» и «Чередующийся», у Windows «Случайные аппаратные адреса».
const HOW: Record<Os, How> = {
  ios: {
    tab: 'iPhone',
    path: (
      <>
        <b>Настройки</b> › Wi-Fi › ⓘ у сети Endpoint
      </>
    ),
    k1: 'Частный адрес Wi-Fi',
    v1: 'Постоянный',
    k2: 'Адрес Wi-Fi',
    v2: 'a4:83:e7:1c:0f:92',
    note: '«Чередующийся» не подойдёт: адрес будет меняться раз в две недели.',
    random: 'Это частный адрес. Подойдёт, если он «Постоянный».',
    label: 'iPhone',
  },
  android: {
    tab: 'Android',
    path: (
      <>
        <b>Настройки</b> › Wi-Fi › ⚙ у сети Endpoint
      </>
    ),
    k1: 'Конфиденциальность',
    v1: 'MAC-адрес устройства',
    k2: 'MAC-адрес',
    v2: 'a4:83:e7:1c:0f:92',
    note: 'Пункт может называться «Тип MAC-адреса»: нужен адрес устройства, а не случайный.',
    random: 'Это случайный адрес. Подойдёт, только если он не меняется при переподключении.',
    label: 'Телефон',
  },
  mac: {
    tab: 'Mac',
    path: (
      <>
        <b>Системные настройки</b> › Wi-Fi › Подробнее у сети Endpoint
      </>
    ),
    k1: 'Частный адрес Wi-Fi',
    v1: 'Постоянный',
    k2: 'Адрес Wi-Fi',
    v2: 'a4:83:e7:1c:0f:92',
    note: '«Чередующийся» не подойдёт: адрес будет меняться раз в две недели.',
    random: 'Это частный адрес. Подойдёт, если он «Постоянный».',
    label: 'Mac',
  },
  win: {
    tab: 'Windows',
    path: (
      <>
        <b>Параметры</b> › Сеть и Интернет › Wi-Fi › Свойства Endpoint
      </>
    ),
    k1: 'Случайные аппаратные адреса',
    v1: 'Откл.',
    k2: 'Физический адрес (MAC)',
    v2: 'A4-83-E7-1C-0F-92',
    note: 'Адрес с дефисами подойдёт, бот сам приведёт его к одному виду.',
    random: 'Это случайный адрес. Выключите «Случайные аппаратные адреса», иначе он будет меняться.',
    label: 'Ноутбук',
  },
}

const OS_ORDER: Os[] = ['ios', 'android', 'mac', 'win']

/** Вкладка по умолчанию: платформа клиента Telegram, для десктопа и веба - система. */
const defaultOs = (): Os => {
  const p = tg?.platform ?? ''
  if (p === 'ios') return 'ios'
  if (p.startsWith('android')) return 'android'
  if (p === 'macos') return 'mac'
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'win'
  return 'ios'
}

type Check = { ok: boolean; msg: string; tone: '' | 'err' | 'warn' }

/**
 * Проверка до отправки. Бит локального адреса во втором символе значит «адрес
 * случайный»: сохранить его можно (постоянный частный адрес Apple именно такой),
 * но человек должен понимать, что на ротации отметка отвалится.
 */
const checkMac = (raw: string, os: Os): Check => {
  const value = raw.trim()
  if (!value) return { ok: false, msg: '', tone: '' }
  const hex = value.replace(/[^0-9a-f]/gi, '')
  if (hex.length !== 12 || /[^0-9a-f:\-.\s]/i.test(value)) {
    return { ok: false, msg: 'Нужно 12 символов 0-9 и a-f, например a4:83:e7:1c:0f:92', tone: 'err' }
  }
  const pretty = (hex.toLowerCase().match(/../g) ?? []).join(':')
  if (parseInt(hex.charAt(1), 16) & 2) return { ok: true, msg: HOW[os].random, tone: 'warn' }
  return { ok: true, msg: pretty === value ? '' : 'Сохранится как ' + pretty, tone: '' }
}

const canPaste = (): boolean => typeof navigator.clipboard?.readText === 'function'

/**
 * Лист вопроса, как у остальных листов со значением: вопрос сверху, «Привязать» кнопкой
 * листа, под ней «Отмена». Отказ сервера встаёт вопросом в том же листе, а введённое под
 * ним остаётся.
 */
function MacBody({ done }: { done: (bound: boolean | null) => void }) {
  const [os, setOs] = useState<Os>(defaultOs)
  const [mac, setMac] = useState('')
  const [label, setLabel] = useState(() => HOW[defaultOs()].label)
  const labelTouched = useRef(false)
  const [sending, setSending] = useState(false)
  const macRef = useRef<HTMLInputElement>(null)
  const check = checkMac(mac, os)
  const how = HOW[os]

  const pickOs = (next: Os): void => {
    setOs(next)
    if (!labelTouched.current) setLabel(HOW[next].label)
  }

  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) setMac(text.trim())
    } catch {
      // Вебвью не дал прочитать буфер: вставить можно и руками, из поля.
    }
    macRef.current?.focus()
  }

  const submit = async (): Promise<void> => {
    if (!check.ok || sending) return
    setSending(true)
    // Тихо: затемнение со спиннером лежит под листом. Пока ответа нет, кнопка погашена.
    const res = await action('mac.add', { mac: mac.trim(), label: label.trim() }, { quiet: true })
    setSending(false)
    if (!res) return
    haptic.notify('success')
    done(true)
  }

  return (
    <>
      <Question text="Привязка телефона" />
      <div className="mac-body">
        <div className="segmented ob-seg4" role="tablist" aria-label="Платформа">
          <i className="seg-thumb" style={{ transform: `translateX(${OS_ORDER.indexOf(os) * 100}%)` }} />
          {OS_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={os === key}
              className={'seg' + (os === key ? ' on' : '')}
              onClick={() => pickOs(key)}
            >
              {HOW[key].tab}
            </button>
          ))}
        </div>
        <div className="ob-how">
          <div className="ob-how-path">{how.path}</div>
          <div className="ob-replica">
            <div className="ob-rr">
              <span>{how.k1}</span>
              <span className="ob-rv">
                {how.v1}
                {icons.chevron()}
              </span>
            </div>
            <div className="ob-rr hit">
              <span>{how.k2}</span>
              <span className="ob-rv">{how.v2}</span>
            </div>
          </div>
          <div className="ob-how-note">{how.note}</div>
        </div>
        <div className="card ob-field-card">
          <label className="ob-field">
            <span className="vh">MAC-адрес</span>
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
            {canPaste() ? (
              <button type="button" className="ob-paste" onClick={() => void paste()}>
                Вставить
              </button>
            ) : null}
          </label>
          <Sep inset="text" />
          <label className="ob-field">
            <span className="vh">Название</span>
            <input
              className="text-input"
              placeholder="Название, например iPhone"
              autoComplete="off"
              maxLength={50}
              value={label}
              onChange={(e) => {
                labelTouched.current = true
                setLabel(e.target.value)
              }}
            />
          </label>
        </div>
        <div className={'ob-field-msg' + (check.tone ? ' ' + check.tone : '')}>{check.msg}</div>
      </div>
      <Actions label="Привязать" disabled={!check.ok || sending} onConfirm={() => void submit()} cancel="Отмена" onCancel={() => done(null)} />
    </>
  )
}

/** Лист привязки телефона. true - телефон привязан, null - лист закрыли. */
export const bindPhone = (): Promise<boolean | null> => sheetPrompt<boolean | null>(({ done }) => <MacBody done={done} />)

/**
 * Тот же лист компонентом, для дизайн-системы (ds.ts): открывается при монтировании,
 * `onClose` зовётся, когда его закрыли. Рисует его ModalHost, он должен стоять рядом.
 */
export function MacSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    void (async () => {
      await bindPhone()
      onClose()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
