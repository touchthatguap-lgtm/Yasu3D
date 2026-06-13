# Models

3D model files, organized by type. Served at runtime from `/models/<folder>/<file>`.

| Folder        | What goes here                          | Loaded as                |
| ------------- | --------------------------------------- | ------------------------ |
| `guns/`       | Weapon models (ak47, pistol, …)          | `/models/guns/ak47.glb`       |
| `characters/` | Player skins, enemy/target models        | `/models/characters/soldier.glb` |
| `maps/`       | Full level/arena geometry                | `/models/maps/arena.glb`      |
| `props/`      | Crates, barrels, decorations             | `/models/props/crate.glb`     |

- Preferred format: `.glb` (bundles mesh + materials + textures + animations)
- Also supported: `.gltf`, `.obj` (+ `.mtl`), `.fbx`

Load with the helpers in `src/assets.js`:

```js
import { loadModel } from "./assets.js";
const gun = await loadModel("/models/guns/ak47.glb");
scene.add(gun.scene);  // gun.animations holds any clips
```
