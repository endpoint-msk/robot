// Список «кто придёт»: подтверждённые гости (без анонимных) + резиденты «я приду».

import { Fragment, type ReactNode } from 'react'
import type { Attendee, User } from '../types'
import { Avatar, Profile } from './people'
import { Sep } from './common'

/**
 * `right` занимает место пометки «резидент»: на своей строке там выбор времени, и
 * пометка о самом себе там ни к чему.
 */
export function AttendeeRow({ a, right }: { a: Attendee; right?: ReactNode }) {
  // Время теперь есть и у резидентов, поэтому ник больше не вытесняется им: многоточие
  // достаётся нику, время видно всегда (как в строке заявки).
  const subEl =
    a.time || a.username ? (
      <div className="req-sub split">
        {a.username ? <span className="req-sub-nick">@{a.username}</span> : null}
        {a.time ? <span className="req-sub-fixed">{(a.username ? ' · ' : '') + 'к ' + a.time}</span> : null}
      </div>
    ) : null
  return (
    <div className="row">
      <Avatar user={a} className="req-avatar" profile />
      <div className="req-main">
        <Profile user={a as User} className="req-name">
          {a.name}
        </Profile>
        {subEl}
      </div>
      {right ?? (a.resident ? <span className="resident-badge">резидент</span> : null)}
    </div>
  )
}

/** Карточка списка участников (residents-first порядок задаёт сервер). */
export function AttendeesCard({ list }: { list: Attendee[] }) {
  return (
    <div className="card">
      {list.map((a, i) => (
        <Fragment key={a.userId}>
          {i > 0 ? <Sep inset="avatar" /> : null}
          <AttendeeRow a={a} />
        </Fragment>
      ))}
    </div>
  )
}
