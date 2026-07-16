/* Миниапп хостинга: заявки гостей на визит + одобрение резидентами.
   Вся отрисовка — на DOM-хелперах без innerHTML для пользовательских строк.
   Экраны и стили следуют «Раскадровке хостинга v2» (светлый iOS). */
'use strict'

const tg = window.Telegram ? window.Telegram.WebApp : null

// ---------------------------------------------------------------------------
// DOM-хелперы
// ---------------------------------------------------------------------------

function h(tag, attrs, ...children) {
    const node = document.createElement(tag)
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === null || v === undefined || v === false) continue
            if (k === 'class') node.className = v
            else if (k === 'style') node.style.cssText = v
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
            else node.setAttribute(k, v)
        }
    }
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue
        node.append(c.nodeType ? c : document.createTextNode(String(c)))
    }
    return node
}

/** Только для статичных SVG-иконок — никакого пользовательского контента. */
function svg(markup) {
    const tpl = document.createElement('template')
    tpl.innerHTML = markup.trim()
    return tpl.content.firstChild
}

const icons = {
    chevron: (color) => svg(`<svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" fill="none" stroke="${color || 'rgba(60,60,67,0.3)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    back: () => svg('<svg width="11" height="18" viewBox="0 0 11 18"><path d="M9.5 1.5L2 9l7.5 7.5" fill="none" stroke="#007aff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
    check: (size, color, width) => svg(`<svg width="${size}" height="${size}" viewBox="0 0 14 14"><path d="M2.5 7.5l3 3L11.5 4" fill="none" stroke="${color}" stroke-width="${width || 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    clock: (size, color) => svg(`<svg width="${size}" height="${size}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="${color}" stroke-width="1.6"/><path d="M9 5v4.2l2.6 1.6" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    plus: () => svg('<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 3v12M3 9h12" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'),
    plusSmall: () => svg('<svg width="14" height="14" viewBox="0 0 18 18"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'),
    lock: () => svg('<svg width="13" height="13" viewBox="0 0 18 18"><path d="M4 8V6.5a5 5 0 0 1 10 0V8" fill="none" stroke="rgba(60,60,67,0.55)" stroke-width="1.6"/><rect x="3.5" y="8" width="11" height="7.5" rx="2" fill="none" stroke="rgba(60,60,67,0.55)" stroke-width="1.6"/></svg>'),
    info: () => svg('<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="rgba(60,60,67,0.35)" stroke-width="1.4"/><path d="M8 7v4M8 5h.01" stroke="rgba(60,60,67,0.45)" stroke-width="1.6" stroke-linecap="round"/></svg>'),
    archiveBox: () => svg('<svg width="16" height="16" viewBox="0 0 18 18"><rect x="2.5" y="3" width="13" height="4" rx="1.2" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M4 7v6.2A1.8 1.8 0 0 0 5.8 15h6.4a1.8 1.8 0 0 0 1.8-1.8V7M7.3 10h3.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>'),
    gear: () => svg('<svg width="17" height="17" viewBox="0 0 20 20"><path d="M4 6h5M13 6h3M4 14h3M11 14h5" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="11" cy="6" r="2" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="9" cy="14" r="2" fill="none" stroke="#fff" stroke-width="1.7"/></svg>'),
    bell: () => svg('<svg width="16" height="16" viewBox="0 0 18 18"><path d="M9 2.2a4.6 4.6 0 0 0-4.6 4.6c0 3.4-1.4 4.6-1.4 4.6h12s-1.4-1.2-1.4-4.6A4.6 4.6 0 0 0 9 2.2zM7.4 14.2a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
    wifi: () => svg('<svg width="17" height="17" viewBox="0 0 20 20"><path d="M3 8.2a10 10 0 0 1 14 0M5.6 11a6.4 6.4 0 0 1 8.8 0M8.2 13.7a2.8 2.8 0 0 1 3.6 0" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="16" r="1.2" fill="#fff"/></svg>'),
    eye: () => svg('<svg width="14" height="14" viewBox="0 0 20 20"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'),
    minusCircle: () => svg('<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.5" fill="#ff3b30"/><path d="M6.8 11h8.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'),
}

// ---------------------------------------------------------------------------
// Даты и текст. Ключ дня — 'YYYY-MM-DD' в поясе спейса, приходит с сервера.
// ---------------------------------------------------------------------------

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

const keyToDate = (k) => new Date(k + 'T12:00:00Z')
const weekdayIdx = (k) => (keyToDate(k).getUTCDay() + 6) % 7
const dayNum = (k) => keyToDate(k).getUTCDate()
const monthIdx = (k) => keyToDate(k).getUTCMonth()
const yearOf = (k) => keyToDate(k).getUTCFullYear()
const addDays = (k, n) => {
    const d = keyToDate(k)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}

const fmtDayMonth = (k) => `${dayNum(k)} ${MONTHS_GEN[monthIdx(k)]}`
const fmtRange = (a, b) => (monthIdx(a) === monthIdx(b) && yearOf(a) === yearOf(b)
    ? `${dayNum(a)}–${dayNum(b)} ${MONTHS_GEN[monthIdx(b)]}`
    : `${fmtDayMonth(a)} – ${fmtDayMonth(b)}`)
const fmtWeekdayDate = (k) => `${WEEKDAYS_FULL[weekdayIdx(k)]}, ${fmtDayMonth(k)}`
const fmtShortDate = (k) => `${WEEKDAYS_SHORT[weekdayIdx(k)]}, ${fmtDayMonth(k)}`

function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100
    const d = abs % 10
    if (abs > 10 && abs < 20) return many
    if (d === 1) return one
    if (d >= 2 && d <= 4) return few
    return many
}
const requestsWord = (n) => `${n} ${plural(n, 'заявка', 'заявки', 'заявок')}`

// ---------------------------------------------------------------------------
// Аватарки: градиент по userId, буква — первая из имени
// ---------------------------------------------------------------------------

const GRADIENTS = [
    ['#6fc7ff', '#2f7bff'], ['#ff9db8', '#ff4f7e'], ['#ffc06a', '#ff7d2e'], ['#c39bff', '#7d52f0'],
    ['#5fe0c4', '#14a58a'], ['#8b96ff', '#4c56d8'], ['#ff9d8a', '#e0483e'], ['#f79bff', '#c44fe0'],
]

function avatar(user, extraClass) {
    const [c1, c2] = GRADIENTS[Math.abs(user.userId) % GRADIENTS.length]
    const node = h('div', { class: 'avatar' + (extraClass ? ' ' + extraClass : '') })
    node.style.background = `linear-gradient(135deg, ${c1}, ${c2})`
    node.textContent = ((user.name || user.username || '?').trim().charAt(0) || '?').toUpperCase()
    return node
}

const userLabel = (u) => (u.username ? '@' + u.username : u.name)

// ---------------------------------------------------------------------------
// API и стор
// ---------------------------------------------------------------------------

const store = { data: null, perspective: 'guest' }

async function api(method, params) {
    const res = await fetch('/api/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ initData: tg ? tg.initData : '' }, params || {})),
    })
    let data = {}
    try { data = await res.json() } catch { /* не-JSON — ниже упадём в generic */ }
    if (!res.ok) {
        const err = new Error(data.message || 'Что-то пошло не так. Попробуй ещё раз.')
        err.code = data.error
        throw err
    }
    return data
}

const setBusy = (on) => document.body.classList.toggle('busy', on)

function showAlert(message) {
    try { tg.showAlert(message) } catch { window.alert(message) }
}

function confirmDialog(message) {
    return new Promise((resolve) => {
        try {
            tg.showConfirm(message, (ok) => resolve(!!ok))
        } catch {
            resolve(window.confirm(message))
        }
    })
}

function haptic(kind) {
    try { tg.HapticFeedback.notificationOccurred(kind) } catch { /* старый клиент */ }
}

/** Мутация, возвращающая свежий bootstrap: обновляет стор и перерисовывает экран. */
async function action(method, params) {
    setBusy(true)
    try {
        const data = await api(method, params)
        store.data = data
        rerender()
        return data
    } catch (err) {
        showAlert(err.message)
        if (err.code === 'already_approved' || err.code === 'not_found' || err.code === 'not_approved') {
            // Данные разошлись с сервером — подтягиваем актуальные.
            try {
                store.data = await api('bootstrap')
                rerender()
            } catch { /* сеть легла — оставляем как есть */ }
        }
        return null
    } finally {
        setBusy(false)
    }
}

// ---------------------------------------------------------------------------
// Навигация: стек экранов + системная кнопка «назад»
// ---------------------------------------------------------------------------

const stack = []

function render(keepScroll) {
    const y = keepScroll ? window.scrollY : 0
    const app = document.getElementById('app')
    const top = stack[stack.length - 1]
    app.replaceChildren(SCREENS[top.name](top.params || {}))
    window.scrollTo(0, y)
    if (tg) {
        try {
            if (stack.length > 1) tg.BackButton.show()
            else tg.BackButton.hide()
        } catch { /* старый клиент без BackButton */ }
    }
}

const rerender = () => render(true)
const push = (name, params) => { stack.push({ name, params }); render(false) }
function pop() {
    if (stack.length > 1) {
        stack.pop()
        render(false)
    }
}
function resetRoot() {
    stack.length = 0
    stack.push({ name: store.perspective === 'resident' ? 'overview' : 'myVisits', params: {} })
    render(false)
}

// ---------------------------------------------------------------------------
// Общие фрагменты экранов
// ---------------------------------------------------------------------------

const backRow = (label) => h('div', { class: 'back-row', onclick: pop }, icons.back(), label)

function header(title, subtitle, chip) {
    return h('div', { class: 'header' },
        chip ? h('div', { class: 'header-chip-row' }, chip) : null,
        h('div', { class: 'title' }, title),
        subtitle ? h('div', { class: 'subtitle' }, subtitle) : null,
    )
}

/** Дев-переключатель перспективы «резидент ↔ гость» (только для DEV_USERNAMES из .env). */
function devChip() {
    if (!store.data.me.isDev) return null
    const other = store.perspective === 'resident' ? 'guest' : 'resident'
    return h('div', {
        class: 'dev-chip',
        onclick: () => {
            store.perspective = other
            resetRoot()
        },
    }, icons.eye(), other === 'guest' ? 'Как гость' : 'Как резидент')
}

const sectionTitle = (text) => h('div', { class: 'section-title' }, text)
const sep = (leftPx) => h('div', { class: 'sep', style: `margin-left:${leftPx}px` })

const spinnerCenter = () => h('div', { style: 'display:flex;justify-content:center;padding:40px 0' }, h('div', { class: 'spinner' }))

function emptyState(title, text, icon) {
    return h('div', { class: 'empty-state' },
        icon ? h('div', { class: 'es-icon' }, icon) : null,
        h('div', { class: 'es-title' }, title),
        text ? h('div', { class: 'es-text' }, text) : null,
    )
}

const avatarStack = (users, max) =>
    h('div', { class: 'avatar-stack' }, users.slice(0, max || 3).map((u) => avatar(u)))

/** Строка заявки в деталях дня: гость, время, цель; справа — одобривший или «Захостить». */
function requestRow(r, opts) {
    const me = store.data.me
    const sub = (r.guest.username ? '@' + r.guest.username + ' · ' : '') + 'к ' + r.time
    const main = h('div', { class: 'req-main' },
        h('div', { class: 'req-name' }, r.guest.name),
        h('div', { class: 'req-sub' }, sub),
        r.purpose ? h('div', { class: 'req-purpose' }, r.purpose) : null,
    )
    let right
    if (r.status === 'approved' && r.approvedBy) {
        const mine = !opts.archive && r.approvedBy.userId === me.id
        const pill = h('div', { class: 'pill' + (mine ? ' mine' : '') },
            avatar(r.approvedBy),
            h('span', { class: 'pill-name' }, userLabel(r.approvedBy)),
            mine ? h('span', { class: 'pill-x' }, '✕') : null,
        )
        if (mine) {
            pill.addEventListener('click', async () => {
                const ok = await confirmDialog(`Отменить хостинг? Заявка ${r.guest.name} снова будет ждать ответа.`)
                if (!ok) return
                const done = await action('unapprove', { id: r.id })
                if (done) haptic('warning')
            })
        }
        right = h('div', { class: 'approver' },
            h('span', { class: 'approver-label' }, 'одобрил'),
            pill,
        )
    } else if (opts.archive) {
        right = h('span', { class: 'waiting-label' }, 'Без ответа')
    } else {
        right = h('button', {
            class: 'host-btn',
            onclick: async () => {
                const ok = await confirmDialog(`Захостить: ${r.guest.name}${r.guest.username ? ' (@' + r.guest.username + ')' : ''}, ${fmtShortDate(r.dateKey)} к ${r.time}?`)
                if (!ok) return
                const done = await action('approve', { id: r.id })
                if (done) haptic('success')
            },
        }, 'Захостить')
    }
    return h('div', { class: 'row' }, avatar(r.guest, 'req-avatar'), main, right)
}

/** Карточка со строками заявок и разделителями. */
function requestsCard(list, opts) {
    const card = h('div', { class: 'card' })
    list.forEach((r, i) => {
        if (i > 0) card.append(sep(66))
        card.append(requestRow(r, opts))
    })
    return card
}

// ---------------------------------------------------------------------------
// Экран: обзор недели (резидент)
// ---------------------------------------------------------------------------

function dayRow(day, opts) {
    const isToday = day.dateKey === store.data.todayKey
    const empty = day.total === 0
    const row = h('div', {
        class: 'row' + (opts.tappable && !empty ? ' tappable' : '') + (isToday ? ' today' : '') + (empty ? ' day-empty' : ''),
    })
    row.append(h('div', { class: 'day-col' },
        h('div', { class: 'dow' }, WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]),
        h('div', { class: 'date' }, isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)),
    ))
    if (empty) {
        row.append(h('span', { class: 'day-none' }, 'Нет заявок'))
        return row
    }
    const guests = (day.requests || []).map((r) => r.guest)
    if (guests.length > 0) row.append(avatarStack(guests))
    row.append(h('span', { class: 'day-count' }, requestsWord(day.total)))
    const right = h('div', { class: 'row-right' })
    if (day.approved > 0 || opts.alwaysApproved) {
        right.append(h('div', { class: 'approved-count' }, icons.check(14, '#34c759'), String(day.approved)))
    }
    if (opts.tappable) right.append(icons.chevron(isToday ? 'rgba(60,60,67,0.4)' : undefined))
    row.append(right)
    if (opts.tappable) row.addEventListener('click', opts.onopen)
    return row
}

function screenOverview() {
    const { days } = store.data
    const total = days.reduce((sum, d) => sum + d.total, 0)
    const first = days[0].dateKey
    const last = days[days.length - 1].dateKey

    const daysCard = h('div', { class: 'card' })
    days.forEach((day, i) => {
        if (i > 0) daysCard.append(sep(86))
        daysCard.append(dayRow(day, {
            tappable: true,
            onopen: () => push('day', { dateKey: day.dateKey }),
        }))
    })

    const navCard = h('div', { class: 'card' },
        h('div', { class: 'row tappable', onclick: () => push('archive') },
            h('div', { class: 'row-icon', style: 'background:#5856d6' }, icons.archiveBox()),
            h('span', { class: 'row-label' }, 'Архив'),
            h('div', { class: 'row-right' }, icons.chevron()),
        ),
        sep(54),
        h('div', { class: 'row tappable', onclick: () => push('settings') },
            h('div', { class: 'row-icon', style: 'background:#8e8e93' }, icons.gear()),
            h('span', { class: 'row-label' }, 'Настройки'),
            h('div', { class: 'row-right' }, icons.chevron()),
        ),
    )

    return h('div', { class: 'screen' },
        header('Ближайшие дни', `${fmtRange(first, last)} · ${requestsWord(total)}`, devChip()),
        daysCard,
        h('div', { style: 'height:22px' }),
        navCard,
    )
}

// ---------------------------------------------------------------------------
// Экран: детали дня (резидент; в архиве — только просмотр)
// ---------------------------------------------------------------------------

function screenDay(params) {
    const archive = !!params.archive
    let requests
    if (archive) {
        requests = params.requests || []
    } else {
        const day = store.data.days.find((d) => d.dateKey === params.dateKey)
        requests = (day && day.requests) || []
    }
    const approved = requests.filter((r) => r.status === 'approved')
    const pending = requests.filter((r) => r.status !== 'approved')
    const isToday = !archive && params.dateKey === store.data.todayKey

    const parts = [
        backRow(archive ? 'Неделя' : 'Обзор'),
        header(WEEKDAYS_FULL[weekdayIdx(params.dateKey)],
            `${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${requestsWord(requests.length)}`),
    ]
    if (archive) {
        parts.push(h('div', { class: 'readonly-badge' }, icons.lock(), 'Архив · только просмотр'))
    }
    if (requests.length === 0) {
        parts.push(h('div', { class: 'card' }, emptyState(
            archive ? 'Заявок не было' : 'Нет заявок',
            archive ? 'В этот день никто не собирался прийти.' : 'На этот день пока никто не собирается прийти.',
        )))
    }
    if (approved.length > 0) {
        parts.push(sectionTitle(`Одобрены · ${approved.length}`), requestsCard(approved, { archive }))
    }
    if (pending.length > 0) {
        parts.push(sectionTitle(`Ждут ответа · ${pending.length}`), requestsCard(pending, { archive }))
    }
    return h('div', { class: 'screen' }, parts)
}

// ---------------------------------------------------------------------------
// Экран: архив — список недель
// ---------------------------------------------------------------------------

function weeksAgoLabel(weekStart) {
    const currentMonday = addDays(store.data.todayKey, -weekdayIdx(store.data.todayKey))
    const diffWeeks = Math.round((keyToDate(currentMonday) - keyToDate(weekStart)) / (7 * 24 * 3600 * 1000))
    if (diffWeeks <= 1) return 'Прошлая неделя'
    return `${diffWeeks} ${plural(diffWeeks, 'неделю', 'недели', 'недель')} назад`
}

function screenArchive() {
    const holder = h('div', null, spinnerCenter())
    api('archive').then(({ weeks }) => {
        holder.replaceChildren()
        if (weeks.length === 0) {
            holder.append(h('div', { class: 'card' }, emptyState('Архив пуст', 'Здесь появятся прошедшие недели с заявками.')))
            return
        }
        // Группируем недели по месяцу понедельника: «Июль 2026».
        let curMonth = ''
        let card = null
        for (const week of weeks) {
            const label = `${MONTHS_NOM[monthIdx(week.weekStart)]} ${yearOf(week.weekStart)}`
            if (label !== curMonth) {
                curMonth = label
                holder.append(sectionTitle(label))
                card = h('div', { class: 'card', style: 'margin-bottom:22px' })
                holder.append(card)
            } else if (card) {
                card.append(sep(70))
            }
            const weekEnd = addDays(week.weekStart, 6)
            card.append(h('div', {
                class: 'row tappable',
                onclick: () => push('archiveWeek', { weekStart: week.weekStart }),
            },
                h('div', { class: 'week-square' },
                    h('span', { class: 'ws-from' }, String(dayNum(week.weekStart))),
                    h('span', { class: 'ws-to' }, '–' + dayNum(weekEnd)),
                ),
                h('div', { style: 'min-width:0' },
                    h('div', { class: 'week-title' }, fmtRange(week.weekStart, weekEnd)),
                    h('div', { class: 'week-sub' }, weeksAgoLabel(week.weekStart)),
                ),
                h('div', { class: 'row-right' },
                    h('div', { class: 'approved-count', style: 'font-size:14px' }, icons.check(14, '#34c759'), String(week.approved)),
                    h('span', { class: 'count-muted' }, `/ ${week.total}`),
                    icons.chevron(),
                ),
            ))
        }
    }).catch((err) => {
        holder.replaceChildren(h('div', { class: 'card' }, emptyState('Не получилось загрузить', err.message)))
    })

    return h('div', { class: 'screen' },
        backRow('Обзор'),
        header('Архив', 'Прошедшие недели'),
        holder,
    )
}

// ---------------------------------------------------------------------------
// Экран: неделя в архиве
// ---------------------------------------------------------------------------

function screenArchiveWeek(params) {
    const weekEnd = addDays(params.weekStart, 6)
    const holder = h('div', null, spinnerCenter())
    const sub = h('div', { class: 'subtitle' }, '…')

    api('archive.week', { weekStart: params.weekStart }).then(({ days }) => {
        const all = days.flatMap((d) => d.requests)
        const approvedCount = all.filter((r) => r.status === 'approved').length
        sub.textContent = `${requestsWord(all.length)} · ${approvedCount} одобрено`
        holder.replaceChildren()
        const nonEmpty = days.filter((d) => d.requests.length > 0)
        if (nonEmpty.length === 0) {
            holder.append(h('div', { class: 'card' }, emptyState('Заявок не было', 'На этой неделе никто не оставлял заявки.')))
            return
        }
        const card = h('div', { class: 'card' })
        nonEmpty.forEach((d, i) => {
            if (i > 0) card.append(sep(86))
            card.append(dayRow({
                dateKey: d.dateKey,
                total: d.requests.length,
                approved: d.requests.filter((r) => r.status === 'approved').length,
                requests: d.requests,
            }, {
                tappable: true,
                alwaysApproved: true,
                onopen: () => push('day', { dateKey: d.dateKey, archive: true, requests: d.requests }),
            }))
        })
        holder.append(card)
    }).catch((err) => {
        holder.replaceChildren(h('div', { class: 'card' }, emptyState('Не получилось загрузить', err.message)))
    })

    const head = h('div', { class: 'header' },
        h('div', { class: 'title' }, fmtRange(params.weekStart, weekEnd)),
        sub,
    )
    return h('div', { class: 'screen' },
        backRow('Архив'),
        head,
        h('div', { class: 'readonly-badge' }, icons.lock(), 'Архив · только просмотр'),
        holder,
    )
}

// ---------------------------------------------------------------------------
// Экран: настройки (резидент): уведомления + авто-отметка по MAC
// ---------------------------------------------------------------------------

function switchEl(on, onToggle) {
    return h('button', {
        class: 'switch' + (on ? ' on' : ''),
        role: 'switch',
        'aria-checked': String(on),
        onclick: onToggle,
    })
}

function screenSettings() {
    const s = store.data.settings
    if (!s) return h('div', { class: 'screen' }, backRow('Обзор'), header('Настройки'), h('div', { class: 'card' }, emptyState('Только для резидентов', 'Настройки доступны админам подключённых чатов.')))

    const radioRow = (label, sublabel, mode) => h('div', {
        class: 'row tappable',
        onclick: () => { if (s.notify.mode !== mode) void action('notify', { enabled: s.notify.enabled, mode }) },
    },
        h('span', { class: 'row-label' }, label, h('span', { class: 'row-sublabel' }, sublabel)),
        h('div', { class: 'radio-check' }, s.notify.mode === mode ? icons.check(16, '#007aff', 2.2) : null),
    )

    const notifyCard = h('div', { class: 'card' },
        h('div', { class: 'row' },
            h('div', { class: 'row-icon', style: 'background:#ff9500' }, icons.bell()),
            h('span', { class: 'row-label' }, 'Новые заявки'),
            switchEl(s.notify.enabled, () => void action('notify', { enabled: !s.notify.enabled, mode: s.notify.mode })),
        ),
        sep(54),
        h('div', { class: s.notify.enabled ? '' : 'rows-disabled' },
            radioRow('Только на сегодня', 'Заявки на текущий день', 'today'),
            sep(14),
            radioRow('Все заявки', 'На любой день', 'all'),
        ),
    )

    // --- MAC-адреса ---
    const macCard = h('div', { class: 'card' })
    s.macs.forEach((m, i) => {
        if (i > 0) macCard.append(sep(14))
        macCard.append(h('div', { class: 'row' },
            h('span', { class: 'row-label' },
                m.label || 'Устройство',
                h('span', { class: 'row-sublabel mono' }, m.mac),
            ),
            h('button', {
                class: 'remove-btn',
                'aria-label': 'Убрать MAC',
                onclick: async () => {
                    const ok = await confirmDialog(`Убрать ${m.label ? '«' + m.label + '» ' : ''}${m.mac}? Авто-отметка по этому устройству перестанет работать.`)
                    if (ok) void action('mac.remove', { mac: m.mac })
                },
            }, icons.minusCircle()),
        ))
    })
    if (s.macs.length > 0) macCard.append(sep(14))

    const macInput = h('input', { class: 'text-input mono', placeholder: 'AA:BB:CC:DD:EE:FF', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' })
    const labelInput = h('input', { class: 'text-input', placeholder: 'Название (например, Телефон)', autocomplete: 'off' })
    const form = h('div', { style: 'display:none' },
        sep(14),
        h('div', { class: 'row' }, macInput),
        sep(14),
        h('div', { class: 'row' }, labelInput),
        h('div', { class: 'inline-form-actions' },
            h('button', {
                class: 'small-btn blue',
                onclick: async () => {
                    const mac = macInput.value.trim()
                    if (!mac) { macInput.focus(); return }
                    const done = await action('mac.add', { mac, label: labelInput.value })
                    if (done) haptic('success')
                },
            }, 'Привязать'),
            h('button', {
                class: 'small-btn gray',
                onclick: () => { form.style.display = 'none'; addRow.style.display = '' },
            }, 'Отмена'),
        ),
    )
    const addRow = h('div', {
        class: 'row tappable',
        onclick: () => { form.style.display = ''; addRow.style.display = 'none'; macInput.focus() },
    },
        h('div', { class: 'icon-plus-circle' }, icons.plusSmall()),
        h('span', { class: 'add-row-label' }, 'Добавить устройство'),
    )
    macCard.append(addRow, form)

    const anonCard = h('div', { class: 'card', style: 'margin-top:8px' },
        h('div', { class: 'row' + (s.macs.length === 0 ? ' rows-disabled' : '') },
            h('span', { class: 'row-label' }, 'Отмечаться без ника', h('span', { class: 'row-sublabel' }, 'В списке будет «Без ника»')),
            switchEl(s.macAnon, () => void action('mac.anon', { anon: !s.macAnon })),
        ),
    )

    return h('div', { class: 'screen' },
        backRow('Обзор'),
        header('Настройки', 'Уведомления и авто-отметка'),
        sectionTitle('Уведомления о заявках'),
        notifyCard,
        h('div', { class: 'footnote' }, icons.info(), 'Придут в личку от бота, когда гость оставит заявку. По умолчанию — только заявки на сегодня.'),
        sectionTitle('Авто-отметка по MAC'),
        h('div', { class: 'card', style: 'margin-bottom:8px' },
            h('div', { class: 'row' },
                h('div', { class: 'row-icon', style: 'background:#007aff' }, icons.wifi()),
                h('span', { class: 'row-label' }, 'Мои устройства', h('span', { class: 'row-sublabel' }, s.macPresenceActive ? 'Сейчас ты отмечен по MAC' : 'Авто-отметка сейчас не активна')),
            ),
        ),
        macCard,
        anonCard,
        h('div', { class: 'footnote' }, icons.info(), 'Пока устройство в сети спейса, бот сам ставит отметку «внутри». Выключи ротацию (рандомизацию) MAC для Wi-Fi спейса — иначе адрес будет меняться. Команды /bindmac, /unbindmac и /settings в боте работают как раньше и синхронизированы с этим списком.'),
    )
}

// ---------------------------------------------------------------------------
// Экран: мои визиты (гость)
// ---------------------------------------------------------------------------

function visitRow(r) {
    const approved = r.status === 'approved'
    const iconSquare = approved
        ? h('div', { class: 'status-square ok' }, icons.check(20, '#34c759'))
        : h('div', { class: 'status-square' }, icons.clock(18, 'rgba(60,60,67,0.5)'))
    const main = h('div', { class: 'req-main' },
        h('div', { class: 'req-name' }, fmtWeekdayDate(r.dateKey)),
        h('div', { class: 'req-sub' }, `к ${r.time} · ${approved ? 'подтверждён' : 'ждём резидента'}`),
    )
    let right
    if (approved && r.approvedBy) {
        right = h('div', { class: 'approver' },
            h('span', { class: 'approver-label' }, 'хостит'),
            h('div', { class: 'pill' }, avatar(r.approvedBy), h('span', { class: 'pill-name' }, userLabel(r.approvedBy))),
        )
    } else {
        right = h('span', { class: 'waiting-label' }, 'В ожидании')
    }
    return h('div', { class: 'row tappable', onclick: () => push('visit', { id: r.id }) }, iconSquare, main, right)
}

function screenMyVisits() {
    const my = store.data.myRequests
    const approved = my.filter((r) => r.status === 'approved')
    const pending = my.filter((r) => r.status !== 'approved')

    const parts = [header('Мои визиты', 'Ваши заявки в хакспейс', devChip())]
    if (my.length === 0) {
        parts.push(h('div', { class: 'card' }, emptyState(
            'Пока нет заявок',
            'Выбери день и время визита — резиденты увидят заявку и откликнутся.',
        )))
    }
    if (approved.length > 0) {
        const card = h('div', { class: 'card' })
        approved.forEach((r, i) => { if (i > 0) card.append(sep(66)); card.append(visitRow(r)) })
        parts.push(sectionTitle('Одобрены'), card)
    }
    if (pending.length > 0) {
        const card = h('div', { class: 'card' })
        pending.forEach((r, i) => { if (i > 0) card.append(sep(66)); card.append(visitRow(r)) })
        parts.push(sectionTitle('Ждут ответа'), card)
    }
    parts.push(h('div', { class: 'bottom-bar' },
        h('button', { class: 'primary-btn', onclick: () => push('newRequest') }, icons.plus(), 'Новая заявка'),
    ))
    return h('div', { class: 'screen has-bottom-bar' }, parts)
}

// ---------------------------------------------------------------------------
// Экран: статус визита (гость)
// ---------------------------------------------------------------------------

function screenVisit(params) {
    const r = store.data.myRequests.find((x) => x.id === params.id)
    if (!r) {
        // Заявку могли отменить/она протухла — возвращаемся к списку.
        setTimeout(() => pop(), 0)
        return h('div', { class: 'screen' })
    }
    const approved = r.status === 'approved' && r.approvedBy

    let statusCard
    if (approved) {
        statusCard = h('div', { class: 'status-card approved' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.check(14, '#fff')),
                h('span', { class: 'status-card-title' }, 'Ваш визит подтверждён'),
            ),
            h('div', { class: 'status-card-body' },
                avatar(r.approvedBy, 'host-avatar'),
                h('div', { style: 'min-width:0' },
                    h('div', { class: 'host-kicker' }, 'Вас хостит'),
                    h('div', { class: 'host-name' }, r.approvedBy.name),
                    h('div', { class: 'host-sub' }, (r.approvedBy.username ? '@' + r.approvedBy.username + ' · ' : '') + 'резидент'),
                ),
            ),
        )
    } else {
        statusCard = h('div', { class: 'status-card pending' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.clock(15, 'rgba(60,60,67,0.55)')),
                h('span', { class: 'status-card-title' }, 'Заявка ждёт ответа'),
            ),
            h('div', { class: 'status-card-note' }, 'Резиденты видят вашу заявку. Как только кто-то возьмётся захостить — бот напишет вам в личку.'),
        )
    }

    return h('div', { class: 'screen' },
        backRow('Мои визиты'),
        header(WEEKDAYS_FULL[weekdayIdx(r.dateKey)], `${fmtDayMonth(r.dateKey)} · к ${r.time}`),
        statusCard,
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row' },
                h('span', { class: 'kv-key' }, 'Когда'),
                h('span', { class: 'kv-val' }, `${fmtShortDate(r.dateKey)} · ${r.time}`),
            ),
            r.purpose ? sep(14) : null,
            r.purpose
                ? h('div', { class: 'kv-block' },
                    h('div', { class: 'kv-cap' }, 'Цель визита'),
                    h('div', { class: 'kv-text' }, r.purpose),
                )
                : null,
        ),
        h('div', { class: 'footnote' }, icons.info(), 'Другие гости и их заявки вам не видны — только ваш визит.'),
        h('div', { style: 'height:22px' }),
        h('button', {
            class: 'destructive-btn',
            onclick: async () => {
                const ok = await confirmDialog('Отменить заявку на визит?')
                if (!ok) return
                setBusy(true)
                try {
                    store.data = await api('cancel', { id: r.id })
                    haptic('warning')
                    pop()
                } catch (err) {
                    showAlert(err.message)
                } finally {
                    setBusy(false)
                }
            },
        }, 'Отменить заявку'),
    )
}

// ---------------------------------------------------------------------------
// Экран: новая заявка (общий для гостя и «гостевой» перспективы)
// ---------------------------------------------------------------------------

function defaultTimeFor(dateKey) {
    if (dateKey !== store.data.todayKey) return '15:00'
    // Для «сегодня» — ближайший целый час, но не позже 23:00.
    const next = Math.min(new Date().getHours() + 1, 23)
    return String(next).padStart(2, '0') + ':00'
}

function screenNewRequest() {
    const days = store.data.days
    let selected = days[0].dateKey
    let timeTouched = false

    const timeInput = h('input', { class: 'time-input', type: 'time', value: defaultTimeFor(selected) })
    timeInput.addEventListener('change', () => { timeTouched = true })

    const chips = h('div', { class: 'day-chips' })
    const renderChips = () => {
        chips.replaceChildren(...days.map((d) => {
            const counts = d.total > 0
                ? h('div', { class: 'dc-counts' },
                    h('span', null, String(d.total)),
                    icons.check(10, d.dateKey === selected ? '#fff' : '#34c759', 2.2),
                    h('span', { class: 'dc-approved' }, String(d.approved)),
                )
                : h('span', { class: 'dc-dash' }, '—')
            return h('button', {
                class: 'day-chip' + (d.dateKey === selected ? ' selected' : ''),
                onclick: () => {
                    selected = d.dateKey
                    if (!timeTouched) timeInput.value = defaultTimeFor(selected)
                    renderChips()
                },
            },
                h('span', { class: 'dc-dow' }, WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]),
                h('span', { class: 'dc-num' }, String(dayNum(d.dateKey))),
                counts,
            )
        }))
    }
    renderChips()

    const purpose = h('textarea', { class: 'purpose-input', placeholder: 'Цель визита (опционально)', rows: '2', maxlength: '300' })
    purpose.addEventListener('input', () => {
        purpose.style.height = 'auto'
        purpose.style.height = purpose.scrollHeight + 'px'
    })

    const submit = h('button', {
        class: 'primary-btn',
        onclick: async () => {
            if (!timeInput.value) {
                showAlert('Укажи время прихода.')
                return
            }
            submit.disabled = true
            setBusy(true)
            try {
                store.data = await api('create', { dateKey: selected, time: timeInput.value, purpose: purpose.value })
                haptic('success')
                resetRoot()
                showAlert('Заявка отправлена! Бот напишет, когда её одобрят.')
            } catch (err) {
                showAlert(err.message)
                submit.disabled = false
            } finally {
                setBusy(false)
            }
        },
    }, 'Отправить заявку')

    return h('div', { class: 'screen has-bottom-bar' },
        backRow('Назад'),
        header('Хочу прийти', 'Заявка на визит в хакспейс'),
        sectionTitle('День'),
        chips,
        h('div', { class: 'chips-legend' }, icons.check(12, '#34c759', 2.2), 'число заявок и уже одобренных в этот день'),
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row', style: 'padding:6px 14px' },
                h('span', { style: 'font-size:16px' }, 'Приду к'),
                timeInput,
            ),
            sep(14),
            h('div', { class: 'kv-block' }, purpose),
        ),
        h('div', { class: 'bottom-bar' },
            submit,
            h('div', { class: 'bar-hint' }, 'Ваша заявка будет отправлена резидентам'),
        ),
    )
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

const SCREENS = {
    overview: screenOverview,
    day: screenDay,
    archive: screenArchive,
    archiveWeek: screenArchiveWeek,
    settings: screenSettings,
    myVisits: screenMyVisits,
    visit: screenVisit,
    newRequest: screenNewRequest,
}

function boot() {
    const app = document.getElementById('app')
    document.body.append(h('div', { id: 'busy-overlay' }, h('div', { class: 'spinner' })))

    if (!tg || !tg.initData) {
        app.replaceChildren(h('div', { class: 'center-screen' },
            h('div', { style: 'font-size:40px' }, '🚪'),
            h('div', null, 'Откройте миниапп из Telegram — через кнопку меню в чате с ботом.'),
        ))
        return
    }

    try { tg.ready() } catch { /* noop */ }
    try { tg.expand() } catch { /* noop */ }
    try { tg.setHeaderColor('#f2f2f7') } catch { /* старый клиент */ }
    try { tg.setBackgroundColor('#f2f2f7') } catch { /* старый клиент */ }
    try { tg.disableVerticalSwipes() } catch { /* старый клиент */ }
    try { tg.BackButton.onClick(pop) } catch { /* старый клиент */ }

    app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'spinner' })))
    api('bootstrap').then((data) => {
        store.data = data
        store.perspective = data.me.isResident ? 'resident' : 'guest'
        resetRoot()
    }).catch((err) => {
        app.replaceChildren(h('div', { class: 'center-screen' },
            h('div', { style: 'font-size:40px' }, '😿'),
            h('div', null, 'Не получилось загрузиться: ' + err.message),
        ))
    })
}

boot()
