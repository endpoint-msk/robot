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
  /** Когда гость нажал «Я на месте». null - не нажимал. */
  arrivedAt?: string | null
}

/** Сколько раз человек уже приходил - чип в строке заявки. Только резидентам. */
export type GuestVisitStats = { past: number; lastDateKey: string }

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
  /** Афиши в порядке показа — id файлов, каждый грузится через /event-photo.jpg?id=. */
  photos: string[]
  /** Пост канала, из которого сделан ивент, — только у заведённых пересылкой. */
  sourceUrl?: string
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
  eventNotify: NotifyPrefs
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
  /** Свои прошедшие визиты, свежие сверху (последние 5): «Были раньше» в «Моих визитах». */
  myPast: HostingRequest[]
  /** Ключ - userId гостя. Только резидентам: чужая история визитов гостю не полагается. */
  guestStats?: Record<string, GuestVisitStats>
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
  /** Взносы текущего периода — только резидентам. null: выключены или сборов ещё не было. */
  dues?: DuesSnapshot | null
}

/** Статус взноса: не отмечен, заявлен резидентом, подтверждён dev. */
export type DuesStatus = 'none' | 'claimed' | 'paid'

/** Какая ставка у человека: общая спейса, студенческая или своя по договорённости. */
export type DuesRateKind = 'common' | 'student' | 'custom'

export type DuesRow = {
  userId: number
  username: string | null
  name: string
  amount: number
  status: DuesStatus
  /** Когда подтвердили либо (для 'claimed') когда заявил. */
  at: string | null
  /** Кто подтвердил. null — ещё не подтверждено. */
  by: { username: string | null; name: string } | null
  /** Периодов подряд с незакрытым взносом, до текущего. */
  missed: number
  rate: DuesRateKind
}

export type DuesSnapshot = {
  /** Сбор включён. false видит только dev: ему нужен вход в настройки, чтобы включить обратно. */
  enabled: boolean
  /** Пустой, если периодов ещё не было. */
  periodKey: string
  periodLabel: string
  /** false — открыт из истории: отмечать можно, но это уже прошлый месяц. */
  isCurrent: boolean
  day: number
  amount: number
  studentAmount: number
  currency: string
  requisites: string
  /** Менять отметки и настройки может только dev. */
  canEdit: boolean
  /** Свой тумблер DM об открытии сбора. */
  notify: boolean
  me: { inRoster: boolean; amount: number; status: DuesStatus; at: string | null }
  summary: { total: number; paid: number; claimed: number; collected: number; expected: number }
  rows: DuesRow[]
}

export type DuesPeriodSummary = {
  periodKey: string
  label: string
  paid: number
  total: number
  collected: number
  expected: number
}

export type DuesHistory = {
  periods: DuesPeriodSummary[]
  collected: number
  expected: number
  /** Собираемость за всё время в процентах: доля закрытых взносов. */
  rate: number
  currency: string
}

export type DuesMonth = {
  periodKey: string
  label: string
  amount: number
  status: DuesStatus
  at: string | null
  by: { username: string | null; name: string } | null
}

export type DuesPerson = {
  user: User
  rate: { kind: DuesRateKind; amount: number }
  amount: number
  studentAmount: number
  currency: string
  canEdit: boolean
  months: DuesMonth[]
  missed: number
  debt: number
}

export type ArchiveWeekSummary = { weekStart: string; total: number; approved: number }
export type ArchiveResponse = { weeks: ArchiveWeekSummary[] }

/** Человек в поиске по архиву: кто, сколько заявок и когда был в последний раз. */
export type GuestSummary = { user: User; total: number; approved: number; lastDateKey: string }
export type GuestSearchResponse = { guests: GuestSummary[] }
export type GuestRequestsResponse = { user: User; requests: HostingRequest[] }

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
