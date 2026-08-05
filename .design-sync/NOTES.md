# design-sync: заметки по этому репозиторию

Синк дизайн-системы миниаппа в проект claude.ai/design `bd914cf0-e212-4ea4-88a7-7d5946621728`
(«Telegram webapp DS»). Команды и поля — в `config.json`.

## Как устроен вход

- Репо не библиотека, а Vite-приложение, поэтому вход собран специально:
  `webapp/src/ds.ts` — барель дизайн-системы, `npm --prefix webapp run build:ds`
  (`webapp/tsconfig.ds.json`) кладёт `.d.ts` в `webapp/dist-ds`, а поле `types` в
  `webapp/package.json` указывает туда. **Без этого шага пропсы уезжают пустыми**:
  ts-morph ищет типы от `pkgJson.types`.
- JS-сборки нет и не нужно: `--entry ./webapp/src/ds.ts`, esbuild жуёт TSX сам.
- `--node-modules ./webapp/node_modules` — там React и `@types/react`.
- Провайдер `DsPreview` и данные — `.design-sync/preview-provider.tsx` и `fixture.ts`,
  подмешиваются через `cfg.extraEntries` (путь-форма, ограничена корнем гита). Стор
  сеется на уровне модуля: `RequestRow`, `RequestsCard`, `DayRow`, `DevChips` читают
  `useStore().data!` и без снимка падают.
- Из списка карточек исключены (`componentSrcMap: null`): `ApiError` (класс ошибки),
  `ModalHost` (портал, сам по себе рендерит пустоту), `EventPoster` (тянет
  `/event-photo.jpg`, в превью это 404). Из бандла они не выпадают — только из карточек.

## Грабли, которые стоили итерации

- **У `.avatar` нет своего размера** — его даёт контекст (`.req-avatar` 40px,
  `.avatar-stack .avatar` 26px, `.pill .avatar` 20px). Голый `<Avatar>` растягивается
  в розовую полосу; первая версия превью так и попалась.
- `PurposeInput` прозрачный и без рамки — рамка это карточка вокруг (`.card > .kv-block`).
- `BottomBar` — `position: fixed`, в сетке карточек кадрируется. Лечится
  `overrides.BottomBar.cardMode = "single"` (трансформированная обёртка становится
  containing block) плюс отступ под панель в самом превью.
- Строки заявок в трёхколоночной сетке режут имена многоточием → `cardMode: "column"`
  у `RequestRow` и `RequestsCard`. `[GRID_OVERFLOW]` при этом молчит: контент не
  вылезает, он схлопывается — смотреть глазами на `_screenshots/general__*.png`.
- **Windows: `package-build.mjs` делает `rm -rf ds-bundle`.** Любой шелл с cwd внутри
  этой папки даёт `EPERM: rm`. Не держать терминал в `ds-bundle`.
- Playwright: в кэше `~/AppData/Local/ms-playwright` лежали chromium 1217 и 1228,
  подошёл `playwright@1.61.0` (пинит 1228). Ставить с `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`,
  иначе потянет ещё 200 МБ.
- Шрифты `SF Pro Text` / `SF Mono` не поставляются **намеренно**: это системные шрифты
  Apple, их даёт платформа (в `runtimeFontPrefixes`). На не-Apple всё уезжает в
  Helvetica/Arial — ровно так же, как в самом миниаппе.

## Known render warns

Нет. Последний `package-validate.mjs` прошёл вообще без предупреждений (25/25 чисто).
Любая новая warn-строка на ре-синке — новая, разбирать её, а не списывать на шум.

## Re-sync risks

- **Фикстура — копия формы `Bootstrap`** из `webapp/src/types.ts`. Меняется контракт
  бэкенда — превью продолжат компилироваться, но будут показывать неправду. Правишь
  `types.ts` — загляни в `.design-sync/fixture.ts`.
- **Даты в фикстуре зашиты** (2026-08-05…2026-08-11), чтобы скриншоты не плыли день
  ото дня. «Сегодня» на карточках всегда 5 августа 2026 — это не баг.
- **`<Name>.d.ts` ссылается на доменные типы** (`HostingRequest`, `Attendee`,
  `SpaceEvent`, `User`, `DayRowData`, `AvatarUser`, `SwipeAction`), которых в самом
  файле нет — они не экспортируются как значения. Их формы описаны в `conventions.md`;
  правишь `types.ts` — правь и там.
- **`conventions.md` перечисляет классы и токены по именам.** Переименование в
  `app.css` превращает хедер во враньё, которому дизайн-агент верит. На каждом
  ре-синке прогонять имена по `ds-bundle/_ds_bundle.css` (grep) и по списку папок в
  `ds-bundle/components/general/`.
- **Барель `webapp/src/ds.ts` руками.** Новый компонент в `webapp/src/components/`
  сам в дизайн-систему не попадёт.
- **Первый прогон `resync.mjs` отдаёт `ok:false`** из-за стадии capture: удалённого
  якоря ещё нет, поэтому все компоненты считаются `added` и попадают в `pendingGrade`.
  Оценки при этом целы — отдельный `package-capture.mjs` печатает 25 carried forward и
  выходит 0. После первой заливки якорь есть, и это уходит.
- Группа у всех компонентов одна (`general`): в `src/` они лежат плоско, а раздавать
  группы через `docsMap`-заглушки не стали — это меняет cfg-срез и сбрасывает оценки.
