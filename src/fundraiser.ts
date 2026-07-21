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

/** Ключ предыдущего периода (на один цикл назад от старта (year, month)). Январь → декабрь прошлого года. */
export const previousPeriodKey = (year: number, month: number, resetDay = DEFAULT_RESET_DAY): string => {
    const rd = clampResetDay(resetDay)
    return month > 1 ? keyForPeriod(year, month - 1, rd) : keyForPeriod(year - 1, 12, rd)
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

const formatAmount = (n: number): string => {
    if (Number.isInteger(n)) return n.toString()
    return n.toFixed(2)
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

export const renderFundraiser = (
    f: Fundraiser,
    requestedPage = 1,
    previous?: Fundraiser,
): RenderResult => {
    const total = totalAmount(f)
    const board = buildLeaderboard(f)
    const pages = totalPages(board)
    const page = clampPage(requestedPage, pages)
    const closed = f.goal > 0 && total >= f.goal

    const disp = displayPeriodOf(f.year, f.month, resetDayFromKey(f.periodKey))
    const header = `Сбор на ${escapeHtml(f.title)} за ${monthNameRu(disp.month)} ${disp.year}.`
    const bar = renderProgressBar(total, f.goal)

    const lines: string[] = [header, bar]
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
            lines.push(`${medal}${place}. ${who} — ${formatAmount(entry.total)}${f.currency}`)
        }
        lines.push('')
        const goalSuffix = f.goal > 0 ? ` из ${formatAmount(f.goal)}${f.currency}` : ''
        lines.push(`Итого: ${formatAmount(total)}${f.currency}${goalSuffix}`)
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
        const descLines = description.split('\n').map((l) => escapeHtml(l))
        lines.push('', ...descLines)
    }
    return { text: lines.join('<br>'), page, pages, closed }
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
