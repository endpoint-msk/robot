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
  /** Кому адресовано. null/undefined — предложение из записи, заведённой до появления поля. */
  to?: User | null
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

/** Заметка резидентов о госте: одна на человека, общая — правит любой резидент. */
export type GuestNote = {
  userId: number
  text: string
  by: User
  updatedAt: string
}

export type Attendee = {
  userId: number
  name: string
  username: string | null
  resident: boolean
  time: string | null
}

/** Кандидат из списка «кого позвать в спейс» (резидент или гость из заявок). */
export type InviteCandidate = {
  userId: number
  name: string
  username: string | null
  resident: boolean
  /** Уже придёт: отметился «я приду» или у него есть заявка на этот день. */
  attending: boolean
}

export type InviteListResponse = { people: InviteCandidate[] }

/** Ивент спейса: воркшоп, ремонт-кафе, демо-день. Заводит резидент, видят все (если не resOnly). */
export type SpaceEvent = {
  id: string
  dateKey: string
  time: string
  title: string
  description: string
  /** Гости не увидят такой ивент в «Активности» и на доске. */
  residentsOnly: boolean
  /** Есть афиша — грузится через /event-photo.jpg?id=. */
  hasPhoto: boolean
  host: User
  createdAt: string
}

/** Заготовка ивента из пересланного в личку поста канала анонсов. */
export type EventDraft = {
  userId: number
  title: string
  description: string
  hasPhoto: boolean
  at: string
}

export type Day = {
  dateKey: string
  total: number
  approved: number
  /** Детали заявок приходят только резидентам и dev-аккаунтам; гостям — undefined. */
  requests?: HostingRequest[]
  attendees: Attendee[]
  /** Ивенты дня: гостю — только открытые. */
  events: SpaceEvent[]
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
  /** Согласился с правилами спейса: спрашивается один раз, перед первой заявкой. */
  acceptedRules: boolean
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
  /** Заметки о гостях — только резидентам; гостю (в т.ч. о нём самом) не приходят. */
  notes?: GuestNote[]
  /** Заготовка ивента из пересланного поста — только резидентам. null, если её нет. */
  eventDraft?: EventDraft | null
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
