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
    /** ID последнего сообщения со списком присутствующих в каждом чате (для редактирования вместо нового). */
    presenceListMessages: Record<string, number>
    /** Когда сообщение со списком было ОТПРАВЛЕНО (не отредактировано) в каждом чате (ISO). Используется, чтобы при checkin/checkout
     *  публиковать новое сообщение, если предыдущее «протухло» — иначе апдейт никто не увидит. */
    presenceListPostedAt: Record<string, string>
    /** Чаты, в которых выключены АВТОМАТИЧЕСКИЕ сообщения со списком присутствующих
     *  (таймер тишины + авто-восстановление удалённого списка). Ключ — chatId. Ручной /inside работает всегда.
     *  Переключается командой /autoinside админом чата. */
    presenceAutoMuted: Record<string, true>
    /** userId, попросивших уведомить в личку по окончании текущей печати. Чистится после уведомления. */
    printerSubscribers: Record<string, true>
    /** MAC-адреса резидентов для авто-отметок. Ключ — userId. */
    macBindings: Record<string, ResidentMacs>
    /** День месяца (1..29), в который сбрасывается сбор. По умолчанию 1 = календарный месяц UTC. */
    resetDay: number
    /** Чаты, где отключена автоотправка сбора дважды в день (ключ — chatId как строка). Ручные /goals продолжают работать. */
    goalsMuted: Record<string, true>
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
    presenceListMessages: {},
    presenceListPostedAt: {},
    presenceAutoMuted: {},
    printerSubscribers: {},
    macBindings: {},
    resetDay: 1,
    goalsMuted: {},
})
