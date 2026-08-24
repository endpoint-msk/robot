import type { Donation, Fundraiser } from './types.js'

const MONTH_NAMES_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const

const MONTH_NAMES_RU_GENITIVE = [
    'Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
    'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря',
] as const

export const periodKey = (year: number, month: number): string =>
    `${year}-${String(month).padStart(2, '0')}`

/** Допустимый диапазон дня сброса. Верх — 29, чтобы день существовал в любом месяце (включая февраль). */
export const MIN_RESET_DAY = 1
export const MAX_RESET_DAY = 29
export const DEFAULT_RESET_DAY = 1

/** Зажимает день сброса в [1..29] и округляет вниз. */
export const clampResetDay = (day: number): number =>
    Math.min(MAX_RESET_DAY, Math.max(MIN_RESET_DAY, Math.floor(day)))

/**
 * Год и месяц «периода», которому принадлежит дата, с учётом дня сброса.
 * Период стартует в `resetDay` числа: дата помечается месяцем, в котором период начался.
 * Сдвигаем дату назад на (resetDay-1) суток и берём её UTC-месяц — при resetDay=1 сдвига нет
 * (поведение по умолчанию = календарный месяц UTC).
 */
export const periodAnchorOf = (date: Date, resetDay = DEFAULT_RESET_DAY): { year: number; month: number } => {
    const shifted = new Date(date.getTime() - (clampResetDay(resetDay) - 1) * 86_400_000)
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 }
}

/**
 * Ключ периода. При resetDay=1 — `YYYY-MM` (как календарный месяц, обратная совместимость).
 * При resetDay≠1 — `YYYY-MM-DD` от даты старта, чтобы НЕ пересекаться с легаси-ключами
 * календарных месяцев: иначе период «25 июня → 24 июля» получил бы ключ `2026-06` и наложился
 * на ранее созданный календарный сбор за июнь.
 */
const keyForPeriod = (year: number, month: number, resetDay: number): string =>
    resetDay === DEFAULT_RESET_DAY
        ? periodKey(year, month)
        : `${periodKey(year, month)}-${String(resetDay).padStart(2, '0')}`

export const periodKeyOf = (date: Date, resetDay = DEFAULT_RESET_DAY): string => {
    const rd = clampResetDay(resetDay)
    const { year, month } = periodAnchorOf(date, rd)
    return keyForPeriod(year, month, rd)
}

export const monthNameRu = (month: number): string => MONTH_NAMES_RU[month - 1] ?? '?'
export const monthNameRuGenitive = (month: number): string => MONTH_NAMES_RU_GENITIVE[month - 1] ?? '?'

/** День сброса, закодированный в periodKey 3-м сегментом (`YYYY-MM-DD`). Для календарного ключа `YYYY-MM` — DEFAULT_RESET_DAY. */
const resetDayFromKey = (key: string): number => {
    const parts = key.split('-')
    if (parts.length < 3) return DEFAULT_RESET_DAY
    const day = Number(parts[2])
    return Number.isFinite(day) ? clampResetDay(day) : DEFAULT_RESET_DAY
}

/**
 * Месяц/год для ОТОБРАЖЕНИЯ. При нестандартном дне сброса период стартует в середине месяца
 * (например 25 июня) и охватывает в основном следующий месяц, поэтому показываем его на один
 * вперёд: старт 25 июня → «Июль». При resetDay=1 (календарный месяц) — без сдвига.
 * Декабрь→Январь с инкрементом года, чтобы не выйти за 1..12.
 */
export const displayPeriodOf = (year: number, month: number, resetDay: number): { year: number; month: number } => {
    if (clampResetDay(resetDay) === DEFAULT_RESET_DAY) return { year, month }
    return month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/** Подпись периода для показа: «Июнь 2026» (день сброса берётся из ключа сбора). */
export const fundraiserPeriodLabel = (f: Fundraiser): string => {
    const disp = displayPeriodOf(f.year, f.month, resetDayFromKey(f.periodKey))
    return `${monthNameRu(disp.month)} ${disp.year}`
}

export const createFundraiser = (
    year: number,
    month: number,
    opts: { goal?: number; currency?: string; title?: string; description?: string } = {},
    resetDay = DEFAULT_RESET_DAY,
): Fundraiser => ({
    periodKey: keyForPeriod(year, month, clampResetDay(resetDay)),
    year,
    month,
    goal: opts.goal ?? 0,
    currency: opts.currency ?? 'RUB',
    title: opts.title ?? 'аренду',
    description: opts.description ?? '',
    donations: [],
})

export const totalAmount = (f: Fundraiser): number =>
    f.donations.reduce((s, d) => s + d.amount, 0)

const PROGRESS_WIDTH = 10

/** Рисует прогресс-бар вида ====10%=== длиной PROGRESS_WIDTH символов '=' с процентом по центру. */
export const renderProgressBar = (current: number, goal: number): string => {
    if (goal <= 0) {
        return '=' .repeat(PROGRESS_WIDTH) + ' (цель не задана)'
    }
    const ratio = Math.max(0, Math.min(1, current / goal))
    const percent = Math.round(ratio * 100)
    const filled = Math.round(ratio * PROGRESS_WIDTH)
    const left = '='.repeat(filled)
    const right = '='.repeat(PROGRESS_WIDTH - filled)
    return `${left}${percent}%${right}`
}

/**
 * Голое число без разделителей. Это формат протокола табло (`renderBoardExport`) и
 * столбца CSV — прошивка и Excel парсят его как есть, поэтому пробелы и знак валюты
 * сюда добавлять нельзя. Всё, что читает человек, идёт через `formatMoney`.
 */
const formatAmount = (n: number): string => {
    if (Number.isInteger(n)) return n.toString()
    return n.toFixed(2)
}

/** Коды, у которых есть привычный знак. Незнакомый код печатаем как есть. */
const CURRENCY_SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' }

const currencySymbol = (currency: string): string => {
    const code = currency.trim()
    return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code
}

/** Сумма для чтения человеком: «10 000 ₽». */
export const formatMoney = (amount: number, currency: string): string => {
    const [int = '0', frac] = formatAmount(Math.abs(amount)).split('.')
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    const symbol = currencySymbol(currency)
    return `${amount < 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}${symbol ? ` ${symbol}` : ''}`
}

const escapeNick = (raw: string): string => raw.trim().replace(/^@+/, '')

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Ник как кликабельная t.me-ссылка вместо «сырого» @username.
 * Текст-ссылка не является mention-сущностью, поэтому Telegram не шлёт пинг
 * упомянутому пользователю (в отличие от plain @username).
 */
const nickLink = (rawNick: string): string => {
    const nick = escapeNick(rawNick)
    const href = `https://t.me/${encodeURIComponent(nick)}`
    return `<a href="${href}">@${escapeHtml(nick)}</a>`
}

/**
 * Описание сбора (реквизиты, ссылки) как готовая разметка: `html()` схлопывает `\n`
 * в пробел, поэтому перенос строки даёт только `<br>`. Отдельная функция, потому что
 * то же описание уходит человеку в ответ на `/donate` без прав админа.
 */
export const renderDescription = (description: string): string =>
    description.split('\n').map((l) => escapeHtml(l)).join('<br>')

/** Размер одной страницы лидерборда. */
export const PAGE_SIZE = 10

/** Подпись для донатов без ника. Все они группируются в одну запись лидерборда. */
export const ANON_LABEL = 'Анонимно'

/** Донат без ника — анонимный (ник пустой/пробелы). */
export const isAnonNick = (nick: string): boolean => nick.trim() === ''

/** Эмодзи для топ-3 мест. Индексы: 0 → 🥇, 1 → 🥈, 2 → 🥉. */
const MEDAL_EMOJI = ['🥇', '🥈', '🥉'] as const

/** Запись лидерборда — все донаты одного ника, сложенные. */
export type LeaderboardEntry = {
    nick: string
    total: number
    donations: Donation[]
}

/** Ключ группировки: анонимы — все в одно ведро, остальные — по нику в lower-case. */
const leaderboardKey = (nick: string): string => (isAnonNick(nick) ? '\x00anon' : nick.toLowerCase())

/** Группирует донаты по нику (анонимы — в одну запись) и сортирует по убыванию суммы. */
export const buildLeaderboard = (f: Fundraiser): LeaderboardEntry[] => {
    const acc = new Map<string, LeaderboardEntry>()
    for (const d of f.donations) {
        const key = leaderboardKey(d.nick)
        const existing = acc.get(key)
        if (existing) {
            existing.total += d.amount
            existing.donations.push(d)
        } else {
            acc.set(key, { nick: d.nick, total: d.amount, donations: [d] })
        }
    }
    return Array.from(acc.values()).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total
        return a.nick.localeCompare(b.nick)
    })
}

/** Сколько страниц у лидерборда (минимум 1). */
export const totalPages = (entries: LeaderboardEntry[]): number =>
    Math.max(1, Math.ceil(entries.length / PAGE_SIZE))

/** Нормализует страницу в [1..totalPages]. */
export const clampPage = (page: number, pages: number): number => {
    if (!Number.isFinite(page) || page < 1) return 1
    if (page > pages) return pages
    return Math.floor(page)
}

// ---------------------------------------------------------------------------
// Экспорт для табло (e-paper на микроконтроллере), см. GET /board в webapp.ts
// ---------------------------------------------------------------------------

/** Сколько строк донатеров уходит на табло, когда сегодня нет непринятых заявок. */
export const BOARD_LIMIT = 10

/**
 * Сколько строк донатеров остаётся, когда снизу встал блок заявок.
 * Вёрстка табло адаптивная: заявки важнее хвоста лидерборда, но и совсем его
 * прятать нельзя — экран должен оставаться узнаваемым.
 */
export const BOARD_LIMIT_WITH_REQUESTS = 3

/** Сколько заявок помещается в блок; остальные схлопываются в счётчик. */
export const BOARD_REQUEST_LIMIT = 3

/** Непринятая заявка в том виде, в каком она уходит на табло. */
export type BoardRequest = {
    /** 'HH:MM' по поясу спейса. */
    time: string
    /** Отображаемое имя гостя. */
    name: string
}

/** Блок «ждут ответа»: ближайший день с заявками плюс счётчик по всему горизонту. */
export type BoardRequests = {
    /** Подпись дня для показа: «сегодня», «завтра» или сокращение вроде «вс». */
    dayLabel: string
    /**
     * Сколько всего заявок ждёт ответа на горизонте хостинга — не только в этот день.
     * Показываем именно общее число: смысл блока в том, чтобы резидент видел объём
     * необработанного, а не только ближайшую заявку.
     */
    total: number
    items: BoardRequest[]
}

/**
 * Потолок длины ника в БАЙТАХ (не символах): прошивка читает ответ в статический
 * буфер, поэтому у ответа должен быть предсказуемый максимум. Кириллица в UTF-8 —
 * два байта на букву, так что 24 байта это 12 русских букв или 24 латинских.
 */
export const BOARD_NICK_BYTES = 24

/** Подпись периода, которому принадлежит дата (для табло, когда сбора ещё нет). */
export const currentPeriodLabel = (now: Date, resetDay: number): string => {
    const { year, month } = periodAnchorOf(now, resetDay)
    const disp = displayPeriodOf(year, month, resetDay)
    return `${monthNameRu(disp.month)} ${disp.year}`
}

/**
 * Обрезает ник до BOARD_NICK_BYTES по границе символа. Режем посимвольно, а не
 * `slice` по байтам: разрубленная пополам кириллическая буква даёт битый UTF-8,
 * и табло рисует крокозябру вместо последней буквы.
 */
const clampNickBytes = (nick: string): string => {
    if (Buffer.byteLength(nick, 'utf8') <= BOARD_NICK_BYTES) return nick
    let out = ''
    for (const ch of nick) {
        if (Buffer.byteLength(out + ch, 'utf8') > BOARD_NICK_BYTES) break
        out += ch
    }
    return out
}

/** Ник для табло: без ведущей собаки, без разделителей формата и в пределах лимита. */
const boardNick = (nick: string): string =>
    clampNickBytes(escapeNick(nick).replace(/[|\r\n]/g, ' '))

/**
 * Строит тело ответа для табло: построчный `key=value`, а не JSON.
 * На микроконтроллере это `strtok` по `\n` и `=` вместо парсера, а вся арифметика
 * (суммы по нику, сортировка, склейка анонимов) уже сделана здесь.
 *
 * `f = undefined` — сбора за текущий период ещё нет (бот создаёт его лениво, первым
 * `/goals` или `/donate`). Это штатное состояние первых дней периода, а не ошибка:
 * отдаём `state=none` с подписью периода, чтобы табло написало «сбор не начат», а не
 * показывало прошлый месяц как текущий.
 */
export const renderBoardExport = (
    f: Fundraiser | undefined,
    periodLabel: string,
    requests: BoardRequests = { dayLabel: '', total: 0, items: [] },
): string => {
    const total = f ? totalAmount(f) : 0
    const goal = f?.goal ?? 0
    const state = !f ? 'none' : (goal > 0 && total >= goal ? 'reached' : 'open')
    const board = f ? buildLeaderboard(f) : []
    // Строк лидерборда тем меньше, чем больше места забрал блок заявок. Решение
    // принимается здесь, а не в прошивке: так вёрстку можно менять деплоем бота.
    const donorLines = requests.items.length > 0 ? BOARD_LIMIT_WITH_REQUESTS : BOARD_LIMIT
    const lines = [
        'v=1',
        `period=${f ? fundraiserPeriodLabel(f) : periodLabel}`,
        `title=${f?.title ?? ''}`,
        `currency=${f?.currency ?? ''}`,
        `goal=${formatAmount(goal)}`,
        `total=${formatAmount(total)}`,
        `state=${state}`,
        `donors=${board.length}`,
        `waiting=${requests.total}`,
    ]
    for (const entry of board.slice(0, donorLines)) {
        const who = isAnonNick(entry.nick) ? ANON_LABEL : boardNick(entry.nick)
        lines.push(`d=${who}|${formatAmount(entry.total)}`)
    }
    if (requests.items.length > 0) {
        lines.push(`rday=${requests.dayLabel}`)
        // Сортируем здесь, а не полагаемся на вызывающего: порядок строк на табло —
        // часть формата, и он не должен зависеть от того, кто собирал список.
        const byTime = [...requests.items].sort((a, b) => a.time.localeCompare(b.time))
        for (const r of byTime.slice(0, BOARD_REQUEST_LIMIT)) {
            lines.push(`r=${r.time}|${boardNick(r.name)}`)
        }
    }
    return lines.join('\n') + '\n'
}

export type RenderResult = {
    /** HTML-разметка сообщения (ники — t.me-ссылки, чтобы не пинговать). Парсить через `html()`. */
    text: string
    page: number
    pages: number
    closed: boolean
}

/** Топ-3 донатера прошлого месяца одной строкой (без сумм). Пустая строка — если сбора не было или он пуст. */
const renderPreviousTop = (prev: Fundraiser): string => {
    const board = buildLeaderboard(prev).slice(0, MEDAL_EMOJI.length)
    if (board.length === 0) return ''
    const parts = board.map((entry, i) => {
        const who = isAnonNick(entry.nick) ? ANON_LABEL : nickLink(entry.nick)
        return `${MEDAL_EMOJI[i]} ${who}`
    })
    const disp = displayPeriodOf(prev.year, prev.month, resetDayFromKey(prev.periodKey))
    return `Топ за ${monthNameRu(disp.month)}: ${parts.join(' · ')}`
}

/**
 * Момент окончания периода = старт следующего (UTC). `f.month` 1-based, поэтому
 * `Date.UTC(year, month, day)` сам перекатывает декабрь в январь следующего года.
 * День сброса берём из ключа сбора, а не из текущей настройки: `/setresetday` двигает
 * только будущие периоды, у уже заведённого граница остаётся прежней.
 */
const periodEndUtc = (f: Fundraiser): number =>
    Date.UTC(f.year, f.month, resetDayFromKey(f.periodKey))

/** Начало UTC-суток, которым принадлежит дата. */
const utcDayStart = (date: Date): number =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

/**
 * Сколько целых суток осталось до сброса сбора. Считаем по границам UTC-суток, а не
 * по разнице миллисекунд: «осталось 14 дней» не должно превращаться в 13 к вечеру.
 * 0 и меньше — период уже закончился (так отсекается история прошлых сборов).
 */
export const daysLeftInPeriod = (f: Fundraiser, now: Date = new Date()): number =>
    Math.round((periodEndUtc(f) - utcDayStart(now)) / 86_400_000)

/** Русское склонение: 1 день, 2 дня, 5 дней, 21 день. */
const pluralDays = (n: number): string => {
    const mod100 = n % 100
    if (mod100 >= 11 && mod100 <= 14) return 'дней'
    const mod10 = n % 10
    if (mod10 === 1) return 'день'
    if (mod10 >= 2 && mod10 <= 4) return 'дня'
    return 'дней'
}

/** Строка «сколько осталось» под прогресс-баром. Пустая — если период уже закрыт. */
const renderDaysLeft = (f: Fundraiser, now: Date): string => {
    const days = daysLeftInPeriod(f, now)
    if (days <= 0) return ''
    if (days === 1) return '⏳ Сегодня последний день сбора'
    return `⏳ До конца сбора ${days} ${pluralDays(days)}`
}

export const renderFundraiser = (
    f: Fundraiser,
    requestedPage = 1,
    previous?: Fundraiser,
    now: Date = new Date(),
): RenderResult => {
    const total = totalAmount(f)
    const board = buildLeaderboard(f)
    const pages = totalPages(board)
    const page = clampPage(requestedPage, pages)
    const closed = f.goal > 0 && total >= f.goal

    const header = `Сбор на ${escapeHtml(f.title)} за ${fundraiserPeriodLabel(f)}.`
    const bar = renderProgressBar(total, f.goal)

    const lines: string[] = [header, bar]
    // У закрытого сбора дедлайн уже не важен — там своя строка «цель достигнута».
    const daysLeft = closed ? '' : renderDaysLeft(f, now)
    if (daysLeft) lines.push(daysLeft)
    if (board.length === 0) {
        lines.push('', 'Пока нет ни одного доната.')
    } else {
        lines.push('')
        const start = (page - 1) * PAGE_SIZE
        const end = Math.min(board.length, start + PAGE_SIZE)
        for (let i = start; i < end; i++) {
            const entry = board[i]!
            const place = i + 1
            const medal = i < MEDAL_EMOJI.length ? `${MEDAL_EMOJI[i]} ` : ''
            const who = isAnonNick(entry.nick) ? ANON_LABEL : nickLink(entry.nick)
            lines.push(`${medal}${place}. ${who} — ${formatMoney(entry.total, f.currency)}`)
        }
        lines.push('')
        const goalSuffix = f.goal > 0 ? ` из ${formatMoney(f.goal, f.currency)}` : ''
        lines.push(`Итого: ${formatMoney(total, f.currency)}${goalSuffix}`)
        if (pages > 1) {
            lines.push(`Страница ${page}/${pages}`)
        }
    }
    if (closed) {
        lines.push('', '✅ Сбор закрыт — цель достигнута!')
    }
    if (previous) {
        const prevTop = renderPreviousTop(previous)
        if (prevTop) {
            lines.push('', prevTop)
        }
    }
    const description = (f.description ?? '').trim()
    if (description) {
        // Многострочное описание (реквизиты/ссылки): каждая строка экранируется,
        // переносы — через <br>. URL Telegram подсветит сам, даже без web-превью.
        lines.push('', renderDescription(description))
    }
    return { text: lines.join('<br>'), page, pages, closed }
}

/**
 * Завершённые сборы, свежие сверху: без текущего периода и без пустых.
 * Пустые отсекаем намеренно — период заводится автоматически при первом обращении,
 * и месяц без единого доната в истории только шумит.
 */
export const pastFundraisers = (all: Fundraiser[], currentKey: string): Fundraiser[] =>
    all
        .filter((f) => f.periodKey !== currentKey && f.donations.length > 0)
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey))

/** Список прошлых сборов: период, итог, цель и отметка «цель взята». */
export const renderHistoryList = (past: Fundraiser[], truncated = false): string => {
    if (past.length === 0) return 'Прошлых сборов пока нет.'
    const lines = ['История сборов:', '']
    for (const f of past) {
        const total = totalAmount(f)
        const goalSuffix = f.goal > 0 ? ` из ${formatMoney(f.goal, f.currency)}` : ''
        const done = f.goal > 0 && total >= f.goal ? ' ✅' : ''
        lines.push(`${fundraiserPeriodLabel(f)} — ${formatMoney(total, f.currency)}${goalSuffix}${done}`)
    }
    lines.push('')
    // Текст уходит через html(): угловые скобки в подсказке дали бы «тег», поэтому пример без них.
    if (truncated) lines.push('Показаны только последние периоды. Остальные — командой вида /history 2026-06.')
    lines.push('Открыть сбор целиком — кнопкой ниже.')
    return lines.join('<br>')
}

/** Экранирует поле по RFC 4180: оборачивает в кавычки, если есть `,`, `"`, перенос или крайние пробелы. */
const csvField = (raw: string): string => {
    const s = raw ?? ''
    if (/[",\r\n]/.test(s) || s !== s.trim()) {
        return `"${s.replace(/"/g, '""')}"`
    }
    return s
}

/**
 * CSV с итогами по каждому нику за каждый сбор (RFC 4180, CRLF).
 * Столбцы: месяц (`periodKey`, напр. `2026-06`), ник, суммарный донат за месяц.
 * Внутри месяца — та же группировка и сортировка, что в лидерборде (по убыванию суммы,
 * анонимы схлопнуты в одну строку под ANON_LABEL). Месяцы — по возрастанию periodKey.
 */
export const buildDonationsCsv = (fundraisers: Fundraiser[]): string => {
    const header = ['Месяц', 'Ник', 'Сумма']
    const rows: string[] = [header.join(',')]
    const sorted = [...fundraisers].sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    for (const f of sorted) {
        for (const entry of buildLeaderboard(f)) {
            const nick = isAnonNick(entry.nick) ? ANON_LABEL : entry.nick
            rows.push([
                csvField(f.periodKey),
                csvField(nick),
                csvField(formatAmount(entry.total)),
            ].join(','))
        }
    }
    return rows.join('\r\n')
}

/**
 * Парсит аргументы /donate.
 * Принимает: `/donate 10000 @otomir23` или `/donate 10000 otomir23` или
 *            `/donate @otomir23 10000` (порядок терпимый).
 * Ник можно опустить — `/donate 10000` добавит анонимный донат (nick === '').
 * Возвращает {amount, nick} или строку с ошибкой.
 */
export const parseDonateArgs = (args: string[]): { amount: number; nick: string } | string => {
    if (args.length < 1) {
        return 'Использование: /donate <сумма> [ник] (без ника — анонимно)'
    }
    let amountStr: string | undefined
    let nick: string | undefined
    for (const a of args) {
        const cleaned = a.replace(',', '.')
        if (/^-?\d+(\.\d+)?$/.test(cleaned) && amountStr === undefined) {
            amountStr = cleaned
        } else if (nick === undefined) {
            nick = a
        }
    }
    if (amountStr === undefined) {
        return 'Не удалось распознать сумму. Пример: /donate 10000 @otomir23 или /donate 10000'
    }
    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'Сумма должна быть положительным числом.'
    }
    return { amount, nick: (nick ?? '').replace(/^@+/, '') }
}

/**
 * Парсит аргументы /remove.
 * Принимает либо номер позиции `/remove 2`, либо ник `/remove @otomir23` (удалит первое вхождение),
 * либо комбинацию `/remove @otomir23 10000` (удалит первое совпадение по нику и сумме).
 */
export type RemoveSpec =
    | { kind: 'index'; index: number }
    | { kind: 'nick'; nick: string; amount?: number }

export const parseRemoveArgs = (args: string[]): RemoveSpec | string => {
    if (args.length === 0) {
        return 'Использование: /remove <номер> или /remove <ник> [сумма]'
    }
    if (args.length === 1) {
        const a = args[0]!
        if (/^\d+$/.test(a)) return { kind: 'index', index: Number(a) }
        return { kind: 'nick', nick: a.replace(/^@+/, '') }
    }
    // 2+ аргумента: ник + сумма (в любом порядке)
    let amount: number | undefined
    let nick: string | undefined
    for (const a of args) {
        const cleaned = a.replace(',', '.')
        if (/^-?\d+(\.\d+)?$/.test(cleaned) && amount === undefined) {
            amount = Number(cleaned)
        } else if (nick === undefined) {
            nick = a.replace(/^@+/, '')
        }
    }
    if (nick === undefined) return 'Не указан ник для удаления.'
    return { kind: 'nick', nick, amount }
}
