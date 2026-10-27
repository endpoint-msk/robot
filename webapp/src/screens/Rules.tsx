// Правила спейса перед первой заявкой на визит: листом поверх уже открытой формы, один раз
// (см. me.acceptedRules). Согласие - сама кнопка, а сервер всё равно не даст создать заявку
// без него (403 rules_required).

import { Fragment, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { action } from '../api'
import { icons } from '../icons'
import { sheetPrompt, type SheetBodyProps } from '../modals'
import { reducedMotion } from '../motion'
import { openUrl } from '../telegram'
import { ActionButton, Sep } from '../components/common'

const WIKI_URL = 'https://wiki.endpoint.moscow/s/public/doc/pravila-i-principy-soobshestva-oA7WZg3nWS'

const ruleIcon = {
  request: (
    <svg width="17" height="17" viewBox="0 0 18 18">
      <rect x="2.8" y="3.6" width="12.4" height="11.6" rx="2.6" fill="none" stroke="#fff" strokeWidth="1.7" />
      <path d="M2.8 7.4h12.4M6.2 1.8v3M11.8 1.8v3" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.4 11.3l1.7 1.6 3.4-3.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  smile: (
    <svg width="18" height="18" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.6" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="7.5" cy="8.1" r="1.2" fill="#fff" />
      <circle cx="12.5" cy="8.1" r="1.2" fill="#fff" />
      <path d="M6.6 11.5c.8 1.6 2 2.4 3.4 2.4s2.6-.8 3.4-2.4" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  box: (
    <svg width="18" height="18" viewBox="0 0 20 20">
      <path d="M10 2.6l6.4 3.4v8L10 17.4 3.6 14V6z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3.6 6 10 9.4 16.4 6M10 9.4v8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
}

const RULES: { text: string; tone: string; icon: ReactElement }[] = [
  { text: 'Не приходите без одобренной заявки', tone: 'green', icon: ruleIcon.request },
  { text: 'Ведите себя адекватно', tone: 'blue', icon: ruleIcon.smile },
  { text: 'Не трогайте чужие вещи без прямого согласия резидента или владельца', tone: 'orange', icon: ruleIcon.box },
  {
    text: 'Не рушьте духовный порядок места: если вы чем-то воспользовались, верните на место',
    tone: 'purple',
    icon: icons.undo(18, '#fff'),
  },
]

/** Галочки встают сверху вниз через столько мс одна за другой; последняя доходит за TICK_MS. */
const TICK_STEP_MS = 110
const TICK_MS = 300

function RulesSheet({ done }: SheetBodyProps<boolean>) {
  const [ticked, setTicked] = useState(false)
  // Согласие записано, лист вот-вот уйдёт: повторный тап по кнопке ничего не шлёт.
  const accepted = useRef(false)
  // Значки по очереди становятся зелёными галочками, пока идёт ответ сервера: видно, с чем
  // согласились. Лист уходит, когда пришёл ответ и встала последняя галочка; кнопка ждёт
  // только сервера, иначе крутилка изображала бы сеть, пока доигрывают галочки. Отказ
  // возвращает значки и ложится алертом в тот же лист, согласиться можно ещё раз.
  const accept = async (): Promise<void> => {
    if (accepted.current) return
    const still = reducedMotion()
    if (!still) setTicked(true)
    const shown = new Promise((r) => setTimeout(r, still ? 0 : (RULES.length - 1) * TICK_STEP_MS + TICK_MS))
    if (!(await action('rules.accept', {}, { quiet: true }))) {
      setTicked(false)
      return
    }
    accepted.current = true
    void (async () => {
      await shown
      done(true)
    })()
  }
  return (
    <>
      <div className="rules-head">
        <div className="rules-title">Правила спейса</div>
        <div className="rules-sub">Прочитайте перед первой заявкой</div>
      </div>
      <div className={'card rules-list' + (ticked ? ' ticked' : '')}>
        {RULES.map((r, i) => (
          <Fragment key={r.text}>
            {i > 0 ? <Sep inset="icon" /> : null}
            <div className="row rule-row">
              <div className="row-icon rule-icon" style={{ background: `var(--rule-ok, var(--${r.tone}))`, '--i': i } as CSSProperties}>
                <span className="ri-mark">{r.icon}</span>
                <span className="ri-ok" aria-hidden="true">
                  {icons.check(16, '#fff', 2.4)}
                </span>
              </div>
              <span className="rule-text">{r.text}</span>
            </div>
          </Fragment>
        ))}
      </div>
      <div className="card rules-wiki">
        <button type="button" className="row tappable" onClick={() => openUrl(WIKI_URL)}>
          <span className="row-label">Все правила на вики</span>
          <div className="row-right">{icons.external()}</div>
        </button>
      </div>
      <div className="card modal-actions">
        <ActionButton className="modal-btn primary" onClick={accept}>
          Принимаю правила
        </ActionButton>
      </div>
    </>
  )
}

/** true - правила приняты и сервер это записал; false - лист смахнули, заявку не подаём. */
export const askRules = async (): Promise<boolean> => (await sheetPrompt<boolean>(RulesSheet)) === true
