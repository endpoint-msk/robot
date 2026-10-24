import { useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { markOwnTap } from '../motion'
import { heroSupported } from '../hero'
import { replaceTop, resetRoot, setData, useParams, useStore } from '../store'
import { botCanWrite, haptic, requestWriteAccess } from '../telegram'
import type { Bootstrap, ReminderChoice } from '../types'
import { ActionButton, BackRow, BottomBar, Header, SectionTitle, Sep, Switch } from '../components/common'
import { Crossfade } from '../components/Crossfade'
import {
  DayChips,
  DayChipsLegend,
  SelectedDayInfo,
  firstOpenDay,
  isPastForToday,
  PurposeInput,
  REMINDER_LABELS,
  REMINDER_ORDER,
  reminderAvailable,
  reminderFor,
  reminderWhen,
  useDayTime,
} from '../components/forms'
import { MenuItems, useRowMenu } from '../components/RowMenu'
import { Screen } from '../components/Screen'
import { TimeRow } from '../components/TimeField'

type RemindValue = ReminderChoice | 'off'

/**
 * Напоминание строкой с меню, как «Новые заявки» в настройках: срок справа, момент,
 * когда напишет бот, под названием. Тумблер и пять чипов говорили то же самое. Меню
 * лежит над карточкой, а не в ней: карточка обрезает всё, что выходит за её край.
 */
export function useRemind(
  dateKey: string,
  time: string,
  choice: ReminderChoice | null,
  onChange: (c: ReminderChoice | null) => void,
  sent = false,
) {
  const menu = useRowMenu<'remind'>()
  const available = REMINDER_ORDER.filter((c) => reminderAvailable(dateKey, time, c))
  // Срок мог перестать успевать, когда гость сдвинул слот: тогда на сервер уйдёт null.
  const active = !sent && choice !== null && available.includes(choice) ? choice : null
  const none = available.length === 0
  const row = (
    <div className="row">
      <span className="row-label">
        Напомнить
        <span className="row-sublabel">
          {sent
            ? 'Напоминание уже отправлено'
            : none
              ? 'До визита слишком мало времени'
              : active
                ? `Бот напишет ${reminderWhen(dateKey, time, active)}`
                : 'Бот напишет в личку перед визитом'}
        </span>
      </span>
      <button
        type="button"
        className="ob-popup"
        aria-haspopup="menu"
        aria-expanded={menu.openFor === 'remind'}
        disabled={none || sent}
        onClick={(e) => menu.open('remind', e.currentTarget)}
      >
        {active ? REMINDER_LABELS[active] : 'Нет'}
        {icons.updown()}
      </button>
    </div>
  )
  const items = (
    <MenuItems<RemindValue>
      open={menu.openFor === 'remind'}
      place={menu.place}
      items={[
        ...REMINDER_ORDER.map((c) => ({ value: c as RemindValue, label: REMINDER_LABELS[c], off: !available.includes(c) })),
        { value: 'off', label: 'Не напоминать' },
      ]}
      value={active ?? 'off'}
      gapBefore="off"
      onPick={(v) => {
        menu.close()
        onChange(v === 'off' ? null : v)
      }}
    />
  )
  return { row, items, hostRef: menu.hostRef }
}

export function NewRequest() {
  const { data } = useStore()
  const params = useParams()
  const days = data!.days
  // Закрытый день в чипах не выбрать — предвыбранным он оставил бы форму в состоянии,
  // из которого заявку не отправить. Пришли с ивента: день и время уже его.
  const asked = days.find((d) => d.dateKey === params.dateKey && !d.lock)
  const askedTime = asked && typeof params.time === 'string' && !isPastForToday(asked.dateKey, params.time) ? params.time : null
  const { day, time, min, selectDay, onTimeChange } = useDayTime(asked ? asked.dateKey : firstOpenDay(days), askedTime)
  const locked = days.find((d) => d.dateKey === day)?.lock ?? null
  const [purpose, setPurpose] = useState('')
  const [anon, setAnon] = useState(false)
  // Напоминание предлагается включённым: выключенное по умолчанию им бы почти никто
  // не воспользовался, а именно оно и уменьшает «забыл про заявку».
  const [remind, setRemind] = useState<ReminderChoice | null>('h2')
  // Заявка ушла: форма гаснет и уступает место карточке визита (см. visit-rise).
  const [leaving, setLeaving] = useState(false)
  const remindUi = useRemind(day, time, remind, setRemind)

  const submit = async (): Promise<void> => {
    if (locked) {
      showAlert('В этот день спейс закрыт для гостей — выберите другой.')
      return
    }
    if (!time) {
      showAlert('Укажите время прихода.')
      return
    }
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выберите время позже текущего.')
      return
    }
    haptic.impact('medium')
    try {
      // Если гость открыл миниапп из чата без /start, бот не сможет прислать ему ответ
      // резидента в личку — до создания заявки просим доступ нативной плашкой Telegram.
      if (!botCanWrite()) await requestWriteAccess()
      const boot = await api<Bootstrap>('create', { dateKey: day, time, purpose, anon, remind: reminderFor(day, time, remind) })
      setData(boot)
      haptic.notify('success')
      // Форма становится созданным визитом на месте, а не уходит в корень: там сразу
      // написано «ждёт ответа» и что бот напишет в личку. «Назад» ведёт туда, откуда
      // форму открыли.
      const created = boot.myRequests.find((x) => x.dateKey === day && x.time === time)
      markOwnTap()
      // С переходом кнопка сама вырастает в карточку статуса визита, а форма гаснет под ней;
      // без него форма сначала гаснет, и визит поднимается на её месте.
      if (created && heroSupported()) {
        replaceTop('visit', { id: created.id, fresh: 1 }, 'cta')
        return
      }
      setLeaving(true)
      await new Promise((r) => setTimeout(r, 300))
      if (created) replaceTop('visit', { id: created.id, fresh: 1 })
      else resetRoot()
    } catch (err) {
      showAlert((err as Error).message)
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow />
      <div className={'nr-form' + (leaving ? ' leaving' : '')}>
        <Header title="Хочу прийти" />
        <SectionTitle>День</SectionTitle>
        <DayChips
          days={days}
          selected={day}
          onSelect={(k) => {
            if (k !== day) haptic.tick()
            markOwnTap()
            selectDay(k)
          }}
        />
        <Crossfade id={day}>
          <SelectedDayInfo days={days} selected={day} />
        </Crossfade>
        <DayChipsLegend days={days} />
        <SectionTitle>Детали</SectionTitle>
        {/* Всё про визит одной карточкой: время, напоминание, видимость и цель. */}
        <div className="nt-host" ref={remindUi.hostRef}>
          <div className="card">
            <TimeRow label="Приду к" value={time} min={min} onChange={onTimeChange} />
            <Sep left={14} />
            {remindUi.row}
            <Sep left={14} />
            <div className="row">
              <span className="row-label">Не показывать другим гостям</span>
              <Switch on={anon} onToggle={() => setAnon(!anon)} label="Не показывать другим гостям" />
            </div>
            <Sep left={14} />
            <div className="kv-block">
              <PurposeInput value={purpose} onChange={setPurpose} />
            </div>
          </div>
          {remindUi.items}
        </div>
        {/* Про кнопку «Я на месте» говорим заранее: в момент, когда гость стоит у двери,
            читать инструкции поздно, а сама кнопка появится только в день визита. */}
        <div className="hint-card">
          <div className="hint-icon">{icons.pin(17, '#34c759')}</div>
          <div className="hint-text">
            Когда доберётесь до спейса, откройте свой визит и нажмите «Я на месте» - резиденты
            поймут, что нужно открыть.
          </div>
        </div>
      </div>
      <BottomBar>
        <ActionButton className={'primary-btn' + (leaving ? ' nr-sent' : '')} disabled={leaving} onClick={submit} hero="cta">
          Отправить заявку
        </ActionButton>
      </BottomBar>
    </Screen>
  )
}
