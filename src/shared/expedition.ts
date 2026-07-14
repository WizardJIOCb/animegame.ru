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
  "rifle-blueprint"
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
    stackSize: 1
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
    range: 28
  },
  rifle: {
    id: "rifle",
    name: "Автомат",
    price: 2_400,
    description: "Скорострельное оружие для ближней и средней дистанции.",
    damage: 28,
    fireIntervalMs: 125,
    range: 36
  },
  rocket: {
    id: "rocket",
    name: "Ракетница",
    price: 6_500,
    description: "Тяжёлое оружие против групп и роботов.",
    damage: 120,
    fireIntervalMs: 1_050,
    range: 32
  },
  laser: {
    id: "laser",
    name: "Лазер",
    price: 7_800,
    description: "Экспериментальное энергетическое оружие.",
    damage: 55,
    fireIntervalMs: 210,
    range: 42
  },
  sniper: {
    id: "sniper",
    name: "Снайперская винтовка",
    price: 5_000,
    description: "Точный дальнобойный вариант.",
    damage: 110,
    fireIntervalMs: 900,
    range: 70
  }
};

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

export const EXPEDITION_RECIPE_IDS = ["rifle", "ammo", "medkit", "bandage", "shield"] as const;
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
  }
};

export const EXPEDITION_TRADER_BUY_PRICES = {
  scrap: 35,
  fabric: 55,
  electronics: 140,
  alloy: 170,
  bandage: 90,
  "weapon-parts": 260
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
  "rifle-blueprint": 1_800
};

export const EXPEDITION_CONTAINER_IDS = ["forest-cache", "depot-alpha", "quarry-cache", "ruins-vault"] as const;
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
      { itemId: "alloy", quantity: 2 }
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
      { itemId: "scrap", quantity: 8 }
    ]
  }
};

export const EXPEDITION_ENEMY_IDS = ["eye-scout", "quad-warden", "quad-hunter", "raider-vika", "raider-boris"] as const;
export type ExpeditionEnemyId = typeof EXPEDITION_ENEMY_IDS[number];

export type ExpeditionEnemyDefinition = {
  id: ExpeditionEnemyId;
  name: string;
  faction: "robot" | "raider";
  hostile: boolean;
  maxHealth: number;
  position: readonly [x: number, z: number];
  loot: ItemStack[];
};

export const EXPEDITION_ENEMIES: Record<ExpeditionEnemyId, ExpeditionEnemyDefinition> = {
  "eye-scout": { id: "eye-scout", name: "Робот-наблюдатель", faction: "robot", hostile: false, maxHealth: 70, position: [24, -128], loot: [{ itemId: "robot-lens", quantity: 1 }, { itemId: "electronics", quantity: 1 }] },
  "quad-warden": { id: "quad-warden", name: "Четвероногий страж", faction: "robot", hostile: true, maxHealth: 180, position: [-43, -198], loot: [{ itemId: "alloy", quantity: 2 }, { itemId: "robot-lens", quantity: 1 }, { itemId: "electronics", quantity: 2 }] },
  "quad-hunter": { id: "quad-hunter", name: "Четвероногий охотник", faction: "robot", hostile: true, maxHealth: 145, position: [72, -230], loot: [{ itemId: "power-cell", quantity: 1 }, { itemId: "alloy", quantity: 2 }, { itemId: "electronics", quantity: 1 }] },
  "raider-vika": { id: "raider-vika", name: "Рейдер Вика", faction: "raider", hostile: true, maxHealth: 110, position: [-72, -266], loot: [{ itemId: "ammo", quantity: 18 }, { itemId: "weapon-parts", quantity: 1 }, { itemId: "fabric", quantity: 2 }] },
  "raider-boris": { id: "raider-boris", name: "Рейдер Борис", faction: "raider", hostile: true, maxHealth: 125, position: [-17, -177], loot: [{ itemId: "ammo", quantity: 14 }, { itemId: "scrap", quantity: 3 }, { itemId: "fabric", quantity: 2 }] }
};

export const EXPEDITION_QUEST_ID = "first-expedition";
export const EXPEDITION_EXTRACT_REWARD = { coins: 850, xp: 180 } as const;

export const EXPEDITION_SKILL_IDS = ["survival", "scavenging", "weapons"] as const;
export type ExpeditionSkillId = typeof EXPEDITION_SKILL_IDS[number];

export type ExpeditionSkillDefinition = {
  id: ExpeditionSkillId;
  name: string;
  description: string;
  bonusPerLevel: string;
  maxLevel: number;
};

export const EXPEDITION_SKILLS: Record<ExpeditionSkillId, ExpeditionSkillDefinition> = {
  survival: {
    id: "survival",
    name: "Живучесть",
    description: "Повышает запас здоровья во время экспедиции.",
    bonusPerLevel: "+10 здоровья",
    maxLevel: 5
  },
  scavenging: {
    id: "scavenging",
    name: "Сборщик",
    description: "Позволяет извлекать больше ресурсов из каждого тайника.",
    bonusPerLevel: "+10% добычи",
    maxLevel: 5
  },
  weapons: {
    id: "weapons",
    name: "Оружейник",
    description: "Увеличивает урон оружия во время экспедиции.",
    bonusPerLevel: "+5% урона",
    maxLevel: 5
  }
};

export type ExpeditionProfile = {
  stash: ItemStack[];
  unlockedWeapons: ExpeditionWeaponId[];
  selectedWeapon: ExpeditionWeaponId;
  skillPoints: number;
  skills: Record<ExpeditionSkillId, number>;
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
      { itemId: "fabric", quantity: 4 },
      { itemId: "scrap", quantity: 4 }
    ],
    unlockedWeapons: ["pistol"],
    selectedWeapon: "pistol",
    skillPoints: 0,
    skills: {
      survival: 0,
      scavenging: 0,
      weapons: 0
    },
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
