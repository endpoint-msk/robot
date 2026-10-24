import { EventsScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const FromPost = () => (
  <SceneStage scene="events">
    <EventsScene
      ev={{
        title: 'Ремонт-кафе',
        short: 'сб 08.08, 16:00',
        when: 'Сб, 8 августа к 16:00',
        desc: 'Приносите сломанное: фены, лампы, наушники. Паяльники наши, руки общие.',
        photo: null,
      }}
    />
  </SceneStage>
)

export const NoDescription = () => (
  <SceneStage scene="events">
    <EventsScene ev={{ title: 'Кино в спейсе', short: 'пт 07.08, 20:00', when: 'Пт, 7 августа к 20:00', desc: '', photo: null }} />
  </SceneStage>
)
