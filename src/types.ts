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
    /** Когда в чате последний раз было «обычное» сообщение (от пользователя, не от бота). Ключ — chatId. */
    chatLastActivity: Record<string, string>
    /** userId, попросивших уведомить в личку по окончании текущей печати. Чистится после уведомления. */
    printerSubscribers: Record<string, true>
    /** MAC-адреса резидентов для авто-отметок. Ключ — userId. */
    macBindings: Record<string, ResidentMacs>
    /** День месяца (1..29), в который сбрасывается сбор. По умолчанию 1 = календарный месяц UTC. */
    resetDay: number
    /** Чаты, где отключена автоотправка сбора дважды в день (ключ — chatId как строка). Ручные /goals продолжают работать. */
    goalsMuted: Record<string, true>
    /** Заявки гостей на визит (хостинг). Ключ — id заявки. */
    hostingRequests: Record<string, HostingRequest>
    /** Отметки резидентов «я приду» на день. Ключ — `${dateKey}#${userId}`. */
    hostingAttendance: Record<string, HostingAttendance>
    /** Настройки уведомлений о новых заявках per-резидент. Ключ — userId.
     *  Отсутствие записи = дефолт: включено, только заявки на сегодня (см. DEFAULT_HOSTING_NOTIFY). */
    hostingNotify: Record<string, HostingNotifyPrefs>
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
 * Активное предложение перенести визит на другое время — пинг-понг между
 * резидентом и гостем: одна сторона предлагает, вторая принимает или отвечает
 * своим временем. null — активного предложения нет, действует `time` заявки.
 */
export type TimeProposal = {
    /** Предложенное время прихода 'HH:MM' (по поясу спейса). */
    time: string
    /** Кто предложил и ждёт ответа второй стороны. */
    by: 'resident' | 'guest'
    /** Карточка предложившего — для отображения и адресных уведомлений. */
    user: HostingUser
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
    /** Активное предложение переноса времени. null/отсутствует — действует `time`. */
    timeProposal: TimeProposal | null
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

/** Настройки уведомлений резидента о новых заявках. */
export type HostingNotifyPrefs = {
    /** Слать ли уведомления о новых заявках в личку. */
    enabled: boolean
    /** 'today' — только заявки на текущий день; 'all' — все новые заявки. */
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
    chatLastActivity: {},
    printerSubscribers: {},
    macBindings: {},
    resetDay: 1,
    goalsMuted: {},
    hostingRequests: {},
    hostingAttendance: {},
    hostingNotify: {},
    hostingBoard: {},
    hostingBoardMuted: {},
    announceMuted: {},
    lastAnnouncedVersion: '',
})
