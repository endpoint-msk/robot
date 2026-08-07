// Правила спейса перед первой заявкой на визит. Показывается один раз (см.
// me.acceptedRules и startNewRequest); сервер тоже не даст создать заявку без согласия.

import { useState } from 'react'
import { action } from '../api'
import { icons } from '../icons'
import { pop, push, useStore } from '../store'
import { haptic } from '../telegram'
import { BackRow, BottomBar, Header, Sep } from '../components/common'
import { Screen } from '../components/Screen'

const RULES = [
  'Ведите себя адекватно',
  'Не трогайте чужие вещи без прямого согласия резидента или владельца',
  'Не рушьте духовный порядок места — если вы чем-то воспользовались, верните на место',
]

export function Rules() {
  const { data } = useStore()
  const [agreed, setAgreed] = useState(data!.me.acceptedRules)

  const submit = async (): Promise<void> => {
    const done = await action('rules.accept')
    if (!done) return
    haptic('success')
    // Экран правил из стека убираем: назад с формы заявки надо возвращаться к визитам.
    pop()
    push('newRequest')
  }

  return (
    <Screen hasBottomBar>
      <BackRow label="Мои визиты" />
      <Header title="Правила спейса" subtitle="Прочитайте перед первой заявкой" />
      <div className="rules-intro">Вы собираетесь подать заявку на хостинг в endpoint. Основные правила сообщества:</div>
      <div className="card">
        {RULES.map((text, i) => (
          <div key={text}>
            {i > 0 ? <Sep left={52} /> : null}
            <div className="row rule-row">
              <div className="rule-num">{String(i + 1)}</div>
              <span className="rule-text">{text}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 22 }} />
      <div className="card">
        <button
          type="button"
          className="row tappable"
          role="checkbox"
          aria-checked={agreed}
          onClick={() => setAgreed((v) => !v)}
        >
          <span className="row-label rule-agree">Я прочитал и согласен с правилами</span>
          <div className={'checkbox' + (agreed ? ' on' : '')}>{agreed ? icons.check(13, '#fff', 2.6) : null}</div>
        </button>
      </div>
      <BottomBar>
        <button className="primary-btn" disabled={!agreed} onClick={submit}>
          Согласиться и продолжить
        </button>
      </BottomBar>
    </Screen>
  )
}
