export const OUTLANDS_MIN_X = -170;
export const OUTLANDS_MAX_X = 170;
export const OUTLANDS_MIN_Z = -330;
export const OUTLANDS_ENTRY_Z = -88;
export const EXTRACTION_POSITION = [0, 0, -91] as const;
export const EXTRACTION_RADIUS = 7;

export function isAtExtractionCheckpoint(x: number, z: number) {
  return Math.abs(x) <= 14 && z >= -100 && z <= -82;
}

export type WorldRegion = "city" | "checkpoint" | "forest" | "depot" | "quarry" | "ruins";
export type OutlandsEnemyKind = "eyeDrone" | "quadShell" | "human";
export type OutlandsFaction = "neutral" | "hostile";

export type OutlandsEnemyDefinition = {
  id: string;
  name: string;
  kind: OutlandsEnemyKind;
  faction: OutlandsFaction;
  maxHealth: number;
  damage: number;
  aggroRange: number;
  attackRange: number;
  speed: number;
  respawnMs: number;
  position: readonly [number, number, number];
  patrol: ReadonlyArray<readonly [number, number, number]>;
};

export type OutlandsContainerDefinition = {
  id: "forest-cache" | "depot-alpha" | "quarry-cache" | "ruins-vault";
  name: string;
  danger: string;
  position: readonly [number, number, number];
  rotation: number;
};

export const OUTLAND_ENEMIES: readonly OutlandsEnemyDefinition[] = [
  {
    id: "eye-scout",
    name: "Наблюдатель EYE-7",
    kind: "eyeDrone",
    faction: "neutral",
    maxHealth: 70,
    damage: 0,
    aggroRange: 0,
    attackRange: 0,
    speed: 1.8,
    respawnMs: 28_000,
    position: [24, 0, -128],
    patrol: [[24, 0, -128], [38, 0, -143], [15, 0, -153], [8, 0, -132]]
  },
  {
    id: "quad-warden",
    name: "Квад-страж",
    kind: "quadShell",
    faction: "hostile",
    maxHealth: 180,
    damage: 16,
    aggroRange: 30,
    attackRange: 3.2,
    speed: 3.15,
    respawnMs: 40_000,
    position: [-43, 0, -198],
    patrol: [[-43, 0, -198], [-58, 0, -211], [-34, 0, -222.25], [-20, 0, -202]]
  },
  {
    id: "quad-hunter",
    name: "Квад-охотник",
    kind: "quadShell",
    faction: "hostile",
    maxHealth: 145,
    damage: 19,
    aggroRange: 34,
    attackRange: 3.1,
    speed: 3.75,
    respawnMs: 36_000,
    position: [72, 0, -230],
    patrol: [[72, 0, -230], [93, 0, -242], [82, 0, -265], [58, 0, -248]]
  },
  {
    id: "raider-vika",
    name: "Рейдер Вика",
    kind: "human",
    faction: "hostile",
    maxHealth: 110,
    damage: 12,
    aggroRange: 27,
    attackRange: 13,
    speed: 2.55,
    respawnMs: 42_000,
    position: [-72, 0, -266],
    patrol: [[-72, 0, -266], [-88, 0, -278], [-61, 0, -292], [-49, 0, -271]]
  },
  {
    id: "raider-boris",
    name: "Рейдер Борис",
    kind: "human",
    faction: "hostile",
    maxHealth: 125,
    damage: 14,
    aggroRange: 29,
    attackRange: 14,
    speed: 2.4,
    respawnMs: 42_000,
    position: [-17, 0, -177],
    patrol: [[-17, 0, -177], [-29, 0, -187], [-8, 0, -205], [8, 0, -185]]
  }
] as const;

export const OUTLAND_CONTAINERS: readonly OutlandsContainerDefinition[] = [
  {
    id: "forest-cache",
    name: "Тайник лесника",
    danger: "низкая опасность",
    position: [35, 0, -149],
    rotation: -0.35
  },
  {
    id: "depot-alpha",
    name: "Контейнер депо",
    danger: "охраняется",
    position: [-45, 0, -211],
    rotation: 0.7
  },
  {
    id: "quarry-cache",
    name: "Ящик геологов",
    danger: "высокая опасность",
    position: [75, 0, -251],
    rotation: -1.15
  },
  {
    id: "ruins-vault",
    name: "Сейф старого города",
    danger: "ценная добыча",
    position: [-73, 0, -286],
    rotation: 0.15
  }
] as const;

export const QUATERNIUS_SCIFI_ROOT = "/assets/models/quaternius-scifi";
export const EYE_DRONE_MODEL_URL = `${QUATERNIUS_SCIFI_ROOT}/Enemy_EyeDrone.gltf`;
export const QUAD_SHELL_MODEL_URL = `${QUATERNIUS_SCIFI_ROOT}/Enemy_QuadShell.gltf`;
export const LOOT_CHEST_MODEL_URL = `${QUATERNIUS_SCIFI_ROOT}/Prop_Chest.gltf`;
export const AMMO_PROP_MODEL_URL = `${QUATERNIUS_SCIFI_ROOT}/Prop_Ammo.gltf`;
export const MEDKIT_PROP_MODEL_URL = `${QUATERNIUS_SCIFI_ROOT}/Prop_HealthPack.gltf`;

export const OUTLAND_MODEL_URLS = [
  EYE_DRONE_MODEL_URL,
  QUAD_SHELL_MODEL_URL,
  LOOT_CHEST_MODEL_URL,
  AMMO_PROP_MODEL_URL,
  MEDKIT_PROP_MODEL_URL,
  "/assets/models/kenney-nature/tree_pineTallA.glb",
  "/assets/models/kenney-nature/tree_pineTallB.glb",
  "/assets/models/kenney-nature/tree_pineSmallC.glb",
  "/assets/models/kenney-nature/rock_largeB.glb",
  "/assets/models/kenney-nature/rock_largeE.glb",
  "/assets/models/kenney-nature/rock_tallC.glb",
  "/assets/models/kenney-nature/tent_detailedOpen.glb",
  "/assets/models/kenney-nature/campfire_stones.glb",
  "/assets/models/kenney-nature/log_stack.glb"
] as const;

export function worldRegionAt(x: number, z: number): WorldRegion {
  if (z > OUTLANDS_ENTRY_Z) return "city";
  if (z > -108) return "checkpoint";
  if (z > -174) return "forest";
  if (x > 38 && z < -202) return "quarry";
  if (x < -38 && z < -244) return "ruins";
  return "depot";
}

export const WORLD_REGION_LABELS: Record<WorldRegion, string> = {
  city: "Город · безопасная зона",
  checkpoint: "Северный КПП · точка эвакуации",
  forest: "Хвойный рубеж",
  depot: "Заброшенное депо",
  quarry: "Красный карьер",
  ruins: "Старый город"
};
