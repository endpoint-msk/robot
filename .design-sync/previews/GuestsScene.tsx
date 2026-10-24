import { GuestsScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

export const AtTheDoor = () => (
  <SceneStage scene="guests">
    <GuestsScene botName="Endpoint Robot" />
  </SceneStage>
)
