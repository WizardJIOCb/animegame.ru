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
export type OutlandsAttackStyle = "melee" | "ranged";
export type OutlandsEnemyBehavior = "patrol" | "sentinel" | "artillery" | "tank" | "stalker" | "skirmisher" | "brute";

export type OutlandsEnemyVisualAttachment =
  | "none"
  | "sensor-array"
  | "thermal-fins"
  | "bulwark-plates"
  | "stalker-spines"
  | "scout-rig"
  | "heavy-rig";

export type OutlandsEnemyVisualVariant = {
  kind: OutlandsEnemyKind;
  modelScale: number;
  tint: string;
  accent: string;
  emissive: string;
  emissiveIntensity: number;
  attachment: OutlandsEnemyVisualAttachment;
};

const DEFAULT_OUTLAND_ENEMY_VISUALS: Record<OutlandsEnemyKind, OutlandsEnemyVisualVariant> = {
  eyeDrone: {
    kind: "eyeDrone",
    modelScale: 1.25,
    tint: "#ffffff",
    accent: "#62d9ff",
    emissive: "#176d89",
    emissiveIntensity: 0.35,
    attachment: "none"
  },
  quadShell: {
    kind: "quadShell",
    modelScale: 1.08,
    tint: "#ffffff",
    accent: "#f1b557",
    emissive: "#6f4214",
    emissiveIntensity: 0.22,
    attachment: "none"
  },
  human: {
    kind: "human",
    modelScale: 1,
    tint: "#ffffff",
    accent: "#b65d4b",
    emissive: "#5e2018",
    emissiveIntensity: 0.12,
    attachment: "none"
  }
};

// Kept separate from the combat contract so new silhouettes can ship without
// making older expedition snapshots or enemy definitions unreadable. The
// caller may opt into a variant simply by using one of these stable ids.
export const OUTLAND_ENEMY_VISUAL_VARIANTS: Readonly<Record<string, OutlandsEnemyVisualVariant>> = {
  "eye-sentinel": {
    kind: "eyeDrone",
    modelScale: 1.48,
    tint: "#b9dce5",
    accent: "#5ef4ff",
    emissive: "#23d9eb",
    emissiveIntensity: 1.15,
    attachment: "sensor-array"
  },
  "eye-scorcher": {
    kind: "eyeDrone",
    modelScale: 1.32,
    tint: "#d89568",
    accent: "#ff7b35",
    emissive: "#ff3d16",
    emissiveIntensity: 1.35,
    attachment: "thermal-fins"
  },
  "quad-bulwark": {
    kind: "quadShell",
    modelScale: 1.42,
    tint: "#728a91",
    accent: "#72c9ff",
    emissive: "#1976a8",
    emissiveIntensity: 0.85,
    attachment: "bulwark-plates"
  },
  "quad-stalker": {
    kind: "quadShell",
    modelScale: 0.96,
    tint: "#554d68",
    accent: "#bd7bff",
    emissive: "#7437c4",
    emissiveIntensity: 0.9,
    attachment: "stalker-spines"
  },
  "raider-scout": {
    kind: "human",
    modelScale: 0.96,
    tint: "#718b78",
    accent: "#71ffd2",
    emissive: "#1a9d79",
    emissiveIntensity: 0.65,
    attachment: "scout-rig"
  },
  "raider-heavy": {
    kind: "human",
    modelScale: 1.12,
    tint: "#6f5550",
    accent: "#ff8a5f",
    emissive: "#a9321f",
    emissiveIntensity: 0.55,
    attachment: "heavy-rig"
  }
};

export function outlandsEnemyVisualVariant(enemyId: string, kind: OutlandsEnemyKind) {
  const configured = OUTLAND_ENEMY_VISUAL_VARIANTS[enemyId];
  return configured?.kind === kind ? configured : DEFAULT_OUTLAND_ENEMY_VISUALS[kind];
}

export type OutlandsEnemyDefinition = {
  id: string;
  name: string;
  kind: OutlandsEnemyKind;
  faction: OutlandsFaction;
  maxHealth: number;
  damage: number;
  aggroRange: number;
  attackRange: number;
  attackStyle: OutlandsAttackStyle;
  behavior?: OutlandsEnemyBehavior;
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
    attackStyle: "melee",
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
    attackStyle: "melee",
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
    attackRange: 17,
    attackStyle: "ranged",
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
    attackStyle: "ranged",
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
    attackStyle: "ranged",
    speed: 2.4,
    respawnMs: 42_000,
    position: [-17, 0, -177],
    patrol: [[-17, 0, -177], [-29, 0, -187], [-8, 0, -205], [8, 0, -185]]
  },
  {
    id: "eye-sentinel",
    name: "Дозорный «Искра»",
    kind: "eyeDrone",
    faction: "hostile",
    maxHealth: 95,
    damage: 9,
    aggroRange: 44,
    attackRange: 25,
    attackStyle: "ranged",
    behavior: "sentinel",
    speed: 2.15,
    respawnMs: 32_000,
    position: [115, 0, -165],
    patrol: [[115, 0, -165], [132, 0, -178], [120, 0, -196], [101, 0, -181]]
  },
  {
    id: "eye-scorcher",
    name: "Испепелитель EYE-X",
    kind: "eyeDrone",
    faction: "hostile",
    maxHealth: 120,
    damage: 24,
    aggroRange: 39,
    attackRange: 22,
    attackStyle: "ranged",
    behavior: "artillery",
    speed: 1.85,
    respawnMs: 38_000,
    position: [-118, 0, -235],
    patrol: [[-118, 0, -235], [-137, 0, -248], [-126, 0, -272], [-104, 0, -258]]
  },
  {
    id: "quad-bulwark",
    name: "Квад «Бастион»",
    kind: "quadShell",
    faction: "hostile",
    maxHealth: 330,
    damage: 30,
    aggroRange: 28,
    attackRange: 3.8,
    attackStyle: "melee",
    behavior: "tank",
    speed: 1.75,
    respawnMs: 52_000,
    position: [45, 0, -285],
    patrol: [[45, 0, -285], [61, 0, -297], [45, 0, -313], [28, 0, -301]]
  },
  {
    id: "quad-stalker",
    name: "Квад «Тень»",
    kind: "quadShell",
    faction: "hostile",
    maxHealth: 135,
    damage: 23,
    aggroRange: 25,
    attackRange: 2.9,
    attackStyle: "melee",
    behavior: "stalker",
    speed: 4.85,
    respawnMs: 34_000,
    position: [-105, 0, -145],
    patrol: [[-105, 0, -145], [-126, 0, -159], [-112, 0, -181], [-91, 0, -164]]
  },
  {
    id: "raider-scout",
    name: "Разведчица Ника",
    kind: "human",
    faction: "hostile",
    maxHealth: 92,
    damage: 10,
    aggroRange: 38,
    attackRange: 20,
    attackStyle: "ranged",
    behavior: "skirmisher",
    speed: 3.25,
    respawnMs: 40_000,
    position: [110, 0, -285],
    patrol: [[110, 0, -285], [134, 0, -298], [121, 0, -320], [96, 0, -309]]
  },
  {
    id: "raider-heavy",
    name: "Тяжёлый рейдер Гром",
    kind: "human",
    faction: "hostile",
    maxHealth: 240,
    damage: 20,
    aggroRange: 34,
    attackRange: 15,
    attackStyle: "ranged",
    behavior: "brute",
    speed: 2.05,
    respawnMs: 50_000,
    position: [8, 0, -260],
    patrol: [[8, 0, -260], [24, 0, -273], [12, 0, -295], [-8, 0, -280]]
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
  "/assets/models/kenney-nature/campfire_logs.glb",
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
