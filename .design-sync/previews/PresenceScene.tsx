import { PresenceScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const WithNick = () => (
  <SceneStage scene="presence">
    <PresenceScene
      board={{ nicks: ['dasha', 'mixa'], total: 3, me: 'max_k', time: '19:42' }}
      botName="Endpoint Robot"
      dayLabel="Ср, 5 августа"
    />
  </SceneStage>
)

export const WithoutNick = () => (
  <SceneStage scene="presence">
    <PresenceScene board={{ nicks: ['dasha'], total: 2, me: null, time: '19:42' }} botName="Endpoint Robot" dayLabel="Ср, 5 августа" />
  </SceneStage>
)
