// «Как пройти»: адрес, метро, фото двери подъезда и точка на карте.
// Открывается с главной гостя («Мои визиты»).
//
// Содержимое — во фронте, как и текст правил (screens/Rules.tsx): это константа
// конкретного спейса, а не настройка, и в стейте ей делать нечего.

import { icons } from '../icons'
import { showAlert } from '../modals'
import { openUrl } from '../telegram'
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

export function Route() {
  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ADDRESS)
      showAlert('Адрес скопирован.')
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
        <div className="row tappable route-address" onClick={copyAddress}>
          <div className="row-icon route-pin">{icons.pin(18, '#007aff')}</div>
          <div className="route-address-main">
            <div className="route-label">Адрес</div>
            <div className="route-value">{ADDRESS}</div>
          </div>
          <div className="row-right">
            <div className="route-copy">{icons.copy(15, '#007aff')}</div>
          </div>
        </div>
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

      <div className="route-door">
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
        <div className="row tappable" onClick={() => openUrl(MAPS_URL)}>
          <span className="route-map-open">
            {icons.external()}
            Открыть в картах
          </span>
          <div className="row-right">{icons.chevron()}</div>
        </div>
      </div>

      <Footnote>По прибытию свяжитесь с резидентом, который вас хостит.</Footnote>
    </Screen>
  )
}
