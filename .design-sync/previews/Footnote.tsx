import { Footnote } from 'endpoint-robot-webapp'

/** Сноска под карточкой: иконка «i» + пояснение мелким вторичным текстом. */
export const UnderCard = () => (
  <>
    <div className="card">
      <div className="row">
        <span className="row-label">
          Прийти анонимно
          <span className="row-sublabel">Другие гости не увидят вас в списке</span>
        </span>
      </div>
    </div>
    <Footnote>Резиденты всё равно увидят заявку — с меткой «инкогнито».</Footnote>
  </>
)

/** Длинная сноска: переносится по строкам, иконка остаётся сверху. */
export const Long = () => (
  <Footnote>
    Кнопка «Я на месте» появится на экране визита за полчаса до времени и будет жить час после.
    Нажмёте — хост получит сообщение, а если его нет в спейсе, то и все, кто сейчас внутри.
  </Footnote>
)
