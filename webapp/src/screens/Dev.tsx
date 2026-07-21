import { Fragment, useState } from 'react'
import { action } from '../api'
import { fmtShortDate } from '../dates'
import { icons } from '../icons'
import { confirmDialog, showAlert } from '../modals'
import { push, useStore } from '../store'
import { haptic } from '../telegram'
import { BackRow, BottomBar, EmptyState, Header, SectionTitle, Sep } from '../components/common'
import { DayChips, defaultTimeFor } from '../components/forms'
import { Screen } from '../components/Screen'

// Dev-меню: сид фейковых заявок + правка/удаление любых заявок. Доступ только у
// DEV_USER_IDS (сервер проверяет сам, чип лишь прячет вход).
export function Dev() {
  const { data } = useStore()
  const days = data!.days
  const [selected, setSelected] = useState(days[0]!.dateKey)
  const [time, setTime] = useState(() => defaultTimeFor(days[0]!.dateKey))
  const [purpose, setPurpose] = useState('')

  const submit = async (): Promise<void> => {
    if (!time) {
      showAlert('Укажи время прихода.')
      return
    }
    const res = await action('dev.seed', { dateKey: selected, time, purpose })
    if (res) {
      haptic('success')
      setPurpose('')
    }
  }

  // Все заявки ближайших 7 дней: правка и удаление (dev получает days[].requests).
  const all = days.flatMap((d) => d.requests || [])
  const blocked = data!.blocked || []

  return (
    <Screen hasBottomBar>
      <BackRow label="Назад" />
      <Header title="Dev" subtitle="Тестовые данные - резиденты не будут уведомлены" />
      <SectionTitle>Рассылка</SectionTitle>
      <div className="card">
        <div className="row tappable" onClick={() => push('announce')}>
          <span className="row-label">
            Анонс новой версии
            <span className="row-sublabel">Разослать обновление или объявление в чаты</span>
          </span>
          {icons.chevron()}
        </div>
      </div>
      <SectionTitle>День</SectionTitle>
      <DayChips days={days} selected={selected} onSelect={setSelected} />
      <SectionTitle>Детали</SectionTitle>
      <div className="card">
        <div className="row" style={{ padding: '6px 14px' }}>
          <span style={{ fontSize: 16 }}>Придёт к</span>
          <input className="time-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <Sep left={14} />
        <div className="kv-block">
          <textarea
            className="purpose-input"
            placeholder="Цель визита (по умолчанию — «Фейковая заявка (dev)»)"
            rows={2}
            maxLength={300}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
      </div>
      <SectionTitle>Все заявки</SectionTitle>
      <div className="card">
        {all.length === 0 ? (
          <EmptyState title="Заявок нет" text="Создай фейковую — появится здесь." />
        ) : (
          all.map((r, i) => (
            <Fragment key={r.id}>
              {i > 0 ? <Sep left={14} /> : null}
              <div className="row tappable" onClick={() => push('devEdit', { id: r.id })}>
                <span className="row-label">
                  {r.guest.name}
                  <span className="row-sublabel">
                    {`${fmtShortDate(r.dateKey)} · ${r.time}${r.status === 'approved' ? ' · одобрена' : ''}`}
                  </span>
                </span>
                <button
                  className="remove-btn"
                  aria-label="Удалить заявку"
                  onClick={async (e) => {
                    e.stopPropagation() // иначе откроется правка
                    const ok = await confirmDialog(`Удалить заявку ${r.guest.name} на ${fmtShortDate(r.dateKey)}?`, {
                      confirmLabel: 'Удалить',
                      destructive: true,
                    })
                    if (ok) {
                      await action('dev.delete', { id: r.id })
                      // Старый экран пересоздавал textarea цели на каждый rerender —
                      // поле цели очищалось и после удаления, не только после сида.
                      setPurpose('')
                    }
                  }}
                >
                  {icons.minusCircle()}
                </button>
              </div>
            </Fragment>
          ))
        )}
      </div>
      <SectionTitle>Заблокированные</SectionTitle>
      <div className="card">
        {blocked.length === 0 ? (
          <EmptyState title="Никто не заблокирован" text="Резидент может заблокировать гостя из его заявки." />
        ) : (
          blocked.map((b, i) => (
            <Fragment key={b.userId}>
              {i > 0 ? <Sep left={14} /> : null}
              <div className="row">
                <span className="row-label">
                  {b.name}
                  <span className="row-sublabel">
                    {(b.username ? '@' + b.username + ' · ' : '') + 'заблокировал ' + b.by.name}
                  </span>
                </span>
                <button
                  className="small-btn gray"
                  onClick={async () => {
                    const ok = await confirmDialog(`Разблокировать ${b.name}? Бот снимет бан во всех чатах.`, {
                      confirmLabel: 'Разблокировать',
                    })
                    if (ok) {
                      const res = await action('unblock', { userId: b.userId })
                      if (res) haptic('success')
                    }
                  }}
                >
                  Разблокировать
                </button>
              </div>
            </Fragment>
          ))
        )}
      </div>
      <BottomBar>
        <button className="primary-btn" onClick={submit}>
          Создать фейковую заявку
        </button>
        <div className="bar-hint">Заявка от случайного фейкового гостя</div>
      </BottomBar>
    </Screen>
  )
}
