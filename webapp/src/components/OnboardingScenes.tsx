// Разметка сцен знакомства (screens/Onboarding.tsx). Движение считает
// src/onboarding.ts по классам отсюда; здесь только конечный кадр. Сцены -
// иллюстрации, смысл шага несёт текст под ними, поэтому для скринридера они скрыты.

import { Fragment, useState, type ReactNode } from 'react'
import { icons } from '../icons'
import type { User } from '../types'
import { Avatar } from './people'

/** Круглая аватарка бота: своего фото у бота в миниаппе нет, как и у канала. */
const BotAvatar = ({ name, size }: { name: string; size: number }) => (
  <span className="ob-bot-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
    {(name.trim().charAt(0) || 'E').toUpperCase()}
  </span>
)

/** Счётчик на доске: число перещёлкивается на единицу, когда вы встаёте в список. */
const Counter = ({ from }: { from: number }) => (
  <span className="ob-cnt">
    <span className="ob-cnt-in">
      <i>{from}</i>
      <i>{from + 1}</i>
    </span>
  </span>
)

/** Строки «• @ник» доски: не больше двух, иначе пузырь не влезает в сцену. */
const NickLines = ({ nicks }: { nicks: string[] }) => (
  <>
    {nicks.slice(0, 2).map((nick) => (
      <Fragment key={nick}>
        <br />• <a>@{nick}</a>
      </Fragment>
    ))}
  </>
)

export type BoardData = {
  /** Кто внутри с ником. */
  nicks: string[]
  /** Сколько внутри всего, вместе с отметками «без ника». */
  total: number
  /** Ваш ник. null: ника нет, на доске вы будете только в счётчике. */
  me: string | null
  time: string
}

export type HivePeople = { people: User[]; me: User }

export function CoverScene({ people, me }: HivePeople) {
  return (
    <div className="ob-hive">
      {people.map((p, i) => (
        <span key={p.userId} className="ob-cell" data-i={i}>
          <Avatar user={p} />
        </span>
      ))}
      <span className="ob-cell ob-you">
        <Avatar user={me} />
      </span>
      <span className="ob-you-tag">Вы</span>
      {[0, 1].map((slot) => (
        <span key={slot} className="ob-tip">
          <b className="ob-tip-name" />
          <span className="ob-tip-nick" />
          <span className="ob-tip-on" hidden>
            в спейсе
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * Штрихкод карты: полосы и просветы разной толщины из ГПСЧ, засеянного userId, -
 * у человека он всегда один и тот же. Ширину полосы делят пропорционально.
 */
function Barcode({ seed }: { seed: number }) {
  let a = Math.abs(seed) | 0 || 1
  const next = (): number => {
    // mulberry32: короткий детерминированный ГПСЧ
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const bars = Array.from({ length: 46 }, (_, i) => [
    <i key={`b${i}`} style={{ flex: `${1 + Math.floor(next() * 3)} 0 0` }} />,
    <span key={`g${i}`} style={{ flex: `${1 + Math.floor(next() * 2)} 0 0` }} />,
  ]).flat()
  return <div className="ob-pass-bars">{bars}</div>
}

/**
 * Карта резидента в духе карты Endpoint: логотип, имя крупно, номер, служебные
 * строки моноширинным и штрихкод. Номер - сколько резидентов вместе с вами.
 */
export function DoneScene({ me, number, since }: { me: User; number: number | null; since: string | null }) {
  const code = `EPT-${String(number ?? 0).padStart(3, '0')}-${String(Math.abs(me.userId)).padStart(10, '0')}`
  return (
    <div className="ob-pass-stage" aria-hidden="true">
      <div className="ob-pass-pos">
        <div className="ob-pass">
          <div className="ob-pass-logo">EPT</div>
          <div className="ob-pass-name">{me.name}</div>
          {number ? <div className="ob-pass-num">#{number}</div> : null}
          <div className="ob-pass-meta">
            {me.username ? (
              <>
                <b>URI</b>
                <span>t.me/{me.username}</span>
              </>
            ) : null}
            <b>ID</b>
            <span>{me.userId}</span>
            {since ? (
              <>
                <b>SINCE</b>
                <span>{since}</span>
              </>
            ) : null}
          </div>
          <div className="ob-pass-foot">
            <div className="ob-pass-code">{code}</div>
            <Barcode seed={me.userId} />
          </div>
          <span className="ob-pass-sheen" />
        </div>
      </div>
    </div>
  )
}

export function PresenceScene({ board, botName, dayLabel }: { board: BoardData; botName: string; dayLabel: string }) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-board">
        <div className="ob-bubble ob-lift">
          <div className="ob-b-name">{botName}</div>
          <p>
            🚪 <b>{dayLabel} (сегодня)</b> в спейсе
          </p>
          <p>
            <b>
              Сейчас в спейсе [<Counter from={board.total} />]:
            </b>
            <NickLines nicks={board.nicks} />
            {board.me ? (
              <span className="ob-me-line">
                <span className="ob-me">
                  • <a>@{board.me}</a>
                </span>
              </span>
            ) : null}
            <span className="ob-b-meta">{board.time}</span>
          </p>
        </div>
        <div className="ob-kb">
          <span>🚪 Хочу прийти</span>
        </div>
      </div>
    </div>
  )
}

export function MacScene({ board }: { board: BoardData }) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-wifi">
        <div className="ob-wf-row">
          <span className="ob-wf-title">Wi-Fi</span>
          <span className="ob-mini-switch" />
        </div>
        <div className="ob-wf-row">
          <span className="ob-wf-state">
            <span className="ob-spin">{icons.spinner(18)}</span>
            <span className="ob-wf-check">{icons.check(18, 'currentColor', 2.2)}</span>
          </span>
          <span className="ob-wf-name">Endpoint</span>
          <span className="ob-wf-icons">
            {icons.lockSmall()}
            {icons.wifiFull()}
            <span className="ob-wf-info">{icons.infoCircle(21)}</span>
          </span>
        </div>
      </div>
      <div className="ob-mac-board ob-bubble ob-lift">
        <p>
          <b>
            Сейчас в спейсе [<Counter from={board.total} />]:
          </b>
          <NickLines nicks={board.nicks} />
          {board.me ? (
            <span className="ob-me-line">
              <span className="ob-me">
                • <a>@{board.me}</a>
                <span className="ob-via">Wi-Fi</span>
              </span>
            </span>
          ) : null}
          <span className="ob-b-meta">{board.time}</span>
        </p>
      </div>
    </div>
  )
}

export type Banner = { key: string; time: string; text: string; off: boolean }

function Notification({ botName, time, text, className }: { botName: string; time: string; text: string; className: string }) {
  return (
    <div className={className}>
      <span className="ob-nb-av">
        <BotAvatar name={botName} size={38} />
        <span className="ob-tg-badge">{icons.plane()}</span>
      </span>
      <span className="ob-nb-body">
        <span className="ob-nb-top">
          {botName}
          <span className="ob-nb-time">{time}</span>
        </span>
        <span className="ob-nb-msg">{text}</span>
      </span>
    </div>
  )
}

export function NotifyScene({ banners, botName }: { banners: Banner[]; botName: string }) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-nbs">
        {banners.map((b) => (
          <Notification key={b.key} botName={botName} time={b.time} text={b.text} className={'ob-nb' + (b.off ? ' off' : '')} />
        ))}
      </div>
    </div>
  )
}

export function GuestsScene({ botName }: { botName: string }) {
  return (
    <>
      <div className="ob-door" aria-hidden="true" />
      <div className="ob-scene" aria-hidden="true">
        <Notification botName={botName} time="сейчас" text="🚪 Настя у двери - визит к 20:00." className="ob-nb ob-door-nb" />
      </div>
    </>
  )
}

export type EventCardData = {
  title: string
  /** «сб 27.09, 16:00»: подпись на афише. */
  short: string
  /** «Сб, 27 сентября к 16:00». */
  when: string
  desc: string
  /** Афиша настоящего ивента. null: рисованная. */
  photo: string | null
}

/** Афиша: настоящая, если есть, поверх рисованной; та остаётся, пока фото не приехало. */
function Poster({ ev, className, children }: { ev: EventCardData; className: string; children: ReactNode }) {
  const [ok, setOk] = useState(false)
  return (
    <div className={className}>
      {children}
      {ev.photo ? (
        <img
          className={'ob-poster-photo' + (ok ? ' loaded' : '')}
          src={ev.photo}
          alt=""
          onLoad={() => setOk(true)}
          onError={() => setOk(false)}
        />
      ) : null}
    </div>
  )
}

export function EventsScene({ ev }: { ev: EventCardData }) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-post ob-bubble ob-lift">
        <div className="ob-post-head">
          <BotAvatar name="Endpoint" size={28} />
          <span className="ob-post-ch">
            <b>Endpoint</b>
            <span>пост в канале</span>
          </span>
        </div>
        <Poster ev={ev} className="ob-poster">
          <b>{ev.title}</b>
          <span>{ev.short}</span>
        </Poster>
        {ev.desc ? <div className="ob-post-cap">{ev.desc}</div> : null}
      </div>
      <div className="ob-ev">
        <Poster ev={ev} className="ob-ev-thumb">
          <b>{ev.title}</b>
        </Poster>
        <div className="ob-ev-body">
          <div className="ob-ev-top">
            <span className="ob-ev-kicker">Ивент</span>
            <span className="ob-ev-from">из поста</span>
          </div>
          <div className="ob-ev-title">{ev.title}</div>
          <div className="ob-ev-meta">{ev.when}</div>
          {ev.desc ? <div className="ob-ev-desc">{ev.desc}</div> : null}
        </div>
      </div>
    </div>
  )
}

export function DuesScene({ label, amount, sub }: { label: string; amount: string; sub: string }) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-pay">
        <div className="ob-pay-top">
          <span className="ob-pay-label">{label}</span>
          <span className="ob-pay-tags">
            <span className="ob-tag warn" data-st="0">
              Не внесён
            </span>
            <span className="ob-tag gray" data-st="1">
              Ждёт сверки
            </span>
            <span className="ob-tag green" data-st="2">
              Внесён
            </span>
          </span>
        </div>
        <div className="ob-pay-sum">{amount}</div>
        <div className="ob-pay-sub">{sub}</div>
        <div className="ob-pay-act">
          <span className="ob-pay-btn" data-st="0">
            Я внёс
          </span>
          <span className="ob-pay-line" data-st="1">
            {icons.clock(16, 'currentColor')}
            Отметка ушла на сверку
          </span>
          <span className="ob-pay-line ok" data-st="2">
            {icons.check(15, 'currentColor', 2.2)}
            Сверено с выпиской
          </span>
        </div>
      </div>
    </div>
  )
}

/** Модель на столе принтера: превью gcode, как его присылает /printer. */
const PrinterModel = () => (
  <svg width="120" height="84" viewBox="0 0 120 84">
    <path d="M60 16L96 34 60 52 24 34z" fill="#ffb340" />
    <path d="M24 34L60 52v18L24 52z" fill="#e08600" />
    <path d="M96 34L60 52v18l36-18z" fill="#b86a00" />
    <ellipse cx="60" cy="33" rx="9" ry="4.6" fill="#8a4f00" />
  </svg>
)

export function BotScene({
  printer,
  time,
  finish,
  board,
}: {
  printer: boolean
  time: string
  /** Во сколько закончит печать в примере. */
  finish: string
  board: BoardData
}) {
  return (
    <div className="ob-scene" aria-hidden="true">
      <div className="ob-chat">
        <div className="ob-bubble out">
          <span className="ob-cmd">{printer ? '/printer' : '/inside'}</span>
          <span className="ob-b-meta">
            {time} {icons.ticks()}
          </span>
        </div>
        <div className="ob-inbox">
          <div className="ob-typing">
            <i />
            <i />
            <i />
          </div>
          {printer ? (
            <div className="ob-bubble ob-media ob-reply">
              <div className="ob-thumb">
                <PrinterModel />
              </div>
              <div className="ob-media-cap">
                🖨 <b>Статус принтера:</b> печатает
                <br />
                Прогресс: 64%
                <br />
                Осталось ~1 ч 20 мин · закончит в {finish}
                <span className="ob-b-meta">{time}</span>
              </div>
            </div>
          ) : (
            <div className="ob-bubble ob-reply">
              <p>
                {`Внутри [${board.total}], отметились [${board.nicks.length}]:`}
                {board.nicks.slice(0, 3).map((nick) => (
                  <Fragment key={nick}>
                    <br />
                    <a>@{nick}</a>
                  </Fragment>
                ))}
                <span className="ob-b-meta">{time}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
