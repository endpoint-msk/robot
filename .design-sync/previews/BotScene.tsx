import { BotScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'

const board = { nicks: ['dasha', 'mixa', 'zhenya_p'], total: 4, me: 'max_k', time: '19:42' }

export const Printer = () => (
  <SceneStage scene="bot">
    <BotScene printer time="19:42" finish="21:05" board={board} />
  </SceneStage>
)

export const Inside = () => (
  <SceneStage scene="bot">
    <BotScene printer={false} time="19:42" finish="21:05" board={board} />
  </SceneStage>
)
