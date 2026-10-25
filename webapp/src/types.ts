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

/** Просьба хоста подхватить его визит. Приходит только резидентам: гостя это не касается. */
export type HostTransfer = { to: User; by: User; at: string }

export type RequestStatus = 'pending' | 'approved'

/** За сколько до визита напомнить: за 30 минут, час, два, утром того же дня, вечером накануне. */
export type ReminderChoice = 'm30' | 'h1' | 'h2' | 'morning' | 'evening'

/** Напоминание о визите. null — гость его не просил. sentAt — уже отправлено. */
export type VisitReminder = { choice: ReminderChoice; sentAt: string | null }

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
  /** Напоминание о визите. Приходит только в своих заявках: чужое напоминание не наше дело. */
  remind?: VisitReminder | null
  /** Кому хост предлагает передать визит. Приходит только в резидентские списки. */
  transfer?: HostTransfer | null
  /** Чем закончился визит. Резидентам с автором отметки, гостю - только по своей заявке и без автора. */
  visit?: VisitOutcome
}

/**
 * Исход визита (см. visitOutcome на сервере). status null - исхода нет: визит впереди,
 * идёт сегодня или заявку никто не взял. 'unknown' - подтверждённый визит без отметки.
 * source: 'mark' - отметил резидент (by/at - кто и когда), 'door' - гость нажал «Я на
 * месте», 'legacy' - визит был до отметок и засчитан.
 */
export type VisitOutcome = {
  status: 'came' | 'missed' | 'unknown' | null
  source: 'mark' | 'door' | 'legacy' | null
  by: User | null
  at: string | null
}

/** Гость, пришедший без заявки. userId 0 - добавлен только по имени, профиля у него нет. */
export type WalkIn = { id: string; dateKey: string; guest: User; by: User; at: string }

/** «Кто пришёл» за день: заявки с исходом и гости без заявки. editable - день ещё можно отмечать. */
export type VisitsDay = { dateKey: string; editable: boolean; requests: HostingRequest[]; walkIns: WalkIn[] }

/** Кандидат в «пришёл без заявки». fromEvent - принят на ивент этого дня по форме. */
export type WalkInCandidate = User & { fromEvent: boolean }
export type WalkInCandidatesResponse = { people: WalkInCandidate[] }

/** Сколько раз человек уже приходил и сколько раз не пришёл - чипы в строке заявки. Только резидентам. */
export type GuestVisitStats = { past: number; missed: number; lastDateKey: string }

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
  /** Ко скольки придёт: у гостя время заявки, у резидента - если указал. */
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

export type EventFieldType = 'text' | 'choice'
export type EventFormOption = { id: string; label: string; writeIn?: boolean }
export type EventFormField = {
  id: string
  type: EventFieldType
  label: string
  required: boolean
  multi?: boolean
  options?: EventFormOption[]
}
/** Кто рассматривает заявки: все резиденты / только автор / выбранный круг. */
export type ReviewerScope =
  | { kind: 'all' }
  | { kind: 'creator' }
  | { kind: 'circle'; userIds: number[] }

/** Ответ на один блок формы (снимок текста вопроса и подписей вариантов). */
export type EventAnswer = {
  fieldId: string
  question: string
  type: EventFieldType
  text?: string
  choiceLabels?: string[]
  writeIn?: string
}

export type EventApplication = {
  id: string
  eventId: string
  guest: User
  answers: EventAnswer[]
  status: 'pending' | 'approved'
  createdAt: string
  approvedBy: User | null
  approvedAt: string | null
}

export type EventAppsResponse = { applications: EventApplication[] }
export type ReviewersResponse = { people: User[] }

/** Кандидат в ответственные за ивент: резидент или известный боту гость. */
export type ResponsibleCandidate = User & { resident: boolean }
export type EventPeopleResponse = { people: ResponsibleCandidate[] }

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
  /**
   * Тон первой афиши, '#rrggbb': экран ивента красится в него. Считает сам миниапп при
   * загрузке фото (image.ts), сервер его только хранит. Нет - ивент в своём фиолетовом.
   */
  tone?: string
  /** Пост канала, из которого сделан ивент, — только у заведённых пересылкой. */
  sourceUrl?: string
  host: User
  /** Ответственные за ивент. Приходит только резидентам (гостю — undefined). */
  responsibles?: User[]
  createdAt: string
  /**
   * Форма-заявка. null — ивент без заявок (анонс + «Хочу прийти»). Гостю приходят только
   * `fields` (для заполнения); `reviewers` — лишь рецензенту/автору (настройка формы).
   */
  form?: { fields: EventFormField[]; reviewers?: ReviewerScope } | null
  /** Вправе ли текущий зритель рассматривать заявки (кнопка «Заявки · N»). */
  canReview?: boolean
  /** Число заявок на рассмотрении — только рецензенту. */
  applicationsPending?: number
  /** Своя заявка на этот ивент (со снимком ответов для правки). null — не подавал. */
  myApplication?: { id: string; status: 'pending' | 'approved'; answers: EventAnswer[] } | null
  /** Публичный «кто придёт» по принятым заявкам. */
  approvedAttendees?: User[]
  approvedCount?: number
}

/** Заготовка ивента из пересланного в личку поста канала анонсов. */
export type EventDraft = {
  userId: number
  title: string
  description: string
  hasPhoto: boolean
  at: string
}

/**
 * День закрыт для гостевых заявок. Причину видят все, автора — только резиденты
 * (сервер не отдаёт `by` гостю).
 */
export type DayLock = {
  reason: string
  by?: User
  at?: string
}

/** Повестка дня. Текст видят все, автора только резиденты (сервер не отдаёт `by` гостю). */
export type DayAgenda = {
  text: string
  by?: User
  at?: string
}

export type Day = {
  dateKey: string
  total: number
  approved: number
  /** null — день открыт. Закрытый: гость не оставит заявку, резидент отметится «я приду». */
  lock: DayLock | null
  agenda: DayAgenda | null
  /** Детали заявок приходят только резидентам и dev-аккаунтам; гостям — undefined. */
  requests?: HostingRequest[]
  attendees: Attendee[]
  /** Ивенты дня: гостю — только открытые. */
  events: SpaceEvent[]
  /** Мягкий лимит вместимости. Приходит только резидентам. */
  capacity?: DayCapacity
  /** Подписан ли резидент на события дня (хостинг, «я приду», перенос). Только резидентам. */
  subscribed?: boolean
  /** Пришедшие без заявки (бывают только сегодня). Только резидентам. */
  walkIns?: WalkIn[]
}

/**
 * Занятые места дня против вместимости. Занято = резиденты «я приду» + подтверждённые
 * гости + принятые заявители ивентов; `pending` — заявки без хоста, они места не держат.
 * `custom` — вместимость этого дня отличается от общей.
 */
export type DayCapacity = {
  occupied: number
  pending: number
  cap: number
  custom: boolean
  /** Общая вместимость спейса — её называет подсказка при вводе своего числа. */
  defaultCap: number
}

export type NotifyPrefs = { enabled: boolean; mode: 'today' | 'all' }
/** Подписка гостя на отметки резидентов «я приду»: на сегодня и завтра или на всю неделю. */
export type AttendNotifyPrefs = { enabled: boolean; mode: 'near' | 'week' }
/** `online`: устройство было в сети спейса на последнем опросе роутера. */
export type MacEntry = { mac: string; label: string; online?: boolean }

export type Settings = {
  notify: NotifyPrefs
  eventNotify: NotifyPrefs
  macs: MacEntry[]
  macAnon: boolean
  macPresenceActive: boolean
  /** Журнал присутствия ведётся: выключено — визиты не пишутся и в статистике человека нет. */
  logVisits: boolean
}

// --- Журнал присутствия (src/stats.ts) -------------------------------------

export type StatsPeriod = 'month' | 'quarter' | 'all'

/** Ячейка тепловой карты: среднее число людей внутри. noData — роутер молчал. */
export type StatsHeatCell = { v: number; noData: boolean }

export type StatsTopPerson = {
  userId: number
  label: string
  username: string | null
  minutes: number
  visits: number
}

/** Столбик графика часов: дни `from`–`to` включительно и сколько спейс был открыт за них. */
export type StatsBar = { from: string; to: string; minutes: number }

/** Шаг графика идёт от периода: месяц по дням, 3 месяца по неделям, всё время по месяцам. */
export type StatsChart = { step: 'day' | 'week' | 'month'; bars: StatsBar[] }

export type StatsOverview = {
  period: StatsPeriod
  periodLabel: string
  /** Минуты, когда внутри был хоть кто-то. Не путать с manMinutes (человекоминуты). */
  openMinutes: number
  manMinutes: number
  avgInside: number
  prevOpenMinutes: number | null
  heat: { max: number; rows: { dow: number; cells: StatsHeatCell[] }[] }
  chart: StatsChart
  top: StatsTopPerson[]
  daysCount: number
  myMinutes: number
  hasData: boolean
}

export type StatsDayRow = {
  userId: number
  label: string
  username: string | null
  /** Минуты от полуночи в поясе спейса. */
  fromMin: number
  toMin: number
  source: 'manual' | 'mac'
}

export type StatsDayView = {
  dateKey: string
  openMinutes: number
  manMinutes: number
  peak: number
  from: string
  to: string
  people: number
  rows: StatsDayRow[]
  gaps: number[]
}

export type StatsDaySummary = {
  dateKey: string
  openMinutes: number
  from: string
  to: string
  people: number
  peak: number
}

export type StatsDaysView = { days: StatsDaySummary[] }

export type StatsPersonVisit = {
  dateKey: string
  from: string
  to: string
  minutes: number
  source: 'manual' | 'mac'
}

export type StatsPersonView = {
  user: { userId: number; label: string; username: string | null }
  period: StatsPeriod
  periodLabel: string
  visits: number
  minutes: number
  avgMinutes: number
  favArrival: string
  /** Сколько разных гостей резидент захостил за всё время. */
  hostedGuests: number
  firstDateKey: string
  /** Вступление в чат резидентов. Пусто — Telegram даты не отдал. */
  joinedSince: string
  /**
   * Дата вступления, выставленная руками (dev), либо `RESIDENT_SINCE_ORIGIN`.
   * Пусто — считаем по первому визиту.
   */
  manualSince: string
  /** 12 недель × 7 дней, минуты; порядок — по столбцам-неделям. */
  dots: number[]
  dotsFrom: string
  lastVisits: StatsPersonVisit[]
}

// --- Итоги месяца (src/wrap.ts) --------------------------------------------

/** Итоги прошлого месяца в bootstrap: строка в статистике. */
export type WrapInfo = {
  /** 'YYYY-MM'. */
  month: string
  evenings: number
  minutes: number
  /** Числа месяца, в которые человек приходил. */
  days: number[]
}

export type WrapStrip = {
  dateKey: string
  /** Минуты от полуночи дня прихода; конец бывает больше суток. */
  me: [number, number]
  /** Кто был в спейсе вместе с вами: только интервалы, без имён. */
  others: [number, number][]
}

export type WrapMonth = {
  month: string
  minutes: number
  prevMinutes: number
  evenings: { dateKey: string; minutes: number }[]
  /** Дни, когда роутер не отвечал: календарь штрихует их неделю. */
  gapDays: string[]
  longest: { dateKey: string; minutes: number }
  /** 7×12: в скольких вечерах человек был в спейсе в этот день недели и интервал. */
  heat: number[][]
  usual: {
    /** Обычный день недели (0 - понедельник). null - день не повторялся. */
    dow: number | null
    count: number
    of: number
    arrival: string
    /** Минуты от полуночи дня прихода. */
    leave: number
    ring: { dow: number; bucket: number }
  }
  opened: { count: number; closed: number; strips: WrapStrip[] }
  companion: { userId: number; username: string | null; label: string; minutes: number } | null
  companions: number
}

// --- Права резидента (dev, src/resident-admin.ts) --------------------------

export type AdminTargetKind = 'group' | 'channel'

/** Положение резидента в одной цели: где состоит, где админ, стоит ли тег. */
export type AdminTargetStatus = {
  key: string
  label: string
  kind: AdminTargetKind
  present: boolean
  creator: boolean
  admin: boolean
  canEdit: boolean
  /** В этой цели можно ставить member tag (только «чат»). */
  canTag: boolean
  /** Текущий тег (поле rank). null — нет. */
  tag: string | null
  error: string | null
}

export type AdminStatus = { userId: number; targets: AdminTargetStatus[] }
export type ResidentsListResponse = { people: User[] }

export type Me = {
  id: number
  username: string | null
  name: string
  isResident: boolean
  isDev: boolean
  /** Согласился с правилами спейса: спрашивается один раз, перед первой заявкой. */
  acceptedRules: boolean
}

/** Коммит, на котором крутится бот: подпись внизу настроек. Собирается на сервере. */
export type BuildInfo = {
  /** Короткий SHA — он же текст ссылки. */
  commit: string
  /** Ссылка на коммит в GitHub. */
  url: string
}

export type Bootstrap = {
  me: Me
  /** null, если бот не знает своего коммита (нет ни GIT_COMMIT, ни git рядом). */
  build: BuildInfo | null
  /** Токен для `src` картинок (/avatar.jpg, /event-photo.jpg) вместо initData в URL. */
  mediaToken: string
  /** Ник бота: из него «Переслать» собирает ссылку t.me на клиентах старше Bot API 8.0. */
  bot?: string | null
  todayKey: string
  nowTime: string
  days: Day[]
  /** Ивенты дальше окна обзора: их дня в `days` нет, поэтому едут отдельным списком. */
  laterEvents: SpaceEvent[]
  myRequests: HostingRequest[]
  /** Свои прошедшие визиты, свежие сверху (последние 5): «Были раньше» в «Моих визитах». */
  myPast: HostingRequest[]
  /** Свои визиты: сколько засчитано и сколько раз резиденты отметили неявку. */
  myVisits: { visits: number }
  /** Ключ - userId гостя. Только резидентам: чужая история визитов гостю не полагается. */
  guestStats?: Record<string, GuestVisitStats>
  /** Вчерашний день, пока его ещё можно отметить (ночь после него). Только резидентам. */
  visitGraceDay?: string | null
  /** null у гостя: уведомления о заявках и ивентах и MAC — только резидентам. */
  settings: Settings | null
  /** Гостевая настройка, но приходит всем: её читает и дев в перспективе «гость». */
  attendNotify: AttendNotifyPrefs
  /** create/edit возвращают ещё и саму созданную/изменённую заявку. */
  request?: HostingRequest
  /** Ответ `close`: дошло ли гостю сообщение о закрытии. null - отправка ещё идёт. */
  delivered?: boolean | null
  /** Ответ отметок «кто пришёл»: день целиком, каким он стал. */
  visitsDay?: VisitsDay
  /** Список заблокированных — только dev-аккаунтам (для дев-меню). */
  blocked?: BlockedUser[]
  /** Заметки о гостях — только резидентам; гостю (в т.ч. о нём самом) не приходят. */
  notes?: GuestNote[]
  /** Заготовка ивента из пересланного поста — только резидентам. null, если её нет. */
  eventDraft?: EventDraft | null
  /** Взносы текущего периода — только резидентам. null: выключены или сборов ещё не было. */
  dues?: DuesSnapshot | null
  /** Знакомство с ботом. Только резидентам. */
  onboarding?: OnboardingInfo
  /** Код домофона. Только резидентам и dev; null: не задан. */
  door?: DoorCode | null
  /** Итоги прошлого месяца. Только резидентам; null: итогов нет. */
  wrap?: WrapInfo | null
}

export type OnboardingInfo = {
  /** Открыть знакомство само: человек его ещё не проходил. */
  show: boolean
  /** Когда бот увидел вступление в чат резидентов. null: раньше знакомства или пока бот лежал. */
  joinedAt: string | null
  /** Подключён ли принтер: только тогда шаг «Бот» зовёт в /printer. */
  printer: boolean
  /** Ник бота для диплинков. */
  bot: string | null
  /** Имя бота, как его видно в чате. */
  botName: string
}

/** Резидент в сотах на обложке знакомства. inside: отмечен в спейсе с ником. */
export type OnboardingPerson = User & { inside: boolean }
export type OnboardingPeople = {
  people: OnboardingPerson[]
  /** Сколько сейчас внутри всего, вместе с отметками «без ника». */
  insideTotal: number
}

/** Код домофона и подсказка к нему (подъезд, панель). */
export type DoorCode = { code: string; note: string }

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

/** Человек в поиске по архиву: сколько записей (заявки и визиты без заявки), сколько визитов засчитано. */
export type GuestSummary = { user: User; total: number; visits: number; lastDateKey: string }
export type GuestSearchResponse = { guests: GuestSummary[] }

/**
 * Профиль гостя для резидентов. visits - засчитанные визиты, из них unmarked без
 * отметки; missed - явные неявки. usual - обычный день недели (0 - понедельник) и время.
 */
export type GuestProfile = {
  user: User
  visits: number
  unmarked: number
  missed: number
  firstDateKey: string
  lastDateKey: string
  next: { dateKey: string; time: string; approved: boolean } | null
  usual: { weekday: number; time: string | null } | null
  hosts: { user: User; count: number }[]
  events: { id: string; title: string; dateKey: string }[]
}
export type GuestRequestsResponse = { user: User; requests: HostingRequest[]; walkIns: WalkIn[]; profile: GuestProfile }

export type ArchiveWeekDay = VisitsDay
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
