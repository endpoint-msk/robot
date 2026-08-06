import { EventCard } from 'endpoint-robot-webapp'
import { residentsOnlyEvent, spaceEvent } from '../fixture'

export const Open = () => <EventCard event={spaceEvent} />

export const ResidentsOnly = () => <EventCard event={residentsOnlyEvent} />

export const WithCalendar = () => <EventCard event={spaceEvent} calendar />

export const DimTitle = () => <EventCard event={spaceEvent} dimTitle />
