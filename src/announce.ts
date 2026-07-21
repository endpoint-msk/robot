import { html, type TelegramClient } from '@mtcute/node'
import type { Storage } from './storage.js'

/**
 * Система анонсов: рассылка объявлений во все allowlist-чаты (минус замьюченные
 * через /announcemute). Основной сценарий — «бот обновлён до версии X», где текст
 * тянется из описания последнего GitHub-релиза, но `broadcastAnnouncement` намеренно
 * работает с произвольным текстом — это база под универсальные рассылки.
 *
 * Релизы делает воркфлоу `release.yml` по пушу тега `vX.Y.Z`: генерит GitHub-style
 * release notes и создаёт Release. Бот только читает его описание — репо публичный,
 * токен не нужен.
 */

export type ReleaseInfo = {
    /** tag_name релиза, например 'v1.1.0'. */
    version: string
    /** Заголовок релиза (обычно == version). */
    name: string
    /** Тело релиза (markdown с авто-ченджлогом). */
    body: string
    /** Ссылка на страницу релиза. */
    url: string
    /** Когда опубликован (ISO). */
    publishedAt: string
}

/** Читает последний GitHub-релиз репо. null — сети нет / релизов ещё нет. */
export const fetchLatestRelease = async (repo: string): Promise<ReleaseInfo | null> => {
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'endpoint-robot' },
        })
        if (!res.ok) {
            // 404 — у репо ещё нет ни одного релиза; остальное — реальная ошибка.
            if (res.status !== 404) console.warn(`[announce] GitHub releases API вернул ${res.status}`)
            return null
        }
        const j = (await res.json()) as {
            tag_name?: string
            name?: string | null
            body?: string | null
            html_url?: string
            published_at?: string
        }
        if (!j.tag_name) return null
        return {
            version: j.tag_name,
            name: j.name || j.tag_name,
            body: j.body ?? '',
            url: j.html_url ?? '',
            publishedAt: j.published_at ?? '',
        }
    } catch (err) {
        console.warn('[announce] не удалось получить последний релиз:', err)
        return null
    }
}

/**
 * Превращает тело GitHub-релиза (markdown авто-нотсов) в плоский список строк
 * ченджлога: срезает markdown-заголовки (`## What's Changed`), строку
 * `**Full Changelog**`, маркеры списков заменяет на `•`.
 */
const changelogLines = (body: string): string[] => {
    const out: string[] = []
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        // Хвост авто-нотсов («New Contributors», «Full Changelog») в анонс не тащим.
        if (/^#{1,6}\s*new contributors/i.test(line)) break
        if (/^#{1,6}\s/.test(line)) continue
        if (/^\*\*full changelog\*\*/i.test(line)) continue
        // '* Заголовок PR by @user in https://…/pull/42' → '• Заголовок PR'.
        const item = line.replace(/^[*-]\s+/, '').replace(/\s+by @\S+ in https?:\/\/\S+$/i, '')
        out.push(`• ${item}`)
    }
    return out
}

/** Дефолтный текст анонса версии — его дев видит в textarea и может править. */
export const buildDefaultAnnouncement = (release: ReleaseInfo): string => {
    const changelog = changelogLines(release.body)
    const lines = [`✨ Бот обновлён до версии ${release.version}, ченджлоги:`, '']
    lines.push(...(changelog.length ? changelog : ['• Мелкие улучшения и исправления.']))
    return lines.join('\n')
}

/** Готовит текст анонса к отправке: экранирует построчно и склеивает через `<br>`
 *  (у mtcute `html()` схлопывает `\n`, реальный перенос даёт только `<br>`). */
export const renderAnnouncement = (text: string) =>
    html(text.split(/\r?\n/).map((l) => html.escape(l)).join('<br>'))

/** Сколько чатов реально получат анонс (allowlist минус замьюченные). */
export const announceTargets = (storage: Storage, allowedChats: ReadonlySet<number>): number[] =>
    [...allowedChats].filter((chatId) => storage.get().announceMuted[String(chatId)] !== true)

/**
 * Рассылает текст во все allowlist-чаты, кроме замьюченных. Ошибку отправки в
 * конкретный чат (бот кикнут / нет прав) логируем и продолжаем.
 */
export const broadcastAnnouncement = async (
    client: TelegramClient,
    storage: Storage,
    allowedChats: ReadonlySet<number>,
    text: string,
): Promise<{ sent: number; failed: number }> => {
    const rendered = renderAnnouncement(text)
    let sent = 0
    let failed = 0
    for (const chatId of announceTargets(storage, allowedChats)) {
        try {
            await client.sendText(chatId, rendered, { disableWebPreview: true })
            sent++
        } catch (err) {
            console.error(`[announce] не удалось отправить в чат ${chatId}:`, err)
            failed++
        }
    }
    return { sent, failed }
}
