# CLAUDE.md

Гайд для LLM по проекту `endpoint-robot` — телеграм-бота хакерспейса на TypeScript + [mtcute](https://mtcute.dev).

## Документация mtcute

Полный индекс гайда и API-референса в формате для LLM лежит здесь: <https://mtcute.dev/llms.txt>. Это «table of contents» с прямыми ссылками на `.md`-страницы; используй его как первый источник, когда нужны сигнатуры/имена методов или примеры (handlers, filters, banChatMember, deleteMessages и т. п.). Полный API-референс: <https://ref.mtcute.dev>.

## Что делает бот

Четыре независимые подсистемы, разделяющие общий стейт:

1. **Сборы донатов** (`src/fundraiser.ts`, `src/handlers.ts`, `src/scheduler.ts`) — один сбор на календарный месяц (UTC), команды `/goals`, `/donate`, `/remove`, `/setgoal`, `/settitle`. Лидерборд группируется по нику (lower-case) и сортируется по убыванию суммы; топ-3 — медали 🥇🥈🥉. Пагинация по `PAGE_SIZE = 10`.
2. **Присутствие резидентов** (`src/presence.ts`) — резиденты = админы любого из allowlist-чатов. `/start` в личке открывает меню «Отметиться с/без ника». Каждые 3 ч (`PRESENCE_PING_INTERVAL_MS`) — пинг в личку; если 15 минут (`PRESENCE_PING_TIMEOUT_MS`) нет нажатия «Я внутри» — отметка снимается. Пока есть отмеченные, список раз в интервал (`PRESENCE_LIST_INTERVAL_MS`, 5 ч) постится новым сообщением — независимо от активности чата. Команда `/inside` доступна **любому участнику** allowlist-чата и пушит/обновляет список. **Авто-отметки по MAC** (`src/keenetic.ts`): `/bindmac <MAC>` в личке привязывает MAC; поллер опрашивает RCI-API Keenetic и сам ставит отметку (`source: 'mac'`), пока устройство онлайн, снимает после `MAC_ABSENCE_GRACE_MS` (10 мин) отсутствия. MAC-отметки **не пингуются** (пинг/таймаут только для `source: 'manual'`).
3. **3D-принтер** (`src/printer.ts`) — команда `/printer` тянет статус из Moonraker (Klipper) по `PRINTER_URL`. Доступна в личке всем и в allowlist-чатах. При активной печати показывает прогресс + картинку (превью gcode / снимок вебки, переключаются кнопками) и кнопку «Уведомить по окончании». Поллер (тик 30 с) ловит переход в терминальное состояние и шлёт подписчикам в личку.
4. **Хостинг гостей** (`src/hosting.ts`, `src/webapp.ts`, `webapp/`) — Telegram Mini App: гость оставляет заявку на визит (день из ближайших 7 + время + цель), резидент видит обзор недели и жмёт «Захостить». Включается `WEBAPP_URL` (бот поднимает HTTP-сервер `WEBAPP_HOST:WEBAPP_PORT`, статика `webapp/` + JSON API). Резиденты по умолчанию получают в личку уведомления о новых заявках в режиме «только на сегодня» (`hostingNotify`, дефолт см. `DEFAULT_HOSTING_NOTIFY`); настраивается в миниаппе («все» / «только сегодня» / выкл). Там же настройки MAC-привязок — общий стейт с `/bindmac`/`/unbindmac`/`/settings`. Кнопки входа: menu button рядом с полем ввода (ставится API-вызовом на старте), URL-кнопка под списком `/inside` (deep link `t.me/<bot>?startapp=hosting`, требует включённый Main Mini App в BotFather) и webView-кнопки в личке (`/start`, `/inside`). Подтверждённый визит можно добавить в календарь: `.ics` отдаётся по `GET /visit.ics` (см. поток ниже). Тема — системная по умолчанию, выбор в настройках; настройки открыты всем, но гостю в них доступна только тема. `DEV_USER_IDS` — дев-меню миниаппа: переключатель перспективы «резидент ↔ гость», создание фейковых заявок (`dev.seed`) и правка/удаление любых заявок (`dev.update`/`dev.delete`).

## Архитектура

```
src/index.ts        — точка входа: env, клиент, dispatcher, регистрация хендлеров, шедулеры, setMyCommands per-scope, запуск webapp-сервера + menu button
src/handlers.ts     — команды сборов + общий callback для пагинации/обновления, проверки allowlist/админа
src/presence.ts     — /start, callback presence:*, трекер активности чатов, watcher удалений, шедулер пингов/тишины
src/printer.ts      — /printer, callback printer:* (превью/камера/подписка), запросы к Moonraker, поллер окончания печати
src/keenetic.ts     — клиент RCI-API Keenetic: challenge-response авторизация, fetchActiveMacs (онлайн MAC), нормализация MAC
src/residents.ts    — ResidentDirectory: единый источник «кто резидент/админ» (isResident/presenceChats/isChatAdmin); реализация createTelegramResidentDirectory — поверх getChatMember. Точка замены под Authentik
src/fundraiser.ts   — чистая модель: createFundraiser, buildLeaderboard, renderFundraiser, parseDonateArgs, parseRemoveArgs
src/hosting.ts      — модель хостинга: dayKey/недели (пояс спейса), createHostingRequest, update/delete (dev), архив, рассылка уведомлений, buildVisitIcs (.ics для календаря)
src/webapp.ts       — HTTP-сервер миниаппа: статика webapp/ + POST /api/* c проверкой подписи initData + GET /visit.ics (initData в query)
webapp/             — фронт миниаппа: index.html + app.css + app.js (vanilla JS, без сборки; дизайн — iOS, светлая и тёмная темы)
src/scheduler.ts    — раз в минуту перерисовывает «последнее сообщение со сбором» при смене UTC-месяца
src/storage.ts      — JSON-файл с атомарной записью через writeChain (промис-цепочка), tmp+rename
src/types.ts        — все типы стейта; emptyState() — фабрика дефолта
```

### Ключевые инварианты

- **`onCallbackQuery`: на «чужой» callback всегда `return PropagationAction.Continue`, а не голый `return`.** Голый `return` (или `return undefined`) останавливает пропагацию, и другие `onCallbackQuery`-хендлеры (presence, printer, fundraiser) НЕ увидят свой callback. Симптом — «кнопка ничего не делает». Все callback-хендлеры зарегистрированы независимо в разных модулях.
- **`State` плоский и однофайловый**, всё через `Storage.update(mutator)` — мутация in-memory + запись на диск. Не читать `state` из нескольких мест без понимания, что `update` сериализует записи; чтение через `storage.get()` возвращает живую ссылку.
- **`periodKey` = `YYYY-MM` по UTC**. Сменa месяца → `scheduler.ts` перерисовывает `lastMessages[chatId]` под новый сбор. Никогда не сравнивать ключи через локальное время.
- **Allowlist `ALLOWED_CHATS`** — единственный гейт «бот тут вообще работает». В чужих чатах бот **молчит** (никаких ответов даже на ошибки) — это сознательный design: см. `requireUserInAllowedChat`/`requireChatAdminInAllowedChat`.
- **Кто резидент/админ — только через `ResidentDirectory`** (`src/residents.ts`), а не через прямой `getChatMember` в хендлерах. Три вопроса: `isResident` (юзер вообще резидент), `presenceChats` (в каких чатах показывать его присутствие), `isChatAdmin` (вправе ли выполнять админ-команду в этом чате). Сейчас всё это — живой `getChatMember` (кэша нет, актуальность ценой API-вызова); при переходе на Authentik меняется только реализация в `residents.ts`. NB: `presenceChats` сейчас == «где ты админ», но с Authentik совпадёт не обязательно — Authentik не знает про Telegram-чаты.
- **`/inside` — для всех участников allowlist-чата**, остальные команды сборов — только для админов. Это закреплено двумя разными хелперами и двумя scope-ами в `setMyCommands`.

### Поток сообщения сбора

`/goals` или `/donate` → `ensureCurrentFundraiser` → `renderFundraiser` → `msg.answerText` + `rememberLastMessage`. Дальше любые `/donate`, `/setgoal`, `/settitle`, `/remove`, кнопки «Обновить»/`◀️▶️` → `refreshLastMessageInChat`, который **редактирует** запомненное сообщение. Если оно удалено/протухло (`MESSAGE_ID_INVALID`, `MESSAGE_DELETE`) — забываем id, при следующем `/goals` запомнится новое.

### Поток presence

- Чек-ин: callback `presence:checkin:nick|anon` → `checkInResident` пишет в `state.presence[userId]` и для каждого чата, где юзер админ, делает `upsertPresenceListInChat(... 'edit')`.
- Чек-аут: `presence:checkout` → `removePresence` (тоже обновляет списки во всех релевантных чатах).
- Шедулер `startPresenceScheduler` (тик 60 с): (0) проверяет, что сохранённое сообщение со списком физически есть (`getMessages`), иначе постит новое; (1) шлёт пинги или снимает по таймауту; (2) если есть отмеченные, раз в `PRESENCE_LIST_INTERVAL_MS` (5 ч, якорь — `presenceListPostedAt`) постит список новым сообщением (`mode: 'new'`).
- `registerPresenceDeleteWatcher` ловит `onDeleteMessage` для синхронной реакции на удаление; в супергруппах `channelId` приходит без префикса `-100`, маппинг в коде явный (`-1000000000000 - channelId`).

### Поток printer

- `/printer` → `fetchPrinterStatus` (Moonraker `/printer/objects/query`). Не печатает → просто текст. Печатает → `fetchPrinterThumbnail` (превью из метаданных gcode) + `activeKeyboard('preview')`.
- Кнопки `printer:view:preview|camera` → `ctx.editMessage({ media })` подменяет картинку (превью gcode ↔ `fetchWebcamSnapshot`); у активного вида галочка ✅, повторный тап ловит `MESSAGE_NOT_MODIFIED`.
- Кнопка `printer:notify` → перепроверяет live-статус, пишет userId в `state.printerSubscribers` и шлёт подтверждение в личку с кнопкой `printer:unsubscribe`. Если бот не может писать в личку — просит нажать `/start`.
- `startPrinterCompletionWatcher` (тик 30 с): при переходе из активной печати в `complete`/`cancelled`/`error` шлёт подписчикам в личку и **чистит весь список** (подписка одноразовая, на текущую печать — иначе «переедет» на следующую).
- **Превью зависит от слайсера**: миниатюры должны быть встроены в gcode. **Снимок вебки** — `snapshot_url` первой камеры из `/server/webcams/list`, фолбэк `/webcam/?action=snapshot`.

### Поток хостинга

- Аутентификация API — только подпись `initData` миниаппа (`validateInitData` в `webapp.ts`, HMAC c ключом `WebAppData` + TTL 24 ч). Никаких сессий/куки. `isResident` = админ хотя бы одного allowlist-чата, проверяется на каждый запрос.
- `POST /api/bootstrap` — общий снапшот: 7 дней от «сегодня» (пояс спейса), свои заявки, настройки. **Гостям в днях отдаются только счётчики** (total/approved), детали заявок — резидентам и dev-аккаунтам (последним они нужны для дев-меню). Все мутирующие методы возвращают свежий bootstrap, фронт просто заменяет стор.
- Ключ дня — `YYYY-MM-DD` по поясу спейса (`HOSTING_TZ_OFFSET_MINUTES`, дефолт 180 = МСК, без DST). Никогда не считать «сегодня» через локальное время процесса — только `todayKey(offset)`. Время слота «на сегодня» не должно быть в прошлом: `isPastSlot`/`nowTimeKey` сравнивают с текущим временем в поясе спейса (bootstrap отдаёт `nowTime`, фронт ставит `min` у `<input type=time>` и гейтит перед отправкой).
- Правила заявок: день в окне `[сегодня; +6]`, одна активная заявка гостя на день, отмена заявки = удаление из стейта. «Захостить» может любой резидент (первый успевший), отменить одобрение — только сам одобривший (заявка возвращается в pending, гостю уходит DM).
- **Правка заявки гостем** (`editHostingRequest`, API `edit`): гость меняет день/время/цель/анонимность своей заявки, только пока она `pending` (иначе `not_pending`); те же гейты дня/времени/дубля, что при создании; незакрытое предложение переноса при этом снимается. У одобренной заявки правка запрещена (гость отменяет и создаёт заново).
- **Кто придёт** (`attendeesView`, поле `days[].attendees` — видно всем, включая гостей): подтверждённые (`approved`) гости **без анонимных** + резиденты, отметившиеся «я приду». Резиденты идут первыми (приоритет) и с пометкой `resident:true`; дубли по `userId` схлопываются в пользу резидентской строки (один человек мог и отметиться, и завести заявку). Цель визита в публичный список НЕ попадает. Гость включает анонимность (`request.anon`) при создании/правке — резиденты в своих списках (`requests`) видят его всегда, с меткой «инкогнито».
- **Отметка резидента «я приду»** (`setResidentAttendance`/`residentsAttendingDay`, стейт `hostingAttendance`, ключ `${dateKey}#${userId}`, API `attend`): без заявки, просто присутствие в списке дня; кнопка-переключатель на экране дня резидента; день — в окне `[сегодня; +6]`.
- **Перенос времени** (`proposeTime`/`acceptTimeProposal`/`clearTimeProposal`): пинг-понг вокруг `request.timeProposal` (`{ time, by: 'resident'|'guest', user, at }` или null). Сторона-адресат принимает (`proposal.accept` — согласованным становится `request.time`, предложение снимается) либо снимает предложение (`proposal.decline` — время не меняется). «Захостить» гасит висящее предложение.
  - Встречное `propose` **тем же временем**, что висит в предложении другой стороны, трактуется как `proposal.accept` (время согласовано, предложение снимается, уходит DM о принятии) — иначе стороны бесконечно пингуют друг друга одинаковым временем.
  - **pending**: резидент предлагает время на любой заявке (API `propose`), гость отвечает своим **только в ответ** на предложение резидента.
  - **approved**: перенос доступен обеим сторонам по своей инициативе — подтверждённый визит тоже иногда надо сдвинуть. Меняется только `time`, статус и `approvedBy` остаются. Со стороны резидентов работать с таким предложением (`propose`/`accept`/`decline`) вправе **только хост** (`approvedBy`), иначе чужой визит подвинет посторонний. День у одобренной заявки по-прежнему не двигаем — только время (правка заявки гостем так и осталась `pending`-only).
  - Уведомления адресные: резидент→гость по `guest.userId`; гость→ хосту (`approvedBy.userId`), а на pending — резиденту из прошлого предложения. Если адреса нет (встречное предложение гостя без предыдущего), DM не шлём.
- Уведомления: новая заявка → DM резидентам по prefs (`hostingNotify`, дефолт «включено, только сегодня»); одобрение/снятие одобрения → DM гостю; отмена одобренного визита гостем → DM одобрившему. Рассылка — fire-and-forget (`void …catch`), чтобы не задерживать HTTP-ответ.
- Архив — прошедшие недели (понедельник — ключ недели) с заявками, только для резидентов и только чтение.
- **Календарь** — `GET /visit.ics?id=&initData=` (`buildVisitIcs`, RFC 5545). Путь намеренно вне `/api/` (там только POST): ссылку открывает системный браузер, поэтому `initData` едет в query, а не в теле; подпись и TTL проверяются те же. Отдаём **только свою** заявку (в файле цель визита и кто хостит). `DTSTART` — в UTC (пояс спейса → UTC), длительность фиксированная (`ICS_EVENT_HOURS`).
- Фронт (`webapp/app.js`) — стек экранов без роутера; пользовательские строки только через `textContent` (никакого innerHTML), `innerHTML` — только для статических SVG-иконок. Дев-меню (переключатель перспективы, сид фейковых заявок, правка/удаление любых заявок) видно юзерам из `DEV_USER_IDS`; сервер проверяет это сам, чип лишь прячет вход.
- **Тема** — `data-theme` на `<html>`, ставит JS; в CSS всегда приходит уже разрешённая (`light`/`dark`), выбор (`system`/`light`/`dark`) лежит в `localStorage`. Цвета иконок считает `sec(alpha)` в JS: в атрибут `stroke` инлайнового SVG CSS-переменную не подставить.

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

`.env` обязателен: `API_ID`, `API_HASH`, `BOT_TOKEN`, `ALLOWED_CHATS` (через запятую), опционально `DATA_FILE` (по умолчанию `./data.json`), `PRINTER_URL` (Moonraker; без него `/printer` отключён), `KEENETIC_URL`/`KEENETIC_LOGIN`/`KEENETIC_PASSWORD` (все три — иначе авто-отметки по MAC отключены), `WEBAPP_URL` (+ `WEBAPP_HOST`/`WEBAPP_PORT`/`HOSTING_TZ_OFFSET_MINUTES`; без URL миниапп хостинга отключён). Сессия mtcute — `bot.session` в CWD.

Тестов и линтера нет. После любых правок — `npm run typecheck`.

## Что НЕ делать

- Не кэшировать результат `getChatMember` в `state` — он намеренно живой.
- Не вводить миграции схемы стейта без необходимости: `Storage.load` устойчив к отсутствующим полям через `?? {}`.
- Не добавлять реакции/ответы в чатах вне `ALLOWED_CHATS`. «Молчание в чужих чатах» — это фича.
- Не путать `chatId` (Telegram, со знаком, с префиксом `-100` для супергрупп) и `channelId` (mtcute updates, без префикса). См. `registerPresenceDeleteWatcher`.
- Не писать новые таймеры через `setTimeout` chain — следовать паттерну `setInterval` + `tick` + `stop()`-handle, как в `scheduler.ts` и `presence.ts`.
- Не использовать `.then`/`.catch`-цепочки в новом коде; везде `async/await`.
