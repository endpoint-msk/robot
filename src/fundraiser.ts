import type { Donation, Fundraiser } from './types.js'

const MONTH_NAMES_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const

const MONTH_NAMES_RU_GENITIVE = [
    'Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
    'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря',
] as const

export const periodKeyOf = (date: Date): string => {
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}`
}

export const periodKey = (year: number, month: number): string =>
    `${year}-${String(month).padStart(2, '0')}`

export const monthNameRu = (month: number): string => MONTH_NAMES_RU[month - 1] ?? '?'
export const monthNameRuGenitive = (month: number): string => MONTH_NAMES_RU_GENITIVE[month - 1] ?? '?'

export const createFundraiser = (
    year: number,
    month: number,
    opts: { goal?: number; currency?: string; title?: string } = {},
): Fundraiser => ({
    periodKey: periodKey(year, month),
    year,
    month,
    goal: opts.goal ?? 0,
    currency: opts.currency ?? 'RUB',
    title: opts.title ?? 'аренду',
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

/** Эмодзи для топ-3 мест. Индексы: 0 → 🥇, 1 → 🥈, 2 → 🥉. */
const MEDAL_EMOJI = ['🥇', '🥈', '🥉'] as const

/** Запись лидерборда — все донаты одного ника, сложенные. */
export type LeaderboardEntry = {
    nick: string
    total: number
    donations: Donation[]
}

/** Группирует донаты по нику и сортирует по убыванию суммы. */
export const buildLeaderboard = (f: Fundraiser): LeaderboardEntry[] => {
    const acc = new Map<string, LeaderboardEntry>()
    for (const d of f.donations) {
        const key = d.nick.toLowerCase()
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

export const renderFundraiser = (f: Fundraiser, requestedPage = 1): RenderResult => {
    const total = totalAmount(f)
    const board = buildLeaderboard(f)
    const pages = totalPages(board)
    const page = clampPage(requestedPage, pages)
    const closed = f.goal > 0 && total >= f.goal

    const header = `Сбор на ${escapeHtml(f.title)} за ${monthNameRu(f.month)} ${f.year}.`
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
            lines.push(`${medal}${place}. ${nickLink(entry.nick)} — ${formatAmount(entry.total)}${f.currency}`)
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
    return { text: lines.join('<br>'), page, pages, closed }
}

/**
 * Парсит аргументы /donate.
 * Принимает: `/donate 10000 @otomir23` или `/donate 10000 otomir23` или
 *            `/donate @otomir23 10000` (порядок терпимый).
 * Возвращает {amount, nick} или строку с ошибкой.
 */
export const parseDonateArgs = (args: string[]): { amount: number; nick: string } | string => {
    if (args.length < 2) {
        return 'Использование: /donate <сумма> <ник>'
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
    if (amountStr === undefined || nick === undefined) {
        return 'Не удалось распознать сумму и ник. Пример: /donate 10000 @otomir23'
    }
    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'Сумма должна быть положительным числом.'
    }
    return { amount, nick: nick.replace(/^@+/, '') }
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
