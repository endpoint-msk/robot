import { MacScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const Connected = () => (
  <SceneStage scene="mac">
    <MacScene board={{ nicks: ['dasha', 'mixa'], total: 3, me: 'max_k', time: '19:42' }} />
  </SceneStage>
)
