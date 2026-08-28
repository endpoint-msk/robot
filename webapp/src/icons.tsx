// Статичные SVG-иконки. Цвет по умолчанию у части иконок зависит от темы (sec());
// компоненты, где они используются, перерисовываются на смене темы, так что цвет
// пересчитывается. Возвращают JSX.Element — встраиваются как {icons.chevron()}.

import type { ReactElement } from 'react'
import { sec } from './theme'

export const icons = {
  chevron: (color?: string): ReactElement => (
    <svg width="7" height="12" viewBox="0 0 7 12">
      <path d="M1 1l5 5-5 5" fill="none" stroke={color || sec(0.3)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  back: (): ReactElement => (
    <svg width="11" height="18" viewBox="0 0 11 18">
      <path d="M9.5 1.5L2 9l7.5 7.5" fill="none" stroke="#007aff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (size: number, color: string, width?: number): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <path d="M2.5 7.5l3 3L11.5 4" fill="none" stroke={color} strokeWidth={width || 2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="7" fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M9 5v4.2l2.6 1.6" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chart: (size = 17, color = '#fff'): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path d="M3 15V9.4M7.6 15V4.2M12.2 15v-7M16 15H2" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  plus: (): ReactElement => (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M9 3v12M3 9h12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  plusSmall: (): ReactElement => (
    <svg width="14" height="14" viewBox="0 0 18 18">
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  /** Лупа в поле поиска — цвет служебный, как у плейсхолдера. */
  search: (): ReactElement => (
    <svg width="15" height="15" viewBox="0 0 18 18">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke={sec(0.45)} strokeWidth="1.8" />
      <path d="M12 12l4 4" stroke={sec(0.45)} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  lock: (): ReactElement => (
    <svg width="13" height="13" viewBox="0 0 18 18">
      <path d="M4 8V6.5a5 5 0 0 1 10 0V8" fill="none" stroke={sec(0.55)} strokeWidth="1.6" />
      <rect x="3.5" y="8" width="11" height="7.5" rx="2" fill="none" stroke={sec(0.55)} strokeWidth="1.6" />
    </svg>
  ),
  /** Заливной замок для плашки «день закрыт»: контурный на мелком размере мылится. */
  lockFilled: (size = 17, color = '#fff'): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M6.7 8.8V6.7a3.3 3.3 0 0 1 6.6 0v2.1" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <rect x="4.3" y="8.6" width="11.4" height="8.2" rx="2.6" fill={color} />
    </svg>
  ),
  info: (): ReactElement => (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="none" stroke={sec(0.35)} strokeWidth="1.4" />
      <path d="M8 7v4M8 5h.01" stroke={sec(0.45)} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  archiveBox: (): ReactElement => (
    <svg width="16" height="16" viewBox="0 0 18 18">
      <rect x="2.5" y="3" width="13" height="4" rx="1.2" fill="none" stroke="#fff" strokeWidth="1.7" />
      <path d="M4 7v6.2A1.8 1.8 0 0 0 5.8 15h6.4a1.8 1.8 0 0 0 1.8-1.8V7M7.3 10h3.4" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  gear: (): ReactElement => (
    <svg width="17" height="17" viewBox="0 0 20 20">
      <path d="M4 6h5M13 6h3M4 14h3M11 14h5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="11" cy="6" r="2" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="9" cy="14" r="2" fill="none" stroke="#fff" strokeWidth="1.7" />
    </svg>
  ),
  bell: (): ReactElement => (
    <svg width="16" height="16" viewBox="0 0 18 18">
      <path d="M9 2.2a4.6 4.6 0 0 0-4.6 4.6c0 3.4-1.4 4.6-1.4 4.6h12s-1.4-1.2-1.4-4.6A4.6 4.6 0 0 0 9 2.2zM7.4 14.2a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  wifi: (): ReactElement => (
    <svg width="17" height="17" viewBox="0 0 20 20">
      <path d="M3 8.2a10 10 0 0 1 14 0M5.6 11a6.4 6.4 0 0 1 8.8 0M8.2 13.7a2.8 2.8 0 0 1 3.6 0" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="16" r="1.2" fill="#fff" />
    </svg>
  ),
  eye: (): ReactElement => (
    <svg width="14" height="14" viewBox="0 0 20 20">
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  minusCircle: (): ReactElement => (
    <svg width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9.5" fill="#ff3b30" />
      <path d="M6.8 11h8.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  calendarPlus: (size = 19, color = '#007aff'): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 26 26">
      <rect x="3.5" y="5" width="19" height="17.5" rx="5" fill="none" stroke={color} strokeWidth="1.9" />
      <path d="M8.5 2.8v4M17.5 2.8v4M3.5 10h19" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.5 16.5h7M13 13v7" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  people: (): ReactElement => (
    <svg width="18" height="18" viewBox="0 0 20 20">
      <circle cx="7" cy="6.5" r="2.6" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M2.5 15.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 5.2a2.4 2.4 0 0 1 0 4.6M14.5 15.5c0-2.2-1.2-3.6-3-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  personPlus: (): ReactElement => (
    <svg width="19" height="19" viewBox="0 0 20 20">
      <circle cx="8" cy="6.3" r="2.8" fill="none" stroke="#007aff" strokeWidth="1.7" />
      <path d="M2.8 16c0-2.6 2.2-4.3 5.2-4.3 0.9 0 1.8.2 2.5.5" fill="none" stroke="#007aff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15 11.5v5.2M12.4 14.1h5.2" stroke="#007aff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  // Флажок «о госте есть заметка» в строке заявки — рисуется мелко, поэтому
  // внутри только две строки текста: три на 13px сливаются в пятно.
  note: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="3.2" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 6.5h5M5.5 9.4h3.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  /** Рубль — раздел резидентских взносов. */
  rub: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path d="M6.6 3.6h3.5a3.1 3.1 0 0 1 0 6.2H6.6V3.6zM6.6 3.6v10.8M4.4 12.2h6" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** Треугольник с восклицательным знаком — месяц просрочки. */
  warnTriangle: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <path d="M7 1.9l5.4 9.3H1.6L7 1.9z" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 5.6v2.4M7 9.9h.01" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  /** Восьмиугольник «стоп» — второй месяц просрочки, крайний срок. */
  stopSign: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <path d="M4.9 1.4h4.2l3.5 3.5v4.2l-3.5 3.5H4.9L1.4 9.1V4.9L4.9 1.4z" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 4.4v3M7 9.6h.01" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  /** Ценник — персональная ставка взноса. */
  tag: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M10.2 2.4H16a1.6 1.6 0 0 1 1.6 1.6v5.8a1.6 1.6 0 0 1-.5 1.1l-6 6a1.6 1.6 0 0 1-2.2 0l-5.4-5.4a1.6 1.6 0 0 1 0-2.2l6-6a1.6 1.6 0 0 1 1.1-.5z" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="13.4" cy="6.6" r="1.3" fill={color} />
    </svg>
  ),
  /** Стрелка назад по дуге — снять отметку. */
  undo: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M4.5 9.5A5.8 5.8 0 1 1 10 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.4 5.4v4.3h4.3" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** Лист со стрелкой вниз — выгрузка таблицы. */
  doc: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path d="M4.5 2.6h5.2l4 4v9a1.4 1.4 0 0 1-1.4 1.4H4.5A1.4 1.4 0 0 1 3.1 15.6V4A1.4 1.4 0 0 1 4.5 2.6z" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8.2v4.4M7 10.8l2 1.9 2-1.9" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** Запрет («заблокировать») — кружок с косой чертой. */
  ban: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.2" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M5 5l10 10" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  /** Булавка на карте — метка адреса. */
  pin: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M10 18s6-6.1 6-10.2A6 6 0 004 7.8C4 11.9 10 18 10 18z" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="10" cy="7.7" r="2.1" fill={color} />
    </svg>
  ),
  /** Две наложенные рамки — «скопировать». */
  copy: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <rect x="4.5" y="1.5" width="8" height="8" rx="2" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M9.5 12.5h-6a2 2 0 01-2-2v-6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  /** Стрелка наружу — «открыть во внешнем приложении». */
  external: (color = '#007aff'): ReactElement => (
    <svg width="17" height="17" viewBox="0 0 18 18">
      <path d="M3 15L15 3M8 3h7v7" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** Заливная булавка поверх карты — крупнее и с белой обводкой, чтобы читалась на тайлах. */
  mapPin: (): ReactElement => (
    <svg width="30" height="38" viewBox="0 0 30 38">
      <path d="M15 37c0-9 11-13.5 11-22A11 11 0 004 15c0 8.5 11 13 11 22z" fill="#007aff" stroke="#fff" strokeWidth="2" />
      <circle cx="15" cy="14.5" r="4" fill="#fff" />
    </svg>
  ),
  /** Минус в круглой кнопке шага времени — пара к `plusSmall`. */
  minus: (): ReactElement => (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path d="M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  /** Календарь — метка ивента. Цвет задаётся вызывающим: у ивентов он фиолетовый. */
  calendar: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <rect x="2.8" y="3.6" width="12.4" height="11.6" rx="2.6" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M2.8 7.4h12.4M6.2 1.8v3M11.8 1.8v3" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  /** Облачко реплики — вход в чат спейса. */
  chat: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path d="M15.2 8.4c0 3.1-2.8 5.6-6.2 5.6-.8 0-1.6-.1-2.3-.4l-3.4 1.1 1.1-2.7A5.3 5.3 0 012.8 8.4C2.8 5.3 5.6 2.8 9 2.8s6.2 2.5 6.2 5.6z" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  /** Крестик («закрыть заявку») — без кружка, чтобы не путался с `ban`. */
  xmark: (size: number, color: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  pencil: (): ReactElement => (
    <svg width="17" height="17" viewBox="0 0 20 20">
      <path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" fill="none" stroke="#007aff" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  github: (size = 13, color?: string): ReactElement => (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path
        fill={color || sec(0.5)}
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  ),
}
