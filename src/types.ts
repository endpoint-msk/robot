export type Donation = {
    /** Telegram username (без @) или произвольная строка-ник, как ввёл админ. */
    nick: string
    /** Сумма в условных единицах (RUB по умолчанию). */
    amount: number
    /** Когда добавили (ISO). Чисто для истории. */
    addedAt: string
}

export type Fundraiser = {
    /** Машинный ключ периода: "2026-06". */
    periodKey: string
    /** Год периода. */
    year: number
    /** Месяц периода (1..12). */
    month: number
    /** Цель в условных единицах. 0 — цель не задана, прогрессбар выводится по сумме относительно неё, иначе показывается «без цели». */
    goal: number
    /** Валюта (для отображения). */
    currency: string
    /** Тема сбора, например «аренду». */
    title: string
    /** Произвольное описание под сбором (реквизиты/ссылки). Многострочное; пусто — не выводится. */
    description: string
    donations: Donation[]
}

/** Координаты последнего «живого» сообщения сбора в чате. */
export type LastFundraiserMessage = {
    chatId: number
    messageId: number
    /** Какой период отрисован в этом сообщении. Если изменился — авто-обновление перерисует под актуальный. */
    periodKey: string
}

export type State = {
    /** Все сборы, ключ — periodKey. */
    fundraisers: Record<string, Fundraiser>
    /** Последнее сообщение со сбором в каждом чате (ключ — chatId как строка). */
    lastMessages: Record<string, LastFundraiserMessage>
    /** Резиденты, отметившиеся в хакерспейсе. Ключ — userId. */
    presence: Record<string, ResidentPresence>
    /** userId, попросивших уведомить в личку по окончании текущей печати. Чистится после уведомления. */
    printerSubscribers: Record<string, true>
    /** MAC-адреса резидентов для авто-отметок. Ключ — userId. */
    macBindings: Record<string, ResidentMacs>
    /** День месяца (1..29), в который сбрасывается сбор. По умолчанию 1 = календарный месяц UTC. */
    resetDay: number
    /** Чаты, где отключена ежедневная автоотправка сбора (ключ — chatId как строка). Ручные /goals продолжают работать. */
    goalsMuted: Record<string, true>
    /** Заявки гостей на визит (хостинг). Ключ — id заявки. */
    hostingRequests: Record<string, HostingRequest>
    /** Отметки резидентов «я приду» на день. Ключ — `${dateKey}#${userId}`. */
    hostingAttendance: Record<string, HostingAttendance>
    /** Настройки уведомлений о новых заявках per-резидент. Ключ — userId.
     *  Отсутствие записи = дефолт: включено, только заявки на сегодня (см. DEFAULT_HOSTING_NOTIFY). */
    hostingNotify: Record<string, HostingNotifyPrefs>
    /** Настройки уведомлений о новых ивентах per-резидент. Ключ — userId. Отдельный тумблер
     *  от заявок: это разные потоки, и один нужен не всем, кому нужен другой.
     *  Отсутствие записи = дефолт: включено, ивенты на любой день (см. DEFAULT_EVENT_NOTIFY). */
    eventNotify: Record<string, HostingNotifyPrefs>
    /** Закреплённая доска «кто сегодня в спейсе» по чатам (ключ — chatId как строка). */
    hostingBoard: Record<string, HostingBoardMessage>
    /** Чаты, где доска «кто сегодня в спейсе» отключена (ключ — chatId как строка).
     *  Переключается командой /boardmute админом чата. */
    hostingBoardMuted: Record<string, true>
    /** Чаты, где выключены анонсы (рассылка обновлений/объявлений). Ключ — chatId как строка.
     *  Переключается командой /announcemute админом чата. */
    announceMuted: Record<string, true>
    /** Версия (tag_name последнего релиза), до которой уже разослали анонс. Пусто — ещё ни разу.
     *  Чисто индикатор для дев-меню миниаппа: видно, есть ли неанонсированный релиз. */
    lastAnnouncedVersion: string
    /** Заблокированные участники (бан во всех allowlist-чатах + отказ в миниаппе). Ключ — userId. */
    blockedUsers: Record<string, BlockedUser>
    /** Заметки резидентов о гостях: одна на человека, общая для всех резидентов. Ключ — userId гостя. */
    guestNotes: Record<string, GuestNote>
    /** Согласия с правилами спейса перед первой заявкой на визит. Ключ — userId. */
    hostingRules: Record<string, RulesAcceptance>
    /** Расписания авто-бэкапа хранилища по чатам (ключ — chatId как строка). Включает дев через /autobackup. */
    backups: Record<string, BackupSchedule>
    /** Ивенты спейса (воркшопы, ремонт-кафе, демо-дни). Ключ — id ивента. */
    events: Record<string, SpaceEvent>
    /** Заготовка ивента из пересланного поста канала. Ключ — userId резидента, по одной на человека. */
    eventDrafts: Record<string, EventDraft>
    /** Резидентские взносы — одна общая настройка на весь спейс. */
    dues: DuesState
}

/**
 * Резидентские взносы: настройка плюс история периодов.
 *
 * Отдельная от сборов донатов подсистема: сбор — это добровольные донаты в общий
 * котёл, а взнос — обязательный платёж каждого резидента, и главный вопрос тут не
 * «сколько собрали», а «кто не заплатил и сколько месяцев».
 *
 * Настройка одна на спейс, а не на чат: взнос у резидента один, а allowlist-чатов
 * может быть несколько, и в миниаппе (главная поверхность подсистемы) чат не
 * выбирают вовсе. В чат подсистема не пишет: только личка и миниапп.
 */
export type DuesState = {
    /** Взносы включены: периоды открываются, раздел виден в миниаппе. */
    enabled: boolean
    /** День месяца (1..28), в который открывается период. */
    day: number
    /** Ставка обычного резидента. */
    amount: number
    /** Ставка студента. */
    studentAmount: number
    /** Валюта для отображения. */
    currency: string
    /** Реквизиты для перевода. Многострочные, уходят в DM и в плашку «Мой взнос». Пусто — не выводятся. */
    requisites: string
    /**
     * Персональная ставка. Ключ — userId, записи нет — платит общую.
     * 'student' следует за `studentAmount` (подняли ставку — поднялась у всех студентов),
     * число — фикс по договорённости, на него общие ставки не влияют.
     */
    rates: Record<string, DuesRate>
    /** Периоды. Ключ — 'YYYY-MM' месяца, в котором открыли сбор. */
    periods: Record<string, DuesPeriod>
    /** Резиденты, отключившие DM о взносе. Ключ — userId. Отсутствие записи = уведомления включены. */
    notifyOff: Record<string, true>
}

/** Персональная ставка: следовать студенческой либо фиксированная сумма. */
export type DuesRate = 'student' | number


/** Один месяц взносов: круг плательщиков и отметки об оплате. */
export type DuesPeriod = {
    /** 'YYYY-MM'. */
    periodKey: string
    /** Когда открыли период (ISO). */
    postedAt: string
    /**
     * С кого спрашивали в этом месяце — снимок резидентов чата на момент периода.
     * Ключ — userId. Снимок, а не живой список админов, потому что по нему считается
     * долг в следующих месяцах: без него «пришёл в мае» и «не платил с мая» неотличимы.
     */
    roster: Record<string, DuesMember>
    /** Отметки о взносе, заявленные и подтверждённые. Ключ — userId. */
    marks: Record<string, DuesMark>
}

/** Резидент в снимке периода: ник на тот момент и ставка, по которой с него спрашивали. */
export type DuesMember = {
    userId: number
    /** Username (без @) на момент периода. null — ника нет. */
    username: string | null
    /** Отображаемое имя. */
    name: string
    /** Ставка периода (уже с учётом студенческой). */
    amount: number
}

/**
 * Отметка о взносе. Две стадии: резидент сам жмёт «Я внёс» ('claimed'), dev сверяет
 * с выпиской и подтверждает ('paid'). Зачтённым считается только 'paid': он идёт в
 * статистику, в расчёт просрочки и в выгрузку. Отклонение снимает запись целиком.
 */
export type DuesMark = {
    userId: number
    /** Сумма по ставке периода. */
    amount: number
    status: 'claimed' | 'paid'
    /** Когда резидент заявил (ISO). null — отметку сразу поставил dev. */
    claimedAt: string | null
    /** Когда подтвердили (ISO). null — ещё ждёт сверки. */
    paidAt: string | null
    /** userId подтвердившего. null — ещё не подтверждено. */
    by: number | null
}

/**
 * Ивент спейса на конкретный день: то, ради чего в спейс приходят вместе, в отличие
 * от заявки гостя (та — про одного человека).
 *
 * Живёт в том же окне ближайших дней, что и хостинг (`HOSTING_DAYS_AHEAD`): ивент
 * показывается на экране дня, в «Активности» и на доске, а все три поверхности
 * ограничены этим окном — событие дальше просто негде было бы увидеть.
 */
export type SpaceEvent = {
    id: string
    /** День 'YYYY-MM-DD' в поясе спейса. */
    dateKey: string
    /** Время начала 'HH:MM' в поясе спейса. */
    time: string
    title: string
    /** Описание: что будет, кому интересно, что взять с собой. Пусто — не выводится. */
    description: string
    /** Виден только резидентам: в «Активности» у гостей и на доске такой ивент не появляется. */
    residentsOnly: boolean
    /**
     * Легаси-флаг одной афиши: у ивентов, заведённых до мульти-афиш, картинка лежит
     * под id самого ивента, а `photos` нет. Читать только через `eventPhotoIds`.
     */
    hasPhoto: boolean
    /**
     * Афиши в порядке показа — id файлов (см. `eventPhotoPath`). Сами файлы лежат
     * рядом со стейтом, а не в JSON: картинки на сотни килобайт раздули бы файл,
     * который переписывается целиком на каждую мутацию.
     */
    photos?: string[]
    /**
     * Пост в канале анонсов, из которого сделан ивент (t.me-ссылка). Есть только у
     * ивентов, заведённых пересылкой: доска даёт на него ссылку, чтобы из чата можно
     * было дойти до полного анонса с версткой и обсуждением.
     */
    sourceUrl?: string
    /** Резидент, который завёл ивент. */
    host: HostingUser
    createdAt: string
}

/**
 * Заготовка ивента из поста, пересланного резидентом из канала анонсов.
 *
 * Пересылка — вход в редактор с уже вставленным текстом: перепечатывать анонс,
 * который уже написан в канале, никто не будет. Живёт до тех пор, пока резидент
 * не заведёт ивент или не перешлёт следующий пост.
 */
export type EventDraft = {
    userId: number
    /** Первая строка поста — в заголовок, остальное — в описание. */
    title: string
    description: string
    /** У заготовки есть картинка из поста (файл — `eventPhotoPath` с id `draft-<userId>`). */
    hasPhoto: boolean
    /** Ссылка на исходный пост канала — переезжает в `SpaceEvent.sourceUrl`. */
    postUrl?: string
    /** Когда переслали (ISO). */
    at: string
}

/** Единица интервала авто-бэкапа. `m` — календарный месяц, НЕ минуты. */
export type BackupUnit = 'h' | 'd' | 'w' | 'm'

/** Расписание отправки бэкапа хранилища в конкретный чат. */
export type BackupSchedule = {
    chatId: number
    /** Раз в `value` единиц `unit`. */
    value: number
    unit: BackupUnit
    /** Когда должен уйти следующий бэкап (ISO). */
    nextAt: string
    /** Когда ушёл последний (ISO). null — ещё ни разу. */
    lastSentAt: string | null
    /** userId дева, включившего расписание. */
    by: number
}

/** Закреплённое сообщение-доска хостинга в чате: одно на календарный день (пояс спейса). */
export type HostingBoardMessage = {
    chatId: number
    messageId: number
    /** dateKey (пояс спейса), в который сообщение отправили — гейт «одно в день» и открепление на следующий день. */
    postedDay: string
    /** Какой день сейчас показан в сообщении (ближайший активный). */
    shownDay: string
}

/** Краткая карточка участника для заявок хостинга (гость/одобривший резидент). */
export type HostingUser = {
    userId: number
    /** Username (без @) на момент действия. null, если username нет. */
    username: string | null
    /** Отображаемое имя (first + last из Telegram). */
    name: string
}

/**
 * Активное предложение перенести визит на другой день и/или время — пинг-понг
 * между резидентом и гостем: одна сторона предлагает, вторая принимает или
 * отвечает своим слотом. null — активного предложения нет, действуют `dateKey`/
 * `time` заявки. Предложение несёт полный слот (день + время): резидент может
 * попросить и перенести день, и сдвинуть время одним предложением.
 */
export type RescheduleProposal = {
    /** Предложенный день визита 'YYYY-MM-DD' (по поясу спейса). */
    dateKey: string
    /** Предложенное время прихода 'HH:MM' (по поясу спейса). */
    time: string
    /** Кто предложил и ждёт ответа второй стороны. */
    by: 'resident' | 'guest'
    /** Карточка предложившего — для отображения и адресных уведомлений. */
    user: HostingUser
    /**
     * Кому адресовано: гость (когда предложил резидент) либо конкретный резидент
     * (хост или тот, на чьё предложение отвечает гость). null — адресат неизвестен,
     * так выглядят записи, заведённые до появления поля.
     *
     * Нужно, чтобы принимать и снимать предложение могли только его две стороны.
     * Без адресата на pending-заявке (там `approvedBy` ещё null) в переговоры влезал
     * любой резидент, а автор об этом даже не узнавал — DM уходил гостю.
     */
    to?: HostingUser | null
    /** Когда предложили (ISO). */
    at: string
}

/** Заявка гостя на визит в спейс. */
export type HostingRequest = {
    id: string
    /** День визита: 'YYYY-MM-DD' в поясе спейса (HOSTING_TZ_OFFSET_MINUTES). */
    dateKey: string
    /** Согласованное время прихода 'HH:MM' (по поясу спейса). */
    time: string
    /** Цель визита. Пустая строка — не указана. */
    purpose: string
    /** Гость пришёл анонимно: другие гости не видят его в публичном списке дня; резиденты видят всё. */
    anon: boolean
    guest: HostingUser
    createdAt: string
    status: 'pending' | 'approved'
    /** Резидент, который взялся захостить. null — пока никто. */
    approvedBy: HostingUser | null
    approvedAt: string | null
    /** Активное предложение переноса дня/времени. null/отсутствует — действуют `dateKey`/`time`. */
    proposal: RescheduleProposal | null
}

/** Заблокированный участник: бот банит его во всех allowlist-чатах и не пускает в миниапп. */
export type BlockedUser = {
    userId: number
    /** Username (без @) на момент блокировки — для отображения в списке. null, если username нет. */
    username: string | null
    /** Отображаемое имя на момент блокировки. */
    name: string
    /** Резидент, который заблокировал. */
    by: HostingUser
    /** Когда заблокировали (ISO). */
    at: string
}

/** Согласие гостя с правилами спейса: спрашивается один раз, перед первой заявкой. */
export type RulesAcceptance = {
    userId: number
    /** Версия текста правил (`HOSTING_RULES_VERSION`): подняли текст — спросим заново. */
    version: number
    /** Когда согласился (ISO). */
    at: string
}

/**
 * Заметка резидентов о госте: «приходил с паяльником», «шумный», «свой человек».
 * Одна на гостя и общая — правит любой резидент, `by` перезаписывается автором
 * последней правки. Гость своей заметки не видит (она не уходит в его bootstrap).
 */
export type GuestNote = {
    /** userId гостя, о котором заметка. */
    userId: number
    /** Текст заметки. Пустой не хранится — запись удаляется. */
    text: string
    /** Кто правил последним. */
    by: HostingUser
    /** Когда правили последний раз (ISO). */
    updatedAt: string
}

/** Отметка резидента «я приду» на конкретный день (без заявки, просто присутствие в списке). */
export type HostingAttendance = {
    /** День визита: 'YYYY-MM-DD' в поясе спейса. */
    dateKey: string
    /** Карточка резидента для отображения в списке. */
    user: HostingUser
    /** Когда отметился (ISO). */
    at: string
}

/** Настройки уведомлений резидента в личку: одна форма и для заявок, и для ивентов. */
export type HostingNotifyPrefs = {
    /** Слать ли уведомления в личку. */
    enabled: boolean
    /** 'today' — только про текущий день; 'all' — про любой день. */
    mode: 'today' | 'all'
}

/** MAC-адреса устройств резидента для авто-отметок присутствия. */
export type ResidentMacs = {
    userId: number
    /** Username (без @) на момент привязки — для отображения в списке. null, если username нет. */
    username: string | null
    /** Привязанные устройства. */
    macs: MacEntry[]
    /** Отмечать анонимно («Без ника») при авто-отметке по MAC. Меняется через /settings. */
    anon: boolean
    /** Когда последний раз меняли список (ISO). */
    updatedAt: string
}

/** Одно устройство резидента. */
export type MacEntry = {
    /** MAC в каноничном виде: lower-case, разделитель `:`. */
    mac: string
    /** Человекочитаемое имя устройства для списка. Пусто — если не задано. */
    label: string
}

/** Отметка резидента, что он сейчас внутри хакерспейса. */
export type ResidentPresence = {
    userId: number
    /** Имя для отображения в списке: либо @username, либо «Без ника» (если пользователь так выбрал). */
    displayLabel: string
    /** Username, если есть и пользователь не выбрал «без ника». */
    username: string | null
    /** Когда отметился (ISO). */
    checkedInAt: string
    /** Когда последний раз подтвердил присутствие через ping (ISO). При первой отметке = checkedInAt. */
    lastConfirmedAt: string
    /** Когда был отправлен последний ping в личку, на который мы ждём ответ. null — нет открытого ping'а. */
    pendingPingAt: string | null
    /** Источник отметки: 'manual' — через /start, 'mac' — авто по присутствию устройства в сети. */
    source: 'manual' | 'mac'
    /** Для 'mac'-отметок: когда MAC последний раз был онлайн в сети (ISO). Снимаем после grace-периода. */
    lastSeenOnlineAt: string | null
}

export const emptyState = (): State => ({
    fundraisers: {},
    lastMessages: {},
    presence: {},
    printerSubscribers: {},
    macBindings: {},
    resetDay: 1,
    goalsMuted: {},
    hostingRequests: {},
    hostingAttendance: {},
    hostingNotify: {},
    eventNotify: {},
    hostingBoard: {},
    hostingBoardMuted: {},
    announceMuted: {},
    lastAnnouncedVersion: '',
    blockedUsers: {},
    guestNotes: {},
    hostingRules: {},
    backups: {},
    events: {},
    eventDrafts: {},
    dues: emptyDues(),
})

/** Дефолт взносов: подсистема выключена, ставки хакерспейса, сбор 1-го числа. */
export const emptyDues = (): DuesState => ({
    enabled: false,
    day: 1,
    amount: 2222,
    studentAmount: 666,
    currency: '₽',
    requisites: '',
    rates: {},
    periods: {},
    notifyOff: {},
})
