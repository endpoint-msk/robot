// Контракт с сервером (src/webapp.ts): формы ответов /api/*. Зеркалит requestsView,
// buildBootstrap, attendeesForDay, archiveWeeks и announce.* на бэкенде.

export type Perspective = 'resident' | 'guest'
export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export type User = {
  userId: number
  username: string | null
  name: string
}

export type RescheduleProposal = {
  dateKey: string
  time: string
  by: 'resident' | 'guest'
  user: User
  at: string
}

export type RequestStatus = 'pending' | 'approved'

export type HostingRequest = {
  id: string
  dateKey: string
  time: string
  purpose: string
  status: RequestStatus
  createdAt: string
  guest: User
  approvedBy: User | null
  proposal: RescheduleProposal | null
  anon: boolean
}

export type BlockedUser = {
  userId: number
  username: string | null
  name: string
  by: User
  at: string
}

export type Attendee = {
  userId: number
  name: string
  username: string | null
  resident: boolean
  time: string | null
}

export type Day = {
  dateKey: string
  total: number
  approved: number
  /** Детали заявок приходят только резидентам и dev-аккаунтам; гостям — undefined. */
  requests?: HostingRequest[]
  attendees: Attendee[]
}

export type NotifyPrefs = { enabled: boolean; mode: 'today' | 'all' }
export type MacEntry = { mac: string; label: string }

export type Settings = {
  notify: NotifyPrefs
  macs: MacEntry[]
  macAnon: boolean
  macPresenceActive: boolean
}

export type Me = {
  id: number
  username: string | null
  name: string
  isResident: boolean
  isDev: boolean
}

export type Bootstrap = {
  me: Me
  todayKey: string
  nowTime: string
  days: Day[]
  myRequests: HostingRequest[]
  /** null у гостя: уведомления и MAC — только резидентам. */
  settings: Settings | null
  /** create/edit возвращают ещё и саму созданную/изменённую заявку. */
  request?: HostingRequest
  /** Список заблокированных — только dev-аккаунтам (для дев-меню). */
  blocked?: BlockedUser[]
}

export type ArchiveWeekSummary = { weekStart: string; total: number; approved: number }
export type ArchiveResponse = { weeks: ArchiveWeekSummary[] }

export type ArchiveWeekDay = { dateKey: string; requests: HostingRequest[] }
export type ArchiveWeekResponse = { weekStart: string; days: ArchiveWeekDay[] }

export type Release = { version: string; name: string; url: string; publishedAt: string }
export type AnnounceLatest = {
  release: Release | null
  defaultText: string
  lastAnnouncedVersion: string
  targetChats: number
}
export type AnnounceSendResult = { sent: number; failed: number }

/** Форма ошибки API: сервер шлёт человекочитаемый message + машинный error-код. */
export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}
