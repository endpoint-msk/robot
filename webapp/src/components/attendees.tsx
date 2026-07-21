// Список «кто придёт»: подтверждённые гости (без анонимных) + резиденты «я приду».

import { Fragment } from 'react'
import type { Attendee, User } from '../types'
import { Avatar, Profile } from './people'
import { Sep } from './common'

export function AttendeeRow({ a }: { a: Attendee }) {
  const subEl = a.time ? (
    <div className="req-sub">к {a.time}</div>
  ) : a.username ? (
    <div className="req-sub">@{a.username}</div>
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
      {a.resident ? <span className="resident-badge">резидент</span> : null}
    </div>
  )
}

/** Карточка списка участников (residents-first порядок задаёт сервер). */
export function AttendeesCard({ list }: { list: Attendee[] }) {
  return (
    <div className="card">
      {list.map((a, i) => (
        <Fragment key={a.userId}>
          {i > 0 ? <Sep left={66} /> : null}
          <AttendeeRow a={a} />
        </Fragment>
      ))}
    </div>
  )
}
