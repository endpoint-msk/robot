import { DuesScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const Full = () => (
  <SceneStage scene="dues">
    <DuesScene label="Взнос за сентябрь" amount="2 222 ₽" sub="Бот напишет 1 сентября" />
  </SceneStage>
)

export const Student = () => (
  <SceneStage scene="dues">
    <DuesScene label="Взнос за сентябрь" amount="666 ₽" sub="Бот напишет 1 сентября" />
  </SceneStage>
)
