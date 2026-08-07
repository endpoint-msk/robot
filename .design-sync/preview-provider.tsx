// Обёртка превью-карточек. Нужна по трём причинам, каждая — иначе пустая карточка:
//   • половина компонентов читает стор напрямую (`useStore().data!`) — сеем фикстуру
//     до первого рендера, на уровне модуля;
//   • `sec()` (цвета инлайновых SVG) берёт цвет из разрешённой темы — без applyTheme
//     иконки рисуются цветом светлой темы поверх любой подложки;
//     тема прибита к светлой намеренно: подложку карточки задаёт шаблон превью
//     (`body{background:#fff}`), и системная тёмная тема давала белый текст на
//     белом. Заодно скриншоты перестают зависеть от машины, где идёт прогон;
//   • BottomBar рендерится порталом в узел из BarContext — без узла он возвращает null.
//
// Модуль подмешивается в бандл через cfg.extraEntries, поэтому посев стора
// случается один раз на загрузку страницы карточки.

import { useState, type ReactNode } from 'react'
import { BarContext } from '../webapp/src/barContext'
import { AnimContext } from '../webapp/src/components/Screen'
import { setData } from '../webapp/src/store'
import { applyTheme } from '../webapp/src/theme'
import { dsFixture } from './fixture'

setData(dsFixture)
applyTheme('light')

/** Ширина и отступы как у экрана миниаппа: карточки должны читаться так же, как в приложении. */
export function DsPreview({ children }: { children: ReactNode }) {
  const [bar, setBar] = useState<HTMLElement | null>(null)
  return (
    <AnimContext.Provider value={null}>
      <BarContext.Provider value={bar}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div className="screen">{children}</div>
          <div ref={setBar} />
        </div>
      </BarContext.Provider>
    </AnimContext.Provider>
  )
}
