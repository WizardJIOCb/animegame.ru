# Third-Party Assets

## Bundled

- Kenney Furniture Kit
  - Source: https://kenney.nl/assets/furniture-kit
  - License: Creative Commons CC0
  - Runtime files used: `public/assets/models/kenney-furniture/*.glb`

- KayKit Furniture Bits
  - Source: https://kaylousberg.itch.io/furniture-bits
  - Mirror used for automated download: https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0
  - License: Creative Commons Zero v1.0 Universal
  - Runtime files used: `public/assets/models/kaykit-furniture/*.gltf`, `*.bin`, texture atlas

- Kenney Nature Kit
  - Source: https://kenney.nl/assets/nature-kit
  - License: Creative Commons CC0
  - Runtime files used: `public/assets/models/kenney-nature/*.glb`

- Quaternius Universal Animation Library
  - Source: https://quaternius.com/packs/universalanimationlibrary.html
  - License: Creative Commons CC0
  - Runtime files used: `public/assets/animations/quaternius-universal/UAL1_Standard.glb`
  - The non-root-motion Standard file is used so click-to-move remains authoritative.

- Quaternius Toon Shooter Game Kit
  - Source: https://quaternius.com/packs/toonshootergamekit.html
  - License: Creative Commons CC0
  - Runtime files used: `public/assets/models/quaternius-weapons/*.gltf`
  - The pack's `ShortCannon` asset is bundled as `laser.gltf` and presented as the laser weapon.

## Planned Character Pipeline

- Quaternius Universal Base Characters
  - Source: https://quaternius.com/packs/universalbasecharacters.html
  - License: Creative Commons CC0
  - Runtime files used: `public/assets/models/quaternius-characters/Superhero_*_FullBody.gltf`, `*.bin`, character textures
  - Source drop folder ignored by git: `public/assets/models/Universal Base Characters[Standard]/`

- VRoid Studio
  - Source: https://vroid.com/en/studio/guidelines
  - Status: not bundled; use it to create original anime avatars, export VRM, then convert/load them in the client.

- Mixamo
  - Source: https://www.mixamo.com/
  - Status: not bundled; use for animation authoring/retargeting. Do not publish raw Mixamo asset packs as standalone downloadable assets.
