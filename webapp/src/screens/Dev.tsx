import { tr } from '../i18n'
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
import { TimeField } from '../components/TimeField'

/**
 * Код домофона. Живёт в стейте бота, а не в коде: репозиторий публичный. Пустой
 * код снимает строку с главной и кнопку из меню бота.
 */
function DoorSection() {
  const { data } = useStore()
  const door = data!.door ?? null
  const [code, setCode] = useState(door?.code ?? '')
  const [note, setNote] = useState(door?.note ?? '')
  const dirty = code.replace(/\s+/g, '').toUpperCase() !== (door?.code ?? '') || note.trim() !== (door?.note ?? '')

  const save = async (nextCode: string, nextNote: string): Promise<void> => {
    const res = await action('door.set', { code: nextCode, note: nextNote })
    if (!res) return
    haptic.notify('success')
    setCode(res.door?.code ?? '')
    setNote(res.door?.note ?? '')
  }

  return (
    <>
      <SectionTitle>{tr('Домофон', 'Intercom')}</SectionTitle>
      <div className="card">
        <div className="row">
          <input
            className="text-input mono"
            placeholder={tr('Код с панели', 'Entry code')}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Sep inset="text" />
        <div className="row">
          <input
            className="text-input"
            placeholder={tr('Подсказка: подъезд, панель', 'Hint: entrance or keypad')}
            autoComplete="off"
            maxLength={60}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="inline-form-actions">
          <button className="small-btn blue" disabled={!dirty} onClick={() => void save(code, note)}>
            {tr('Сохранить', 'Save')}
          </button>
          {door ? (
            <button
              className="small-btn gray"
              onClick={async () => {
                const ok = await confirmDialog(tr('Убрать код домофона? Строка пропадёт с главной и из меню бота.', 'Remove the entry code? It will disappear from the home screen and the bot menu.'), {
                  confirmLabel: tr('Убрать код', 'Remove code'),
                  cancelLabel: tr('Оставить', 'Keep'),
                  destructive: true,
                })
                if (ok) await save('', '')
              }}
            >
              {tr('Убрать', 'Remove')}
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}

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
      showAlert(tr('Укажите время.', 'Choose a time.'))
      return
    }
    const res = await action('dev.seed', { dateKey: selected, time, purpose })
    if (res) {
      haptic.notify('success')
      setPurpose('')
    }
  }

  // Все заявки ближайших 7 дней: правка и удаление (dev получает days[].requests).
  const all = days.flatMap((d) => d.requests || [])
  const blocked = data!.blocked || []

  return (
    <Screen hasBottomBar>
      <BackRow />
      <Header title="Dev" subtitle={tr('Тестовые данные - резиденты не будут уведомлены', "Test data – residents won't be notified")} />
      <SectionTitle>{tr('Резиденты', 'Residents')}</SectionTitle>
      <div className="card">
        <button type="button" className="row tappable" onClick={() => push('residents')}>
          <span className="row-label">
            {tr('Резиденты', 'Residents')}
            <span className="row-sublabel">{tr('Выдать админку в чатах и тег «resident»', 'Manage chat admins and the “resident” tag')}</span>
          </span>
          {icons.chevron()}
        </button>
      </div>
      <SectionTitle>{tr('Рассылка', 'Broadcast')}</SectionTitle>
      <div className="card">
        <button type="button" className="row tappable" onClick={() => push('announce')}>
          <span className="row-label">
            {tr('Анонс новой версии', 'Release announcement')}
            <span className="row-sublabel">{tr('Разослать обновление или объявление в чаты', 'Send an update or announcement to chats')}</span>
          </span>
          {icons.chevron()}
        </button>
      </div>
      <DoorSection />
      <SectionTitle>{tr('День', 'Day')}</SectionTitle>
      <DayChips days={days} selected={selected} onSelect={setSelected} />
      <SectionTitle>{tr('Детали', 'Details')}</SectionTitle>
      <div className="card">
        <div className="row time-row">
          <span style={{ fontSize: 16 }}>{tr('Придёт к', 'Arrival time')}</span>
          <TimeField value={time} onChange={setTime} />
        </div>
        <Sep inset="text" />
        <div className="kv-block">
          <textarea
            className="purpose-input"
            placeholder={tr('Цель визита (по умолчанию — «Фейковая заявка (dev)»)', 'Purpose of visit (defaults to “Test request (dev)”)')}
            rows={2}
            maxLength={300}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
      </div>
      <SectionTitle>{tr('Все заявки', 'All requests')}</SectionTitle>
      <div className="card">
        {all.length === 0 ? (
          <EmptyState title={tr('Заявок нет', 'No requests')} text={tr('Создайте фейковую — появится здесь.', 'Create a test request and it will appear here.')} />
        ) : (
          all.map((r, i) => (
            <Fragment key={r.id}>
              {i > 0 ? <Sep inset="text" /> : null}
              <div className="row tappable" onClick={() => push('devEdit', { id: r.id })}>
                <span className="row-label">
                  {r.guest.name}
                  <span className="row-sublabel">
                    {`${fmtShortDate(r.dateKey)} · ${r.time}${r.status === 'approved' ? tr(' · одобрена', ' · approved') : ''}`}
                  </span>
                </span>
                <button
                  className="remove-btn"
                  aria-label={tr('Удалить заявку', 'Delete request')}
                  onClick={async (e) => {
                    e.stopPropagation() // иначе откроется правка
                    const ok = await confirmDialog(tr('Удалить заявку?', 'Delete this request?'), {
                      confirmLabel: tr('Удалить заявку', 'Delete request'),
                      cancelLabel: tr('Оставить', 'Keep'),
                      destructive: true,
                      subject: { user: r.guest, line: tr(`${fmtShortDate(r.dateKey)} к\u00a0${r.time}`, `${fmtShortDate(r.dateKey)} at ${r.time}`) },
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
      <SectionTitle>{tr('Заблокированные', 'Blocked users')}</SectionTitle>
      <div className="card">
        {blocked.length === 0 ? (
          <EmptyState title={tr('Никто не заблокирован', 'Nobody is blocked')} text={tr('Резидент может заблокировать гостя из его заявки.', 'Residents can block guests from their visit requests.')} />
        ) : (
          blocked.map((b, i) => (
            <Fragment key={b.userId}>
              {i > 0 ? <Sep inset="text" /> : null}
              <div className="row">
                <span className="row-label">
                  {b.name}
                  <span className="row-sublabel">
                    {(b.username ? '@' + b.username + ' · ' : '') + tr('заблокировал ', 'blocked by ') + b.by.name}
                  </span>
                </span>
                <button
                  className="small-btn gray"
                  onClick={async () => {
                    const ok = await confirmDialog(tr('Разблокировать? Бот снимет бан во всех чатах.', 'Unblock this user? The bot will lift the ban in all chats.'), {
                      confirmLabel: tr('Разблокировать', 'Unblock'),
                      cancelLabel: tr('Оставить блокировку', 'Keep blocked'),
                      subject: { user: b, line: b.username ? '@' + b.username : undefined },
                    })
                    if (ok) {
                      const res = await action('unblock', { userId: b.userId })
                      if (res) haptic.notify('success')
                    }
                  }}
                >
                  {tr('Разблокировать', 'Unblock')}
                </button>
              </div>
            </Fragment>
          ))
        )}
      </div>
      <BottomBar>
        <button className="primary-btn" onClick={submit}>
          {tr('Создать фейковую заявку', 'Create test request')}
        </button>
        <div className="bar-hint">{tr('Заявка от случайного фейкового гостя', 'Request from a random test guest')}</div>
      </BottomBar>
    </Screen>
  )
}
