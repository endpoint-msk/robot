import { EventCard } from 'endpoint-robot-webapp'
import { residentsOnlyEvent, spaceEvent } from '../fixture'

/** Открытый ивент: его видят и гости, и он попадает на доску в чат. */
export const Open = () => <EventCard event={spaceEvent} />

/** Только резидентам: чип у заголовка, гостям такой ивент не показывается. */
export const ResidentsOnly = () => <EventCard event={residentsOnlyEvent} />

/** С кнопкой «В календарь» — .ics отдаёт сервер по подписанной ссылке. */
export const WithCalendar = () => <EventCard event={spaceEvent} calendar />

/** Приглушённый заголовок — карточка в списке дня, где главное не ивент. */
export const DimTitle = () => <EventCard event={spaceEvent} dimTitle />
