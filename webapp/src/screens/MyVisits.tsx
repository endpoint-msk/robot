import { Fragment } from 'react'
import { fmtDayMonth, fmtShortDate, fmtWeekdayDate, plural, visitDayWord } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { bump, push, startNewRequest, useStore } from '../store'
import { accent, sec } from '../theme'
import { botCanWrite, haptic, openUrl, requestWriteAccess } from '../telegram'
import type { HostingRequest } from '../types'
import { BottomBar, DevChips, EmptyState, Header, SectionTitle, Sep } from '../components/common'
import { userLabel } from '../components/people'
import { growIn } from '../dust'
import { Screen } from '../components/Screen'

// Публичный чат спейса — константа фронта, как адрес в «Как пройти»: это конкретный
// чат, а не настройка. openUrl отдаёт t.me клиенту Telegram (openTelegramLink).
const SPACE_CHAT_URL = 'https://t.me/endpointchat'

function VisitRow({ r }: { r: HostingRequest }) {
  const { data } = useStore()
  const approved = r.status === 'approved'
  const p = r.proposal
  // Резидент предложил новый слот — ход за гостем: строка явно зовёт к действию.
  const needsAnswer = Boolean(p && p.by === 'resident')
  // Слот предложения с днём, если предложенный день отличается от дня заявки.
  const pSlot = p ? (p.dateKey !== r.dateKey ? `${fmtShortDate(p.dateKey)} · ${p.time}` : p.time) : ''
  // Часы показывают время, о котором речь: предложенное, если оно висит, иначе заявки.
  const iconSquare = needsAnswer ? (
    <div className="status-square attn">{icons.clock(18, accent(), p!.time)}</div>
  ) : approved ? (
    <div className="status-square ok">{icons.check(20, '#34c759')}</div>
  ) : (
    <div className="status-square">{icons.clock(18, sec(0.5), p ? p.time : r.time)}</div>
  )

  // Хост - словом в подписи, как у прошедших визитов: пилл справа забирает ширину у
  // даты, и на узком экране от неё остаётся «Четверг, 22…».
  let subText: string
  if (needsAnswer) subText = `Резидент предлагает ${pSlot} — нужен ответ`
  else if (p && p.by === 'guest') subText = `вы предложили ${pSlot} · ждём${approved ? ' хоста' : ''}`
  else if (approved) subText = nb(`к ${r.time} · ${r.approvedBy ? `хостит ${userLabel(r.approvedBy)}` : 'подтверждён'}`)
  else subText = nb(`к ${r.time} · ждём резидента`)

  return (
    <button
      type="button"
      className={'row tappable' + (needsAnswer ? ' needs-action' : '')}
      data-dust={'visit-' + r.id}
      onClick={() => push('visit', { id: r.id })}
    >
      {iconSquare}
      <div className="req-main">
        <div className="req-name">
          {`${visitDayWord(r.dateKey, data!.todayKey)}, ${fmtDayMonth(r.dateKey)}`}
        </div>
        <div className={'req-sub' + (needsAnswer ? ' attn' : '')}>{subText}
        </div>
      </div>
      <div className="row-right">{icons.chevron()}</div>
    </button>
  )
}

/** Плашка «бот не может писать вам»: видна, пока доступа нет; тап зовёт нативный
    запрос Telegram, после выдачи доступа плашка пропадает. */
function WriteAccessBanner() {
  if (botCanWrite()) return null
  return (
    <button
      type="button"
      className="write-banner"
      onClick={async () => {
        const ok = await requestWriteAccess()
        if (ok) {
          haptic.notify('success')
          bump()
        }
      }}
    >
      <div className="wb-icon">{icons.bell()}</div>
      <div className="wb-text">
        <div className="wb-title">Бот не может писать вам</div>
        <div className="wb-sub">Разрешите, чтобы получать ответы на заявки</div>
      </div>
      {icons.chevron()}
    </button>
  )
}

/**
 * Прошедший визит: та же строка, но приглушённая и без статуса - это архив, а не
 * состояние, за которым надо следить. Отсюда серая галочка вместо зелёной. Неявку,
 * отмеченную резидентом, гость видит: это его собственная история.
 */
function PastVisitRow({ r }: { r: HostingRequest }) {
  const host = r.approvedBy
  const missed = r.visit?.status === 'missed'
  return (
    <button type="button" className="row tappable" onClick={() => push('visit', { id: r.id })}>
      <div className="status-square">{missed ? icons.xmark(15, sec(0.4)) : icons.check(20, sec(0.4))}</div>
      <div className="req-main">
        <div className="req-name past">
          {fmtWeekdayDate(r.dateKey)}
        </div>
        <div className="req-sub">{nb(`к ${r.time}`) + (missed ? ' · неявка' : host ? ` · хостил ${userLabel(host)}` : '')}
        </div>
      </div>
      <div className="row-right">{icons.chevron()}</div>
    </button>
  )
}

function VisitList({ list, past = false }: { list: HostingRequest[]; past?: boolean }) {
  return (
    <div className="card">
      {list.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 ? <Sep inset="avatar" /> : null}
          {past ? <PastVisitRow r={r} /> : <VisitRow r={r} />}
        </Fragment>
      ))}
    </div>
  )
}

export function MyVisits() {
  const { data } = useStore()
  const my = data!.myRequests
  const past = data!.myPast ?? []
  const tally = data!.myVisits ?? { visits: 0 }
  const approved = my.filter((r) => r.status === 'approved')
  const pending = my.filter((r) => r.status !== 'approved')

  return (
    <Screen hasBottomBar>
      <Header title="Мои визиты" chip={<DevChips />} />
      <WriteAccessBanner />
      {my.length === 0 && past.length === 0 ? (
        <div className="card" ref={growIn} data-dust-empty="">
          <EmptyState
            title="Пока нет заявок"
            text="Выберите день и время визита — резиденты увидят заявку и откликнутся."
          />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>Одобрены</SectionTitle>
          <VisitList list={approved} />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>Ждут ответа</SectionTitle>
          <VisitList list={pending} />
        </>
      ) : null}
      {past.length > 0 || tally.visits > 0 ? (
        <>
          <SectionTitle>Были раньше</SectionTitle>
          {past.length > 0 ? <VisitList list={past} past /> : null}
          {/* В списке только последние визиты, а счёт - за всё время, вместе с визитами
              без заявки, которые отметили резиденты. */}
          {tally.visits > 0 ? (
            <div className="visits-tally">{nb(`Вы были в спейсе ${tally.visits} ${plural(tally.visits, 'раз', 'раза', 'раз')}`)}</div>
          ) : null}
        </>
      ) : null}
      {/* Разделы - плитками, а не строками со стрелками: под визитами такой список
          выглядит экраном настроек, а это места, куда с главной уходят. */}
      <div className="home-tiles">
        <button type="button" className="home-tile" onClick={() => push('route')}>
          <div className="row-icon" style={{ background: 'var(--blue)' }}>
            {icons.pin(17, '#fff')}
          </div>
          <span className="home-tile-label">Как пройти</span>
        </button>
        <button type="button" className="home-tile" onClick={() => push('peek')}>
          {/* Календарь и фиолетовый - те же, что у ивентов: за этой плиткой не только
              список людей, но и то, что в спейсе происходит. */}
          <div className="row-icon" style={{ background: 'var(--purple)' }}>
            {icons.calendar(17, '#fff')}
          </div>
          <span className="home-tile-label">Активность</span>
        </button>
        <button type="button" className="home-tile" onClick={() => openUrl(SPACE_CHAT_URL)}>
          <div className="row-icon" style={{ background: 'var(--green)' }}>
            {icons.chat(17, '#fff')}
          </div>
          <span className="home-tile-label">Чат спейса</span>
        </button>
        <button type="button" className="home-tile" onClick={() => push('settings')}>
          <div className="row-icon" style={{ background: 'var(--gray)' }}>
            {icons.gear()}
          </div>
          <span className="home-tile-label">Настройки</span>
        </button>
      </div>
      <BottomBar>
        {/* Одна кнопка на весь путь заявки: в форме она меняет подпись на месте, после
            отправки вырастает в карточку статуса визита (hero.ts, ключ cta). */}
        <button className="primary-btn" data-hero="cta" data-hero-part="cta" onClick={() => startNewRequest()}>
          <span className="cta-label" data-hero-part="cta-label">
            {icons.plus()}
            Новая заявка
          </span>
        </button>
      </BottomBar>
    </Screen>
  )
}
