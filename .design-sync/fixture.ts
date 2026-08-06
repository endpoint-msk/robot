// Данные для превью-карточек: один правдоподобный снимок `Bootstrap`, каким его
// отдаёт бэкенд (src/webapp.ts → buildBootstrap). Нужен потому, что половина
// компонентов миниаппа читает стор напрямую (useStore().data!): без посева они
// падают, а не показывают «пустое состояние».
//
// Даты зашиты намеренно: карточки должны выглядеть одинаково при каждой сборке,
// иначе скриншоты расходятся день ото дня и оценки превью нечего сравнивать.

import type {
  Attendee,
  Bootstrap,
  Day,
  GuestNote,
  HostingRequest,
  SpaceEvent,
  User,
} from '../webapp/src/types'

export const DAY_KEYS = [
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
  '2026-08-09',
  '2026-08-10',
  '2026-08-11',
] as const

export const TODAY = DAY_KEYS[0]
export const NOW_TIME = '13:20'

export const me: User = { userId: 501, username: 'max_k', name: 'Макс' }
export const dasha: User = { userId: 502, username: 'dasha', name: 'Даша Ильина' }
export const kostya: User = { userId: 503, username: null, name: 'Костя' }

export const misha: User = { userId: 9001, username: 'mixa', name: 'Миша Коротков' }
export const anya: User = { userId: 9002, username: null, name: 'Аня Соколова' }
export const zhenya: User = { userId: 9003, username: 'zhenya_p', name: 'Женя Петров' }

export const pendingRequest: HostingRequest = {
  id: 'req-1',
  dateKey: TODAY,
  time: '19:00',
  purpose: 'Хочу напечатать корпус для датчика — пластик свой, принесу с собой.',
  status: 'pending',
  createdAt: '2026-08-04T18:40:00.000Z',
  guest: misha,
  approvedBy: null,
  proposal: null,
  anon: false,
}

export const approvedRequest: HostingRequest = {
  id: 'req-2',
  dateKey: TODAY,
  time: '15:30',
  purpose: 'Паяльная станция: чинить наушники.',
  status: 'approved',
  createdAt: '2026-08-03T09:12:00.000Z',
  guest: anya,
  approvedBy: dasha,
  proposal: null,
  anon: false,
}

export const proposedByGuestRequest: HostingRequest = {
  id: 'req-3',
  dateKey: TODAY,
  time: '20:00',
  purpose: 'Забрать плату с прошлой встречи и допаять разъёмы.',
  status: 'pending',
  createdAt: '2026-08-04T21:05:00.000Z',
  guest: zhenya,
  approvedBy: null,
  proposal: {
    dateKey: TODAY,
    time: '21:00',
    by: 'guest',
    user: zhenya,
    to: me,
    at: '2026-08-05T08:30:00.000Z',
  },
  anon: false,
}

export const proposedByResidentRequest: HostingRequest = {
  id: 'req-4',
  dateKey: DAY_KEYS[1],
  time: '18:00',
  purpose: '',
  status: 'pending',
  createdAt: '2026-08-04T12:00:00.000Z',
  guest: anya,
  approvedBy: null,
  proposal: {
    dateKey: DAY_KEYS[1],
    time: '19:30',
    by: 'resident',
    user: me,
    to: anya,
    at: '2026-08-05T09:00:00.000Z',
  },
  anon: true,
}

export const myRequest: HostingRequest = {
  id: 'req-5',
  dateKey: DAY_KEYS[2],
  time: '17:00',
  purpose: 'Посмотреть станок и познакомиться.',
  status: 'approved',
  createdAt: '2026-08-02T15:00:00.000Z',
  guest: me,
  approvedBy: kostya,
  proposal: null,
  anon: false,
}

export const requests: HostingRequest[] = [approvedRequest, pendingRequest, proposedByGuestRequest]

export const attendees: Attendee[] = [
  { userId: dasha.userId, name: dasha.name, username: dasha.username, resident: true, time: null },
  { userId: kostya.userId, name: kostya.name, username: kostya.username, resident: true, time: null },
  { userId: anya.userId, name: anya.name, username: anya.username, resident: false, time: '15:30' },
]

export const spaceEvent: SpaceEvent = {
  id: 'ev-1',
  dateKey: TODAY,
  time: '19:30',
  title: 'Ремонт-кафе: чиним всё, что принесли',
  description:
    'Приносите сломанное — фены, лампы, наушники. Паяльники и мультиметры наши, руки общие.\nНачинаем в 19:30, чай в 21:00.',
  residentsOnly: false,
  photos: [],
  host: dasha,
  createdAt: '2026-07-30T10:00:00.000Z',
}

export const residentsOnlyEvent: SpaceEvent = {
  id: 'ev-2',
  dateKey: DAY_KEYS[3],
  time: '20:00',
  title: 'Разбор склада и инвентаризация',
  description: 'Считаем филамент и метизы, подписываем ящики.',
  residentsOnly: true,
  photos: [],
  host: kostya,
  createdAt: '2026-08-01T08:00:00.000Z',
}

export const guestNote: GuestNote = {
  userId: anya.userId,
  text: 'Была в июне на ремонт-кафе, помогала с пайкой. Знает, где ключ от шкафа с инструментом.',
  by: dasha,
  updatedAt: '2026-06-21T19:30:00.000Z',
}

export const days: Day[] = [
  { dateKey: DAY_KEYS[0], total: 3, approved: 1, requests, attendees, events: [spaceEvent] },
  { dateKey: DAY_KEYS[1], total: 1, approved: 0, requests: [proposedByResidentRequest], attendees: [], events: [] },
  {
    dateKey: DAY_KEYS[2],
    total: 1,
    approved: 1,
    requests: [myRequest],
    attendees: [{ userId: me.userId, name: me.name, username: me.username, resident: true, time: null }],
    events: [],
  },
  { dateKey: DAY_KEYS[3], total: 0, approved: 0, requests: [], attendees: [], events: [residentsOnlyEvent] },
  { dateKey: DAY_KEYS[4], total: 0, approved: 0, requests: [], attendees: [], events: [] },
  { dateKey: DAY_KEYS[5], total: 2, approved: 2, requests: [], attendees: [], events: [] },
  { dateKey: DAY_KEYS[6], total: 0, approved: 0, requests: [], attendees: [], events: [] },
]

export const dsFixture: Bootstrap = {
  me: { id: me.userId, username: me.username, name: me.name, isResident: true, isDev: true, acceptedRules: true },
  todayKey: TODAY,
  nowTime: NOW_TIME,
  days,
  myRequests: [myRequest],
  myPast: [],
  guestStats: {
    [String(misha.userId)]: { past: 0, lastDateKey: '' },
    [String(anya.userId)]: { past: 4, lastDateKey: '2026-07-18' },
    [String(zhenya.userId)]: { past: 11, lastDateKey: '2026-08-01' },
  },
  settings: {
    notify: { enabled: true, mode: 'today' },
    eventNotify: { enabled: true, mode: 'all' },
    macs: [{ mac: 'a4:83:e7:11:22:33', label: 'ноут' }],
    macAnon: false,
    macPresenceActive: true,
  },
  notes: [guestNote],
}
