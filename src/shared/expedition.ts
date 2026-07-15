export const EXPEDITION_ITEM_IDS = [
  "scrap",
  "alloy",
  "power-cell",
  "robot-lens",
  "ammo",
  "medkit",
  "fabric",
  "electronics",
  "bandage",
  "shield-module",
  "weapon-parts",
  "rifle-blueprint",
  "explosive-compound",
  "ceramic-plate",
  "upgrade-core",
  "colossus-core",
  "storm-crystal",
  "void-shard",
  "grenade-frag",
  "grenade-emp",
  "grenade-incendiary",
  "grenade-cryo",
  "grenade-vortex",
  "grenade-cluster",
  "scout-helmet",
  "composite-vest",
  "tactical-pants",
  "colossus-helmet",
  "storm-vest",
  "void-greaves",
  "artifact-nuke",
  "artifact-robot-beacon",
  "artifact-scanner"
] as const;

export type ExpeditionItemId = typeof EXPEDITION_ITEM_IDS[number];

export type ItemStack = {
  itemId: ExpeditionItemId;
  quantity: number;
};

export type ExpeditionItemDefinition = {
  id: ExpeditionItemId;
  name: string;
  description: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  stackSize: number;
  category?: "resource" | "ammo" | "medical" | "grenade" | "gear" | "artifact" | "blueprint";
  icon?: string;
};

export const EXPEDITION_ITEMS: Record<ExpeditionItemId, ExpeditionItemDefinition> = {
  scrap: {
    id: "scrap",
    name: "Металлолом",
    description: "Базовый материал для патронов и снаряжения.",
    rarity: "common",
    stackSize: 99
  },
  alloy: {
    id: "alloy",
    name: "Сплав рейдеров",
    description: "Прочный металл для оружейных механизмов.",
    rarity: "uncommon",
    stackSize: 50
  },
  "power-cell": {
    id: "power-cell",
    name: "Энергоячейка",
    description: "Ценный источник питания, нужный для задания экспедиции.",
    rarity: "rare",
    stackSize: 20
  },
  "robot-lens": {
    id: "robot-lens",
    name: "Линза робота",
    description: "Оптический модуль боевой машины.",
    rarity: "rare",
    stackSize: 20
  },
  ammo: {
    id: "ammo",
    name: "Боеприпасы",
    description: "Универсальная пачка патронов для экспедиции.",
    rarity: "common",
    stackSize: 120
  },
  medkit: {
    id: "medkit",
    name: "Аптечка",
    description: "Полевой комплект для восстановления здоровья.",
    rarity: "uncommon",
    stackSize: 10
  },
  fabric: {
    id: "fabric",
    name: "Техническая ткань",
    description: "Прочная ткань для бинтов, разгрузок и защитного снаряжения.",
    rarity: "common",
    stackSize: 99
  },
  electronics: {
    id: "electronics",
    name: "Электроника",
    description: "Микросхемы и проводка для оружия, щитов и сложных устройств.",
    rarity: "uncommon",
    stackSize: 50
  },
  bandage: {
    id: "bandage",
    name: "Полевой бинт",
    description: "Останавливает кровотечение и восстанавливает часть здоровья в экспедиции.",
    rarity: "common",
    stackSize: 10
  },
  "shield-module": {
    id: "shield-module",
    name: "Модуль щита",
    description: "Переносной защитный модуль, изготовленный из сплава и электроники.",
    rarity: "rare",
    stackSize: 5
  },
  "weapon-parts": {
    id: "weapon-parts",
    name: "Детали оружия",
    description: "Затворы, пружины и другие пригодные узлы.",
    rarity: "uncommon",
    stackSize: 40
  },
  "rifle-blueprint": {
    id: "rifle-blueprint",
    name: "Чертёж автомата",
    description: "Позволяет собрать автомат на домашнем верстаке.",
    rarity: "epic",
    stackSize: 1,
    category: "blueprint",
    icon: "blueprint"
  },
  "explosive-compound": {
    id: "explosive-compound",
    name: "Взрывчатая смесь",
    description: "Стабилизированный состав для гранат и тяжёлых боеприпасов.",
    rarity: "uncommon",
    stackSize: 40,
    category: "resource",
    icon: "compound"
  },
  "ceramic-plate": {
    id: "ceramic-plate",
    name: "Керамическая пластина",
    description: "Лёгкая бронепластина для защитного снаряжения.",
    rarity: "rare",
    stackSize: 20,
    category: "resource",
    icon: "plate"
  },
  "upgrade-core": {
    id: "upgrade-core",
    name: "Ядро улучшения",
    description: "Стабильный техномодуль для усиления оружия и экипировки.",
    rarity: "rare",
    stackSize: 30,
    category: "resource",
    icon: "upgrade"
  },
  "colossus-core": {
    id: "colossus-core",
    name: "Сердце Колосса",
    description: "Уникальное силовое ядро Железного Колосса.",
    rarity: "epic",
    stackSize: 5,
    category: "resource",
    icon: "core"
  },
  "storm-crystal": {
    id: "storm-crystal",
    name: "Кристалл бури",
    description: "Заряженный фрагмент брони Штормового Серафима.",
    rarity: "epic",
    stackSize: 5,
    category: "resource",
    icon: "storm"
  },
  "void-shard": {
    id: "void-shard",
    name: "Осколок Пустоты",
    description: "Нестабильный материал из реактора Стража Пустоты.",
    rarity: "epic",
    stackSize: 5,
    category: "resource",
    icon: "void"
  },
  "grenade-frag": {
    id: "grenade-frag",
    name: "Осколочная граната",
    description: "Наносит высокий урон людям и роботам в небольшом радиусе.",
    rarity: "uncommon",
    stackSize: 6,
    category: "grenade",
    icon: "frag"
  },
  "grenade-emp": {
    id: "grenade-emp",
    name: "ЭМИ-граната",
    description: "Электромагнитный импульс особенно опасен для роботов.",
    rarity: "rare",
    stackSize: 6,
    category: "grenade",
    icon: "emp"
  },
  "grenade-incendiary": {
    id: "grenade-incendiary",
    name: "Зажигательная граната",
    description: "Создаёт огненный очаг и поджигает цели в зоне поражения.",
    rarity: "rare",
    stackSize: 6,
    category: "grenade",
    icon: "fire"
  },
  "grenade-cryo": {
    id: "grenade-cryo",
    name: "Крио-граната",
    description: "Взрывается облаком сверхохлаждённых частиц и замедляет цели.",
    rarity: "rare",
    stackSize: 6,
    category: "grenade",
    icon: "cryo"
  },
  "grenade-vortex": {
    id: "grenade-vortex",
    name: "Вихревая граната",
    description: "Создаёт короткую гравитационную воронку с большим радиусом.",
    rarity: "epic",
    stackSize: 4,
    category: "grenade",
    icon: "vortex"
  },
  "grenade-cluster": {
    id: "grenade-cluster",
    name: "Кластерная граната",
    description: "После основного взрыва разбрасывает серию малых зарядов.",
    rarity: "epic",
    stackSize: 4,
    category: "grenade",
    icon: "cluster"
  },
  "scout-helmet": {
    id: "scout-helmet",
    name: "Шлем разведчика",
    description: "Композитный шлем с визором. Снижает входящий урон на 5%.",
    rarity: "uncommon",
    stackSize: 1,
    category: "gear",
    icon: "helmet"
  },
  "composite-vest": {
    id: "composite-vest",
    name: "Композитный бронежилет",
    description: "Тяжёлая защита корпуса. Снижает входящий урон на 12%.",
    rarity: "rare",
    stackSize: 1,
    category: "gear",
    icon: "vest"
  },
  "tactical-pants": {
    id: "tactical-pants",
    name: "Тактические штаны",
    description: "Усиленные штаны с разгрузкой. Снижают входящий урон на 4%.",
    rarity: "uncommon",
    stackSize: 1,
    category: "gear",
    icon: "pants"
  },
  "colossus-helmet": {
    id: "colossus-helmet",
    name: "Шлем Колосса",
    description: "Трофейная тяжёлая защита с усиленным силовым каркасом.",
    rarity: "epic",
    stackSize: 1,
    category: "gear",
    icon: "boss-helmet"
  },
  "storm-vest": {
    id: "storm-vest",
    name: "Нагрудник Серафима",
    description: "Трофейная броня, накапливающая электрический заряд.",
    rarity: "epic",
    stackSize: 1,
    category: "gear",
    icon: "storm-vest"
  },
  "void-greaves": {
    id: "void-greaves",
    name: "Поножи Пустоты",
    description: "Экспериментальная защита ног из реакторного сплава.",
    rarity: "epic",
    stackSize: 1,
    category: "gear",
    icon: "void-greaves"
  },
  "artifact-nuke": {
    id: "artifact-nuke",
    name: "Артефакт «Солнце»",
    description: "Одноразовый протокол локального ядерного удара по всей зоне.",
    rarity: "epic",
    stackSize: 1,
    category: "artifact",
    icon: "nuke"
  },
  "artifact-robot-beacon": {
    id: "artifact-robot-beacon",
    name: "Маяк «Страж»",
    description: "Вызывает союзного боевого робота на ограниченное время.",
    rarity: "epic",
    stackSize: 1,
    category: "artifact",
    icon: "robot"
  },
  "artifact-scanner": {
    id: "artifact-scanner",
    name: "Резонансный сканер",
    description: "На время подсвечивает противников и тайники экспедиции.",
    rarity: "rare",
    stackSize: 2,
    category: "artifact",
    icon: "scanner"
  }
};

export const EXPEDITION_WEAPON_IDS = ["pistol", "rifle", "rocket", "laser", "sniper"] as const;
export type ExpeditionWeaponId = typeof EXPEDITION_WEAPON_IDS[number];

export type ExpeditionWeaponDefinition = {
  id: ExpeditionWeaponId;
  name: string;
  price: number;
  description: string;
  damage: number;
  fireIntervalMs: number;
  range: number;
};

export const EXPEDITION_WEAPONS: Record<ExpeditionWeaponId, ExpeditionWeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Пистолет",
    price: 0,
    description: "Надёжное стартовое оружие.",
    damage: 40,
    fireIntervalMs: 330,
    range: 84
  },
  rifle: {
    id: "rifle",
    name: "Автомат",
    price: 2_400,
    description: "Скорострельное оружие для ближней и средней дистанции.",
    damage: 28,
    fireIntervalMs: 125,
    range: 108
  },
  rocket: {
    id: "rocket",
    name: "Ракетница",
    price: 6_500,
    description: "Тяжёлое оружие против групп и роботов.",
    damage: 120,
    fireIntervalMs: 1_050,
    range: 96
  },
  laser: {
    id: "laser",
    name: "Лазер",
    price: 7_800,
    description: "Экспериментальное энергетическое оружие.",
    damage: 55,
    fireIntervalMs: 210,
    range: 126
  },
  sniper: {
    id: "sniper",
    name: "Снайперская винтовка",
    price: 5_000,
    description: "Точный дальнобойный вариант.",
    damage: 110,
    fireIntervalMs: 900,
    range: 210
  }
};

export const EXPEDITION_WEAPON_UPGRADE_STATS = ["damage", "range", "handling"] as const;
export type ExpeditionWeaponUpgradeStat = typeof EXPEDITION_WEAPON_UPGRADE_STATS[number];
export type ExpeditionWeaponUpgradeLevels = Record<ExpeditionWeaponUpgradeStat, number>;

export type ExpeditionWeaponUpgradePath = {
  id: ExpeditionWeaponUpgradeStat;
  name: string;
  description: string;
  maxLevel: number;
  bonusPerLevel: number;
  baseCoins: number;
  icon: string;
};

export const EXPEDITION_WEAPON_UPGRADE_PATHS: Record<ExpeditionWeaponUpgradeStat, ExpeditionWeaponUpgradePath> = {
  damage: {
    id: "damage",
    name: "Усиленный затвор",
    description: "+8% урона за уровень",
    maxLevel: 5,
    bonusPerLevel: 0.08,
    baseCoins: 650,
    icon: "damage"
  },
  range: {
    id: "range",
    name: "Дальнобойный ствол",
    description: "+10% дальности за уровень",
    maxLevel: 5,
    bonusPerLevel: 0.1,
    baseCoins: 550,
    icon: "range"
  },
  handling: {
    id: "handling",
    name: "Стабилизатор",
    description: "+4% темпа и контроля за уровень",
    maxLevel: 5,
    bonusPerLevel: 0.04,
    baseCoins: 500,
    icon: "handling"
  }
};

export const EMPTY_WEAPON_UPGRADE_LEVELS: ExpeditionWeaponUpgradeLevels = {
  damage: 0,
  range: 0,
  handling: 0
};

export function expeditionWeaponUpgradeCost(stat: ExpeditionWeaponUpgradeStat, currentLevel: number) {
  const nextLevel = Math.max(1, Math.min(EXPEDITION_WEAPON_UPGRADE_PATHS[stat].maxLevel, currentLevel + 1));
  return {
    coins: EXPEDITION_WEAPON_UPGRADE_PATHS[stat].baseCoins * nextLevel * nextLevel,
    ingredients: [
      { itemId: "upgrade-core" as const, quantity: Math.ceil(nextLevel / 2) },
      { itemId: "weapon-parts" as const, quantity: 1 + nextLevel }
    ]
  };
}

export function expeditionWeaponStats(
  weaponId: ExpeditionWeaponId,
  levels: Partial<ExpeditionWeaponUpgradeLevels> | undefined
) {
  const weapon = EXPEDITION_WEAPONS[weaponId];
  const damageLevel = Math.max(0, levels?.damage ?? 0);
  const rangeLevel = Math.max(0, levels?.range ?? 0);
  const handlingLevel = Math.max(0, levels?.handling ?? 0);
  return {
    damage: Math.round(weapon.damage * (1 + damageLevel * EXPEDITION_WEAPON_UPGRADE_PATHS.damage.bonusPerLevel)),
    range: weapon.range * (1 + rangeLevel * EXPEDITION_WEAPON_UPGRADE_PATHS.range.bonusPerLevel),
    fireIntervalMs: Math.max(70, Math.round(weapon.fireIntervalMs * (1 - handlingLevel * EXPEDITION_WEAPON_UPGRADE_PATHS.handling.bonusPerLevel)))
  };
}

export const EXPEDITION_HIT_ZONES = [
  "head",
  "chest",
  "abdomen",
  "pelvis",
  "upperArm",
  "lowerArm",
  "hand",
  "thigh",
  "calf",
  "foot"
] as const;
export type ExpeditionHitZone = typeof EXPEDITION_HIT_ZONES[number];

export const EXPEDITION_HIT_MULTIPLIERS: Record<ExpeditionHitZone, number> = {
  head: 1.8,
  chest: 1,
  abdomen: 0.95,
  pelvis: 0.9,
  upperArm: 0.76,
  lowerArm: 0.72,
  hand: 0.64,
  thigh: 0.82,
  calf: 0.74,
  foot: 0.64
};

export type ExpeditionHitInput = {
  enemyId: ExpeditionEnemyId;
  zone: ExpeditionHitZone;
  damageScale?: number;
  position?: { x: number; z: number };
};

export const EXPEDITION_VEHICLE_MIN_IMPACT_SPEED = 2.5;
export const EXPEDITION_VEHICLE_MAX_IMPACT_SPEED = 14;

export function expeditionVehicleImpactDamage(speed: number) {
  const numericSpeed = Number(speed);
  const impactSpeed = Number.isFinite(numericSpeed)
    ? Math.min(EXPEDITION_VEHICLE_MAX_IMPACT_SPEED, Math.max(0, Math.abs(numericSpeed)))
    : 0;
  return Math.round(impactSpeed * impactSpeed * 2.2);
}

export type ExpeditionVehicleHitInput = {
  enemyId: ExpeditionEnemyId;
  speed: number;
  position: { x: number; z: number };
};

export const EXPEDITION_AMMO_PACK = { quantity: 30, price: 450 } as const;
export const EXPEDITION_START_AMMO: Record<ExpeditionWeaponId, number> = {
  pistol: 36,
  rifle: 90,
  rocket: 6,
  laser: 60,
  sniper: 15
};
export const EXPEDITION_START_BANDAGES = 3;
export const EXPEDITION_START_SHIELD_MODULES = 1;
export const EXPEDITION_BANDAGE_HEAL = 35;
export const EXPEDITION_SHIELD_PER_MODULE = 35;
export const EXPEDITION_DOWNED_BLEED_OUT_MS = 35_000;

export const EXPEDITION_GRENADE_IDS = [
  "grenade-frag",
  "grenade-emp",
  "grenade-incendiary",
  "grenade-cryo",
  "grenade-vortex",
  "grenade-cluster"
] as const;
export type ExpeditionGrenadeId = typeof EXPEDITION_GRENADE_IDS[number];
export type ExpeditionGrenadeEffect = "frag" | "emp" | "incendiary" | "cryo" | "vortex" | "cluster";

export type ExpeditionGrenadeDefinition = {
  id: ExpeditionGrenadeId;
  name: string;
  damage: number;
  radius: number;
  robotMultiplier: number;
  color: string;
  fuseMs: number;
  effect: ExpeditionGrenadeEffect;
  throwSpeed: number;
};

export const EXPEDITION_GRENADES: Record<ExpeditionGrenadeId, ExpeditionGrenadeDefinition> = {
  "grenade-frag": { id: "grenade-frag", name: "Осколочная", damage: 105, radius: 7.5, robotMultiplier: 1, color: "#ffb35c", fuseMs: 2_600, effect: "frag", throwSpeed: 18 },
  "grenade-emp": { id: "grenade-emp", name: "ЭМИ", damage: 72, radius: 9, robotMultiplier: 2.15, color: "#54d9ff", fuseMs: 2_200, effect: "emp", throwSpeed: 17 },
  "grenade-incendiary": { id: "grenade-incendiary", name: "Зажигательная", damage: 88, radius: 8, robotMultiplier: 0.82, color: "#ff5c35", fuseMs: 2_800, effect: "incendiary", throwSpeed: 17 },
  "grenade-cryo": { id: "grenade-cryo", name: "Крио", damage: 82, radius: 10, robotMultiplier: 1.15, color: "#7de8ff", fuseMs: 2_350, effect: "cryo", throwSpeed: 18 },
  "grenade-vortex": { id: "grenade-vortex", name: "Вихревая", damage: 96, radius: 12, robotMultiplier: 1.25, color: "#b16dff", fuseMs: 3_100, effect: "vortex", throwSpeed: 16 },
  "grenade-cluster": { id: "grenade-cluster", name: "Кластерная", damage: 148, radius: 11, robotMultiplier: 1, color: "#ffcf5a", fuseMs: 3_000, effect: "cluster", throwSpeed: 16 }
};

export const EXPEDITION_ARTIFACT_IDS = ["artifact-nuke", "artifact-robot-beacon", "artifact-scanner"] as const;
export type ExpeditionArtifactId = typeof EXPEDITION_ARTIFACT_IDS[number];

export type ExpeditionArtifactDefinition = {
  id: ExpeditionArtifactId;
  name: string;
  effect: "nuke" | "support" | "scan";
  durationMs: number;
  accent: string;
};

export const EXPEDITION_ARTIFACTS: Record<ExpeditionArtifactId, ExpeditionArtifactDefinition> = {
  "artifact-nuke": { id: "artifact-nuke", name: "Артефакт «Солнце»", effect: "nuke", durationMs: 2_400, accent: "#ffbb45" },
  "artifact-robot-beacon": { id: "artifact-robot-beacon", name: "Маяк «Страж»", effect: "support", durationMs: 75_000, accent: "#64e8d0" },
  "artifact-scanner": { id: "artifact-scanner", name: "Резонансный сканер", effect: "scan", durationMs: 45_000, accent: "#ac8cff" }
};

export const EXPEDITION_GEAR_IDS = [
  "scout-helmet",
  "composite-vest",
  "tactical-pants",
  "colossus-helmet",
  "storm-vest",
  "void-greaves"
] as const;
export type ExpeditionGearId = typeof EXPEDITION_GEAR_IDS[number];
export const EXPEDITION_GEAR_SLOTS = ["helmet", "armor", "legs"] as const;
export type ExpeditionGearSlot = typeof EXPEDITION_GEAR_SLOTS[number];

export type ExpeditionGearDefinition = {
  id: ExpeditionGearId;
  slot: ExpeditionGearSlot;
  name: string;
  damageReduction: number;
  bonusShield: number;
  color: string;
};

export const EXPEDITION_GEAR: Record<ExpeditionGearId, ExpeditionGearDefinition> = {
  "scout-helmet": { id: "scout-helmet", slot: "helmet", name: "Шлем разведчика", damageReduction: 0.05, bonusShield: 5, color: "#8293a5" },
  "composite-vest": { id: "composite-vest", slot: "armor", name: "Композитный бронежилет", damageReduction: 0.12, bonusShield: 20, color: "#263c43" },
  "tactical-pants": { id: "tactical-pants", slot: "legs", name: "Тактические штаны", damageReduction: 0.04, bonusShield: 5, color: "#3c493b" },
  "colossus-helmet": { id: "colossus-helmet", slot: "helmet", name: "Шлем Колосса", damageReduction: 0.09, bonusShield: 15, color: "#9f6b3e" },
  "storm-vest": { id: "storm-vest", slot: "armor", name: "Нагрудник Серафима", damageReduction: 0.16, bonusShield: 35, color: "#426d91" },
  "void-greaves": { id: "void-greaves", slot: "legs", name: "Поножи Пустоты", damageReduction: 0.08, bonusShield: 12, color: "#654c8c" }
};

export const EXPEDITION_GEAR_MAX_UPGRADE = 5;

export function expeditionGearUpgradeCost(currentLevel: number) {
  const nextLevel = Math.max(1, Math.min(EXPEDITION_GEAR_MAX_UPGRADE, currentLevel + 1));
  return {
    coins: 700 * nextLevel * nextLevel,
    ingredients: [
      { itemId: "upgrade-core" as const, quantity: Math.ceil(nextLevel / 2) },
      { itemId: "ceramic-plate" as const, quantity: nextLevel }
    ]
  };
}

export type ExpeditionTacticalId = ExpeditionGrenadeId | ExpeditionArtifactId;

export type ExpeditionTacticalTarget = {
  enemyId: ExpeditionEnemyId;
  distance: number;
  position?: { x: number; z: number };
};

export const EXPEDITION_RECIPE_IDS = [
  "rifle",
  "ammo",
  "medkit",
  "bandage",
  "shield",
  "grenade-frag",
  "grenade-emp",
  "grenade-incendiary",
  "grenade-cryo",
  "grenade-vortex",
  "grenade-cluster",
  "scout-helmet",
  "composite-vest",
  "tactical-pants"
] as const;
export type ExpeditionRecipeId = typeof EXPEDITION_RECIPE_IDS[number];

export type ExpeditionRecipeDefinition = {
  id: ExpeditionRecipeId;
  name: string;
  ingredients: ItemStack[];
  output: ItemStack | { weaponId: ExpeditionWeaponId };
};

export const EXPEDITION_RECIPES: Record<ExpeditionRecipeId, ExpeditionRecipeDefinition> = {
  rifle: {
    id: "rifle",
    name: "Собрать автомат",
    ingredients: [
      { itemId: "scrap", quantity: 10 },
      { itemId: "alloy", quantity: 4 },
      { itemId: "weapon-parts", quantity: 3 },
      { itemId: "rifle-blueprint", quantity: 1 }
    ],
    output: { weaponId: "rifle" }
  },
  ammo: {
    id: "ammo",
    name: "Сделать патроны",
    ingredients: [
      { itemId: "scrap", quantity: 2 },
      { itemId: "alloy", quantity: 1 }
    ],
    output: { itemId: "ammo", quantity: 30 }
  },
  medkit: {
    id: "medkit",
    name: "Собрать аптечку",
    ingredients: [
      { itemId: "scrap", quantity: 1 },
      { itemId: "robot-lens", quantity: 1 }
    ],
    output: { itemId: "medkit", quantity: 1 }
  },
  bandage: {
    id: "bandage",
    name: "Сделать полевые бинты",
    ingredients: [
      { itemId: "fabric", quantity: 2 },
      { itemId: "scrap", quantity: 1 }
    ],
    output: { itemId: "bandage", quantity: 2 }
  },
  shield: {
    id: "shield",
    name: "Собрать модуль щита",
    ingredients: [
      { itemId: "alloy", quantity: 3 },
      { itemId: "electronics", quantity: 3 },
      { itemId: "power-cell", quantity: 1 }
    ],
    output: { itemId: "shield-module", quantity: 1 }
  },
  "grenade-frag": {
    id: "grenade-frag",
    name: "Собрать осколочную гранату",
    ingredients: [{ itemId: "scrap", quantity: 2 }, { itemId: "explosive-compound", quantity: 1 }],
    output: { itemId: "grenade-frag", quantity: 1 }
  },
  "grenade-emp": {
    id: "grenade-emp",
    name: "Собрать ЭМИ-гранату",
    ingredients: [{ itemId: "electronics", quantity: 2 }, { itemId: "power-cell", quantity: 1 }],
    output: { itemId: "grenade-emp", quantity: 1 }
  },
  "grenade-incendiary": {
    id: "grenade-incendiary",
    name: "Собрать зажигательную гранату",
    ingredients: [{ itemId: "fabric", quantity: 2 }, { itemId: "explosive-compound", quantity: 1 }],
    output: { itemId: "grenade-incendiary", quantity: 1 }
  },
  "grenade-cryo": {
    id: "grenade-cryo",
    name: "Собрать крио-гранату",
    ingredients: [{ itemId: "electronics", quantity: 2 }, { itemId: "power-cell", quantity: 1 }, { itemId: "upgrade-core", quantity: 1 }],
    output: { itemId: "grenade-cryo", quantity: 1 }
  },
  "grenade-vortex": {
    id: "grenade-vortex",
    name: "Собрать вихревую гранату",
    ingredients: [{ itemId: "electronics", quantity: 3 }, { itemId: "void-shard", quantity: 1 }, { itemId: "explosive-compound", quantity: 1 }],
    output: { itemId: "grenade-vortex", quantity: 1 }
  },
  "grenade-cluster": {
    id: "grenade-cluster",
    name: "Собрать кластерную гранату",
    ingredients: [{ itemId: "explosive-compound", quantity: 3 }, { itemId: "alloy", quantity: 2 }, { itemId: "upgrade-core", quantity: 1 }],
    output: { itemId: "grenade-cluster", quantity: 1 }
  },
  "scout-helmet": {
    id: "scout-helmet",
    name: "Собрать шлем разведчика",
    ingredients: [{ itemId: "alloy", quantity: 2 }, { itemId: "electronics", quantity: 1 }],
    output: { itemId: "scout-helmet", quantity: 1 }
  },
  "composite-vest": {
    id: "composite-vest",
    name: "Собрать композитный бронежилет",
    ingredients: [{ itemId: "ceramic-plate", quantity: 3 }, { itemId: "fabric", quantity: 4 }, { itemId: "alloy", quantity: 2 }],
    output: { itemId: "composite-vest", quantity: 1 }
  },
  "tactical-pants": {
    id: "tactical-pants",
    name: "Собрать тактические штаны",
    ingredients: [{ itemId: "fabric", quantity: 4 }, { itemId: "ceramic-plate", quantity: 1 }],
    output: { itemId: "tactical-pants", quantity: 1 }
  }
};

export const EXPEDITION_TRADER_BUY_PRICES = {
  scrap: 35,
  fabric: 55,
  electronics: 140,
  alloy: 170,
  bandage: 90,
  "weapon-parts": 260,
  "explosive-compound": 180,
  "ceramic-plate": 390,
  "upgrade-core": 950,
  "grenade-frag": 420,
  "grenade-emp": 760,
  "grenade-incendiary": 620,
  "grenade-cryo": 1_150,
  "grenade-vortex": 2_400,
  "grenade-cluster": 1_850,
  "scout-helmet": 1_700,
  "composite-vest": 4_800,
  "tactical-pants": 2_100,
  "artifact-nuke": 25_000,
  "artifact-robot-beacon": 12_500,
  "artifact-scanner": 6_800
} satisfies Partial<Record<ExpeditionItemId, number>>;

export const EXPEDITION_TRADER_SELL_PRICES: Record<ExpeditionItemId, number> = {
  scrap: 12,
  alloy: 75,
  "power-cell": 280,
  "robot-lens": 190,
  ammo: 5,
  medkit: 130,
  fabric: 20,
  electronics: 65,
  bandage: 35,
  "shield-module": 520,
  "weapon-parts": 115,
  "rifle-blueprint": 1_800,
  "explosive-compound": 75,
  "ceramic-plate": 170,
  "upgrade-core": 360,
  "colossus-core": 3_800,
  "storm-crystal": 4_600,
  "void-shard": 5_400,
  "grenade-frag": 185,
  "grenade-emp": 320,
  "grenade-incendiary": 270,
  "grenade-cryo": 480,
  "grenade-vortex": 1_050,
  "grenade-cluster": 780,
  "scout-helmet": 220,
  "composite-vest": 900,
  "tactical-pants": 320,
  "colossus-helmet": 4_200,
  "storm-vest": 5_500,
  "void-greaves": 4_800,
  "artifact-nuke": 10_000,
  "artifact-robot-beacon": 5_100,
  "artifact-scanner": 2_800
};

export const EXPEDITION_CONTAINER_IDS = [
  "forest-cache",
  "depot-alpha",
  "quarry-cache",
  "ruins-vault",
  "marsh-cache",
  "relay-armory",
  "fortress-vault",
  "reactor-core"
] as const;
export type ExpeditionContainerId = typeof EXPEDITION_CONTAINER_IDS[number];

export type ExpeditionContainerDefinition = {
  id: ExpeditionContainerId;
  name: string;
  loot: ItemStack[];
  position: readonly [x: number, z: number];
};

export const EXPEDITION_CONTAINERS: Record<ExpeditionContainerId, ExpeditionContainerDefinition> = {
  "forest-cache": {
    id: "forest-cache",
    name: "Лесной тайник",
    position: [35, -149],
    loot: [
      { itemId: "scrap", quantity: 4 },
      { itemId: "fabric", quantity: 3 },
      { itemId: "ammo", quantity: 24 },
      { itemId: "medkit", quantity: 1 }
    ]
  },
  "depot-alpha": {
    id: "depot-alpha",
    name: "Склад «Альфа»",
    position: [-45, -211],
    loot: [
      { itemId: "alloy", quantity: 3 },
      { itemId: "electronics", quantity: 2 },
      { itemId: "weapon-parts", quantity: 2 },
      { itemId: "explosive-compound", quantity: 2 },
      { itemId: "ammo", quantity: 36 }
    ]
  },
  "quarry-cache": {
    id: "quarry-cache",
    name: "Тайник в карьере",
    position: [75, -251],
    loot: [
      { itemId: "power-cell", quantity: 1 },
      { itemId: "electronics", quantity: 2 },
      { itemId: "robot-lens", quantity: 2 },
      { itemId: "alloy", quantity: 2 },
      { itemId: "ceramic-plate", quantity: 2 }
    ]
  },
  "ruins-vault": {
    id: "ruins-vault",
    name: "Сейф в руинах",
    position: [-73, -286],
    loot: [
      { itemId: "rifle-blueprint", quantity: 1 },
      { itemId: "fabric", quantity: 4 },
      { itemId: "weapon-parts", quantity: 3 },
      { itemId: "scrap", quantity: 8 },
      { itemId: "grenade-frag", quantity: 1 }
    ]
  },
  "marsh-cache": {
    id: "marsh-cache",
    name: "Затопленный тайник",
    position: [196, -548],
    loot: [
      { itemId: "fabric", quantity: 7 },
      { itemId: "electronics", quantity: 4 },
      { itemId: "upgrade-core", quantity: 1 },
      { itemId: "grenade-cryo", quantity: 1 }
    ]
  },
  "relay-armory": {
    id: "relay-armory",
    name: "Арсенал ретранслятора",
    position: [-221, -681],
    loot: [
      { itemId: "ammo", quantity: 70 },
      { itemId: "weapon-parts", quantity: 6 },
      { itemId: "upgrade-core", quantity: 2 },
      { itemId: "grenade-cluster", quantity: 1 }
    ]
  },
  "fortress-vault": {
    id: "fortress-vault",
    name: "Хранилище небесной базы",
    position: [0, -927],
    loot: [
      { itemId: "ceramic-plate", quantity: 5 },
      { itemId: "power-cell", quantity: 3 },
      { itemId: "upgrade-core", quantity: 2 },
      { itemId: "grenade-vortex", quantity: 1 }
    ]
  },
  "reactor-core": {
    id: "reactor-core",
    name: "Сейф реактора Пустоты",
    position: [0, -1347],
    loot: [
      { itemId: "alloy", quantity: 10 },
      { itemId: "electronics", quantity: 8 },
      { itemId: "upgrade-core", quantity: 3 },
      { itemId: "artifact-scanner", quantity: 1 }
    ]
  }
};

export const EXPEDITION_ENEMY_IDS = [
  "eye-scout",
  "quad-warden",
  "quad-hunter",
  "raider-vika",
  "raider-boris",
  "eye-sentinel",
  "eye-scorcher",
  "quad-bulwark",
  "quad-stalker",
  "raider-scout",
  "raider-heavy",
  "drone-skimmer",
  "quad-artificer",
  "raider-medic",
  "mutant-brute",
  "boss-iron-colossus",
  "boss-storm-seraph",
  "boss-void-warden"
] as const;
export type ExpeditionEnemyId = typeof EXPEDITION_ENEMY_IDS[number];

export type ExpeditionEnemyDefinition = {
  id: ExpeditionEnemyId;
  name: string;
  faction: "robot" | "raider" | "mutant";
  hostile: boolean;
  maxHealth: number;
  position: readonly [x: number, z: number];
  loot: ItemStack[];
  role?: "neutral" | "sentinel" | "artillery" | "tank" | "stalker" | "skirmisher" | "brute" | "support" | "boss-titan" | "boss-storm" | "boss-void";
  boss?: boolean;
  rewardCoins?: number;
};

export const EXPEDITION_ENEMIES: Record<ExpeditionEnemyId, ExpeditionEnemyDefinition> = {
  "eye-scout": { id: "eye-scout", name: "Робот-наблюдатель", faction: "robot", hostile: false, maxHealth: 70, position: [24, -128], loot: [{ itemId: "robot-lens", quantity: 1 }, { itemId: "electronics", quantity: 1 }] },
  "quad-warden": { id: "quad-warden", name: "Четвероногий страж", faction: "robot", hostile: true, maxHealth: 180, position: [-43, -198], loot: [{ itemId: "alloy", quantity: 2 }, { itemId: "robot-lens", quantity: 1 }, { itemId: "electronics", quantity: 2 }] },
  "quad-hunter": { id: "quad-hunter", name: "Четвероногий охотник", faction: "robot", hostile: true, maxHealth: 145, position: [72, -230], loot: [{ itemId: "power-cell", quantity: 1 }, { itemId: "alloy", quantity: 2 }, { itemId: "electronics", quantity: 1 }] },
  "raider-vika": { id: "raider-vika", name: "Рейдер Вика", faction: "raider", hostile: true, maxHealth: 110, position: [-72, -266], loot: [{ itemId: "ammo", quantity: 18 }, { itemId: "weapon-parts", quantity: 1 }, { itemId: "fabric", quantity: 2 }] },
  "raider-boris": { id: "raider-boris", name: "Рейдер Борис", faction: "raider", hostile: true, maxHealth: 125, position: [-17, -177], loot: [{ itemId: "ammo", quantity: 14 }, { itemId: "scrap", quantity: 3 }, { itemId: "fabric", quantity: 2 }] },
  "eye-sentinel": {
    id: "eye-sentinel",
    name: "Дозорный «Искра»",
    faction: "robot",
    hostile: true,
    role: "sentinel",
    maxHealth: 95,
    position: [115, -165],
    loot: [{ itemId: "robot-lens", quantity: 1 }, { itemId: "electronics", quantity: 2 }, { itemId: "ammo", quantity: 10 }]
  },
  "eye-scorcher": {
    id: "eye-scorcher",
    name: "Испепелитель EYE-X",
    faction: "robot",
    hostile: true,
    role: "artillery",
    maxHealth: 120,
    position: [-118, -235],
    loot: [{ itemId: "power-cell", quantity: 1 }, { itemId: "explosive-compound", quantity: 2 }, { itemId: "electronics", quantity: 2 }]
  },
  "quad-bulwark": {
    id: "quad-bulwark",
    name: "Квад «Бастион»",
    faction: "robot",
    hostile: true,
    role: "tank",
    maxHealth: 330,
    position: [45, -285],
    loot: [{ itemId: "alloy", quantity: 4 }, { itemId: "ceramic-plate", quantity: 2 }, { itemId: "robot-lens", quantity: 1 }]
  },
  "quad-stalker": {
    id: "quad-stalker",
    name: "Квад «Тень»",
    faction: "robot",
    hostile: true,
    role: "stalker",
    maxHealth: 135,
    position: [-105, -145],
    loot: [{ itemId: "electronics", quantity: 2 }, { itemId: "power-cell", quantity: 1 }, { itemId: "grenade-emp", quantity: 1 }]
  },
  "raider-scout": {
    id: "raider-scout",
    name: "Разведчица Ника",
    faction: "raider",
    hostile: true,
    role: "skirmisher",
    maxHealth: 92,
    position: [110, -285],
    loot: [{ itemId: "ammo", quantity: 22 }, { itemId: "fabric", quantity: 3 }, { itemId: "grenade-frag", quantity: 1 }]
  },
  "raider-heavy": {
    id: "raider-heavy",
    name: "Тяжёлый рейдер Гром",
    faction: "raider",
    hostile: true,
    role: "brute",
    maxHealth: 240,
    position: [8, -260],
    loot: [{ itemId: "ammo", quantity: 30 }, { itemId: "ceramic-plate", quantity: 2 }, { itemId: "weapon-parts", quantity: 3 }, { itemId: "grenade-incendiary", quantity: 1 }]
  },
  "drone-skimmer": {
    id: "drone-skimmer",
    name: "Скиммер болот",
    faction: "robot",
    hostile: true,
    role: "skirmisher",
    maxHealth: 150,
    position: [178, -474],
    loot: [{ itemId: "robot-lens", quantity: 2 }, { itemId: "electronics", quantity: 3 }, { itemId: "upgrade-core", quantity: 1 }]
  },
  "quad-artificer": {
    id: "quad-artificer",
    name: "Квад-инженер",
    faction: "robot",
    hostile: true,
    role: "artillery",
    maxHealth: 265,
    position: [-214, -642],
    loot: [{ itemId: "weapon-parts", quantity: 4 }, { itemId: "power-cell", quantity: 2 }, { itemId: "grenade-cluster", quantity: 1 }]
  },
  "raider-medic": {
    id: "raider-medic",
    name: "Полевой медик «Мира»",
    faction: "raider",
    hostile: true,
    role: "support",
    maxHealth: 175,
    position: [92, -802],
    loot: [{ itemId: "medkit", quantity: 2 }, { itemId: "bandage", quantity: 3 }, { itemId: "upgrade-core", quantity: 1 }]
  },
  "mutant-brute": {
    id: "mutant-brute",
    name: "Мутант «Клык»",
    faction: "mutant",
    hostile: true,
    role: "brute",
    maxHealth: 520,
    position: [-244, -1035],
    loot: [{ itemId: "fabric", quantity: 6 }, { itemId: "ceramic-plate", quantity: 2 }, { itemId: "grenade-cryo", quantity: 1 }]
  },
  "boss-iron-colossus": {
    id: "boss-iron-colossus",
    name: "Железный Колосс",
    faction: "robot",
    hostile: true,
    role: "boss-titan",
    boss: true,
    rewardCoins: 6_500,
    maxHealth: 2_600,
    position: [0, -875],
    loot: [{ itemId: "colossus-core", quantity: 1 }, { itemId: "alloy", quantity: 12 }, { itemId: "upgrade-core", quantity: 3 }, { itemId: "grenade-cluster", quantity: 2 }]
  },
  "boss-storm-seraph": {
    id: "boss-storm-seraph",
    name: "Штормовой Серафим",
    faction: "robot",
    hostile: true,
    role: "boss-storm",
    boss: true,
    rewardCoins: 8_500,
    maxHealth: 2_100,
    position: [238, -1072],
    loot: [{ itemId: "storm-crystal", quantity: 1 }, { itemId: "power-cell", quantity: 8 }, { itemId: "upgrade-core", quantity: 4 }, { itemId: "grenade-emp", quantity: 3 }]
  },
  "boss-void-warden": {
    id: "boss-void-warden",
    name: "Страж Пустоты",
    faction: "robot",
    hostile: true,
    role: "boss-void",
    boss: true,
    rewardCoins: 12_000,
    maxHealth: 2_350,
    position: [0, -1300],
    loot: [{ itemId: "void-shard", quantity: 1 }, { itemId: "electronics", quantity: 12 }, { itemId: "upgrade-core", quantity: 5 }, { itemId: "grenade-vortex", quantity: 2 }]
  }
};

const EXPEDITION_EXPANDED_PATROL_ENEMY_IDS = new Set<ExpeditionEnemyId>([
  "drone-skimmer",
  "quad-artificer",
  "raider-medic",
  "mutant-brute",
  "boss-iron-colossus",
  "boss-storm-seraph",
  "boss-void-warden"
]);

export function expeditionEnemyPatrolTolerance(enemyId: ExpeditionEnemyId) {
  return EXPEDITION_ENEMIES[enemyId].boss
    ? 82
    : EXPEDITION_EXPANDED_PATROL_ENEMY_IDS.has(enemyId)
      ? 68
      : 45;
}

export const EXPEDITION_QUEST_ID = "first-expedition";
export const EXPEDITION_EXTRACT_REWARD = { coins: 850, xp: 180 } as const;

export const EXPEDITION_QUEST_IDS = [
  "first-expedition",
  "deep-salvage",
  "iron-colossus-contract",
  "storm-seraph-contract",
  "void-warden-contract"
] as const;
export type ExpeditionQuestId = typeof EXPEDITION_QUEST_IDS[number];

export type ExpeditionQuestState = {
  progress: number;
  completed: boolean;
  claimed: boolean;
};

export type ExpeditionQuestDefinition = {
  id: ExpeditionQuestId;
  name: string;
  description: string;
  giver: string;
  kind: "extract" | "containers" | "boss";
  target: number;
  targetEnemyId?: ExpeditionEnemyId;
  reward: {
    coins: number;
    skillPoints: number;
    items: ItemStack[];
  };
  accent: string;
};

export const EXPEDITION_QUESTS: Record<ExpeditionQuestId, ExpeditionQuestDefinition> = {
  "first-expedition": {
    id: "first-expedition",
    name: "Первый выход",
    description: "Завершите задачу рейда и эвакуируйтесь с добычей.",
    giver: "Инструктор Рэй",
    kind: "extract",
    target: 1,
    reward: { coins: 1_200, skillPoints: 1, items: [{ itemId: "upgrade-core", quantity: 1 }] },
    accent: "#54d6bc"
  },
  "deep-salvage": {
    id: "deep-salvage",
    name: "За дальней чертой",
    description: "Обыщите четыре тайника в дальних регионах за Старым городом.",
    giver: "Техник Лира",
    kind: "containers",
    target: 4,
    reward: { coins: 3_200, skillPoints: 1, items: [{ itemId: "upgrade-core", quantity: 2 }, { itemId: "grenade-cryo", quantity: 2 }] },
    accent: "#8ee8ff"
  },
  "iron-colossus-contract": {
    id: "iron-colossus-contract",
    name: "Падение Колосса",
    description: "Уничтожьте Железного Колосса в релейной низине.",
    giver: "Охотник Арсен",
    kind: "boss",
    target: 1,
    targetEnemyId: "boss-iron-colossus",
    reward: { coins: 9_000, skillPoints: 2, items: [{ itemId: "colossus-helmet", quantity: 1 }] },
    accent: "#f0a259"
  },
  "storm-seraph-contract": {
    id: "storm-seraph-contract",
    name: "Гроза над крепостью",
    description: "Победите Штормового Серафима на небесной базе.",
    giver: "Исследователь Нова",
    kind: "boss",
    target: 1,
    targetEnemyId: "boss-storm-seraph",
    reward: { coins: 12_000, skillPoints: 2, items: [{ itemId: "storm-vest", quantity: 1 }] },
    accent: "#69bfff"
  },
  "void-warden-contract": {
    id: "void-warden-contract",
    name: "Сердце Пустоты",
    description: "Проникните в реактор и уничтожьте Стража Пустоты.",
    giver: "Исследователь Нова",
    kind: "boss",
    target: 1,
    targetEnemyId: "boss-void-warden",
    reward: { coins: 18_000, skillPoints: 3, items: [{ itemId: "void-greaves", quantity: 1 }, { itemId: "grenade-vortex", quantity: 2 }] },
    accent: "#b279ff"
  }
};

export function createDefaultExpeditionQuestStates(): Record<ExpeditionQuestId, ExpeditionQuestState> {
  return Object.fromEntries(EXPEDITION_QUEST_IDS.map((questId) => [questId, {
    progress: 0,
    completed: false,
    claimed: false
  }])) as Record<ExpeditionQuestId, ExpeditionQuestState>;
}

export const EXPEDITION_SKILL_IDS = ["survival", "scavenging", "weapons", "medicine", "demolition", "armor"] as const;
export type ExpeditionSkillId = typeof EXPEDITION_SKILL_IDS[number];

export type ExpeditionSkillDefinition = {
  id: ExpeditionSkillId;
  name: string;
  description: string;
  bonusPerLevel: string;
  maxLevel: number;
  branch: "survival" | "combat" | "technology";
  tier: 1 | 2 | 3;
  requires?: Partial<Record<ExpeditionSkillId, number>>;
};

export const EXPEDITION_SKILLS: Record<ExpeditionSkillId, ExpeditionSkillDefinition> = {
  survival: {
    id: "survival",
    name: "Живучесть",
    description: "Повышает запас здоровья во время экспедиции.",
    bonusPerLevel: "+10 здоровья",
    maxLevel: 5,
    branch: "survival",
    tier: 1
  },
  scavenging: {
    id: "scavenging",
    name: "Сборщик",
    description: "Позволяет извлекать больше ресурсов из каждого тайника.",
    bonusPerLevel: "+10% добычи",
    maxLevel: 5,
    branch: "technology",
    tier: 1
  },
  weapons: {
    id: "weapons",
    name: "Оружейник",
    description: "Увеличивает урон оружия во время экспедиции.",
    bonusPerLevel: "+5% урона",
    maxLevel: 5,
    branch: "combat",
    tier: 1
  },
  medicine: {
    id: "medicine",
    name: "Полевой медик",
    description: "Усиливает лечение бинтами и сокращает время тяжёлого ранения.",
    bonusPerLevel: "+8% лечения",
    maxLevel: 5,
    branch: "survival",
    tier: 2,
    requires: { survival: 2 }
  },
  demolition: {
    id: "demolition",
    name: "Подрывник",
    description: "Увеличивает урон и радиус гранат и тяжёлого оружия.",
    bonusPerLevel: "+8% урона гранат",
    maxLevel: 5,
    branch: "combat",
    tier: 2,
    requires: { weapons: 2 }
  },
  armor: {
    id: "armor",
    name: "Бронетехник",
    description: "Усиливает защиту экипировки и переносных щитов.",
    bonusPerLevel: "+4% эффективности брони",
    maxLevel: 5,
    branch: "technology",
    tier: 2,
    requires: { scavenging: 2 }
  }
};

export type ExpeditionProfile = {
  stash: ItemStack[];
  unlockedWeapons: ExpeditionWeaponId[];
  selectedWeapon: ExpeditionWeaponId;
  skillPoints: number;
  skills: Record<ExpeditionSkillId, number>;
  equippedGear: Record<ExpeditionGearSlot, ExpeditionGearId | null>;
  weaponUpgrades: Record<ExpeditionWeaponId, ExpeditionWeaponUpgradeLevels>;
  gearUpgrades: Record<ExpeditionGearId, number>;
  quests: Record<ExpeditionQuestId, ExpeditionQuestState>;
  completedQuestIds: string[];
  stats: {
    expeditionsStarted: number;
    successfulExtracts: number;
    abandonedRuns: number;
    containersLooted: number;
    enemiesKilled: number;
    hostileEnemiesKilled: number;
  };
};

export type ExpeditionRunObjective = {
  powerCells: number;
  hostileKills: number;
  requiredPowerCells: number;
  requiredHostileKills: number;
  complete: boolean;
};

export type ExpeditionRunSnapshot = {
  id: string;
  startedAt: number;
  selectedWeapon: ExpeditionWeaponId;
  playerPosition: {
    x: number;
    y: number;
    z: number;
    rotation?: number;
    vehicle?: boolean;
  };
  backpack: ItemStack[];
  lootedContainerIds: ExpeditionContainerId[];
  lootedEnemyIds: ExpeditionEnemyId[];
  killedEnemyIds: ExpeditionEnemyId[];
  carriedCoins: number;
  carriedWeaponIds: ExpeditionWeaponId[];
  playerHealth: number;
  playerMaxHealth: number;
  playerShield: number;
  supportRobotUntil: number | null;
  scannerUntil: number | null;
  downedAt: number | null;
  bleedOutAt: number | null;
  enemyHealth: Record<ExpeditionEnemyId, number>;
  objective: ExpeditionRunObjective;
};

export type PartyMember = {
  userId: string;
  username: string;
  joinedAt: number;
  isLeader: boolean;
  online: boolean;
};

export type PartySnapshot = {
  id: string;
  leaderUserId: string;
  members: PartyMember[];
  maxSize: 4;
};

export type PartyInvite = {
  id: string;
  partyId: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  createdAt: number;
  expiresAt: number;
};

export type PartyInvitesSnapshot = {
  incoming: PartyInvite[];
  outgoing: PartyInvite[];
};

export function createDefaultExpeditionProfile(): ExpeditionProfile {
  return {
    stash: [
      { itemId: "ammo", quantity: 60 },
      { itemId: "medkit", quantity: 2 },
      { itemId: "bandage", quantity: 2 },
      { itemId: "grenade-frag", quantity: 1 },
      { itemId: "fabric", quantity: 4 },
      { itemId: "scrap", quantity: 4 }
    ],
    unlockedWeapons: ["pistol"],
    selectedWeapon: "pistol",
    skillPoints: 0,
    skills: {
      survival: 0,
      scavenging: 0,
      weapons: 0,
      medicine: 0,
      demolition: 0,
      armor: 0
    },
    equippedGear: {
      helmet: null,
      armor: null,
      legs: null
    },
    weaponUpgrades: Object.fromEntries(EXPEDITION_WEAPON_IDS.map((weaponId) => [weaponId, {
      ...EMPTY_WEAPON_UPGRADE_LEVELS
    }])) as Record<ExpeditionWeaponId, ExpeditionWeaponUpgradeLevels>,
    gearUpgrades: Object.fromEntries(EXPEDITION_GEAR_IDS.map((gearId) => [gearId, 0])) as Record<ExpeditionGearId, number>,
    quests: createDefaultExpeditionQuestStates(),
    completedQuestIds: [],
    stats: {
      expeditionsStarted: 0,
      successfulExtracts: 0,
      abandonedRuns: 0,
      containersLooted: 0,
      enemiesKilled: 0,
      hostileEnemiesKilled: 0
    }
  };
}
