import { plural, tr } from '../i18n'
import { Fragment } from 'react'
import { fmtDayMonth, fmtShortDate, fmtWeekdayDate, visitDayWord } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { bump, push, useStore } from '../store'
import { accent, sec } from '../theme'
import { botCanWrite, haptic, openUrl, requestWriteAccess } from '../telegram'
import type { HostingRequest } from '../types'
import { EmptyState, Header, SectionTitle, Sep } from '../components/common'
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
  if (needsAnswer) subText = tr(`Резидент предлагает ${pSlot} — нужен ответ`, `A resident suggested ${pSlot} · reply needed`)
  else if (p && p.by === 'guest') {
    const waiting = approved ? tr('ждём хоста', 'waiting for the host') : tr('ждём', 'waiting')
    subText = tr(`вы предложили ${pSlot} · ${waiting}`, `you suggested ${pSlot} · ${waiting}`)
  } else if (approved) {
    const host = r.approvedBy ? userLabel(r.approvedBy) : null
    const status = host ? tr(`хостит ${host}`, `hosted by ${host}`) : tr('подтверждён', 'confirmed')
    subText = nb(`${tr('к', 'at')} ${r.time} · ${status}`)
  } else subText = nb(tr(`к ${r.time} · ждём резидента`, `at ${r.time} · waiting for a resident`))

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
        <div className="wb-title">{tr('Бот не может писать вам', 'The bot can’t message you')}</div>
        <div className="wb-sub">{tr('Разрешите, чтобы получать ответы на заявки', 'Allow messages to receive replies to requests')}</div>
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
        <div className="req-sub">{nb(tr(`к ${r.time}`, `at ${r.time}`)) + (missed ? tr(' · неявка', ' · no-show') : host ? tr(` · хостил ${userLabel(host)}`, ` · hosted by ${userLabel(host)}`) : '')}
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
    <Screen>
      <Header title={tr('Мои визиты', 'My visits')} />
      <WriteAccessBanner />
      {my.length === 0 && past.length === 0 ? (
        <div className="card" ref={growIn} data-dust-empty="">
          <EmptyState
            title={tr('Пока нет заявок', 'No requests yet')}
            text={tr('Нажмите «+» внизу, выберите день и время: резиденты увидят заявку и откликнутся.', 'Tap “+” below and choose a day and time. Residents will see your request and can reply.')}
          />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>{tr('Одобрены', 'Approved')}</SectionTitle>
          <VisitList list={approved} />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>{tr('Ждут ответа', 'Pending')}</SectionTitle>
          <VisitList list={pending} />
        </>
      ) : null}
      {past.length > 0 || tally.visits > 0 ? (
        <>
          <SectionTitle>{tr('Были раньше', 'Past visits')}</SectionTitle>
          {past.length > 0 ? <VisitList list={past} past /> : null}
          {/* В списке только последние визиты, а счёт - за всё время, вместе с визитами
              без заявки, которые отметили резиденты. */}
          {tally.visits > 0 ? (
            <div className="visits-tally">
              {nb(`${tr('Вы были в спейсе', 'You’ve visited the space')} ${tally.visits} ${plural(tally.visits, ['раз', 'раза', 'раз'], ['time', 'times'])}`)}
            </div>
          ) : null}
        </>
      ) : null}
      {/* Как пройти, Активность и Настройки - вкладки (components/TabBar.tsx), заявка - «+»
          рядом с ними. Чат - ссылка наружу, а не раздел, поэтому строкой. */}
      <div className="card visits-chat">
        <button type="button" className="row tappable" onClick={() => openUrl(SPACE_CHAT_URL)}>
          <div className="row-icon" style={{ background: 'var(--green)' }}>
            {icons.chat(17, '#fff')}
          </div>
          <span className="row-label">{tr('Чат спейса', 'Space chat')}</span>
          <div className="row-right">{icons.external()}</div>
        </button>
      </div>
    </Screen>
  )
}
