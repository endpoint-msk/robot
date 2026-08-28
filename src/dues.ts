// Резидентские взносы: раз в месяц бот открывает период и пишет каждому резиденту
// в личку. Резидент отмечает свой взнос сам («Я внёс»), dev сверяет с выпиской и
// подтверждает; и список, и настройки живут в миниаппе.
//
// В общий чат подсистема не пишет ничего. Кто сколько должен, дело конкретного
// человека: список в чате шумел бы на тех, кого сбор не касается, и работал бы
// доской позора. От бота остались личка и дев-команды для тестов.
//
// Это не «сбор донатов» (src/fundraiser.ts): там добровольные суммы в общий котёл и
// вопрос «сколько собрали», здесь обязательный платёж каждого и вопрос «кто не
// заплатил и сколько месяцев подряд». Настройка одна на спейс: взнос у резидента
// один, а allowlist-чатов может быть несколько.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import { monthNameRu } from './fundraiser.js'
import { startHeartbeatInterval } from './health.js'
import { displayName } from './hosting.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { DuesMark, DuesMember, DuesPeriod, DuesRate, DuesState, HostingUser } from './types.js'

export const MIN_DUES_DAY = 1
/** 29, 30 и 31 есть не в каждом месяце: ограничиваем, чтобы день сбора не «плавал». */
export const MAX_DUES_DAY = 28

/** Час (в поясе спейса), в который открывается период. */
const POST_HOUR = 12
const TICK_INTERVAL_MS = 60_000
/** Как часто сверяем ростер активного периода с живым составом резидентов. */
const ROSTER_SYNC_INTERVAL_MS = 60 * 60_000
/** Пропущено периодов подряд: столько — предупреждение, столько и больше — крайний срок. */
export const WARN_DEBT = 1
export const CRITICAL_DEBT = 2

/** Ссылка на миниапп для кнопок в личке. null — миниапп не настроен, кнопки нет. */
let duesMiniappUrl: string | null = null

export const setDuesMiniappUrl = (url: string | null): void => {
    duesMiniappUrl = url
}

// ---------------------------------------------------------------------------
// Периоды. Ключ — 'YYYY-MM' месяца, в котором открыли сбор. Всё считается от UTC со
// сдвигом пояса спейса, локальное время процесса не используется (см. CLAUDE.md).
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0')
const monthKey = (year: number, month: number): string => `${year}-${pad2(month)}`

export const clampDuesDay = (day: number): number =>
    Math.min(Math.max(Math.trunc(day), MIN_DUES_DAY), MAX_DUES_DAY)

/**
 * Ключ периода. При сборе 1-го числа — `YYYY-MM`, как было (все заведённые периоды
 * такие). При другом дне — `YYYY-MM-DD` от даты старта: сбор, открытый 25 августа,
 * это не тот же сбор, что открытый 1 августа, и общий ключ с ним означал бы, что
 * смена дня не открывает ничего до следующего месяца. Ключи остаются сравнимыми
 * лексикографически: `2026-08` < `2026-08-25` < `2026-09`.
 */
const keyForDues = (year: number, month: number, day: number): string =>
    day === MIN_DUES_DAY ? monthKey(year, month) : `${monthKey(year, month)}-${pad2(day)}`

const parseMonthKey = (key: string): { year: number; month: number } => {
    const [y, m] = key.split('-').map(Number)
    return { year: y ?? 1970, month: m ?? 1 }
}

/** День сбора, зашитый в ключ 3-м сегментом. У календарного `YYYY-MM` — 1-е число. */
const dayFromKey = (key: string): number => {
    const raw = Number(key.split('-')[2])
    return Number.isFinite(raw) ? clampDuesDay(raw) : MIN_DUES_DAY
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** День сбора в конкретном месяце: 31-е в феврале зажимаем в последний день. */
export const duesDayIn = (year: number, month: number, day: number): number =>
    Math.min(Math.max(day, MIN_DUES_DAY), daysInMonth(year, month))

/**
 * Момент, когда должен открыться период (UTC). День берётся из ключа, а не из текущей
 * настройки: правка дня двигает будущие периоды, а у уже заведённого граница обязана
 * остаться прежней — иначе задним числом меняется и просрочка.
 */
export const duesAnchorOf = (periodKey: string, day: number, tzOffsetMinutes: number): Date => {
    const { year, month } = parseMonthKey(periodKey)
    const anchorDay = periodKey.split('-').length > 2 ? dayFromKey(periodKey) : day
    return new Date(Date.UTC(year, month - 1, duesDayIn(year, month, anchorDay), POST_HOUR) - tzOffsetMinutes * 60_000)
}

/** Соседний месяц с тем же днём сбора: день — часть ключа, терять его нельзя. */
const shiftMonthKey = (key: string, delta: 1 | -1): string => {
    const { year, month } = parseMonthKey(key)
    const day = dayFromKey(key)
    const shifted = month + delta
    if (shifted === 0) return keyForDues(year - 1, 12, day)
    if (shifted === 13) return keyForDues(year + 1, 1, day)
    return keyForDues(year, shifted, day)
}

export const prevMonthKey = (key: string): string => shiftMonthKey(key, -1)

export const nextMonthKey = (key: string): string => shiftMonthKey(key, 1)

/**
 * Период, который к моменту `now` уже должен быть открыт. До дня и часа сбора это
 * ещё прошлый месяц, иначе шедулер выстрелил бы в полночь нужного числа.
 */
export const duesPeriodKeyOf = (now: Date, day: number, tzOffsetMinutes: number): string => {
    const local = new Date(now.getTime() + tzOffsetMinutes * 60_000)
    const key = keyForDues(local.getUTCFullYear(), local.getUTCMonth() + 1, clampDuesDay(day))
    return duesAnchorOf(key, day, tzOffsetMinutes).getTime() <= now.getTime() ? key : prevMonthKey(key)
}

/**
 * Месяц для показа. Период, открытый не 1-го числа, покрывает в основном следующий
 * месяц (25 августа → 25 сентября), и «Август» на нём спорит с тем, за что человек
 * платит. Тот же сдвиг, что у сборов донатов (`displayPeriodOf`).
 */
const displayMonthOf = (periodKey: string): { year: number; month: number } => {
    const { year, month } = parseMonthKey(periodKey)
    if (dayFromKey(periodKey) === MIN_DUES_DAY) return { year, month }
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/** «Август 2026». */
export const duesPeriodLabel = (periodKey: string): string => {
    const { year, month } = displayMonthOf(periodKey)
    return `${monthNameRu(month)} ${year}`
}

/** «августа» — для фраз вида «не подтверждены июнь и июль». */
const monthOnly = (periodKey: string): string => monthNameRu(displayMonthOf(periodKey).month)

// ---------------------------------------------------------------------------
// Стейт
// ---------------------------------------------------------------------------

export const duesOf = (storage: Storage): DuesState => storage.get().dues

export const periodKeysOf = (dues: DuesState): string[] => Object.keys(dues.periods).sort()

/** Активный период — самый поздний из открытых. undefined — сборов ещё не было. */
export const activeDuesPeriod = (dues: DuesState): DuesPeriod | undefined => {
    const last = periodKeysOf(dues).pop()
    return last === undefined ? undefined : dues.periods[last]
}

/** Ставка человека с учётом персональной настройки. */
export const rateFor = (dues: DuesState, userId: number): number => {
    const rate: DuesRate | undefined = dues.rates[String(userId)]
    if (rate === 'student') return dues.studentAmount
    if (typeof rate === 'number') return rate
    return dues.amount
}

/** Зачтён ли взнос: заявка сама по себе не считается, нужна сверка. */
export const isPaid = (mark: DuesMark | undefined): boolean => mark?.status === 'paid'

/**
 * Сколько периодов подряд перед активным человек не закрыл.
 *
 * Считаем только по тем периодам, где он был в снимке ростера: пришёл в мае, за март
 * с него не спрашивают. Первый закрытый (или период без него) обрывает счёт: долг
 * именно «подряд», разовый пропуск полгода назад сюда не тянется.
 */
export const missedPeriods = (dues: DuesState, activeKey: string, userId: number): string[] => {
    const key = String(userId)
    const missed: string[] = []
    for (const periodKey of periodKeysOf(dues).filter((k) => k < activeKey).reverse()) {
        const period = dues.periods[periodKey]!
        const member = period.roster[key]
        if (!member) break
        // Нулевая ставка это освобождение от взноса: такой месяц не долг, но и счёт
        // не обрывает — иначе человек, которого освободили на месяц, «обнулял» бы
        // накопленную просрочку за предыдущие.
        if (member.amount <= 0) continue
        if (isPaid(period.marks[key])) break
        missed.push(periodKey)
    }
    return missed
}

// ---------------------------------------------------------------------------
// Ростер
// ---------------------------------------------------------------------------

/**
 * Приводит снимок активного периода к живому составу резидентов: дописывает новых,
 * освежает ники и ставки, убирает тех, кто резидентом быть перестал.
 *
 * Убираем только неотмеченных: отметка это факт из бухгалтерии, она остаётся в
 * периоде, даже если человек ушёл. Прошлые периоды не трогаем вовсе — на их снимках
 * держится расчёт просрочки.
 *
 * И убираем только по полному списку (`complete`): оборванный обход состава отдаёт
 * часть людей, и вычеркнуть по нему значит потерять плательщиков из уже открытого
 * периода - а по этому снимку в следующих месяцах считается просрочка. Неполный
 * список умеет только дописывать.
 */
export const syncDuesRoster = async (
    storage: Storage,
    directory: ResidentDirectory,
    periodKey: string,
): Promise<void> => {
    let live: HostingUser[]
    let complete: boolean
    try {
        const roster = await directory.list()
        live = roster.users
        complete = roster.complete
    } catch (err) {
        // Не смогли спросить Telegram: оставляем снимок как есть. Лучше слегка
        // устаревший список, чем пустой.
        console.warn('[dues] не удалось получить резидентов:', err)
        return
    }
    if (live.length === 0) return

    await storage.update((s) => {
        const period = s.dues.periods[periodKey]
        if (!period) return
        const liveIds = new Set(live.map((r) => r.userId))
        for (const r of live) {
            const key = String(r.userId)
            const amount = rateFor(s.dues, r.userId)
            const existing = period.roster[key]
            if (existing) {
                existing.username = r.username
                existing.name = r.name
                existing.amount = amount
            } else {
                period.roster[key] = { userId: r.userId, username: r.username, name: r.name, amount }
            }
        }
        if (!complete) return
        for (const key of Object.keys(period.roster)) {
            if (period.marks[key]) continue
            if (!liveIds.has(Number(key))) delete period.roster[key]
        }
    })
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

export const plural = (n: number, forms: [string, string, string]): string => {
    const tail = n % 10
    const teen = n % 100
    if (tail === 1 && teen !== 11) return forms[0]
    if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return forms[1]
    return forms[2]
}

/** `2222` → `2 222`: в списке из десятка сумм неразделённые тысячи не читаются. */
export const formatMoney = (n: number): string => {
    const rounded = Math.round(n * 100) / 100
    const [int = '0', frac] = Math.abs(rounded).toFixed(Number.isInteger(rounded) ? 0 : 2).split('.')
    return `${rounded < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac ? `,${frac}` : ''}`
}

const plainLabel = (m: { username: string | null; name: string }): string =>
    m.username ? `@${m.username}` : displayName(m.name)

/** «июнь и июль» — перечисление пропущенных месяцев. */
const missedMonths = (keys: string[]): string => {
    const names = [...keys].reverse().map(monthOnly)
    if (names.length <= 1) return names[0] ?? ''
    return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

/** Строки состава: сначала не отметившиеся (просрочники сверху), потом заявки, потом закрытые. */
export type DuesRow = { member: DuesMember; mark: DuesMark | undefined; missed: string[] }

export const duesRows = (dues: DuesState, period: DuesPeriod): DuesRow[] => {
    const rows: DuesRow[] = Object.values(period.roster).map((member) => ({
        member,
        mark: period.marks[String(member.userId)],
        missed: missedPeriods(dues, period.periodKey, member.userId),
    }))
    const rank = (r: DuesRow): number => (isPaid(r.mark) ? 2 : r.mark ? 1 : 0)
    return rows.sort((a, b) => {
        const diff = rank(a) - rank(b)
        if (diff !== 0) return diff
        if (a.missed.length !== b.missed.length) return b.missed.length - a.missed.length
        return plainLabel(a.member).localeCompare(plainLabel(b.member), 'ru')
    })
}


/** callback_data кнопки «Я внёс»: период дописывается ключом 'YYYY-MM'. */
export const CB_CLAIM = 'dues:claim:'

const claimKeyboard = (periodKey: string) =>
    BotKeyboard.inline([
        [BotKeyboard.callback('✅ Я внёс', `${CB_CLAIM}${periodKey}`)],
        ...(duesMiniappUrl ? [[BotKeyboard.webView('Открыть взносы', duesMiniappUrl)]] : []),
    ])

/**
 * DM резиденту об открытии сбора. Про просрочку он узнаёт из этого же сообщения:
 * отдельного нытья по расписанию нет. Первый пропущенный месяц предупреждением,
 * второй и дальше строкой про крайний срок.
 */
const notifyMemberAboutPeriod = async (
    client: TelegramClient,
    dues: DuesState,
    member: DuesMember,
    periodKey: string,
    missed: string[],
): Promise<boolean> => {
    const cur = html.escape(dues.currency)
    const lines = [
        `💸 <b>Открыт сбор резидентского взноса за ${duesPeriodLabel(periodKey).toLowerCase()}.</b>`,
        `С тебя ${formatMoney(member.amount)} ${cur}.`,
    ]
    if (dues.requisites.trim()) {
        lines.push('')
        for (const line of dues.requisites.split('\n')) lines.push(html.escape(line))
    }
    if (missed.length >= CRITICAL_DEBT) {
        lines.push('')
        lines.push(`🛑 Не подтверждены ${missedMonths(missed)}. Два месяца это крайний срок неуплаты.`)
    } else if (missed.length >= WARN_DEBT) {
        lines.push('')
        lines.push(`⚠️ Взнос за ${missedMonths(missed)} так и не подтверждён, это месяц просрочки.`)
    }
    lines.push('')
    lines.push('Перевёл? Нажми «Я внёс», перевод будет рассмотрен.')

    try {
        await client.sendText(member.userId, html(lines.join('<br>')), {
            replyMarkup: claimKeyboard(periodKey),
            disableWebPreview: true,
        })
        return true
    } catch {
        // Личка закрыта: узнать это заранее нельзя, а сбор из-за одного человека не рушим.
        return false
    }
}

/**
 * Рассылка об открытии сбора всем, кто не выключил уведомления и с кого есть что спрашивать.
 *
 * Недоставленные письма записываем в период (`notifyFailed`) и жалуемся девам: иначе
 * человек с закрытой личкой выглядит как молчаливый должник, хотя ему просто ничего
 * не пришло. Повторы - в шедулере (`retryFailedDuesNotifications`).
 */
const notifyPeriodOpened = async (
    client: TelegramClient,
    storage: Storage,
    dues: DuesState,
    period: DuesPeriod,
): Promise<void> => {
    const failed: DuesMember[] = []
    for (const member of Object.values(period.roster)) {
        if (dues.notifyOff[String(member.userId)]) continue
        // Ставка 0 — человек освобождён от взноса, напоминать ему не о чем.
        if (member.amount <= 0) continue
        const ok = await notifyMemberAboutPeriod(
            client, dues, member, period.periodKey, missedPeriods(dues, period.periodKey, member.userId),
        )
        if (!ok) failed.push(member)
    }
    if (failed.length === 0) return
    const now = new Date().toISOString()
    await storage.update((s) => {
        const p = s.dues.periods[period.periodKey]
        if (!p) return
        for (const member of failed) p.notifyFailed[String(member.userId)] = now
    })
    // console.error форвардится девам в личку (errors.ts) - отдельный канал не нужен.
    console.error(
        `[dues] не смог написать про сбор ${period.periodKey}: ${failed.map(plainLabel).join(', ')}. Повторю в течение суток.`,
    )
}

/** Сколько ждём между повторами недоставленного DM и как долго вообще повторяем. */
const NOTIFY_RETRY_INTERVAL_MS = 60 * 60_000
const NOTIFY_RETRY_WINDOW_MS = 24 * 60 * 60_000

/**
 * Повторяет недоставленные DM об открытии сбора: человек мог нажать /start уже после
 * рассылки. Сутки и раз в час - дальше это уже не «не дошло», а «не хочет».
 */
export const retryFailedDuesNotifications = async (client: TelegramClient, storage: Storage): Promise<void> => {
    const dues = duesOf(storage)
    const period = activeDuesPeriod(dues)
    if (!period) return
    const pending = Object.entries(period.notifyFailed ?? {})
    if (pending.length === 0) return
    const now = Date.now()
    const openedAt = Date.parse(period.postedAt)
    if (Number.isFinite(openedAt) && now - openedAt > NOTIFY_RETRY_WINDOW_MS) {
        await storage.update((s) => {
            const p = s.dues.periods[period.periodKey]
            if (p) p.notifyFailed = {}
        })
        return
    }
    for (const [key, lastTry] of pending) {
        const at = Date.parse(lastTry)
        if (Number.isFinite(at) && now - at < NOTIFY_RETRY_INTERVAL_MS) continue
        const member = period.roster[key]
        // Человек мог за это время выключить уведомления или уйти из ростера - повтор
        // должен уважать те же правила, что и первая рассылка.
        if (!member || member.amount <= 0 || dues.notifyOff[key]) {
            await storage.update((s) => {
                const p = s.dues.periods[period.periodKey]
                if (p) delete p.notifyFailed[key]
            })
            continue
        }
        const ok = await notifyMemberAboutPeriod(
            client, dues, member, period.periodKey, missedPeriods(dues, period.periodKey, member.userId),
        )
        await storage.update((s) => {
            const p = s.dues.periods[period.periodKey]
            if (!p) return
            if (ok) delete p.notifyFailed[key]
            else p.notifyFailed[key] = new Date().toISOString()
        })
    }
}

/** DM девам: кто-то заявил взнос, нужна сверка. */
export const notifyDevsAboutClaim = async (
    client: TelegramClient,
    devUserIds: ReadonlySet<number>,
    dues: DuesState,
    periodKey: string,
    member: DuesMember,
): Promise<void> => {
    const text = [
        `💸 <b>${html.escape(plainLabel(member))} отметил взнос за ${duesPeriodLabel(periodKey).toLowerCase()}, ${formatMoney(member.amount)} ${html.escape(dues.currency)}.</b>`,
        'Сверь с выпиской и подтверди.',
    ].join('<br>')
    const markup = duesMiniappUrl
        ? BotKeyboard.inline([[BotKeyboard.webView('Открыть взносы', duesMiniappUrl)]])
        : undefined
    for (const userId of devUserIds) {
        try {
            await client.sendText(userId, html(text), { replyMarkup: markup, disableWebPreview: true })
        } catch {
            // Дев не открывал чат с ботом.
        }
    }
}

// ---------------------------------------------------------------------------
// Открытие периода
// ---------------------------------------------------------------------------

/**
 * Открывает период: заводит запись, снимает ростер и пишет каждому в личку.
 *
 * В чат ничего не уходит: поверхности взносов это личка и миниапп. Кто сколько должен,
 * дело конкретного человека, а список в общем чате и шумит на тех, кого сбор не
 * касается, и превращается в доску позора.
 */
export const openDuesPeriod = async (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    periodKey: string,
): Promise<void> => {
    const now = new Date()
    const existed = duesOf(storage).periods[periodKey] !== undefined
    await storage.update((s) => {
        if (s.dues.periods[periodKey]) return
        s.dues.periods[periodKey] = { periodKey, postedAt: now.toISOString(), roster: {}, marks: {}, notifyFailed: {} }
    })
    await syncDuesRoster(storage, directory, periodKey)

    const dues = duesOf(storage)
    const period = dues.periods[periodKey]
    if (!period) return

    // Пустой ростер - это не «резидентов нет», а «состав прочитать не удалось» (бот не
    // админ чата резидентов, флуд-вейт). Запись периода в таком виде откатываем: иначе
    // шедулер считает месяц закрытым и второй раз его уже не откроет, а сбор так и не
    // состоится. Только что заведённый - свой, ранее существовавший не трогаем.
    if (!existed && Object.keys(period.roster).length === 0) {
        await storage.update((s) => {
            delete s.dues.periods[periodKey]
        })
        console.error(`[dues] период ${periodKey} не открыт: состав резидентов пуст. Бот админ чата резидентов?`)
        return
    }

    await notifyPeriodOpened(client, storage, dues, period)
}

// ---------------------------------------------------------------------------
// Мутации (за ними стоят ручки миниаппа и команды)
// ---------------------------------------------------------------------------

export type DuesMutationError = 'disabled' | 'no_period' | 'not_member' | 'no_mark' | 'already'

/** Резидент заявил свой взнос. Идемпотентно: повторный вызов ничего не меняет. */
export const claimDues = async (
    storage: Storage,
    periodKey: string,
    userId: number,
): Promise<{ ok: true; member: DuesMember } | { ok: false; error: DuesMutationError }> => {
    const period = duesOf(storage).periods[periodKey]
    if (!period) return { ok: false, error: 'no_period' }
    const key = String(userId)
    const member = period.roster[key]
    if (!member) return { ok: false, error: 'not_member' }
    if (period.marks[key]) return { ok: false, error: 'already' }
    await storage.update((s) => {
        const p = s.dues.periods[periodKey]
        if (!p || p.marks[key]) return
        p.marks[key] = {
            userId,
            amount: member.amount,
            status: 'claimed',
            claimedAt: new Date().toISOString(),
            paidAt: null,
            by: null,
        }
    })
    return { ok: true, member }
}

/**
 * Dev подтверждает взнос. Работает и по заявке, и с нуля (принесли наличными):
 * во втором случае отметка сразу становится подтверждённой.
 */
export const confirmDues = async (
    storage: Storage,
    periodKey: string,
    userId: number,
    by: number,
): Promise<{ ok: true } | { ok: false; error: DuesMutationError }> => {
    const period = duesOf(storage).periods[periodKey]
    if (!period) return { ok: false, error: 'no_period' }
    const key = String(userId)
    const member = period.roster[key]
    if (!member) return { ok: false, error: 'not_member' }
    const now = new Date().toISOString()
    await storage.update((s) => {
        const p = s.dues.periods[periodKey]
        if (!p) return
        const existing = p.marks[key]
        if (existing) {
            existing.status = 'paid'
            existing.paidAt = now
            existing.by = by
        } else {
            p.marks[key] = { userId, amount: member.amount, status: 'paid', claimedAt: null, paidAt: now, by }
        }
    })
    return { ok: true }
}

/** Снимает отметку целиком: и отклонение заявки, и откат подтверждения. */
export const clearDuesMark = async (
    storage: Storage,
    periodKey: string,
    userId: number,
): Promise<{ ok: true } | { ok: false; error: DuesMutationError }> => {
    const period = duesOf(storage).periods[periodKey]
    if (!period) return { ok: false, error: 'no_period' }
    const key = String(userId)
    if (!period.marks[key]) return { ok: false, error: 'no_mark' }
    await storage.update((s) => {
        const p = s.dues.periods[periodKey]
        if (p) delete p.marks[key]
    })
    return { ok: true }
}

/** Персональная ставка. null — вернуть человека на общую. */
export const setDuesRate = async (storage: Storage, userId: number, rate: DuesRate | null): Promise<void> => {
    const key = String(userId)
    await storage.update((s) => {
        if (rate === null) delete s.dues.rates[key]
        else s.dues.rates[key] = rate
    })
}

/** Настройки сбора. Пришедшие поля перезаписываются, остальные остаются как были. */
export const updateDuesSettings = async (
    storage: Storage,
    patch: Partial<Pick<DuesState, 'enabled' | 'day' | 'amount' | 'studentAmount' | 'requisites'>>,
): Promise<void> => {
    await storage.update((s) => {
        if (patch.enabled !== undefined) s.dues.enabled = patch.enabled
        if (patch.day !== undefined) s.dues.day = clampDuesDay(patch.day)
        if (patch.amount !== undefined) s.dues.amount = Math.max(0, patch.amount)
        if (patch.studentAmount !== undefined) s.dues.studentAmount = Math.max(0, patch.studentAmount)
        if (patch.requisites !== undefined) s.dues.requisites = patch.requisites.slice(0, 1000)
    })
}

export const setDuesNotify = async (storage: Storage, userId: number, enabled: boolean): Promise<void> => {
    const key = String(userId)
    await storage.update((s) => {
        if (enabled) delete s.dues.notifyOff[key]
        else s.dues.notifyOff[key] = true
    })
}

// ---------------------------------------------------------------------------
// Выгрузка
// ---------------------------------------------------------------------------

/** Экранирует поле по RFC 4180 (как в fundraiser.ts: тот же формат, та же Excel-аудитория). */
const csvField = (raw: string): string =>
    /[",\r\n]/.test(raw) || raw !== raw.trim() ? `"${raw.replace(/"/g, '""')}"` : raw

/**
 * Таблица взносов за все периоды: строка — резидент, столбец — месяц.
 *
 * В клетке подтверждённая сумма, «заявлено» у неподтверждённой отметки, «нет» если с
 * человека спрашивали и он не внёс, пусто если он тогда не был резидентом. Внизу
 * итоги по месяцам: видно и конкретного должника, и провал по кассе в конкретном месяце.
 */
export const buildDuesCsv = (dues: DuesState): string => {
    const keys = periodKeysOf(dues)
    const members = new Map<string, DuesMember>()
    // Свежие данные о человеке берём из последнего периода, где он был: ники меняются.
    for (const key of keys) {
        for (const [id, m] of Object.entries(dues.periods[key]!.roster)) members.set(id, m)
    }

    const rows: string[] = [
        ['Участник', 'Ник', 'Ставка', ...keys.map(duesPeriodLabel), 'Внесено всего', 'Просрочено подряд']
            .map(csvField).join(','),
    ]
    const activeKey = keys[keys.length - 1] ?? ''
    const sorted = [...members.entries()].sort((a, b) => plainLabel(a[1]).localeCompare(plainLabel(b[1]), 'ru'))
    for (const [id, member] of sorted) {
        const cells: string[] = []
        let total = 0
        for (const key of keys) {
            const period = dues.periods[key]!
            const mark = period.marks[id]
            if (isPaid(mark)) {
                total += mark!.amount
                cells.push(formatMoney(mark!.amount))
            } else if (mark) {
                cells.push('заявлено')
            } else if (!period.roster[id]) {
                cells.push('')
            } else {
                cells.push(period.roster[id]!.amount <= 0 ? 'освобождён' : 'нет')
            }
        }
        rows.push([
            member.name,
            member.username ? `@${member.username}` : '',
            formatMoney(member.amount),
            ...cells,
            formatMoney(total),
            String(missedPeriods(dues, activeKey, Number(id)).length),
        ].map(csvField).join(','))
    }

    const sums = keys.map((key) =>
        Object.values(dues.periods[key]!.marks).filter((m) => m.status === 'paid').reduce((sum, m) => sum + m.amount, 0),
    )
    const ratios = keys.map((key) => {
        const period = dues.periods[key]!
        const paid = Object.values(period.marks).filter((m) => m.status === 'paid').length
        return `${paid} из ${Object.keys(period.roster).length}`
    })
    rows.push(['Итого', '', '', ...sums.map(formatMoney), formatMoney(sums.reduce((a, b) => a + b, 0)), ''].map(csvField).join(','))
    rows.push(['Внесли', '', '', ...ratios, '', ''].map(csvField).join(','))
    return rows.join('\r\n')
}

// ---------------------------------------------------------------------------
// Команды и кнопка «Я внёс»
// ---------------------------------------------------------------------------

export type DuesDeps = {
    client: TelegramClient
    storage: Storage
    residents: ResidentDirectory
    allowedChats: ReadonlySet<number>
    devUserIds: ReadonlySet<number>
    tzOffsetMinutes: number
}


export const registerDuesHandlers = (dp: Dispatcher, deps: DuesDeps): void => {
    const { client, storage, residents, allowedChats, devUserIds, tzOffsetMinutes } = deps

    /** Дев в разрешённом месте. Не-девам не отвечаем вовсе, чтобы команда не светилась. */
    const isDevHere = (msg: MessageContext): boolean =>
        !!msg.sender &&
        msg.sender.type === 'user' &&
        devUserIds.has(msg.sender.id) &&
        (msg.chat.type === 'user' || allowedChats.has(Number(msg.chat.id)))

    /**
     * Активный период либо текст ошибки. `enabled` тут не гейт: он управляет только
     * авто-открытием периодов шедулером. Уже открытый период работает и после
     * выключения сбора — иначе отметки повисли бы недоступными.
     */
    const requireActive = (): { dues: DuesState; period: DuesPeriod } | string => {
        const dues = duesOf(storage)
        const period = activeDuesPeriod(dues)
        if (!period) {
            return dues.enabled
                ? `Сбор ещё не открывался, ближайший ${dues.day}-го числа.`
                : 'Взносы выключены. Включаются в миниаппе, раздел «Взносы».'
        }
        return { dues, period }
    }


    // /skip — форсировать следующий период: то же, что сделает шедулер в день сбора.
    dp.onNewMessage(filters.command('skip'), async (msg) => {
        if (!isDevHere(msg)) return
        const dues = duesOf(storage)
        const latest = periodKeysOf(dues).pop()
        // Считаем от периода, который положен сейчас: если он ещё не открыт, /skip
        // делает ровно то же, что шедулер в день сбора, а не прыгает через месяц.
        const current = duesPeriodKeyOf(new Date(), dues.day, tzOffsetMinutes)
        const nextKey = latest !== undefined && latest >= current ? nextMonthKey(current) : current
        await openDuesPeriod(client, storage, residents, nextKey)
        await msg.answerText(`[тест] Открыл период ${duesPeriodLabel(nextKey)}.`)
    })

    // /clear — сбросить отметки текущего периода.
    dp.onNewMessage(filters.command('clear'), async (msg) => {
        if (!isDevHere(msg)) return
        const active = requireActive()
        if (typeof active === 'string') {
            await msg.answerText(active)
            return
        }
        const { period } = active
        const count = Object.keys(period.marks).length
        await storage.update((s) => {
            const p = s.dues.periods[period.periodKey]
            if (p) p.marks = {}
        })
        await msg.answerText(`[тест] Сбросил отметки за ${duesPeriodLabel(period.periodKey)} (было ${count}).`)
    })

    // Кнопка «Я внёс» из лички. Чужие callback'и пропускаем дальше (см. инвариант в CLAUDE.md).
    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        if (!ctx.dataStr?.startsWith(CB_CLAIM)) return PropagationAction.Continue
        const periodKey = ctx.dataStr.slice(CB_CLAIM.length)
        const result = await claimDues(storage, periodKey, ctx.user.id)
        if (!result.ok) {
            const text = result.error === 'already'
                ? 'Взнос за этот месяц уже отмечен.'
                : result.error === 'not_member'
                    ? 'Тебя нет в списке этого месяца.'
                    : 'Этот сбор больше не активен.'
            await ctx.answer({ text, alert: true })
            return
        }
        void notifyDevsAboutClaim(client, devUserIds, duesOf(storage), periodKey, result.member).catch((err) =>
            console.error('[dues] не удалось уведомить дева о заявке:', err),
        )
        try {
            await ctx.editMessage({
                text: html(
                    `✅ Отметил взнос за ${duesPeriodLabel(periodKey).toLowerCase()}, ${formatMoney(result.member.amount)} ${html.escape(duesOf(storage).currency)}.<br>Ждём сверки с выпиской.`,
                ),
                replyMarkup: BotKeyboard.inline([]),
            })
        } catch (err) {
            console.warn('[dues] не удалось переписать сообщение о взносе:', err)
        }
        await ctx.answer({ text: 'Отметил' })
    })
}

// ---------------------------------------------------------------------------
// Шедулер
// ---------------------------------------------------------------------------

/**
 * Тик раз в минуту: открывает период, срок которого настал.
 *
 * Сравниваем не «сегодня день сбора», а «есть ли период за текущий расчётный месяц»:
 * так пропущенный за простой бота сбор откроется на первом же тике после старта, а
 * /skip, уехавший вперёд, не заставит открыть тот же месяц второй раз.
 */
export const startDuesScheduler = (
    client: TelegramClient,
    storage: Storage,
    directory: ResidentDirectory,
    tzOffsetMinutes: number,
): { stop: () => void } => {
    /** Ноль — первая сверка уходит на первом же тике: рестарт как раз и повод свериться. */
    let lastRosterSyncAt = 0

    const tick = async () => {
        const dues = duesOf(storage)
        if (!dues.enabled) return
        // Повторы недоставленных писем идут независимо от того, пора ли открывать период.
        await retryFailedDuesNotifications(client, storage)
        // Ростер — снимок состава, и человек, вышедший из чата резидентов, остаётся в нём
        // должником до чьего-нибудь тапа по «Я внёс»: остальные вызовы `syncDuesRoster`
        // висят на ручках миниаппа. `list()` кэширован на пять минут, так что час сверки —
        // это один поход в Telegram.
        const now = Date.now()
        if (now - lastRosterSyncAt >= ROSTER_SYNC_INTERVAL_MS) {
            lastRosterSyncAt = now
            const active = activeDuesPeriod(dues)
            if (active) await syncDuesRoster(storage, directory, active.periodKey)
        }
        const currentKey = duesPeriodKeyOf(new Date(), dues.day, tzOffsetMinutes)
        const latest = periodKeysOf(dues).pop()
        if (latest !== undefined && latest >= currentKey) return
        await openDuesPeriod(client, storage, directory, currentKey)
    }

    return startHeartbeatInterval('dues', TICK_INTERVAL_MS, tick, '[dues]')
}
