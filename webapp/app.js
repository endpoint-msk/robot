/* Миниапп хостинга: заявки гостей на визит + одобрение резидентами.
   Вся отрисовка — на DOM-хелперах без innerHTML для пользовательских строк.
   Экраны и стили следуют «Раскадровке хостинга v2» (светлый iOS). */
'use strict'

const tg = window.Telegram ? window.Telegram.WebApp : null

// ---------------------------------------------------------------------------
// Тема. Выбор пользователя ('system' | 'light' | 'dark') живёт в localStorage —
// это клиентская настройка, гостям она нужна не меньше, чем резидентам, а на
// сервере хранить нечего. В CSS уходит уже разрешённая тема: data-theme на <html>.
// ---------------------------------------------------------------------------

const THEME_KEY = 'endpoint-hosting-theme'
const THEMES = ['system', 'light', 'dark']
const THEME_BG = { light: '#f2f2f7', dark: '#000000' }

function loadTheme() {
    try {
        const v = localStorage.getItem(THEME_KEY)
        return THEMES.includes(v) ? v : 'system'
    } catch {
        return 'system' // хранилище недоступно (приватный режим) — не падаем
    }
}

/** Системная тема: внутри Telegram — тема клиента, вне — системная настройка ОС. */
function systemTheme() {
    if (tg && tg.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light'
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch {
        return 'light'
    }
}

const resolvedTheme = () => (store.theme === 'system' ? systemTheme() : store.theme)

/** Вторичный цвет текущей темы с заданной альфой. Нужен для inline-SVG: в атрибут
    `stroke` CSS-переменную не подставить, поэтому цвет считаем в JS. */
const sec = (a) => `rgba(${resolvedTheme() === 'dark' ? '235, 235, 245' : '60, 60, 67'}, ${a})`

function applyTheme() {
    const t = resolvedTheme()
    document.documentElement.dataset.theme = t
    try { tg.setHeaderColor(THEME_BG[t]) } catch { /* старый клиент */ }
    try { tg.setBackgroundColor(THEME_BG[t]) } catch { /* старый клиент */ }
}

function setTheme(next) {
    store.theme = next
    try { localStorage.setItem(THEME_KEY, next) } catch { /* не сохранится — не критично */ }
    applyTheme()
    // Иконки рисуются цветом темы прямо в разметке SVG — нужна перерисовка.
    if (stack.length > 0) rerender()
}

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
    chevron: (color) => svg(`<svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" fill="none" stroke="${color || sec(0.3)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    back: () => svg('<svg width="11" height="18" viewBox="0 0 11 18"><path d="M9.5 1.5L2 9l7.5 7.5" fill="none" stroke="#007aff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
    check: (size, color, width) => svg(`<svg width="${size}" height="${size}" viewBox="0 0 14 14"><path d="M2.5 7.5l3 3L11.5 4" fill="none" stroke="${color}" stroke-width="${width || 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    clock: (size, color) => svg(`<svg width="${size}" height="${size}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="${color}" stroke-width="1.6"/><path d="M9 5v4.2l2.6 1.6" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    plus: () => svg('<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 3v12M3 9h12" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'),
    plusSmall: () => svg('<svg width="14" height="14" viewBox="0 0 18 18"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'),
    lock: () => svg(`<svg width="13" height="13" viewBox="0 0 18 18"><path d="M4 8V6.5a5 5 0 0 1 10 0V8" fill="none" stroke="${sec(0.55)}" stroke-width="1.6"/><rect x="3.5" y="8" width="11" height="7.5" rx="2" fill="none" stroke="${sec(0.55)}" stroke-width="1.6"/></svg>`),
    info: () => svg(`<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="${sec(0.35)}" stroke-width="1.4"/><path d="M8 7v4M8 5h.01" stroke="${sec(0.45)}" stroke-width="1.6" stroke-linecap="round"/></svg>`),
    archiveBox: () => svg('<svg width="16" height="16" viewBox="0 0 18 18"><rect x="2.5" y="3" width="13" height="4" rx="1.2" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M4 7v6.2A1.8 1.8 0 0 0 5.8 15h6.4a1.8 1.8 0 0 0 1.8-1.8V7M7.3 10h3.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>'),
    gear: () => svg('<svg width="17" height="17" viewBox="0 0 20 20"><path d="M4 6h5M13 6h3M4 14h3M11 14h5" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="11" cy="6" r="2" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="9" cy="14" r="2" fill="none" stroke="#fff" stroke-width="1.7"/></svg>'),
    bell: () => svg('<svg width="16" height="16" viewBox="0 0 18 18"><path d="M9 2.2a4.6 4.6 0 0 0-4.6 4.6c0 3.4-1.4 4.6-1.4 4.6h12s-1.4-1.2-1.4-4.6A4.6 4.6 0 0 0 9 2.2zM7.4 14.2a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
    wifi: () => svg('<svg width="17" height="17" viewBox="0 0 20 20"><path d="M3 8.2a10 10 0 0 1 14 0M5.6 11a6.4 6.4 0 0 1 8.8 0M8.2 13.7a2.8 2.8 0 0 1 3.6 0" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="16" r="1.2" fill="#fff"/></svg>'),
    eye: () => svg('<svg width="14" height="14" viewBox="0 0 20 20"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'),
    minusCircle: () => svg('<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.5" fill="#ff3b30"/><path d="M6.8 11h8.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'),
    calendarPlus: () => svg('<svg width="19" height="19" viewBox="0 0 26 26"><rect x="3.5" y="5" width="19" height="17.5" rx="5" fill="none" stroke="#007aff" stroke-width="1.9"/><path d="M8.5 2.8v4M17.5 2.8v4M3.5 10h19" stroke="#007aff" stroke-width="1.9" stroke-linecap="round"/><path d="M9.5 16.5h7M13 13v7" stroke="#007aff" stroke-width="1.9" stroke-linecap="round"/></svg>'),
    people: () => svg('<svg width="18" height="18" viewBox="0 0 20 20"><circle cx="7" cy="6.5" r="2.6" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M2.5 15.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M13 5.2a2.4 2.4 0 0 1 0 4.6M14.5 15.5c0-2.2-1.2-3.6-3-4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'),
    pencil: () => svg('<svg width="17" height="17" viewBox="0 0 20 20"><path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" fill="none" stroke="#007aff" stroke-width="1.7" stroke-linejoin="round"/></svg>'),
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
    // Настоящее фото кладём поверх буквы (см. /avatar.jpg): нет фото или не
    // загрузилось — картинка убирается, остаётся градиент с буквой.
    const img = h('img', {
        class: 'avatar-photo',
        alt: '',
        loading: 'lazy',
        src: `${location.origin}/avatar.jpg?id=${encodeURIComponent(user.userId)}`
            + `&initData=${encodeURIComponent(tg ? tg.initData : '')}`,
    })
    img.addEventListener('error', () => img.remove())
    node.append(img)
    return node
}

const userLabel = (u) => (u.username ? '@' + u.username : u.name)

// ---------------------------------------------------------------------------
// API и стор
// ---------------------------------------------------------------------------

const store = { data: null, perspective: 'guest', theme: loadTheme() }

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

/**
 * Модалка в дизайн-системе миниаппа. Своя, а не `tg.showAlert`/`window.alert`:
 * нативные попапы выпадают из оформления, а в браузере (вне Telegram) это и вовсе
 * системная всплывашка. Возвращает Promise<boolean> — true, если нажали основную кнопку.
 */
function modal({ text, confirmLabel = 'OK', cancelLabel = null, destructive = false }) {
    return new Promise((resolve) => {
        let done = false
        const close = (value) => {
            if (done) return
            done = true
            overlay.classList.remove('shown')
            // Даём доиграть fade-out, только потом убираем узел.
            setTimeout(() => overlay.remove(), 180)
            resolve(value)
        }

        const buttons = []
        if (cancelLabel) buttons.push(h('button', { class: 'modal-btn', onclick: () => close(false) }, cancelLabel))
        buttons.push(h('button', {
            class: 'modal-btn primary' + (destructive ? ' destructive' : ''),
            onclick: () => close(true),
        }, confirmLabel))

        const overlay = h('div', {
            class: 'modal-overlay',
            // Тап по затемнению = отмена, но только если есть что отменять.
            onclick: (e) => { if (e.target === overlay && cancelLabel) close(false) },
        }, h('div', { class: 'modal-card' },
            h('div', { class: 'modal-text' }, text),
            h('div', { class: 'modal-actions' }, buttons),
        ))

        document.body.append(overlay)
        // Класс — следующим кадром, иначе transition не запустится.
        requestAnimationFrame(() => overlay.classList.add('shown'))
    })
}

const showAlert = (message) => { void modal({ text: message }) }

const confirmDialog = (message, opts) =>
    modal(Object.assign({ text: message, confirmLabel: 'Да', cancelLabel: 'Отмена' }, opts))

/**
 * Модалка выбора времени (в дизайн-системе миниаппа). Возвращает Promise<string|null>:
 * 'HH:MM', если подтвердили, иначе null. Используется для предложения переноса визита.
 */
function timePrompt({ text, initial, confirmLabel = 'Предложить' }) {
    return new Promise((resolve) => {
        let done = false
        const input = h('input', { class: 'time-input modal-time', type: 'time', value: initial || '15:00' })
        const close = (value) => {
            if (done) return
            done = true
            overlay.classList.remove('shown')
            setTimeout(() => overlay.remove(), 180)
            resolve(value)
        }
        const overlay = h('div', {
            class: 'modal-overlay',
            onclick: (e) => { if (e.target === overlay) close(null) },
        }, h('div', { class: 'modal-card' },
            text ? h('div', { class: 'modal-text' }, text) : null,
            h('div', { class: 'modal-time-wrap' }, input),
            h('div', { class: 'modal-actions' },
                h('button', { class: 'modal-btn', onclick: () => close(null) }, 'Отмена'),
                h('button', {
                    class: 'modal-btn primary',
                    onclick: () => close(input.value || null),
                }, confirmLabel),
            ),
        ))
        document.body.append(overlay)
        requestAnimationFrame(() => overlay.classList.add('shown'))
    })
}

function haptic(kind) {
    try { tg.HapticFeedback.notificationOccurred(kind) } catch { /* старый клиент */ }
}

// initData не обновляется в рамках сессии, поэтому выданный доступ помним сами.
let writeAccessGranted = false

/** Может ли бот уже писать гостю в личку (он нажимал /start или дал доступ). */
const botCanWrite = () => writeAccessGranted
    || !!(tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.allows_write_to_pm)

/** Нативная плашка Telegram «разрешить боту писать в личку». Promise<boolean> -
    true, если доступ дали. На старых клиентах без метода - молча false. */
function requestWriteAccess() {
    return new Promise((resolve) => {
        if (!tg || typeof tg.requestWriteAccess !== 'function') { resolve(false); return }
        try {
            tg.requestWriteAccess((granted) => {
                if (granted) writeAccessGranted = true
                resolve(!!granted)
            })
        } catch { resolve(false) }
    })
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
        if (['already_approved', 'not_found', 'not_approved', 'no_proposal', 'bad_status'].includes(err.code)) {
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

/**
 * @param keepScroll  сохранить позицию скролла (перерисовка данных, не переход)
 * @param anim        класс анимации входа: 'in-forward' | 'in-back' | 'in-fade' | null
 */
function render(keepScroll, anim) {
    const y = keepScroll ? window.scrollY : 0
    const app = document.getElementById('app')
    const top = stack[stack.length - 1]
    const node = SCREENS[top.name](top.params || {})
    if (anim) node.classList.add(anim)

    // Нижнюю панель вынимаем из .screen и кладём рядом: анимация перехода — это
    // transform, а он сделал бы .screen containing block'ом для position:fixed,
    // и панель поехала бы вместе с экраном, а в конце анимации прыгнула на место.
    // Снаружи (в #app, без transform) она якорится к вьюпорту, как и задумано.
    const bar = node.querySelector(':scope > .bottom-bar')
    if (bar) bar.remove()
    app.replaceChildren(node)
    if (bar) app.append(bar)

    window.scrollTo(0, y)
    if (tg) {
        try {
            if (stack.length > 1) tg.BackButton.show()
            else tg.BackButton.hide()
        } catch { /* старый клиент без BackButton */ }
    }
}

// Перерисовка данных — без анимации: иначе экран моргал бы на каждом действии.
const rerender = () => render(true, null)
const push = (name, params) => { stack.push({ name, params }); render(false, 'in-forward') }
function pop() {
    if (stack.length > 1) {
        stack.pop()
        render(false, 'in-back')
    }
}
function resetRoot() {
    stack.length = 0
    stack.push({ name: store.perspective === 'resident' ? 'overview' : 'myVisits', params: {} })
    render(false, 'in-fade')
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

/** Дев-переключатель перспективы «резидент ↔ гость» (только для DEV_USER_IDS из .env). */
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

/** Вход в dev-меню (сид фейковых заявок). */
function devMenuChip() {
    if (!store.data.me.isDev) return null
    return h('div', { class: 'dev-chip', onclick: () => push('dev', {}) }, '🛠', 'Dev')
}

/** Дев-панель в шапке: обе кнопки видны только аккаунтам из DEV_USER_IDS. */
function devChips() {
    if (!store.data.me.isDev) return null
    return h('div', { class: 'dev-chips' }, devChip(), devMenuChip())
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

/** Цель визита в строке заявки: одна строка с многоточием; если текст не влез —
    кнопка «ещё», раскрывающая его целиком. Обрезан ли текст, видно только после
    layout, когда узел уже в DOM — отсюда requestAnimationFrame. */
function purposeBlock(text) {
    const textEl = h('div', { class: 'req-purpose' }, text)
    const toggle = h('button', { class: 'purpose-toggle', hidden: true }, 'ещё')
    const wrap = h('div', { class: 'req-purpose-wrap' }, textEl, toggle)
    toggle.addEventListener('click', (e) => {
        e.stopPropagation()
        const expanded = wrap.classList.toggle('expanded')
        toggle.textContent = expanded ? 'свернуть' : 'ещё'
    })
    requestAnimationFrame(() => {
        if (textEl.scrollWidth > textEl.clientWidth) toggle.hidden = false
    })
    return wrap
}

/** Предложить гостю перенос времени (резидент): модалка с вводом → API `propose`. */
async function proposeTimeFor(r) {
    const time = await timePrompt({
        text: `Предложить ${r.guest.name} другое время визита ${fmtShortDate(r.dateKey)}?`,
        initial: (r.timeProposal && r.timeProposal.time) || r.time,
    })
    if (!time) return
    const done = await action('propose', { id: r.id, time })
    if (done) haptic('success')
}

/** Строка заявки в деталях дня: гость, время, цель; справа — одобривший или «Захостить». */
function requestRow(r, opts) {
    const me = store.data.me
    const sub = (r.guest.username ? '@' + r.guest.username + ' · ' : '') + 'к ' + r.time + (r.anon ? ' · инкогнито' : '')
    const p = r.timeProposal
    const main = h('div', { class: 'req-main' },
        h('div', { class: 'req-name' }, r.guest.name),
        h('div', { class: 'req-sub' }, sub),
        r.purpose ? purposeBlock(r.purpose) : null,
        // Плашка активного предложения переноса под целью визита.
        !opts.archive && p
            ? h('div', { class: 'proposal-note' + (p.by === 'resident' ? ' mine' : '') },
                icons.clock(14, sec(0.5)),
                p.by === 'guest'
                    ? h('span', null, 'гость предлагает ', h('span', { class: 'pn-time' }, p.time))
                    : h('span', null, 'вы предложили ', h('span', { class: 'pn-time' }, p.time), ' · ждём гостя'))
            : null,
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
        const hostBtn = h('button', {
            class: 'host-btn',
            onclick: async () => {
                const ok = await confirmDialog(`Захостить: ${r.guest.name}${r.guest.username ? ' (@' + r.guest.username + ')' : ''}, ${fmtShortDate(r.dateKey)} к ${r.time}?`)
                if (!ok) return
                const done = await action('approve', { id: r.id })
                if (done) haptic('success')
            },
        }, 'Захостить')
        const actions = [hostBtn]
        // Гость ответил своим временем — резидент может принять его в один тап.
        if (p && p.by === 'guest') {
            actions.unshift(h('button', {
                class: 'accept-btn',
                onclick: async () => {
                    const done = await action('proposal.accept', { id: r.id })
                    if (done) haptic('success')
                },
            }, icons.check(14, '#34c759', 2.4), 'Принять ' + p.time))
        }
        // Предложить перенос: подпись зависит от того, идёт ли уже переписка.
        actions.push(h('button', {
            class: 'link-btn',
            onclick: () => void proposeTimeFor(r),
        }, p ? 'Другое время' : 'Перенести'))
        right = h('div', { class: 'req-actions' }, actions)
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

const peopleWord = (n) => `${n} ${plural(n, 'человек', 'человека', 'человек')}`

/** Строка участника в списке «кто придёт»: имя, время (для гостя), пометка «резидент». */
function attendeeRow(a) {
    const subEl = a.time
        ? h('div', { class: 'req-sub' }, 'к ' + a.time)
        : (a.username ? h('div', { class: 'req-sub' }, '@' + a.username) : null)
    return h('div', { class: 'row' },
        avatar(a, 'req-avatar'),
        h('div', { class: 'req-main' },
            h('div', { class: 'req-name' }, a.name),
            subEl,
        ),
        a.resident ? h('span', { class: 'resident-badge' }, 'резидент') : null,
    )
}

/** Карточка списка участников (residents-first порядок задаёт сервер). */
function attendeesCard(list) {
    const card = h('div', { class: 'card' })
    list.forEach((a, i) => {
        if (i > 0) card.append(sep(66))
        card.append(attendeeRow(a))
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
    if (opts.tappable) right.append(icons.chevron(isToday ? sec(0.4) : undefined))
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
        header('Ближайшие дни', `${fmtRange(first, last)} · ${requestsWord(total)}`, devChips()),
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

    // Резиденты «я приду» + переключатель для себя (только в живом дне).
    let residentsComing = []
    if (!archive) {
        const day = store.data.days.find((d) => d.dateKey === params.dateKey)
        residentsComing = ((day && day.attendees) || []).filter((a) => a.resident)
        const iAmComing = residentsComing.some((a) => a.userId === store.data.me.id)
        parts.push(h('button', {
            class: 'attend-btn' + (iAmComing ? ' on' : ''),
            onclick: async () => {
                const done = await action('attend', { dateKey: params.dateKey, coming: !iAmComing })
                if (done) haptic(iAmComing ? 'warning' : 'success')
            },
        }, iAmComing ? icons.check(15, '#fff', 2.6) : null, iAmComing ? 'Вы придёте в этот день' : 'Я приду'))
        if (residentsComing.length > 0) {
            parts.push(sectionTitle(`Придут резиденты · ${residentsComing.length}`), attendeesCard(residentsComing))
        }
    }

    if (requests.length === 0 && (archive || residentsComing.length === 0)) {
        parts.push(h('div', { class: 'card' }, emptyState(
            archive ? 'Заявок не было' : 'Нет заявок гостей',
            archive ? 'В этот день никто не собирался прийти.' : 'На этот день пока никто не оставил заявку.',
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
        header('Архив'),
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
    // s === null у гостя: уведомления и MAC — только резидентам, а тема нужна всем.
    // Сервер присылает settings по реальному резидентству и про перспективу не знает,
    // поэтому дев-вид «как гость» гасим здесь — иначе он бы не был честным.
    const s = store.perspective === 'guest' ? null : store.data.settings

    const themeRow = (label, sublabel, value) => h('div', {
        class: 'row tappable',
        onclick: () => { if (store.theme !== value) setTheme(value) },
    },
        h('span', { class: 'row-label' }, label, sublabel ? h('span', { class: 'row-sublabel' }, sublabel) : null),
        h('div', { class: 'radio-check' }, store.theme === value ? icons.check(16, '#007aff', 2.2) : null),
    )

    const themeSection = [
        sectionTitle('Оформление'),
        h('div', { class: 'card' },
            themeRow('Системная', 'Как в Telegram', 'system'),
            sep(14),
            themeRow('Светлая', null, 'light'),
            sep(14),
            themeRow('Тёмная', null, 'dark'),
        ),
    ]

    if (!s) {
        return h('div', { class: 'screen' },
            backRow('Назад'),
            header('Настройки'),
            themeSection,
        )
    }

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
                    const ok = await confirmDialog(
                        `Убрать ${m.label ? '«' + m.label + '» ' : ''}${m.mac}? Авто-отметка по этому устройству перестанет работать.`,
                        { confirmLabel: 'Убрать', destructive: true },
                    )
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
        header('Настройки'),
        themeSection,
        sectionTitle('Уведомления о заявках'),
        notifyCard,
        h('div', { class: 'footnote' }, icons.info(), 'Придут в личку бота. По умолчанию - только заявки на сегодня.'),
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
    const p = r.timeProposal
    const iconSquare = approved
        ? h('div', { class: 'status-square ok' }, icons.check(20, '#34c759'))
        : h('div', { class: 'status-square' }, icons.clock(18, sec(0.5)))
    let subText
    if (approved) subText = `к ${r.time} · подтверждён`
    else if (p && p.by === 'resident') subText = `к ${r.time} · предложено ${p.time} — нужен ответ`
    else if (p && p.by === 'guest') subText = `вы предложили ${p.time} · ждём`
    else subText = `к ${r.time} · ждём резидента`
    const main = h('div', { class: 'req-main' },
        h('div', { class: 'req-name' }, fmtWeekdayDate(r.dateKey)),
        h('div', { class: 'req-sub' }, subText),
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

/** Плашка «бот не может писать вам»: видна, пока доступа нет; тап зовёт нативный
    запрос Telegram, после выдачи доступа плашка пропадает. */
function writeAccessBanner() {
    if (botCanWrite()) return null
    return h('div', {
        class: 'write-banner',
        onclick: async () => {
            const ok = await requestWriteAccess()
            if (ok) { haptic('success'); rerender() }
        },
    },
        h('div', { class: 'wb-icon' }, icons.bell()),
        h('div', { class: 'wb-text' },
            h('div', { class: 'wb-title' }, 'Бот не может писать вам'),
            h('div', { class: 'wb-sub' }, 'Разрешите, чтобы получать ответы на заявки'),
        ),
        icons.chevron(),
    )
}

function screenMyVisits() {
    const my = store.data.myRequests
    const approved = my.filter((r) => r.status === 'approved')
    const pending = my.filter((r) => r.status !== 'approved')

    const parts = [header('Мои визиты', null, devChips())]
    const banner = writeAccessBanner()
    if (banner) parts.push(banner)
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
    // «Кто придёт» + настройки (в настройках гостю доступна тема).
    parts.push(h('div', { class: 'card', style: 'margin-top:22px' },
        h('div', { class: 'row tappable', onclick: () => push('peek') },
            h('div', { class: 'row-icon', style: 'background:#34c759' }, icons.people()),
            h('span', { class: 'row-label' }, 'Кто придёт'),
            h('div', { class: 'row-right' }, icons.chevron()),
        ),
        sep(54),
        h('div', { class: 'row tappable', onclick: () => push('settings') },
            h('div', { class: 'row-icon', style: 'background:#8e8e93' }, icons.gear()),
            h('span', { class: 'row-label' }, 'Настройки'),
            h('div', { class: 'row-right' }, icons.chevron()),
        ),
    ))
    parts.push(h('div', { class: 'bottom-bar' },
        h('button', { class: 'primary-btn', onclick: () => push('newRequest') }, icons.plus(), 'Новая заявка'),
    ))
    return h('div', { class: 'screen has-bottom-bar' }, parts)
}

// ---------------------------------------------------------------------------
// Экран: кто придёт (гость) — обзор недели по подтверждённым участникам
// ---------------------------------------------------------------------------

function peekDayRow(day) {
    const isToday = day.dateKey === store.data.todayKey
    const att = day.attendees || []
    const empty = att.length === 0
    const row = h('div', {
        class: 'row' + (!empty ? ' tappable' : '') + (isToday ? ' today' : '') + (empty ? ' day-empty' : ''),
        onclick: empty ? null : () => push('peekDay', { dateKey: day.dateKey }),
    })
    row.append(h('div', { class: 'day-col' },
        h('div', { class: 'dow' }, WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]),
        h('div', { class: 'date' }, isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)),
    ))
    if (empty) {
        row.append(h('span', { class: 'day-none' }, 'Пока никого'))
        return row
    }
    row.append(avatarStack(att.map((a) => ({ userId: a.userId, name: a.name, username: a.username }))))
    row.append(h('span', { class: 'day-count' }, peopleWord(att.length)))
    row.append(h('div', { class: 'row-right' }, icons.chevron(isToday ? sec(0.4) : undefined)))
    return row
}

function screenPeek() {
    const { days } = store.data
    const card = h('div', { class: 'card' })
    days.forEach((day, i) => {
        if (i > 0) card.append(sep(86))
        card.append(peekDayRow(day))
    })
    return h('div', { class: 'screen' },
        backRow('Мои визиты'),
        header('Кто придёт', 'Подтверждённые гости и резиденты'),
        card,
        h('div', { class: 'footnote' }, icons.info(), 'Показаны те, кого уже подтвердили, и резиденты, отметившие «я приду». Гости, пришедшие анонимно, в списке не видны. Цель визита не показывается.'),
    )
}

function screenPeekDay(params) {
    const day = store.data.days.find((d) => d.dateKey === params.dateKey)
    const att = (day && day.attendees) || []
    const isToday = params.dateKey === store.data.todayKey
    const parts = [
        backRow('Кто придёт'),
        header(WEEKDAYS_FULL[weekdayIdx(params.dateKey)],
            `${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${peopleWord(att.length)}`),
    ]
    if (att.length === 0) {
        parts.push(h('div', { class: 'card' }, emptyState('Пока никого', 'На этот день ещё нет подтверждённых визитов.')))
    } else {
        parts.push(attendeesCard(att))
    }
    return h('div', { class: 'screen' }, parts)
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
    const p = r.timeProposal

    let statusCard
    if (approved) {
        statusCard = h('div', { class: 'status-card approved' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.check(14, 'currentColor', 2)),
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
    } else if (p && p.by === 'resident') {
        // Резидент предложил другое время — гость принимает или отвечает своим.
        statusCard = h('div', { class: 'status-card proposal' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.clock(15, sec(0.55))),
                h('span', { class: 'status-card-title' }, 'Резидент предлагает другое время'),
            ),
            h('div', { class: 'propose-time-big' },
                h('span', { class: 'ptb-new' }, p.time),
                h('span', { class: 'ptb-old' }, r.time),
            ),
            h('div', { class: 'propose-actions' },
                h('button', {
                    class: 'primary-btn',
                    onclick: async () => {
                        const done = await action('proposal.accept', { id: r.id })
                        if (done) haptic('success')
                    },
                }, 'Принять ' + p.time),
                h('button', {
                    class: 'chip-btn',
                    onclick: async () => {
                        const time = await timePrompt({ text: 'Предложить своё время визита?', initial: p.time, confirmLabel: 'Предложить' })
                        if (!time) return
                        const done = await action('propose', { id: r.id, time })
                        if (done) haptic('success')
                    },
                }, 'Своё'),
            ),
            h('button', {
                class: 'link-btn',
                style: 'margin-top:12px',
                onclick: async () => {
                    const done = await action('proposal.decline', { id: r.id })
                    if (done) haptic('warning')
                },
            }, `Оставить как есть (${r.time})`),
        )
    } else if (p && p.by === 'guest') {
        // Гость предложил своё время — ждём резидента; можно изменить или отозвать.
        statusCard = h('div', { class: 'status-card pending' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.clock(15, sec(0.55))),
                h('span', { class: 'status-card-title' }, `Вы предложили ${p.time}`),
            ),
            h('div', { class: 'status-card-note' }, 'Ждём ответа резидента — он примет это время или предложит другое.'),
            h('div', { class: 'propose-actions' },
                h('button', {
                    class: 'chip-btn',
                    onclick: async () => {
                        const time = await timePrompt({ text: 'Изменить предложенное время?', initial: p.time, confirmLabel: 'Обновить' })
                        if (!time) return
                        const done = await action('propose', { id: r.id, time })
                        if (done) haptic('success')
                    },
                }, 'Изменить'),
                h('button', {
                    class: 'chip-btn',
                    onclick: async () => {
                        const done = await action('proposal.decline', { id: r.id })
                        if (done) haptic('warning')
                    },
                }, 'Отозвать'),
            ),
        )
    } else {
        statusCard = h('div', { class: 'status-card pending' },
            h('div', { class: 'status-card-head' },
                h('div', { class: 'status-card-icon' }, icons.clock(15, sec(0.55))),
                h('span', { class: 'status-card-title' }, 'Заявка ждёт ответа'),
            ),
            h('div', { class: 'status-card-note' }, 'Резиденты видят вашу заявку. Как только кто-то возьмётся захостить - бот напишет вам в личку.'),
        )
    }

    return h('div', { class: 'screen' },
        backRow('Мои визиты'),
        header(WEEKDAYS_FULL[weekdayIdx(r.dateKey)], `${fmtDayMonth(r.dateKey)} · к ${r.time}`),
        statusCard,
        // Правка доступна, пока визит не одобрен: сервер тоже это проверяет.
        !approved
            ? h('button', { class: 'secondary-btn', style: 'margin-top:12px', onclick: () => push('editRequest', { id: r.id }) },
                icons.pencil(), 'Изменить день или время')
            : null,
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row' },
                h('span', { class: 'kv-key' }, 'Когда'),
                h('span', { class: 'kv-val' }, `${fmtShortDate(r.dateKey)} · ${r.time}`),
            ),
            sep(14),
            h('div', { class: 'row' },
                h('span', { class: 'kv-key' }, 'Видимость'),
                h('span', { class: 'kv-val' }, r.anon ? 'Анонимно' : 'Обычная'),
            ),
            r.purpose ? sep(14) : null,
            r.purpose
                ? h('div', { class: 'kv-block' },
                    h('div', { class: 'kv-cap' }, 'Цель визита'),
                    h('div', { class: 'kv-text' }, r.purpose),
                )
                : null,
        ),
        h('button', {
            class: 'secondary-btn',
            onclick: () => {
                // .ics отдаёт сервер (см. /visit.ics): подписанная ссылка, которую
                // открывает системный браузер — оттуда файл уходит в календарь.
                const url = `${location.origin}/visit.ics?id=${encodeURIComponent(r.id)}`
                    + `&initData=${encodeURIComponent(tg ? tg.initData : '')}`
                try { tg.openLink(url) } catch { window.open(url, '_blank') }
            },
        }, icons.calendarPlus(), 'Добавить в календарь'),
        h('div', { style: 'height:22px' }),
        h('button', {
            class: 'destructive-btn',
            onclick: async () => {
                const ok = await confirmDialog('Отменить заявку на визит?', { confirmLabel: 'Отменить', destructive: true })
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
    // Для «сегодня» — ближайший целый час в поясе спейса (nowTime с сервера), но не позже 23:00.
    const nowH = Number((store.data.nowTime || '00:00').slice(0, 2))
    const next = Math.min(nowH + 1, 23)
    return String(next).padStart(2, '0') + ':00'
}

/** Слот «на сегодня» уже прошёл (сравнение в поясе спейса — nowTime с сервера). */
const isPastForToday = (dateKey, time) => dateKey === store.data.todayKey && time < (store.data.nowTime || '00:00')

/** Свитч с локальным состоянием (для форм, где значение не в сторе). */
function localSwitch(initial, onChange) {
    const btn = h('button', { class: 'switch' + (initial ? ' on' : ''), role: 'switch', 'aria-checked': String(initial) })
    let on = initial
    btn.addEventListener('click', () => {
        on = !on
        btn.classList.toggle('on', on)
        btn.setAttribute('aria-checked', String(on))
        onChange(on)
    })
    return btn
}

/** Ряд «Прийти анонимно» — общий для новой заявки и правки. */
function anonRow(initial, onChange) {
    return h('div', { class: 'card' },
        h('div', { class: 'row' },
            h('span', { class: 'row-label' }, 'Прийти анонимно', h('span', { class: 'row-sublabel' }, 'Другие гости не увидят вас в списке')),
            localSwitch(initial, onChange),
        ),
    )
}

/**
 * Поле выбора дня + времени, общее для новой заявки и правки. Возвращает узлы и
 * геттеры. `timeTouched` — чтобы не перетирать вручную выставленное время при
 * смене дня; `min` на инпуте для «сегодня» подсказывает прошедшие часы.
 */
function daytimeField(days, initialDay, initialTime) {
    let selected = initialDay
    let timeTouched = !!initialTime
    const timeInput = h('input', { class: 'time-input', type: 'time', value: initialTime || defaultTimeFor(selected) })
    const applyMin = () => {
        if (selected === store.data.todayKey) timeInput.min = store.data.nowTime || '00:00'
        else timeInput.removeAttribute('min')
    }
    applyMin()
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
                    applyMin()
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

    return { chips, timeInput, getDay: () => selected, getTime: () => timeInput.value }
}

function purposeInput(value) {
    const purpose = h('textarea', { class: 'purpose-input', placeholder: 'Цель визита (опционально)', rows: '2', maxlength: '300' })
    if (value) purpose.value = value
    purpose.addEventListener('input', () => {
        purpose.style.height = 'auto'
        purpose.style.height = purpose.scrollHeight + 'px'
    })
    return purpose
}

function screenNewRequest() {
    const days = store.data.days
    const field = daytimeField(days, days[0].dateKey, null)
    const purpose = purposeInput(null)
    let anon = false

    const submit = h('button', {
        class: 'primary-btn',
        onclick: async () => {
            const time = field.getTime()
            const day = field.getDay()
            if (!time) { showAlert('Укажи время прихода.'); return }
            if (isPastForToday(day, time)) { showAlert('Это время уже прошло — выбери время позже текущего.'); return }
            submit.disabled = true
            setBusy(true)
            try {
                // Если гость открыл миниапп из чата без /start, бот не сможет прислать
                // ему ответ резидента в личку — до создания заявки просим доступ
                // нативной плашкой Telegram (её показывает сам requestWriteAccess).
                if (!botCanWrite()) await requestWriteAccess()
                store.data = await api('create', { dateKey: day, time, purpose: purpose.value, anon })
                haptic('success')
                resetRoot()
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
        header('Хочу прийти'),
        sectionTitle('День'),
        field.chips,
        h('div', { class: 'chips-legend' }, icons.check(12, '#34c759', 2.2), 'число заявок и уже одобренных в этот день'),
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row', style: 'padding:6px 14px' },
                h('span', { style: 'font-size:16px' }, 'Приду к'),
                field.timeInput,
            ),
            sep(14),
            h('div', { class: 'kv-block' }, purpose),
        ),
        h('div', { style: 'height:8px' }),
        anonRow(anon, (v) => { anon = v }),
        h('div', { class: 'bottom-bar' },
            submit,
            h('div', { class: 'bar-hint' }, 'Ваша заявка будет отправлена резидентам'),
        ),
    )
}

// ---------------------------------------------------------------------------
// Экран: правка своей заявки гостем (день/время/цель/анонимность)
// ---------------------------------------------------------------------------

function screenEditRequest(params) {
    const r = store.data.myRequests.find((x) => x.id === params.id)
    if (!r) {
        setTimeout(() => pop(), 0)
        return h('div', { class: 'screen' })
    }
    const days = store.data.days
    const field = daytimeField(days, r.dateKey, r.time)
    const purpose = purposeInput(r.purpose)
    let anon = !!r.anon

    const submit = h('button', {
        class: 'primary-btn',
        onclick: async () => {
            const time = field.getTime()
            const day = field.getDay()
            if (!time) { showAlert('Укажи время прихода.'); return }
            if (isPastForToday(day, time)) { showAlert('Это время уже прошло — выбери время позже текущего.'); return }
            const done = await action('edit', { id: r.id, dateKey: day, time, purpose: purpose.value, anon })
            if (done) { haptic('success'); pop() }
        },
    }, 'Сохранить')

    return h('div', { class: 'screen has-bottom-bar' },
        backRow('Визит'),
        header('Изменить заявку'),
        sectionTitle('День'),
        field.chips,
        h('div', { class: 'chips-legend' }, icons.check(12, '#34c759', 2.2), 'число заявок и уже одобренных в этот день'),
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row', style: 'padding:6px 14px' },
                h('span', { style: 'font-size:16px' }, 'Приду к'),
                field.timeInput,
            ),
            sep(14),
            h('div', { class: 'kv-block' }, purpose),
        ),
        h('div', { style: 'height:8px' }),
        anonRow(anon, (v) => { anon = v }),
        h('div', { class: 'bottom-bar' }, submit),
    )
}

// ---------------------------------------------------------------------------
// Экран: dev-меню (сид фейковых заявок). Доступен только DEV_USER_IDS —
// сервер всё равно проверяет это сам, чип тут лишь прячет вход.
// ---------------------------------------------------------------------------

function screenDev(params) {
    const days = store.data.days
    // Выбор держим в params: объект живёт в стеке экранов, поэтому переживает
    // rerender после создания заявки — иначе день сбрасывался бы на первый.
    if (!params.selected) params.selected = days[0].dateKey
    if (!params.time) params.time = defaultTimeFor(params.selected)

    const timeInput = h('input', { class: 'time-input', type: 'time', value: params.time })
    timeInput.addEventListener('change', () => { params.time = timeInput.value })

    const chips = h('div', { class: 'day-chips' })
    const renderChips = () => {
        chips.replaceChildren(...days.map((d) => h('button', {
            class: 'day-chip' + (d.dateKey === params.selected ? ' selected' : ''),
            onclick: () => {
                params.selected = d.dateKey
                renderChips()
            },
        },
            h('span', { class: 'dc-dow' }, WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]),
            h('span', { class: 'dc-num' }, String(dayNum(d.dateKey))),
            d.total > 0
                ? h('div', { class: 'dc-counts' },
                    h('span', null, String(d.total)),
                    icons.check(10, d.dateKey === params.selected ? '#fff' : '#34c759', 2.2),
                    h('span', { class: 'dc-approved' }, String(d.approved)),
                )
                : h('span', { class: 'dc-dash' }, '—'),
        )))
    }
    renderChips()

    const purpose = h('textarea', { class: 'purpose-input', placeholder: 'Цель визита (по умолчанию — «Фейковая заявка (dev)»)', rows: '2', maxlength: '300' })

    const submit = h('button', {
        class: 'primary-btn',
        onclick: async () => {
            if (!timeInput.value) {
                showAlert('Укажи время прихода.')
                return
            }
            const data = await action('dev.seed', {
                dateKey: params.selected,
                time: timeInput.value,
                purpose: purpose.value,
            })
            if (data) haptic('success')
        },
    }, 'Создать фейковую заявку')

    // Все заявки ближайших 7 дней: правка и удаление (сервер приносит days[].requests
    // dev-аккаунтам так же, как резидентам).
    const all = days.flatMap((d) => d.requests || [])
    const listCard = h('div', { class: 'card' })
    if (all.length === 0) {
        listCard.append(emptyState('Заявок нет', 'Создай фейковую — появится здесь.'))
    } else {
        all.forEach((r, i) => {
            if (i > 0) listCard.append(sep(14))
            listCard.append(h('div', { class: 'row tappable', onclick: () => push('devEdit', { id: r.id }) },
                h('span', { class: 'row-label' },
                    r.guest.name,
                    h('span', { class: 'row-sublabel' }, `${fmtShortDate(r.dateKey)} · ${r.time}${r.status === 'approved' ? ' · одобрена' : ''}`),
                ),
                h('button', {
                    class: 'remove-btn',
                    'aria-label': 'Удалить заявку',
                    onclick: async (e) => {
                        e.stopPropagation() // иначе откроется правка
                        const ok = await confirmDialog(`Удалить заявку ${r.guest.name} на ${fmtShortDate(r.dateKey)}?`,
                            { confirmLabel: 'Удалить', destructive: true })
                        if (ok) void action('dev.delete', { id: r.id })
                    },
                }, icons.minusCircle()),
            ))
        })
    }

    return h('div', { class: 'screen has-bottom-bar' },
        backRow('Назад'),
        header('Dev', 'Тестовые данные - резиденты не будут уведомлены'),
        sectionTitle('День'),
        chips,
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row', style: 'padding:6px 14px' },
                h('span', { style: 'font-size:16px' }, 'Придёт к'),
                timeInput,
            ),
            sep(14),
            h('div', { class: 'kv-block' }, purpose),
        ),
        sectionTitle('Все заявки'),
        listCard,
        h('div', { class: 'bottom-bar' },
            submit,
            h('div', { class: 'bar-hint' }, 'Заявка от случайного фейкового гостя'),
        ),
    )
}

// Экран: дев-правка чужой заявки (день/время/цель).
function screenDevEdit(params) {
    const days = store.data.days
    const r = days.flatMap((d) => d.requests || []).find((x) => x.id === params.id)
    if (!r) {
        setTimeout(() => pop(), 0)
        return h('div', { class: 'screen' })
    }
    if (!params.selected) params.selected = r.dateKey

    const timeInput = h('input', { class: 'time-input', type: 'time', value: r.time })
    const purpose = h('textarea', { class: 'purpose-input', rows: '2', maxlength: '300' })
    purpose.value = r.purpose || ''

    const chips = h('div', { class: 'day-chips' })
    const renderChips = () => {
        chips.replaceChildren(...days.map((d) => h('button', {
            class: 'day-chip' + (d.dateKey === params.selected ? ' selected' : ''),
            onclick: () => { params.selected = d.dateKey; renderChips() },
        },
            h('span', { class: 'dc-dow' }, WEEKDAYS_SHORT[weekdayIdx(d.dateKey)]),
            h('span', { class: 'dc-num' }, String(dayNum(d.dateKey))),
        )))
    }
    renderChips()

    const submit = h('button', {
        class: 'primary-btn',
        onclick: async () => {
            if (!timeInput.value) { showAlert('Укажи время прихода.'); return }
            const data = await action('dev.update', {
                id: r.id, dateKey: params.selected, time: timeInput.value, purpose: purpose.value,
            })
            if (data) { haptic('success'); pop() }
        },
    }, 'Сохранить')

    return h('div', { class: 'screen has-bottom-bar' },
        backRow('Dev'),
        header(r.guest.name, 'Правка заявки'),
        sectionTitle('День'),
        chips,
        sectionTitle('Детали'),
        h('div', { class: 'card' },
            h('div', { class: 'row', style: 'padding:6px 14px' },
                h('span', { style: 'font-size:16px' }, 'Придёт к'),
                timeInput,
            ),
            sep(14),
            h('div', { class: 'kv-block' }, purpose),
        ),
        h('div', { class: 'bottom-bar' }, submit),
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
    peek: screenPeek,
    peekDay: screenPeekDay,
    visit: screenVisit,
    newRequest: screenNewRequest,
    editRequest: screenEditRequest,
    dev: screenDev,
    devEdit: screenDevEdit,
}

function boot() {
    const app = document.getElementById('app')
    // Тему ставим до первой отрисовки — иначе моргнёт светлым на тёмной теме.
    applyTheme()
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
    try { tg.disableVerticalSwipes() } catch { /* старый клиент */ }
    try { tg.BackButton.onClick(pop) } catch { /* старый клиент */ }

    // Тема клиента сменилась — при выборе «Системная» едем следом.
    const onSystemThemeChange = () => {
        if (store.theme !== 'system') return
        applyTheme()
        if (stack.length > 0) rerender()
    }
    try { tg.onEvent('themeChanged', onSystemThemeChange) } catch { /* старый клиент */ }
    try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onSystemThemeChange)
    } catch { /* старый браузер без addEventListener у MediaQueryList */ }

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
