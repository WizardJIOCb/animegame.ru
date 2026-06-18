# Clothing Pipeline

This project uses Quaternius Superhero characters as the base avatar rig. Real clothing must be exported as skinned GLB meshes using the same armature and bone names as the base character.

## Target Rig

Use one of these files as the Blender source rig:

- `public/assets/models/quaternius-characters/Superhero_Male_FullBody.gltf`
- `public/assets/models/quaternius-characters/Superhero_Female_FullBody.gltf`

Both files use the same 65-joint skeleton. Important bone names:

- `root`
- `pelvis`
- `spine_01`, `spine_02`, `spine_03`
- `neck_01`, `Head`
- `clavicle_l`, `upperarm_l`, `lowerarm_l`, `hand_l`
- `clavicle_r`, `upperarm_r`, `lowerarm_r`, `hand_r`
- `thigh_l`, `calf_l`, `foot_l`
- `thigh_r`, `calf_r`, `foot_r`

Do not rename bones. Clothing GLBs are animated in game by applying the same procedural pose to these bone names.

## Blender Workflow

1. Import the base character GLTF into Blender.
2. Model clothing directly over the body mesh: hoodie, jacket, pants, skirt, boots, etc.
3. Keep the existing armature. Do not create a new skeleton.
4. Parent the clothing mesh to the armature with automatic weights.
5. Clean the weights:
   - torso clothes mostly use `spine_01`, `spine_02`, `spine_03`, `clavicle_l`, `clavicle_r`;
   - sleeves use `upperarm_*`, `lowerarm_*`, `hand_*`;
   - pants use `pelvis`, `thigh_*`, `calf_*`;
   - shoes use `foot_*`.
6. Delete or hide the body mesh before exporting. Export only:
   - armature with original bone names;
   - clothing skinned mesh;
   - clothing materials and textures.
7. Export as GLB:
   - Format: `glTF Binary (.glb)`
   - Include: `Selected Objects`
   - Transform: `+Y Up` default is fine if the imported character was not rotated
   - Skinning: enabled
   - Animations: disabled

## File Layout

Put exported clothing here:

```text
public/assets/models/clothing/
  hoodie-pink.glb
  hoodie-black.glb
  jacket-cyber.glb
  pants-school.glb
  boots-star.glb
```

Texture source files can live next to the GLB:

```text
public/assets/models/clothing/textures/
  hoodie-pink_baseColor.png
  hoodie-pink_normal.png
  hoodie-pink_roughness.png
```

## Catalog Hookup

Add `clothingModelUrl` to the clothing item:

```ts
{
  id: "hoodie-pink",
  type: "clothing",
  name: "Розовое худи",
  price: 180,
  rarity: "common",
  emoji: "👕",
  color: "#ec4899",
  clothingModelUrl: "/assets/models/clothing/hoodie-pink.glb"
}
```

The runtime checks this field. If it exists, the GLB is loaded as real skinned clothing. If it is missing, the game falls back to simple accessory-only rendering.

## Quality Rules

- Clothing must be slightly outside the body to avoid clipping.
- Avoid very thick shells; low-poly stylized clothing should still follow body shape.
- Use one material per logical part when possible: `fabric`, `trim`, `metal`, `sole`.
- Keep triangle count low:
  - shirt/hودي: 1k-3k triangles;
  - pants/skirt: 1k-3k triangles;
  - shoes/hat/accessory: under 1k triangles each.
- Export each wearable as a separate GLB so inventory items can be mixed later.

## Next Step

The current avatar supports one equipped `outfit`. To support layered outfits, split the avatar fields into slots:

- `top`
- `bottom`
- `shoes`
- `head`
- `back`
- `face`

Then render each equipped slot as a separate skinned/accessory GLB.
