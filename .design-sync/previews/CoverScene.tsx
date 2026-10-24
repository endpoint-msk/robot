import { CoverScene } from 'endpoint-robot-webapp'
import { SceneStage } from '../scene-stage'
import { anya, dasha, kostya, me, misha, zhenya } from '../fixture'

// Соты раскладывает движок (createHive), поэтому список людей для холста и для сцены один.
const people = [
  dasha,
  kostya,
  misha,
  anya,
  zhenya,
  { userId: 504, username: 'lena_v', name: 'Лена Воронова' },
  { userId: 505, username: 'artem', name: 'Артём' },
  { userId: 506, username: null, name: 'Ира' },
]
const hive = people.map((p) => ({ name: p.name, username: p.username, inside: p === dasha }))
const few = people.slice(0, 3)

export const Full = () => (
  <SceneStage scene="cover" people={hive} height={380}>
    <CoverScene people={people} me={me} />
  </SceneStage>
)

export const FewResidents = () => (
  <SceneStage scene="cover" people={hive.slice(0, 3)} height={300}>
    <CoverScene people={few} me={me} />
  </SceneStage>
)
