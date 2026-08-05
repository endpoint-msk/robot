import { AnonRow } from 'endpoint-robot-webapp'

/** Выключено — обычная заявка, гостя видно в публичном списке дня. */
export const Off = () => <AnonRow anon={false} onChange={() => {}} />

/** Включено: в списке «кто придёт» гостя не будет, резиденты увидят метку «инкогнито». */
export const On = () => <AnonRow anon onChange={() => {}} />
