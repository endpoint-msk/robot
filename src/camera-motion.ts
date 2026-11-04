import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { startHeartbeatInterval } from './health.js'
import { presenceLogTz, sessionsInRange } from './presence-log.js'
import type { Storage } from './storage.js'

/**
 * Движение на камере спейса, когда внутри никого из резидентов: кадр в чат резидентов.
 *
 * Источник - лента camera-view (`events.json`): события с абсолютным временем и кадром из
 * самого подвижного момента. camera-view разбирает пятиминутный клип, когда тот дописан,
 * так что событие доходит через 1-6 минут после движения. Это нам на руку: вошедший
 * резидент к этому времени обычно уже отмечен (телефон поймал Wi-Fi или чек-ин).
 */

const TICK_MS = 60_000
const FETCH_TIMEOUT_MS = 10_000
/** Свежее событие ждёт: телефон вошедшего резидента мог ещё не поймать Wi-Fi. */
const SETTLE_MS = 3 * 60_000
/** Резидент ушёл меньше этого до движения - скорее всего, это он и уходил. */
const RECENT_PRESENCE_MS = 15 * 60_000
/** Движение ближе этого к прошлому - та же серия, второе сообщение не шлём. */
const SERIES_GAP_MS = 15 * 60_000

export type CameraMotionConfig = {
    /** База ленты со слэшем на конце: `<feedUrl>events.json`, `<feedUrl><кадр>.jpg`. */
    feedUrl: string
    /** Готовый заголовок `Basic <base64>`; null - лента без пароля. */
    auth: string | null
    /** Плеер записей; кнопка ведёт на момент движения (`#t=<мс>`). null - без кнопки. */
    viewUrl: string | null
}

type MotionEvent = {
    start: string
    end: string
    snapshot: string | null
}

export const parseCameraMotionConfig = (env: {
    url: string | undefined
    auth: string | undefined
    viewUrl: string | undefined
}): CameraMotionConfig | null => {
    const url = env.url?.trim()
    if (!url) return null
    const auth = env.auth?.trim()
    return {
        feedUrl: url.endsWith('/') ? url : `${url}/`,
        auth: auth && auth.includes(':') ? `Basic ${Buffer.from(auth).toString('base64')}` : null,
        viewUrl: env.viewUrl?.trim() || null,
    }
}

const get = async (config: CameraMotionConfig, path: string): Promise<Response> => {
    const res = await fetch(config.feedUrl + path, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: config.auth ? { Authorization: config.auth } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${path}`)
    return res
}

const fetchEvents = async (config: CameraMotionConfig): Promise<MotionEvent[]> => {
    const raw: unknown = await (await get(config, 'events.json')).json()
    if (!Array.isArray(raw)) throw new Error('events.json: не массив')
    return raw
        .filter((e): e is MotionEvent =>
            typeof e === 'object' && e !== null
            && Number.isFinite(Date.parse(e.start)) && Number.isFinite(Date.parse(e.end))
            && (e.snapshot === null || (typeof e.snapshot === 'string' && /^cam_[\w+-]+\.jpg$/.test(e.snapshot))))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/**
 * Был ли кто-то из резидентов в спейсе: отмечен сейчас или ушёл недавно. Сейчас - даже если
 * пришёл после движения: движение, скорее всего, и было его приходом.
 */
const residentAround = async (storage: Storage, at: number, now: number): Promise<boolean> => {
    if (Object.keys(storage.get().presence).length > 0) return true
    const since = at - RECENT_PRESENCE_MS
    const tz = presenceLogTz()
    const dayKey = (ms: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10)
    const sessions = await sessionsInRange(storage, dayKey(since), dayKey(now))
    return sessions.some((s) => Date.parse(s.to) >= since)
}

const clock = (ms: number): string => new Date(ms + presenceLogTz() * 60_000).toISOString().slice(11, 16)

const sendAlert = async (
    client: TelegramClient,
    chatId: number,
    config: CameraMotionConfig,
    event: MotionEvent,
): Promise<void> => {
    const start = Date.parse(event.start)
    const at = 'в\u00a0' + clock(start)
    const caption = html`🎥 Движение в спейсе ${at}, а внутри никого из резидентов не отмечено.`
    const replyMarkup = config.viewUrl
        ? BotKeyboard.inline([[BotKeyboard.url('▶️ Открыть запись', `${config.viewUrl}#t=${start}`)]])
        : undefined
    let photo: Uint8Array | null = null
    if (event.snapshot) {
        try {
            photo = new Uint8Array(await (await get(config, event.snapshot)).arrayBuffer())
        } catch (err) {
            console.warn('[camera] кадр не скачался, шлю без него:', err)
        }
    }
    if (photo) {
        try {
            // Голые байты mtcute заливает без имени, и Telegram отвечает PHOTO_EXT_INVALID.
            const media = InputMedia.photo(photo, { caption, fileName: 'motion.jpg', fileMime: 'image/jpeg' })
            await client.sendMedia(chatId, media, { replyMarkup })
            return
        } catch (err) {
            // Кадр - приятное дополнение: без него оповещение всё равно должно дойти.
            console.error('[camera] кадр не принят, шлю оповещение текстом:', err)
        }
    }
    await client.sendText(chatId, caption, { replyMarkup })
}

export const startCameraMotionAlerts = (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    config: CameraMotionConfig,
): { stop: () => void } =>
    startHeartbeatInterval('camera', TICK_MS, () => cameraMotionTick(client, storage, chatId, config), '[camera] alerts')

/** Один проход по ленте; отдельно от интервала, чтобы его можно было дёрнуть руками. */
export const cameraMotionTick = async (
    client: TelegramClient,
    storage: Storage,
    chatId: number,
    config: CameraMotionConfig,
    now: number = Date.now(),
): Promise<void> => {
    const events = await fetchEvents(config)
    const { cursor } = storage.get().cameraMotion
    if (cursor === null) {
        // Первый запуск: всё, что уже лежит в ленте, - прошлое, его не рассылаем.
        const last = events.at(-1)?.start ?? new Date(now).toISOString()
        await storage.update((s) => {
            s.cameraMotion.cursor = last
        })
        return
    }
    // После пересчёта в camera-view старые события приходят заново с другими границами:
    // курсор по началу их отсекает.
    const fresh = events.filter((e) => Date.parse(e.start) > Date.parse(cursor) && Date.parse(e.start) <= now - SETTLE_MS)
    for (const event of fresh) {
        const start = Date.parse(event.start)
        const { seriesEnd } = storage.get().cameraMotion
        const sameSeries = seriesEnd !== null && start - Date.parse(seriesEnd) < SERIES_GAP_MS
        let alerted = false
        if (!sameSeries && !(await residentAround(storage, start, now))) {
            try {
                await sendAlert(client, chatId, config, event)
                alerted = true
            } catch (err) {
                // Курсор всё равно двигаем: иначе недоставленное событие слалось бы каждую минуту.
                console.error(`[camera] не смог отправить оповещение в чат ${chatId}:`, err)
            }
        }
        await storage.update((s) => {
            s.cameraMotion.cursor = event.start
            const prev = s.cameraMotion.seriesEnd
            if (alerted || (sameSeries && prev !== null && Date.parse(event.end) > Date.parse(prev))) {
                s.cameraMotion.seriesEnd = event.end
            }
        })
    }
}
