// Заглушки на время загрузки. Не спиннер: у каждого экрана свой каркас, и пустой
// круг посреди пустоты не говорит, чего ждать, а после ответа сервера содержимое
// прыгает. Скелет держит ту же раскладку, что и данные.
//
// Волна везде идёт по смыслу блока: по списку сверху вниз, по сетке — диагональю,
// по столбикам — слева направо. Одинаковое мигание всех элементов разом читается
// как сбой отрисовки, а не как ожидание.

import type { CSSProperties } from 'react'

/** Прямоугольник-заглушка: по нему бежит блик. */
export function SkBlock({ w, h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <i className="sk-block" style={{ width: w, height: h, ...style }} />
}

/** Крупная цифра с подписью — шапка карточки сводки. */
export function SkFigure({ big = 40 }: { big?: number }) {
  return (
    <div className="sk-figure">
      <SkBlock w={84} h={big} />
      <SkBlock w={150} h={15} />
    </div>
  )
}

/**
 * Карточка-список. `avatar` — кружок слева (люди), `tail` — значение справа.
 * Ширина второй строки убывает от строки к строке: одинаковые полоски читаются
 * как таблица, а не как текст.
 */
export function SkRows({
  count = 5,
  avatar = false,
  tail = false,
  card = true,
}: {
  count?: number
  avatar?: boolean
  tail?: boolean
  card?: boolean
}) {
  const rows = Array.from({ length: count }, (_, i) => (
    <div className="sk-row" key={i} style={{ animationDelay: `${i * 90}ms` }}>
      {avatar ? <i className="sk-block sk-avatar" /> : null}
      <div className="sk-lines">
        <SkBlock w={`${62 - (i % 3) * 9}%`} h={13} />
        <SkBlock w={`${40 - (i % 3) * 6}%`} h={11} />
      </div>
      {tail ? <SkBlock w={52} h={13} style={{ marginLeft: 'auto' }} /> : null}
    </div>
  ))
  return card ? <div className="card sk-list">{rows}</div> : <div className="sk-list">{rows}</div>
}

/** Сетка клеток: тепловая карта, точки визитов. Гребень идёт по диагонали. */
export function SkGrid({ rows = 7, cols = 12, gutter = false }: { rows?: number; cols?: number; gutter?: boolean }) {
  return (
    <div className="heat">
      {Array.from({ length: rows }, (_, r) => (
        <div className="heat-row" key={r}>
          {gutter ? <div className="heat-dow" /> : null}
          {Array.from({ length: cols }, (_, c) => (
            <i className="heat-cell sk-cell" key={c} style={{ animationDelay: `${(r + c) * 70}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Столбики графика: высота ходит волной слева направо. */
export function SkBars({ count = 9 }: { count?: number }) {
  return (
    <div className="sk-bars">
      {Array.from({ length: count }, (_, i) => (
        <i className="sk-col" key={i} style={{ animationDelay: `${i * 110}ms` }} />
      ))}
    </div>
  )
}

/** Четыре показателя сеткой 2×2 — карточка человека в журнале. */
export function SkQuad() {
  return (
    <div className="card stats-quad">
      {[0, 1].map((r) => (
        <div className="sq-row" key={r}>
          {[0, 1].map((c) => (
            <div className="sq-cell" key={c}>
              <SkBlock w={64} h={26} />
              <SkBlock w={92} h={12} style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Карточка с заголовком: общая обёртка для карты, графика и сетки показателей. */
export function SkCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card stats-card">
      <div className="stats-card-title">{title}</div>
      {children}
    </div>
  )
}
