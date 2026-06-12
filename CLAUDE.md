# CLAUDE.md

Гайд для LLM по проекту `endpoint-robot` — телеграм-бота хакерспейса на TypeScript + [mtcute](https://mtcute.dev).

## Документация mtcute

Полный индекс гайда и API-референса в формате для LLM лежит здесь: <https://mtcute.dev/llms.txt>. Это «table of contents» с прямыми ссылками на `.md`-страницы; используй его как первый источник, когда нужны сигнатуры/имена методов или примеры (handlers, filters, banChatMember, deleteMessages и т. п.). Полный API-референс: <https://ref.mtcute.dev>.

## Что делает бот

Три независимые подсистемы, разделяющие общий стейт:

1. **Сборы донатов** (`src/fundraiser.ts`, `src/handlers.ts`, `src/scheduler.ts`) — один сбор на календарный месяц (UTC), команды `/goals`, `/donate`, `/remove`, `/setgoal`, `/settitle`. Лидерборд группируется по нику (lower-case) и сортируется по убыванию суммы; топ-3 — медали 🥇🥈🥉. Пагинация по `PAGE_SIZE = 10`.
2. **Присутствие резидентов** (`src/presence.ts`) — резиденты = админы любого из allowlist-чатов. `/start` в личке открывает меню «Отметиться с/без ника». Каждые 3 ч (`PRESENCE_PING_INTERVAL_MS`) — пинг в личку; если 15 минут (`PRESENCE_PING_TIMEOUT_MS`) нет нажатия «Я внутри» — отметка снимается. Если в чате ≥ 5 ч (`CHAT_SILENCE_MS`) тишина и есть отмеченные — список постится новым сообщением. Команда `/inside` доступна **любому участнику** allowlist-чата и пушит/обновляет список. **Авто-отметки по MAC** (`src/keenetic.ts`): `/bindmac <MAC>` в личке привязывает MAC; поллер опрашивает RCI-API Keenetic и сам ставит отметку (`source: 'mac'`), пока устройство онлайн, снимает после `MAC_ABSENCE_GRACE_MS` (10 мин) отсутствия. MAC-отметки **не пингуются** (пинг/таймаут только для `source: 'manual'`).
3. **3D-принтер** (`src/printer.ts`) — команда `/printer` тянет статус из Moonraker (Klipper) по `PRINTER_URL`. Доступна в личке всем и в allowlist-чатах. При активной печати показывает прогресс + картинку (превью gcode / снимок вебки, переключаются кнопками) и кнопку «Уведомить по окончании». Поллер (тик 30 с) ловит переход в терминальное состояние и шлёт подписчикам в личку.

## Архитектура

```
src/index.ts        — точка входа: env, клиент, dispatcher, регистрация хендлеров, шедулеры, setMyCommands per-scope
src/handlers.ts     — команды сборов + общий callback для пагинации/обновления, проверки allowlist/админа
src/presence.ts     — /start, callback presence:*, трекер активности чатов, watcher удалений, шедулер пингов/тишины
src/printer.ts      — /printer, callback printer:* (превью/камера/подписка), запросы к Moonraker, поллер окончания печати
src/keenetic.ts     — клиент RCI-API Keenetic: challenge-response авторизация, fetchActiveMacs (онлайн MAC), нормализация MAC
src/fundraiser.ts   — чистая модель: createFundraiser, buildLeaderboard, renderFundraiser, parseDonateArgs, parseRemoveArgs
src/scheduler.ts    — раз в минуту перерисовывает «последнее сообщение со сбором» при смене UTC-месяца
src/storage.ts      — JSON-файл с атомарной записью через writeChain (промис-цепочка), tmp+rename
src/types.ts        — все типы стейта; emptyState() — фабрика дефолта
```

### Ключевые инварианты

- **`onCallbackQuery`: на «чужой» callback всегда `return PropagationAction.Continue`, а не голый `return`.** Голый `return` (или `return undefined`) останавливает пропагацию, и другие `onCallbackQuery`-хендлеры (presence, printer, fundraiser) НЕ увидят свой callback. Симптом — «кнопка ничего не делает». Все callback-хендлеры зарегистрированы независимо в разных модулях.
- **`State` плоский и однофайловый**, всё через `Storage.update(mutator)` — мутация in-memory + запись на диск. Не читать `state` из нескольких мест без понимания, что `update` сериализует записи; чтение через `storage.get()` возвращает живую ссылку.
- **`periodKey` = `YYYY-MM` по UTC**. Сменa месяца → `scheduler.ts` перерисовывает `lastMessages[chatId]` под новый сбор. Никогда не сравнивать ключи через локальное время.
- **Allowlist `ALLOWED_CHATS`** — единственный гейт «бот тут вообще работает». В чужих чатах бот **молчит** (никаких ответов даже на ошибки) — это сознательный design: см. `requireUserInAllowedChat`/`requireChatAdminInAllowedChat`.
- **Админ-проверка через `getChatMember`** на каждый запрос (`isChatAdmin`). Кэша нет — это даёт актуальность ценой одного API-вызова на команду.
- **`/inside` — для всех участников allowlist-чата**, остальные команды сборов — только для админов. Это закреплено двумя разными хелперами и двумя scope-ами в `setMyCommands`.

### Поток сообщения сбора

`/goals` или `/donate` → `ensureCurrentFundraiser` → `renderFundraiser` → `msg.answerText` + `rememberLastMessage`. Дальше любые `/donate`, `/setgoal`, `/settitle`, `/remove`, кнопки «Обновить»/`◀️▶️` → `refreshLastMessageInChat`, который **редактирует** запомненное сообщение. Если оно удалено/протухло (`MESSAGE_ID_INVALID`, `MESSAGE_DELETE`) — забываем id, при следующем `/goals` запомнится новое.

### Поток presence

- Чек-ин: callback `presence:checkin:nick|anon` → `checkInResident` пишет в `state.presence[userId]` и для каждого чата, где юзер админ, делает `upsertPresenceListInChat(... 'edit')`.
- Чек-аут: `presence:checkout` → `removePresence` (тоже обновляет списки во всех релевантных чатах).
- Шедулер `startPresenceScheduler` (тик 60 с): (0) проверяет, что сохранённое сообщение со списком физически есть (`getMessages`), иначе постит новое; (1) шлёт пинги или снимает по таймауту; (2) если в чате тишина ≥ 5 ч — постит список новым сообщением (`mode: 'new'`).
- `registerPresenceDeleteWatcher` ловит `onDeleteMessage` для синхронной реакции на удаление; в супергруппах `channelId` приходит без префикса `-100`, маппинг в коде явный (`-1000000000000 - channelId`).

### Поток printer

- `/printer` → `fetchPrinterStatus` (Moonraker `/printer/objects/query`). Не печатает → просто текст. Печатает → `fetchPrinterThumbnail` (превью из метаданных gcode) + `activeKeyboard('preview')`.
- Кнопки `printer:view:preview|camera` → `ctx.editMessage({ media })` подменяет картинку (превью gcode ↔ `fetchWebcamSnapshot`); у активного вида галочка ✅, повторный тап ловит `MESSAGE_NOT_MODIFIED`.
- Кнопка `printer:notify` → перепроверяет live-статус, пишет userId в `state.printerSubscribers` и шлёт подтверждение в личку с кнопкой `printer:unsubscribe`. Если бот не может писать в личку — просит нажать `/start`.
- `startPrinterCompletionWatcher` (тик 30 с): при переходе из активной печати в `complete`/`cancelled`/`error` шлёт подписчикам в личку и **чистит весь список** (подписка одноразовая, на текущую печать — иначе «переедет» на следующую).
- **Превью зависит от слайсера**: миниатюры должны быть встроены в gcode. **Снимок вебки** — `snapshot_url` первой камеры из `/server/webcams/list`, фолбэк `/webcam/?action=snapshot`.

## Соглашения кода

- **TypeScript strict + `noUncheckedIndexedAccess`** — массивы/индексы возвращают `T | undefined`, всегда проверяйте или `!`-утверждайте после явной проверки длины.
- **ESM + NodeNext**: импорты в исходниках идут с расширением `.js` (`from './handlers.js'`), даже если файл `.ts` — это требование `module: "NodeNext"`. Не уберать.
- **Без билда**: запуск через `tsx` (`npm start` / `npm run dev`). `tsconfig.outDir = dist` есть, но не используется.
- **Никаких сторонних логгеров** — `console.log/warn/error` достаточно. Префиксы `[warn]`, `[presence]`, `[scheduler]`, `[printer]`, `[keenetic]` — соблюдать.
- **Тексты пользователю — на русском**, тон соответствует существующим сообщениям.
- **`html()` схлопывает `\n` в пробел** — реальный перенос строки даёт только `<br>`. Многострочные сообщения собирать через `lines.join('<br>')` (см. `fundraiser.ts`), не `'\n'`.
- **Тип чата**: `msg.chat` — это `Peer = User | Chat`, дискриминатор `.type`. Личка с ботом — `msg.chat.type === 'user'` (НЕ `chatType`, он только у `Chat` и без значения `'private'`).
- **Картинка из байтов**: `msg.answerMedia(InputMedia.photo(uint8Array, { caption: html(text) }), { replyMarkup })`; подмена картинки в существующем сообщении — `ctx.editMessage({ media: InputMedia.photo(...) })`. На повторный edit той же картинки прилетает `MESSAGE_NOT_MODIFIED` — ловить и отвечать тихим `ctx.answer`.
- **Комментарии**: писать только когда «почему» неочевидно (см. существующие JSDoc-блоки над экспортами и встроенные комментарии о mtcute-нюансах). Не дублировать «что делает функция» — имена и сигнатуры самодокументируемы.

## Команды разработки

```bash
npm install
npm start          # tsx src/index.ts
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit  (это весь CI, тестов нет)
```

`.env` обязателен: `API_ID`, `API_HASH`, `BOT_TOKEN`, `ALLOWED_CHATS` (через запятую), опционально `DATA_FILE` (по умолчанию `./data.json`), `PRINTER_URL` (Moonraker; без него `/printer` отключён), `KEENETIC_URL`/`KEENETIC_LOGIN`/`KEENETIC_PASSWORD` (все три — иначе авто-отметки по MAC отключены). Сессия mtcute — `bot.session` в CWD.

Тестов и линтера нет. После любых правок — `npm run typecheck`.

## Что НЕ делать

- Не кэшировать результат `getChatMember` в `state` — он намеренно живой.
- Не вводить миграции схемы стейта без необходимости: `Storage.load` устойчив к отсутствующим полям через `?? {}`.
- Не добавлять реакции/ответы в чатах вне `ALLOWED_CHATS`. «Молчание в чужих чатах» — это фича.
- Не путать `chatId` (Telegram, со знаком, с префиксом `-100` для супергрупп) и `channelId` (mtcute updates, без префикса). См. `registerPresenceDeleteWatcher`.
- Не писать новые таймеры через `setTimeout` chain — следовать паттерну `setInterval` + `tick` + `stop()`-handle, как в `scheduler.ts` и `presence.ts`.
- Не использовать `.then`/`.catch`-цепочки в новом коде; везде `async/await`.
