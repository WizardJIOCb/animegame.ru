import type { CatalogItem } from "../types";

export const generatedCharacterCatalog = [
  {
    id: "quaternius-superhero-female",
    type: "character",
    name: "Quaternius Superhero Female",
    price: 0,
    color: "#ec4899",
    rarity: "rare",
    emoji: "3D",
    size: [0.8, 1.8, 0.8],
    modelUrl: "/assets/models/quaternius-characters/Superhero_Female_FullBody.gltf",
    modelScale: 0.9
  },
  {
    id: "quaternius-superhero-male",
    type: "character",
    name: "Quaternius Superhero Male",
    price: 0,
    color: "#38bdf8",
    rarity: "rare",
    emoji: "3D",
    size: [0.8, 1.8, 0.8],
    modelUrl: "/assets/models/quaternius-characters/Superhero_Male_FullBody.gltf",
    modelScale: 0.9
  }
] satisfies CatalogItem[];
