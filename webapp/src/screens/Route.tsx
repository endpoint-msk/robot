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

/** Адрес нужен и на карточке визита — там он и есть ответ на «куда идти». */
export const ADDRESS = 'ул. Литвина-Седого, 7'

const METRO = [
  { icon: '/metro-mck.webp', line: 'МЦК', station: 'Шелепиха' },
  { icon: '/metro-line7.webp', line: 'Линия 7', station: 'Улица 1905 года' },
]

/**
 * Карта района своей отрисовкой. Тайлы CARTO убраны: у части людей они упирались
 * в too many requests и не приезжали вовсе, а тёмный набор в светлой теме был
 * чёрной плитой среди белых карточек. Геометрия — настоящая, из OpenStreetMap
 * (дороги, здания, вода), спроецированная в тот же кадр z16, что показывали
 * тайлы, и вшитая в разметку: ноль запросов наружу, цвета токенами, на ретине
 * не мылится. Атрибуция обязательна и по лицензии, и по-человечески.
 */
function RouteMap() {
  return (
    <svg
      className="route-map"
      viewBox="0 0 320 210"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Карта района: ${ADDRESS}`}
    >
      <rect className="rs-bg" x="0" y="0" width="320" height="210" />
      <path className="rs-water" d="M346.6 41.2 L359.9 44.1 L374.6 47.2 L360.9 111.6 L345.9 108.4 L332.8 105.7 L346.6 41.2Z" />
      <path className="rs-build" d="M35.5 205.7 L44.4 207.7 L43.5 212.2 L40.7 225.9 L37.6 239.7 L36.7 243.8 L27.8 241.8 L35.5 205.7Z" />
      <path className="rs-build" d="M55.5 121.2 L64.4 123.1 L62.0 134.4 L58.5 151.0 L56.7 159.2 L47.8 157.3 L55.5 121.2Z" />
      <path className="rs-build" d="M217.6 197.0 L226.6 198.9 L225.7 203.1 L222.7 217.0 L219.9 230.0 L218.8 235.0 L209.9 233.1 L217.6 197.0Z" />
      <path className="rs-build" d="M82.6 78.5 L91.9 80.7 L82.6 121.1 L73.3 119.0 L76.0 107.5 L79.9 90.4 L82.6 78.5Z" />
      <path className="rs-build" d="M-2.1 198.0 L6.8 199.9 L-0.9 236.0 L-9.8 234.1 L-8.9 230.0 L-6.1 216.7 L-2.9 201.7 L-2.1 198.0Z" />
      <path className="rs-build" d="M19.7 113.1 L28.7 115.0 L21.0 151.1 L12.0 149.2 L13.3 143.2 L15.8 131.3 L18.6 118.2 L19.7 113.1Z" />
      <path className="rs-build" d="M-17.8 103.9 L-8.8 105.8 L-16.6 141.9 L-25.5 140.0 L-24.3 134.5 L-21.7 122.3 L-19.1 110.1 L-17.8 103.9Z" />
      <path className="rs-build" d="M-14.5 -6.8 L-5.6 -4.9 L-7.2 2.5 L-9.9 15.5 L-13.0 29.7 L-13.8 33.7 L-22.8 31.8 L-14.5 -6.8Z" />
      <path className="rs-build" d="M95.1 16.3 L105.2 18.4 L96.6 58.8 L86.5 56.6 L88.7 46.5 L92.9 26.6 L95.1 16.3Z" />
      <path className="rs-build" d="M158.8 135.0 L185.2 140.9 L179.3 167.6 L169.1 165.3 L170.2 160.2 L172.3 150.6 L172.8 148.4 L164.0 146.5 L156.7 144.8 L158.8 135.0Z" />
      <path className="rs-build" d="M275.5 120.9 L301.7 126.2 L296.5 151.9 L286.2 149.8 L287.3 144.3 L289.1 135.7 L289.4 133.8 L279.5 131.8 L273.5 130.6 L275.5 120.9Z" />
      <path className="rs-build" d="M122.1 114.1 L127.8 88.1 L153.3 93.7 L151.1 103.8 L144.1 102.2 L135.4 100.3 L135.0 101.8 L133.0 111.3 L131.9 116.3 L123.4 114.4 L122.1 114.1Z" />
      <path className="rs-build" d="M229.7 138.9 L234.9 112.7 L260.7 117.9 L258.6 128.2 L252.4 127.0 L242.6 125.0 L242.3 126.5 L240.5 135.4 L239.4 140.8 L229.7 138.9Z" />
      <path className="rs-build" d="M98.9 149.8 L104.7 123.6 L130.4 129.3 L128.2 139.5 L121.3 138.0 L112.4 136.0 L112.1 137.4 L110.0 147.0 L108.9 152.0 L98.9 149.8Z" />
      <path className="rs-build" d="M115.4 193.3 L89.3 187.5 L95.0 161.9 L105.3 164.2 L103.8 170.5 L102.1 178.2 L101.7 180.0 L110.4 182.0 L117.6 183.6 L115.4 193.3Z" />
      <path className="rs-build" d="M176.2 179.5 L170.3 205.6 L144.7 199.8 L147.0 189.5 L153.6 191.0 L162.9 193.1 L163.3 191.5 L165.4 182.3 L166.5 177.3 L176.2 179.5Z" />
      <path className="rs-build" d="M64.9 163.0 L74.0 164.9 L62.8 217.3 L53.7 215.4 L54.8 210.4 L58.0 195.4 L61.1 180.7 L63.9 167.6 L64.9 163.0Z" />
      <path className="rs-build" d="M259.9 32.0 L265.9 33.3 L278.2 36.1 L292.2 39.1 L303.9 41.7 L310.9 43.3 L311.4 40.8 L313.0 33.7 L262.0 22.5 L260.4 29.6 L259.9 32.0Z" />
      <path className="rs-build" d="M115.6 -74.4 L124.7 -72.4 L113.5 -20.0 L104.4 -22.0 L105.6 -27.2 L108.6 -41.6 L111.6 -55.4 L114.6 -69.5 L115.6 -74.4Z" />
      <path className="rs-build" d="M16.3 167.6 L14.0 177.9 L23.5 180.0 L23.3 180.9 L28.7 182.2 L29.0 181.0 L39.0 183.2 L41.2 173.2 L16.3 167.6Z" />
      <path className="rs-build" d="M-23.4 161.6 L-25.6 171.9 L-0.7 177.3 L1.5 166.9 L-23.4 161.6Z" />
      <path className="rs-build" d="M186.6 235.8 L183.7 235.0 L184.2 232.7 L174.8 231.0 L169.5 256.2 L173.1 256.4 L172.7 258.8 L181.9 260.7 L184.3 248.3 L186.6 235.8Z" />
      <path className="rs-build" d="M183.5 180.5 L181.4 189.8 L205.8 195.3 L207.9 186.0 L201.8 184.6 L189.0 181.8 L183.5 180.5Z" />
      <path className="rs-build" d="M292.2 165.1 L285.1 163.7 L278.1 162.4 L276.2 172.3 L278.8 172.8 L275.8 188.7 L273.2 188.2 L270.8 200.7 L277.8 202.1 L284.9 203.4 L292.2 165.1Z" />
      <path className="rs-build" d="M316.0 -20.4 L327.7 -17.8 L338.2 -65.6 L326.5 -68.2 L316.0 -20.4Z" />
      <path className="rs-build" d="M199.0 20.3 L226.9 26.8 L230.4 11.8 L202.6 5.2 L199.0 20.3Z" />
      <path className="rs-build" d="M153.2 10.9 L193.2 19.4 L196.7 4.9 L156.2 -3.1 L153.2 10.9Z" />
      <path className="rs-build" d="M125.8 26.1 L193.8 41.1 L196.8 26.5 L219.8 32.1 L224.8 37.1 L224.8 44.6 L220.8 50.6 L215.8 52.6 L204.3 50.6 L197.8 78.1 L118.3 60.6 L125.8 26.1Z" />
      <path className="rs-build" d="M191.9 153.1 L196.1 134.5 L215.9 138.9 L211.8 157.2 L205.5 155.8 L207.0 148.9 L200.9 147.5 L199.2 154.8 L191.9 153.1Z" />
      <path className="rs-build" d="M247.7 237.1 L274.2 243.6 L280.2 217.6 L270.2 215.1 L269.0 220.8 L267.0 229.9 L266.7 231.1 L257.7 228.7 L249.7 226.6 L247.7 237.1Z" />
      <path className="rs-build" d="M21.9 26.9 L21.2 30.3 L19.8 36.8 L58.7 45.1 L60.8 35.2 L54.0 33.7 L40.3 30.8 L26.6 27.9 L21.9 26.9Z" />
      <path className="rs-build" d="M290.0 -1.9 L294.0 -1.2 L307.7 1.5 L323.2 4.6 L328.0 5.5 L326.1 15.1 L288.1 7.7 L290.0 -1.9Z" />
      <path className="rs-build" d="M196.8 26.5 L129.0 11.6 L125.8 26.1 L193.8 41.1 L196.8 26.5Z" />
      <path className="rs-build" d="M223.7 -0.6 L156.5 -14.3 L173.6 -97.9 L240.8 -84.1 L229.0 -26.3 L230.7 -26.0 L227.2 -9.9 L225.7 -10.2 L223.7 -0.6Z" />
      <path className="rs-build" d="M260.4 29.6 L251.4 27.6 L239.9 79.6 L249.0 81.6 L250.4 75.0 L253.2 62.4 L256.3 48.1 L259.1 35.6 L259.9 32.0 L260.4 29.6Z" />
      <path className="rs-build" d="M310.9 43.3 L309.7 48.5 L307.3 59.7 L304.2 73.7 L301.5 85.9 L299.9 92.9 L309.2 94.9 L320.8 42.8 L311.4 40.8 L310.9 43.3Z" />
      <path className="rs-build" d="M131.9 -7.2 L149.7 -3.2 L148.2 3.8 L130.4 -0.2 L131.9 -7.2Z" />
      <path className="rs-build" d="M214.2 59.9 L224.8 62.2 L219.7 86.2 L209.1 84.0 L214.2 59.9Z" />
      <path className="rs-build" d="M232.0 186.1 L218.9 183.3 L227.1 145.7 L232.4 146.8 L240.2 148.5 L238.7 155.5 L245.2 156.9 L247.2 147.8 L262.8 151.2 L261.8 155.9 L272.7 158.3 L270.7 167.4 L256.0 164.2 L250.8 163.1 L247.3 162.3 L244.2 161.7 L244.5 160.2 L238.0 158.8 L235.7 169.2 L232.0 186.1Z" />
      <path className="rs-build" d="M105.5 216.5 L145.7 225.3 L142.6 239.5 L140.7 239.1 L140.3 241.1 L129.0 238.7 L129.5 236.6 L124.6 235.5 L124.1 237.8 L101.9 232.9 L105.5 216.5Z" />
      <path className="rs-build" d="M-26.7 53.4 L48.7 69.6 L45.1 86.1 L34.2 83.7 L35.1 79.4 L-17.4 68.2 L-21.6 87.6 L-33.5 85.0 L-26.7 53.4Z" />
      <path className="rs-road rs-service" d="M80.9 66.5 L82.3 60.2 L87.4 37.1 L91.1 20.4 L95.2 0.7 L98.8 -16.9 L100.9 -27.1 L110.3 -72.8 L114.4 -92.4 L116.8 -104.2 L119.7 -118.2 L120.0 -120.0 L126.5 -151.3" />
      <path className="rs-road rs-service" d="M210.4 201.4 L215.3 186.7 L216.9 179.7 L225.3 142.8 L225.7 141.1" />
      <path className="rs-road rs-service" d="M170.6 210.1 L158.3 271.3 L157.1 277.3" />
      <path className="rs-road rs-service" d="M197.7 266.9 L218.1 270.3 L223.3 241.2 L225.1 232.7 L227.1 219.8 L232.9 193.0 L231.4 189.9 L215.3 186.7 L208.2 176.7 L182.5 170.8" />
      <path className="rs-road rs-service" d="M82.7 189.9 L87.0 190.9 L88.9 191.3 L119.8 198.1 L122.5 198.7 L138.9 202.5 L170.6 210.1 L173.9 210.3 L189.3 213.4 L197.5 225.9 L196.3 237.6 L193.7 261.6 L194.9 263.3 L197.7 266.9 L194.8 283.9 L186.9 282.4" />
      <path className="rs-road rs-service" d="M285.8 240.5 L276.1 246.9 L274.4 247.0 L262.8 243.9 L248.0 240.0 L246.6 237.6 L227.1 233.3 L225.1 232.7" />
      <path className="rs-road rs-service" d="M126.5 -10.5 L115.9 -13.0 L98.8 -16.9" />
      <path className="rs-road rs-service" d="M87.4 37.1 L60.6 30.8 L31.6 23.9 L-3.5 15.6" />
      <path className="rs-road rs-service" d="M-10.5 47.7 L-9.0 41.0 L-3.5 15.6 L0.2 -1.3 L8.3 -38.8 L10.3 -47.8 L19.8 -91.5" />
      <path className="rs-road rs-service" d="M-42.1 185.7 L-7.7 193.4 L22.4 200.1 L50.2 206.4" />
      <path className="rs-road rs-service" d="M-19.8 260.5 L-17.3 247.4 L-16.7 244.2 L-7.7 193.4" />
      <path className="rs-road rs-service" d="M89.6 158.4 L80.3 156.4 L62.0 152.5" />
      <path className="rs-road rs-service" d="M57.5 173.2 L52.7 172.2 L44.5 170.7" />
      <path className="rs-road rs-service" d="M60.0 161.8 L35.8 155.9 L39.3 136.6" />
      <path className="rs-road rs-service" d="M-31.7 140.1 L-6.4 145.2 L4.3 147.6 L5.0 144.9 L8.2 127.1 L12.1 105.5" />
      <path className="rs-road rs-service" d="M41.1 309.8 L38.2 305.1 L37.5 303.8 L31.1 293.4 L35.8 272.1 L37.8 262.8 L42.5 241.2 L47.8 217.2 L50.2 206.4 L57.5 173.2 L60.0 161.8 L62.0 152.5 L66.9 130.2 L71.8 108.2 L73.9 98.4 L79.7 71.8 L80.9 66.5" />
      <path className="rs-road rs-service" d="M-86.7 268.4 L-81.1 269.4 L-62.0 272.7 L-57.5 252.6 L-53.6 235.9 L-51.0 224.2 L-44.3 195.4 L-42.1 185.7 L-35.3 155.8 L-31.7 140.1 L-30.3 133.9 L-22.7 101.0" />
      <path className="rs-road rs-service" d="M142.9 184.7 L138.9 202.5" />
      <path className="rs-road rs-service" d="M266.1 205.4 L272.7 172.1" />
      <path className="rs-road rs-service" d="M185.6 156.7 L187.9 157.2 L189.1 157.4 L212.2 161.8" />
      <path className="rs-road rs-service" d="M163.8 166.7 L182.5 170.8" />
      <path className="rs-road rs-service" d="M152.4 126.8 L148.1 146.5" />
      <path className="rs-road rs-service" d="M163.8 166.7 L167.3 150.8 L148.1 146.5 L131.9 143.0" />
      <path className="rs-road rs-service" d="M110.5 159.1 L110.9 157.3 L114.9 139.3 L131.9 143.0 L136.2 123.3" />
      <path className="rs-road rs-service" d="M110.5 159.1 L106.7 176.8 L121.4 180.0 L123.7 180.5 L128.3 181.6 L142.9 184.7 L159.1 188.3 L163.8 166.7" />
      <path className="rs-road rs-service" d="M90.4 154.7 L95.0 155.7 L98.5 156.4 L110.5 159.1" />
      <path className="rs-road rs-service" d="M133.5 122.7 L106.2 116.7" />
      <path className="rs-road rs-service" d="M249.3 224.8 L261.7 227.0 L265.8 205.6 L266.1 205.4" />
      <path className="rs-road rs-service" d="M291.4 208.8 L285.0 208.1 L283.5 207.6 L266.1 205.4" />
      <path className="rs-road rs-service" d="M173.7 131.5 L177.9 112.1 L162.5 108.7 L157.2 107.5 L155.0 107.1 L153.1 106.6 L137.7 103.3 L133.7 121.6 L133.5 122.7" />
      <path className="rs-road rs-service" d="M190.3 135.1 L188.2 134.7 L173.7 131.5 L152.4 126.8 L150.7 126.5 L136.2 123.3 L133.5 122.7" />
      <path className="rs-road rs-service" d="M225.7 141.1 L227.3 133.3 L232.8 107.2 L234.4 99.8" />
      <path className="rs-road rs-service" d="M244.7 144.9 L230.7 142.1 L225.7 141.1" />
      <path className="rs-road rs-service" d="M241.1 165.7 L255.2 168.4 L272.7 172.1" />
      <path className="rs-road rs-service" d="M244.7 144.9 L276.9 151.4" />
      <path className="rs-road rs-service" d="M265.7 132.8 L247.8 129.2 L244.7 144.9" />
      <path className="rs-road rs-service" d="M303.1 156.6 L297.5 155.5 L290.3 154.1 L276.9 151.4" />
      <path className="rs-road rs-service" d="M268.4 119.4 L268.2 120.3 L265.7 132.8" />
      <path className="rs-road rs-service" d="M199.6 92.7 L198.1 99.8 L192.4 125.6 L190.3 135.1 L185.6 156.7 L184.7 160.7 L182.5 170.8 L173.9 210.3" />
      <path className="rs-road rs-service" d="M162.3 84.3 L160.6 91.9 L160.2 93.8 L157.2 107.5" />
      <path className="rs-road rs-service" d="M189.1 157.4 L194.9 131.9 L216.8 136.8" />
      <path className="rs-road rs-service" d="M170.3 -105.5 L240.3 -89.6 L242.9 -88.4 L244.2 -86.5 L244.6 -83.9 L244.3 -80.7 L243.2 -72.1 L227.2 0.0 L226.3 2.0 L224.8 2.9 L221.8 3.3 L218.4 3.1 L147.9 -11.5" />
      <path className="rs-road rs-service" d="M276.2 -10.6 L282.9 -9.2" />
      <path className="rs-road rs-service" d="M269.8 -6.0 L272.4 -5.4 L273.5 -5.4 L274.2 -5.6 L274.8 -6.1 L275.4 -6.9 L276.2 -10.6 L276.9 -13.9" />
      <path className="rs-road rs-service" d="M262.0 2.4 L267.7 3.6" />
      <path className="rs-road rs-service" d="M282.9 -9.2 L330.3 1.2 L337.8 2.8" />
      <path className="rs-road rs-service" d="M276.9 -13.9 L278.5 -21.0 L281.4 -34.6 L288.5 -66.9 L289.0 -68.5 L290.0 -69.6 L291.1 -70.1 L292.6 -70.3 L311.9 -66.2 L315.2 -66.1 L317.3 -66.3 L319.6 -66.9 L321.2 -67.6 L323.4 -68.7 L325.9 -69.4 L328.3 -69.8 L331.9 -70.0 L344.7 -67.2 L347.0 -66.7 L352.6 -65.5" />
      <path className="rs-road rs-service" d="M269.8 -6.0 L267.7 3.6 L267.5 4.6 L266.6 6.4 L265.3 7.6 L263.7 8.2 L261.7 8.3 L239.7 3.5 L237.9 2.5 L236.8 1.2 L236.2 -0.4 L236.1 -2.2 L240.0 -20.2 L240.9 -22.0 L241.9 -22.7 L243.4 -23.1 L245.4 -22.7 L250.9 -21.5 L252.9 -20.9 L254.3 -20.2 L255.8 -19.3 L257.6 -17.5 L269.8 -6.0" />
      <path className="rs-road rs-service" d="M267.6 -24.9 L269.3 -32.6 L270.0 -34.3 L270.9 -35.3 L272.1 -36.0 L273.8 -36.2 L281.4 -34.6" />
      <path className="rs-road rs-service" d="M278.5 -21.0 L332.4 -9.1 L334.3 -8.7 L340.0 -7.4" />
      <path className="rs-road rs-service" d="M252.9 104.0 L254.5 96.8 L255.2 93.1 L266.5 37.5 L306.3 45.8 L294.7 101.8 L294.0 105.2 L292.7 112.5" />
      <path className="rs-road rs-service" d="M272.7 172.1 L276.9 151.4 L280.0 135.7 L265.7 132.8" />
      <path className="rs-road rs-residential" d="M311.9 116.5 L305.6 115.2 L292.7 112.5 L270.7 108.0 L252.9 104.0 L234.4 99.8 L199.6 92.7 L162.3 84.3 L113.9 73.5 L108.4 72.4" />
      <path className="rs-road rs-residential" d="M108.4 72.4 L98.3 70.2 L80.9 66.5 L-10.5 47.7 L-17.9 46.2" />
      <path className="rs-road rs-residential" d="M-17.9 46.2 L-33.1 43.0 L-37.6 42.1" />
      <path className="rs-road rs-tertiary" d="M336.7 450.2 L333.5 441.1 L323.4 412.7 L320.9 404.3 L316.2 387.8 L301.3 316.5 L297.2 294.9 L288.0 251.2 L285.8 240.5 L286.5 230.4 L291.4 208.8 L303.1 156.6 L311.9 116.5" />
      <path className="rs-road rs-tertiary" d="M108.4 72.4 L106.7 80.4 L102.2 100.7 L94.4 136.2 L90.4 154.7 L89.6 158.4 L82.7 189.9 L76.0 220.6 L73.3 232.9 L70.5 245.4 L58.7 299.6 L56.1 310.1 L55.3 314.4 L54.6 318.6 L54.1 323.9 L54.0 329.4 L54.6 333.5 L56.2 339.0 L89.7 421.4 L92.6 428.1 L94.1 430.4 L110.6 449.8 L115.8 456.1 L119.2 460.1 L129.3 471.6 L139.8 483.6 L140.6 484.6 L153.0 498.9 L161.6 510.7 L167.0 519.2" />
      <path className="rs-road rs-tertiary" d="M311.9 116.5 L314.3 106.3 L323.7 65.6 L332.0 29.9 L337.8 2.8 L340.0 -7.4 L352.6 -65.5 L353.7 -70.9 L356.1 -81.8 L380.8 -196.8 L384.0 -210.0" />
      <path className="rs-road rs-tertiary" d="M157.2 -152.0 L154.8 -141.2 L148.4 -110.9 L126.5 -10.5 L109.8 66.1 L108.4 72.4" />
      <path className="rs-here" d="M167.0 96.8 L193.3 102.7 L187.5 128.1 L177.4 125.9 L178.6 120.5 L180.5 112.1 L180.9 110.2 L172.1 108.3 L164.8 106.6 L167.0 96.8Z" />
      <text className="rs-name" transform="translate(35.2 57.1) rotate(11.6)" textAnchor="middle" dy="2.4">Литвина-Седого</text>
      <text className="rs-name" transform="translate(114.8 43.1) rotate(-77.7)" textAnchor="middle" dy="2.4">Стрельбищенский пер.</text>
      {/* Метка стоит остриём внутри дома, в его нижнем крыле, и своим цветом:
          синий пин поверх синего дома сливался с ним в одно пятно. */}
      <g className="rs-pin" transform="translate(174 97) scale(0.72)">
        <path d="M15 37c0-9 11-13.5 11-22A11 11 0 004 15c0 8.5 11 13 11 22z" strokeWidth="2.6" />
        <circle cx="15" cy="14.5" r="4.2" className="rs-pin-dot" />
      </g>
    </svg>
  )
}

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
        <div className="route-map-wrap">
          <RouteMap />
          <div className="route-map-credit">© OpenStreetMap</div>
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
