# Как собирать интерфейс на этой системе

Дизайн-система Telegram Mini App хакерспейса endpoint: iOS-подобный один столбец
шириной до 520px, светлая и тёмная темы. Вёрстка — **готовые CSS-классы**, а не
пропсы стилей и не утилиты: у компонентов почти нет визуальных пропов, зато у
системы есть словарь классов, которым размечается всё остальное. Пиши разметку
этими классами, не изобретай свои имена.

## Обёртка, тема и данные

Оборачивай дерево в `DsPreview` — она даёт контексты (`BarContext` для `BottomBar`,
`AnimContext` для `Screen`) и сеет пример данных в стор. Без неё `BottomBar`
возвращает `null`, а компоненты, читающие стор, падают.

```jsx
const { DsPreview, Screen, Header, RequestsCard, setData } = window.EndpointDS
<DsPreview><Screen>…</Screen></DsPreview>
```

Тема ставится атрибутом `data-theme="light" | "dark"` на `<html>` (значение всегда
уже разрешённое). Цвета инлайновых SVG считает `sec(alpha)` в JS — в атрибут
`stroke` CSS-переменную не подставить.

`RequestRow`, `RequestsCard`, `DayRow`, `DevChips` берут снимок бэкенда из стора,
а не из пропсов. Свой снимок подаётся `setData(bootstrap)` до рендера. Формы
данных (их же ждут пропсы `r`, `day`, `a`, `event`):

```ts
User          = { userId: number; username: string | null; name: string }
Attendee      = { userId; name; username: string | null; resident: boolean; time: string | null }
HostingRequest= { id: string; dateKey: 'YYYY-MM-DD'; time: 'HH:MM'; purpose: string
                  status: 'pending' | 'approved'; createdAt: string; guest: User
                  approvedBy: User | null; anon: boolean
                  proposal: { dateKey; time; by: 'resident' | 'guest'; user: User; to?: User | null; at: string } | null }
SpaceEvent    = { id; dateKey; time; title; description; residentsOnly: boolean
                  photos: string[]; host: User; createdAt: string }
Day           = { dateKey; total: number; approved: number; requests?: HostingRequest[]
                  attendees: Attendee[]; events: SpaceEvent[] }
Bootstrap     = { me: { id; username; name; isResident; isDev; acceptedRules }
                  todayKey; nowTime; days: Day[]; myRequests; myPast; notes?; guestStats?; settings }
```

## Словарь классов

| Семья | Классы |
|---|---|
| Каркас | `.screen` (отступы экрана), `.screen.has-bottom-bar`, `.card` (белая карточка r22), `.row` (ряд 44px), `.row.tappable`, `.row.today`, `.sep` |
| Текст ряда | `.row-label`, `.row-label > .row-sublabel`, `.row-right` (акцессуар справа) |
| Заголовки | `.title` (34/800), `.subtitle`, `.section-title` (мелкая заглавная над карточкой), `.footnote` |
| Люди | `.avatar` (размер задаёт контекст!), `.req-avatar` (40px), `.avatar-stack .avatar` (26px), `.pill .avatar` (20px), `.req-main`, `.req-name`, `.req-sub`, `.person-tap` |
| Кнопки | `.primary-btn` (синяя, во всю ширину), `.destructive-btn` (красный текст на карточке), `.host-btn` (синяя капсула в ряду), `.accept-btn` (зелёная), `.modal-btn` |
| Метки | `.pill`, `.visit-chip`, `.visit-chip.first`, `.resident-badge`, `.dev-chip`, `.day-chip`, `.ev-chip`, `.readonly-badge` |
| Поля | `.text-input`, `.time-input`, `.purpose-input` (прозрачное, живёт в `.card > .kv-block`) |
| День | `.day-col`, `.dow`, `.date`, `.day-count`, `.day-none`, `.approved-count` |

**У `.avatar` нет своего размера** — он всегда приходит от контекста. Голый
`<Avatar>` растянется в полосу; ставь `className="req-avatar"` или клади внутрь
`.avatar-stack` / `.pill`.

## Токены

Все цвета — переменные, объявлены на `:root` и переопределены в
`:root[data-theme="dark"]`. Фон/подложки: `--bg`, `--bg-0`, `--card`, `--chip`,
`--today`, `--overlay`, `--busy`. Текст: `--text`, `--text-2`, `--text-3`,
`--text-4`, `--sec` (rgb-тройка для `rgba(var(--sec), α)`). Акценты одинаковы в
обеих темах: `--blue` действия, `--green` одобрение, `--red` блокировка,
`--orange` обратимое закрытие, `--purple` ивенты, `--gray` нейтральное действие.
Форма: `--radius-card` (22px), `--shadow-card`, `--sep`. Подтверждённый визит
живёт на своей зелёной палитре `--ok-*`. Хардкод hex вместо токена ломает тёмную тему.

Шрифт — системный стек (`-apple-system`, `SF Pro Text`, дальше Helvetica/Arial);
файлы не поставляются намеренно, их даёт платформа.

## Где смотреть правду

`styles.css` и его `@import "./_ds_bundle.css"` — это целиком стили миниаппа
(76 КБ, все классы выше). Читай их перед тем, как стилизовать что-то своё.
Пропсы и назначение компонента — в `components/general/<Name>/<Name>.d.ts` и
`<Name>.prompt.md`.

## Пример

```jsx
const { DsPreview, Screen, Header, SectionTitle, RequestsCard, BottomBar } = window.EndpointDS

<DsPreview>
  <Screen hasBottomBar>
    <Header title="Среда, 5 августа" subtitle="3 заявки · 1 одобрена" />
    <SectionTitle>Заявки</SectionTitle>
    <RequestsCard list={requests} />
    <div className="card">
      <div className="row">
        <span className="row-label">Кто придёт<span className="row-sublabel">Резиденты и гости</span></span>
        <div className="row-right"><span className="day-count">5</span></div>
      </div>
    </div>
    <BottomBar><button className="primary-btn">Захостить</button></BottomBar>
  </Screen>
</DsPreview>
```
