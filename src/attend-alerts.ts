// Подписка гостя на отметки резидентов «я приду»: бот пишет в личку, что резидент
// собрался в спейс в такой-то день, а гость решает, оставить ли заявку на тот же день.
//
// Рассылает шедулер, а не ручка `attend`: отметку ставят и миниапп, и кнопка «Приду»
// из зова, а шедулер видит обе разом. Заодно отметка успевает постоять (`SETTLE_MS`):
// снятие отметки гостям не рассылается, и промах по кнопке иначе так и остался бы у
// них в личке неправдой.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { newRequestTarget, webappAt } from './deeplink.js'
import {
    addDaysToKey,
    formatDayKey,
    HOSTING_DAYS_AHEAD,
    isBlocked,
    isDayLocked,
    mentionLabel,
    todayKey,
} from './hosting.js'
import { startHeartbeatInterval } from './health.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { GuestAttendNotify, HostingAttendance } from './types.js'

/** Подписка - опция гостя, а не рассылка: без записи бот молчит. */
export const DEFAULT_GUEST_ATTEND_NOTIFY: GuestAttendNotify = { enabled: false, mode: 'near' }

export const guestAttendPrefsFor = (storage: Storage, userId: number): GuestAttendNotify =>
    storage.get().guestAttendNotify[String(userId)] ?? { ...DEFAULT_GUEST_ATTEND_NOTIFY }

const SETTLE_MS = 5 * 60_000

const TICK_INTERVAL_MS = 60 * 1000

const dayLabel = (dateKey: string, today: string): string => {
    if (dateKey === today) return 'Сегодня'
    if (dateKey === addDaysToKey(today, 1)) return 'Завтра'
    return formatDayKey(dateKey)
}

const joinNames = (names: string[]): string =>
    names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`

/**
 * Отметки, о которых пора написать. Окно проверяем первым: `hostingAttendance` не
 * чистится, и без него каждый тик перебирал бы всю историю отметок.
 *
 * Отметку на закрытый день не списываем, а держим до открытия: откроют день, и
 * подписчики узнают, что в нём уже будут резиденты. Объявление всё равно одноразовое.
 */
const dueMarks = (storage: Storage, today: string, now: number): HostingAttendance[] => {
    const s = storage.get()
    const lastDay = addDaysToKey(today, HOSTING_DAYS_AHEAD - 1)
    return Object.values(s.hostingAttendance)
        .filter((a) =>
            a.dateKey >= today &&
            a.dateKey <= lastDay &&
            !(s.hostingAttendAnnounced[a.dateKey] ?? []).includes(a.user.userId) &&
            now - Date.parse(a.at) >= SETTLE_MS &&
            !isDayLocked(storage, a.dateKey))
        .sort((a, b) => (a.dateKey === b.dateKey ? a.at.localeCompare(b.at) : a.dateKey.localeCompare(b.dateKey)))
}

const buildText = (marks: HostingAttendance[], labels: Map<number, string>, today: string): string => {
    const byDay = new Map<string, string[]>()
    for (const a of marks) {
        const names = byDay.get(a.dateKey) ?? []
        names.push(`${labels.get(a.user.userId) ?? ''}${a.time ? ` к ${a.time}` : ''}`)
        byDay.set(a.dateKey, names)
    }
    const days = [...byDay.entries()]
    const single = days.length === 1 ? days[0] : undefined
    const lines = single
        ? [`🙋 <b>${dayLabel(single[0], today)}</b> в спейс ${single[1].length === 1 ? 'придёт резидент' : 'придут резиденты'} ${joinNames(single[1])}.`]
        : ['🙋 Резиденты собираются в спейс:', ...days.map(([dateKey, names]) => `• <b>${dayLabel(dateKey, today)}</b>: ${names.join(', ')}`)]
    lines.push('Хотите прийти? Оставьте заявку на визит.')
    return lines.join('<br>')
}

/**
 * Тик рассылки: одно сообщение на подписчика, все созревшие отметки в нём.
 *
 * Метку «уже написали» ставим до отправки и даже когда получателей нет: иначе на
 * первом деплое старые отметки дождались бы первого подписчика и упали бы ему разом.
 */
export const startAttendAlertScheduler = (
    client: TelegramClient,
    storage: Storage,
    residents: ResidentDirectory,
    devUserIds: ReadonlySet<number>,
    tzOffsetMinutes: number,
    webappUrl: string,
): { stop: () => void } =>
    startHeartbeatInterval(
        'attend-alerts',
        TICK_INTERVAL_MS,
        async () => {
            const today = todayKey(tzOffsetMinutes)
            const marks = dueMarks(storage, today, Date.now())
            if (marks.length === 0) return
            const subscribers = Object.entries(storage.get().guestAttendNotify)
                .filter(([id, prefs]) => prefs.enabled && !isBlocked(storage, Number(id)))
                .map(([id, prefs]) => ({ userId: Number(id), mode: prefs.mode }))
            const residentIds = subscribers.length > 0 ? await residents.listIds() : new Set<number>()
            await storage.update((s) => {
                for (const key of Object.keys(s.hostingAttendAnnounced)) {
                    if (key < today) delete s.hostingAttendAnnounced[key]
                }
                for (const a of marks) {
                    const ids = s.hostingAttendAnnounced[a.dateKey] ?? []
                    if (!ids.includes(a.user.userId)) ids.push(a.user.userId)
                    s.hostingAttendAnnounced[a.dateKey] = ids
                }
            })

            const near = new Set([today, addDaysToKey(today, 1)])
            const labels = new Map<number, string>()
            for (const sub of subscribers) {
                // Резиденту подписка ни к чему, у него своя, на день. Но и выключить её
                // ему нечем: в резидентских настройках карточки нет, а повышают в
                // резиденты как раз частых гостей. Девы идут мимо фильтра: перспектива
                // «гость» нужна им, чтобы проверять гостевые потоки, доставку тоже.
                if (residentIds.has(sub.userId) && !devUserIds.has(sub.userId)) continue
                const mine = marks.filter((a) =>
                    a.user.userId !== sub.userId && (sub.mode === 'week' || near.has(a.dateKey)))
                if (mine.length === 0) continue
                for (const a of mine) {
                    if (!labels.has(a.user.userId)) labels.set(a.user.userId, await mentionLabel(client, a.user))
                }
                // Про один день: форма открывается на нём. Про несколько: выбирать гостю.
                const days = new Set(mine.map((a) => a.dateKey))
                const target = days.size === 1 ? newRequestTarget(mine[0]!.dateKey) : newRequestTarget()
                try {
                    await client.sendText(sub.userId, html(buildText(mine, labels, today)), {
                        replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Оставить заявку', webappAt(webappUrl, target))]]),
                        disableWebPreview: true,
                    })
                } catch {
                    // гость не открывал личку с ботом
                }
            }
        },
        '[attend-alerts]',
    )
