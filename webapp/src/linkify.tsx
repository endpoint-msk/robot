// Линкификация пользовательского текста (цель визита): ссылки и @юзернеймы —
// кликабельны. Пользовательские строки по-прежнему идут только через текстовые
// узлы React (никакого dangerouslySetInnerHTML).

import type { ReactNode } from 'react'
import { openUrl } from './telegram'

const LINK_RE = /(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?|@[a-z][a-z0-9_]{3,31})/gi
// Хвостовая пунктуация в ссылку не входит: «см. example.com/x.» → ссылка без точки.
const LINK_TRAIL_RE = /[.,;:!?)\]}»"'…]+$/

function LinkNode({ token }: { token: string }) {
  const url = token.startsWith('@')
    ? 'https://t.me/' + token.slice(1)
    : /^https?:/i.test(token)
      ? token
      : 'https://' + token
  return (
    <a
      className="linkified"
      href={url}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation() // строка/карточка вокруг может быть тапабельной
        openUrl(url)
      }}
    >
      {token}
    </a>
  )
}

export function linkedText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    let token = m[0]
    const trail = token.match(LINK_TRAIL_RE)
    if (trail) token = token.slice(0, -trail[0].length)
    if (!token) continue
    // Кусок слова — не ссылка: '@foo' после букв и домен после '@' — это почта.
    if (!/^https?:/i.test(token) && /[a-z0-9_@]/i.test(text.charAt(m.index - 1))) {
      LINK_RE.lastIndex = m.index + token.length
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<LinkNode key={'l' + key++} token={token} />)
    last = m.index + token.length
    LINK_RE.lastIndex = last
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
