// «Как пройти»: адрес, метро, фото двери подъезда и точка на карте.
// Открывается с главной гостя («Мои визиты»).
//
// Содержимое — во фронте, как и текст правил (screens/Rules.tsx): это константа
// конкретного спейса, а не настройка, и в стейте ей делать нечего.

import { useEffect, useRef, useState } from 'react'
import { icons } from '../icons'
import { showAlert, showImage } from '../modals'
import { haptic, openUrl } from '../telegram'
import { BackRow, Footnote, Header } from '../components/common'
import { Screen } from '../components/Screen'

const ADDRESS = 'ул. Литвина-Седого, 7'

const METRO = [
  { icon: '/metro-mck.webp', line: 'МЦК', station: 'Шелепиха' },
  { icon: '/metro-line7.webp', line: 'Линия 7', station: 'Улица 1905 года' },
]

/**
 * Карта — статичная мозаика тайлов OpenStreetMap/CARTO под фиксированным зумом:
 * интерактивная карта в вебвью Telegram стоила бы отдельной библиотеки и перехвата
 * жестов, а тут нужно ровно одно — понять, куда идти. Атрибуция обязательна.
 */
const TILES = [
  { url: 'https://a.basemaps.cartocdn.com/dark_all/16/39601/20484.png', left: -123.7, top: -129.6 },
  { url: 'https://b.basemaps.cartocdn.com/dark_all/16/39602/20484.png', left: 132.3, top: -129.6 },
  { url: 'https://c.basemaps.cartocdn.com/dark_all/16/39601/20485.png', left: -123.7, top: 126.4 },
  { url: 'https://a.basemaps.cartocdn.com/dark_all/16/39602/20485.png', left: 132.3, top: 126.4 },
]

const MAPS_URL = `https://yandex.ru/maps/?text=${encodeURIComponent(`Москва, ${ADDRESS}`)}`

/** Сколько кнопка держит галочку после копирования. */
const COPIED_MS = 1600

export function Route() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ADDRESS)
      haptic('success')
      // Ответ — сменой иконки в самой кнопке: модалка ради «скопировано» слишком громкая.
      setCopied(true)
      window.clearTimeout(timer.current ?? undefined)
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // В вебвью буфер обмена может быть недоступен — тогда просто показываем адрес,
      // выделить и скопировать его руками всё равно можно.
      showAlert(ADDRESS)
    }
  }

  return (
    <Screen>
      <BackRow label="Мои визиты" />
      <Header title="Как пройти" />

      <div className="card">
        <button type="button" className="row tappable route-address" onClick={copyAddress}>
          <div className="row-icon route-pin">{icons.pin(18, '#007aff')}</div>
          <div className="route-address-main">
            <div className="route-label">Адрес</div>
            <div className="route-value">{ADDRESS}</div>
          </div>
          <div className="row-right">
            <div className={'route-copy' + (copied ? ' done' : '')}>
              {copied ? icons.check(15, '#34c759', 2.6) : icons.copy(15, '#007aff')}
            </div>
          </div>
        </button>
        <div className="sep" style={{ marginLeft: 60 }} />
        <div className="route-metro">
          <div className="route-label">Метро</div>
          <div className="route-metro-list">
            {METRO.map((m) => (
              <div className="route-metro-row" key={m.station}>
                <img src={m.icon} width={24} height={24} alt={m.line} />
                <span>{m.station}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Дверь ищут в темноте по фотографии — её нужно уметь рассмотреть. */}
      <div className="route-door tappable" onClick={() => showImage('/door.jpg', 'Дверь подъезда')}>
        <img src="/door.jpg" alt="Дверь подъезда" />
      </div>

      <div className="section-title">На карте</div>
      <div className="card route-map-card">
        <div className="route-map">
          {TILES.map((t) => (
            <img key={t.url} src={t.url} width={256} height={256} alt="" style={{ left: t.left, top: t.top }} />
          ))}
          <div className="route-pin-mark">{icons.mapPin()}</div>
          <div className="route-map-credit">© OpenStreetMap · CARTO</div>
        </div>
        <button type="button" className="row tappable" onClick={() => openUrl(MAPS_URL)}>
          <span className="route-map-open">
            {icons.external()}
            Открыть в картах
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>

      <Footnote>По прибытию свяжитесь с резидентом, который вас хостит, или нажмите кнопку «Я на месте».</Footnote>
    </Screen>
  )
}
