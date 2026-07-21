import { BotKeyboard, html, InputMedia, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type CallbackQueryContext, type Dispatcher, type MessageContext } from '@mtcute/dispatcher'
import type { AllowedChats } from './handlers.js'
import type { Storage } from './storage.js'

/** Состояние печати, как его отдаёт Moonraker (`print_stats.state`). */
type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | string

type PrinterStatus = {
    state: PrintState
    /** Имя файла, который печатается (относительно корня gcodes). Пусто, если не печатает. */
    filename: string
    /** Прогресс печати 0..1, если доступен. */
    progress: number | null
}

export type { PrinterStatus }

const HUMAN_STATE: Record<string, string> = {
    standby: 'Простаивает',
    printing: 'Печатает',
    paused: 'На паузе',
    complete: 'Печать завершена',
    cancelled: 'Печать отменена',
    error: 'Ошибка',
}

const FETCH_TIMEOUT_MS = 8000

const CB_NOTIFY = 'printer:notify'
const CB_UNSUBSCRIBE = 'printer:unsubscribe'
const CB_VIEW_PREVIEW = 'printer:view:preview'
const CB_VIEW_CAMERA = 'printer:view:camera'

/** Состояния, которые считаем «активной печатью» (есть смысл уведомлять об окончании). */
export const ACTIVE_STATES = new Set(['printing', 'paused'])

/** Нормализует базовый URL принтера: гарантирует схему и убирает хвостовой слэш. */
export const normalizePrinterUrl = (raw: string | undefined): string | null => {
    if (!raw) return null
    let url = raw.trim()
    if (!url) return null
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
    return url.replace(/\/+$/, '')
}

/**
 * Парсит `PRINTER_AUTH` (формат `user:pass`) в готовый заголовок `Basic <base64>`.
 * Возвращает null, если переменная пуста или без двоеточия.
 */
export const parsePrinterAuth = (raw: string | undefined): string | null => {
    if (!raw) return null
    const value = raw.trim()
    if (!value || !value.includes(':')) return null
    return `Basic ${Buffer.from(value).toString('base64')}`
}

const authHeaders = (auth: string | null): Record<string, string> =>
    auth ? { Authorization: auth } : {}

/** Сколько раз пробуем достучаться до принтера и пауза между попытками. */
const FETCH_RETRIES = 3
const FETCH_RETRY_DELAY_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * GET с парой повторов: хост принтера (Raspberry Pi/Klipper) часто отвечает не с первого
 * раза — WiFi power-save, холодный TCP, занятый Moonraker. Ретраи прячут транзиентные сбои,
 * чтобы пользователь не видел «не удалось связаться», когда принтер на самом деле в сети.
 */
const fetchJson = async (url: string, auth: string | null): Promise<unknown> => {
    let lastErr: unknown
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: authHeaders(auth),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`)
            return await res.json()
        } catch (err) {
            lastErr = err
            if (attempt < FETCH_RETRIES) await sleep(FETCH_RETRY_DELAY_MS)
        }
    }
    throw lastErr
}

/** Запрашивает у Moonraker состояние печати, имя файла и прогресс. */
export const fetchPrinterStatus = async (baseUrl: string, auth: string | null): Promise<PrinterStatus> => {
    const url = `${baseUrl}/printer/objects/query?print_stats&virtual_sdcard&display_status`
    const data = (await fetchJson(url, auth)) as {
        result?: {
            status?: {
                print_stats?: { state?: string; filename?: string }
                virtual_sdcard?: { progress?: number }
                display_status?: { progress?: number }
            }
        }
    }
    const status = data.result?.status ?? {}
    const state = status.print_stats?.state ?? 'unknown'
    const filename = status.print_stats?.filename ?? ''
    // virtual_sdcard точнее отражает позицию в файле; display_status — запасной вариант.
    const progress = status.virtual_sdcard?.progress ?? status.display_status?.progress ?? null
    return { state, filename, progress: typeof progress === 'number' ? progress : null }
}

/**
 * Возвращает байты превью 3D-модели для печатающегося файла, или null, если превью нет.
 * Moonraker встраивает миниатюры в метаданные gcode; `relative_path` указывается
 * относительно директории самого gcode-файла, поэтому склеиваем путь вручную.
 */
export const fetchPrinterThumbnail = async (
    baseUrl: string,
    filename: string,
    auth: string | null,
): Promise<Uint8Array | null> => {
    if (!filename) return null
    const metaUrl = `${baseUrl}/server/files/metadata?filename=${encodeURIComponent(filename)}`
    const meta = (await fetchJson(metaUrl, auth)) as {
        result?: { thumbnails?: { width?: number; relative_path?: string }[] }
    }
    const thumbs = meta.result?.thumbnails ?? []
    if (thumbs.length === 0) return null
    // Берём самое крупное превью.
    const best = thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a))
    if (!best.relative_path) return null

    const slash = filename.lastIndexOf('/')
    const dir = slash >= 0 ? filename.slice(0, slash) : ''
    const thumbPath = dir ? `${dir}/${best.relative_path}` : best.relative_path
    const encoded = thumbPath.split('/').map(encodeURIComponent).join('/')
    const fileUrl = `${baseUrl}/server/files/gcodes/${encoded}`

    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: authHeaders(auth) })
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
}

/** Достаёт относительный snapshot_url первой вебки из Moonraker. Возвращает дефолт, если список пуст. */
const resolveSnapshotPath = async (baseUrl: string, auth: string | null): Promise<string> => {
    try {
        const data = (await fetchJson(`${baseUrl}/server/webcams/list`, auth)) as {
            result?: { webcams?: { snapshot_url?: string }[] }
        }
        const url = data.result?.webcams?.[0]?.snapshot_url
        if (url) return url
    } catch {
        // список вебок недоступен — используем дефолтный путь mjpeg-streamer
    }
    return '/webcam/?action=snapshot'
}

/**
 * Возвращает байты снимка с вебки принтера, или null, если кадр получить не удалось.
 * snapshot_url из Moonraker может быть как абсолютным, так и относительным к адресу принтера.
 */
export const fetchWebcamSnapshot = async (baseUrl: string, auth: string | null): Promise<Uint8Array | null> => {
    const snapshotPath = await resolveSnapshotPath(baseUrl, auth)
    const url = /^https?:\/\//i.test(snapshotPath)
        ? snapshotPath
        : `${baseUrl}/${snapshotPath.replace(/^\/+/, '')}`
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: authHeaders(auth) })
        if (!res.ok) return null
        return new Uint8Array(await res.arrayBuffer())
    } catch {
        return null
    }
}

/** Собирает текст ответа по статусу принтера. Строки склеиваются через `<br>`, т.к. `html()` схлопывает `\n` в пробел. */
export const renderStatus = (status: PrinterStatus): string => {
    const human = HUMAN_STATE[status.state] ?? status.state
    const lines = [`🖨 <b>Статус принтера:</b> ${human}`]
    if (status.state === 'printing' || status.state === 'paused') {
        if (status.filename) lines.push(`Файл: <code>${html.escape(status.filename)}</code>`)
        if (status.progress !== null) {
            lines.push(`Прогресс: ${Math.round(status.progress * 100)}%`)
        }
    }
    return lines.join('<br>')
}

const isAllowedChat = (allowed: AllowedChats, chatId: number): boolean => allowed.has(chatId)

/** Личка с ботом. В таких чатах `/printer` доступен всем. */
const isPrivateChat = (msg: MessageContext): boolean => msg.chat.type === 'user'

/**
 * Пропускаем команду, если это личка с ботом ИЛИ allowlist-чат с сообщением от пользователя.
 * В чужих группах — молчим.
 */
const canUsePrinter = async (msg: MessageContext, allowed: AllowedChats): Promise<boolean> => {
    if (isPrivateChat(msg)) return true
    const chatId = Number(msg.chat.id)
    if (!isAllowedChat(allowed, chatId)) return false
    if (!msg.sender || msg.sender.type !== 'user') {
        await msg.answerText('Команды доступны только пользователям.')
        return false
    }
    return true
}

const unsubscribeKeyboard = () =>
    BotKeyboard.inline([[BotKeyboard.callback('🔕 Отписаться', CB_UNSUBSCRIBE)]])

/** Какая картинка сейчас показана в сообщении активной печати. */
type PrinterView = 'preview' | 'camera'

/** Клавиатура для сообщения активной печати: переключение картинки (превью/камера) + подписка.
 *  У активного вида рядом стоит галочка. */
const activeKeyboard = (view: PrinterView) =>
    BotKeyboard.inline([
        [
            BotKeyboard.callback(`${view === 'preview' ? '✅ ' : ''}🖼 Превью`, CB_VIEW_PREVIEW),
            BotKeyboard.callback(`${view === 'camera' ? '✅ ' : ''}📷 Камера`, CB_VIEW_CAMERA),
        ],
        [BotKeyboard.callback('🔔 Уведомить по окончании печати', CB_NOTIFY)],
    ])

export const registerPrinterHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        allowedChats: AllowedChats
        printerUrl: string
        printerAuth: string | null
    },
): void => {
    const { client, storage, allowedChats, printerUrl, printerAuth } = deps

    dp.onNewMessage(filters.command('printer'), async (msg) => {
        if (!(await canUsePrinter(msg, allowedChats))) return

        let status: PrinterStatus
        try {
            status = await fetchPrinterStatus(printerUrl, printerAuth)
        } catch (err) {
            console.error('[printer] не удалось получить статус:', err)
            await msg.answerText('Не удалось связаться с принтером. Он включён и доступен в сети?')
            return
        }

        const text = renderStatus(status)
        const active = ACTIVE_STATES.has(status.state)

        if (!active) {
            await msg.answerText(html(text))
            return
        }

        let thumb: Uint8Array | null = null
        try {
            thumb = await fetchPrinterThumbnail(printerUrl, status.filename, printerAuth)
        } catch (err) {
            console.warn('[printer] не удалось получить превью:', err)
        }

        if (thumb) {
            await msg.answerMedia(InputMedia.photo(thumb, { caption: html(text) }), { replyMarkup: activeKeyboard('preview') })
        } else {
            await msg.answerText(html(text), { replyMarkup: activeKeyboard('preview') })
        }
    })

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        if (ctx.dataStr === CB_VIEW_PREVIEW || ctx.dataStr === CB_VIEW_CAMERA) {
            const wantCamera = ctx.dataStr === CB_VIEW_CAMERA

            let status: PrinterStatus
            try {
                status = await fetchPrinterStatus(printerUrl, printerAuth)
            } catch {
                await ctx.answer({ text: 'Принтер сейчас недоступен, попробуй позже.', alert: true })
                return
            }

            const image = wantCamera
                ? await fetchWebcamSnapshot(printerUrl, printerAuth)
                : await fetchPrinterThumbnail(printerUrl, status.filename, printerAuth).catch(() => null)

            if (!image) {
                await ctx.answer({
                    text: wantCamera ? 'Не удалось получить кадр с камеры.' : 'Превью для этой модели нет.',
                    alert: true,
                })
                return
            }

            const caption = html(renderStatus(status))
            try {
                await ctx.editMessage({
                    media: InputMedia.photo(image, { caption }),
                    replyMarkup: activeKeyboard(wantCamera ? 'camera' : 'preview'),
                })
                await ctx.answer({ text: wantCamera ? '📷 Камера' : '🖼 Превью' })
            } catch (err) {
                // У mtcute RpcError код лежит в `.text` (напр. 'MESSAGE_NOT_MODIFIED'), а `.message` — описание без кода.
                const text = `${(err as { text?: string })?.text ?? ''} ${(err as Error)?.message ?? ''}`
                // Повторный тап по активной кнопке (статичное превью) — картинка та же, Telegram ругается.
                if (/MESSAGE_NOT_MODIFIED/i.test(text)) {
                    await ctx.answer({ text: 'Уже показано' })
                    return
                }
                // Сообщение было текстовым (превью не нашлось при /printer) — media в него не вставить через edit.
                if (/MEDIA_NEW_INVALID|message.*media/i.test(text)) {
                    await ctx.answer({ text: 'Не получилось обновить картинку.', alert: true })
                    return
                }
                throw err
            }
            return
        }

        if (ctx.dataStr === CB_UNSUBSCRIBE) {
            const had = storage.get().printerSubscribers[String(ctx.user.id)] === true
            if (had) {
                await storage.update((s) => {
                    delete s.printerSubscribers[String(ctx.user.id)]
                })
            }
            try {
                await ctx.editMessage({
                    text: had ? 'Отписал тебя от уведомлений о печати 🔕' : 'Ты и так не подписан.',
                })
            } catch {}
            await ctx.answer({ text: had ? 'Отписал' : 'Подписки не было' })
            return
        }

        if (ctx.dataStr !== CB_NOTIFY) return PropagationAction.Continue

        let status: PrinterStatus
        try {
            status = await fetchPrinterStatus(printerUrl, printerAuth)
        } catch {
            await ctx.answer({ text: 'Принтер сейчас недоступен, попробуй позже.', alert: true })
            return
        }
        if (!ACTIVE_STATES.has(status.state)) {
            await ctx.answer({ text: 'Принтер уже не печатает — уведомлять не о чем.', alert: true })
            return
        }
        // Уже подписан — не шлём второе сообщение в личку.
        if (storage.get().printerSubscribers[String(ctx.user.id)] === true) {
            await ctx.answer({ text: 'Ты уже подписан — уведомлю по окончании печати 🔔' })
            return
        }
        // Подтверждение шлём в личку (с кнопкой отписки) — заодно проверяем, что бот может писать юзеру.
        try {
            await client.sendText(
                ctx.user.id,
                'Подписал тебя на уведомление 🔔 — напишу сюда, когда печать закончится.',
                { replyMarkup: unsubscribeKeyboard() },
            )
        } catch {
            await ctx.answer({
                text: 'Сначала напиши мне в личку (/start) — иначе я не смогу прислать уведомление.',
                alert: true,
            })
            return
        }
        await storage.update((s) => {
            s.printerSubscribers[String(ctx.user.id)] = true
        })
        await ctx.answer({ text: 'Уведомлю в личке, когда печать закончится 🔔' })
    })
}

/**
 * Поллит статус принтера и, при переходе из активной печати в любое терминальное
 * состояние (`complete`/`cancelled`/`error`), шлёт уведомление в личку всем подписчикам
 * и чистит список. Тик каждые 30 с.
 *
 * Чистим при ЛЮБОМ завершении (в т.ч. отмене), иначе подписка «переедет» на следующую печать:
 * отменил эту — и подписчик неожиданно получит пинг по чужому заданию.
 */
export const startPrinterCompletionWatcher = (
    client: TelegramClient,
    storage: Storage,
    printerUrl: string,
    printerAuth: string | null,
): { stop: () => void } => {
    let wasPrinting = false

    const tick = async () => {
        let status: PrinterStatus
        try {
            status = await fetchPrinterStatus(printerUrl, printerAuth)
        } catch {
            // Принтер недоступен — не трогаем состояние, попробуем на следующем тике.
            return
        }

        const active = ACTIVE_STATES.has(status.state)
        const terminal = wasPrinting && (status.state === 'complete' || status.state === 'cancelled' || status.state === 'error')
        wasPrinting = active

        if (!terminal) return

        const subscribers = Object.keys(storage.get().printerSubscribers)
        if (subscribers.length === 0) return

        await storage.update((s) => {
            s.printerSubscribers = {}
        })

        const file = status.filename ? `\nФайл: ${status.filename}` : ''
        const message =
            status.state === 'complete'
                ? `🖨 Печать завершена!${file}`
                : status.state === 'cancelled'
                  ? `🛑 Печать отменена.${file}`
                  : `⚠️ Печать прервана из-за ошибки принтера.${file}`
        for (const idStr of subscribers) {
            const userId = Number(idStr)
            try {
                await client.sendText(userId, message)
            } catch (err) {
                console.warn(`[printer] не смог уведомить ${userId}:`, err)
            }
        }
    }

    const handle = setInterval(() => {
        void tick().catch((err) => console.error('[printer] watcher tick error:', err))
    }, 30_000)

    return {
        stop: () => clearInterval(handle),
    }
}
