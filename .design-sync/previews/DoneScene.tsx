import { DoneScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'
import { kostya, me } from '../fixture'

export const ResidentCard = () => (
  <SceneStage scene="done" height={460}>
    <DoneScene me={me} number={14} since="2026-08-05" />
  </SceneStage>
)

export const NoNickNoDate = () => (
  <SceneStage scene="done" height={460}>
    <DoneScene me={kostya} number={null} since={null} />
  </SceneStage>
)
