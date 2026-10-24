import { NotifyScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const AllOn = () => (
  <SceneStage scene="notify">
    <NotifyScene
      botName="Endpoint Robot"
      banners={[
        { key: 'req', time: 'сейчас', text: '🚪 Новая заявка на визит: Ср, 5 августа к 18:30 (сегодня). Гость: Оля.', off: false },
        { key: 'ev', time: '1 ч назад', text: '📅 Новый ивент: Ремонт-кафе. Сб, 8 августа к 16:00.', off: false },
        { key: 'dues', time: '1 сентября', text: '💸 Открыт сбор резидентского взноса за сентябрь. С тебя 2 222 ₽.', off: false },
      ]}
    />
  </SceneStage>
)

export const EventsOff = () => (
  <SceneStage scene="notify">
    <NotifyScene
      botName="Endpoint Robot"
      banners={[
        { key: 'req', time: 'сейчас', text: '🚪 Новая заявка на визит: Пт, 7 августа к 14:00. Гость: Дима.', off: false },
        { key: 'ev', time: '1 ч назад', text: '📅 Новый ивент: Ремонт-кафе. Сб, 8 августа к 16:00.', off: true },
      ]}
    />
  </SceneStage>
)
