import type {
  CatalogItem,
  NeighborhoodHouseColors,
  NeighborhoodLot,
  NeighborhoodProgress,
  NeighborhoodResident,
  PlacedItem,
  User,
  UserProgress
} from "../types";

export const NEIGHBORHOOD_SIZE = 12;
export const MAX_PLAYER_LEVEL = 50;
export const MAX_CAREER_LEVEL = 12;
export const MAX_HOUSE_LEVEL = 8;
export const MAX_OFFLINE_INCOME_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const BASE_HOME_VALUE = 4_000;
const HOME_VALUE_PER_LEVEL = 3_000;

const housePalettes: NeighborhoodHouseColors[] = [
  { walls: "#f4b6c2", roof: "#7c3f58", trim: "#fff7ed" },
  { walls: "#a7d8f0", roof: "#315d78", trim: "#f8fafc" },
  { walls: "#f6d186", roof: "#8a4f2c", trim: "#fff7ed" },
  { walls: "#b8e0b0", roof: "#3f6b49", trim: "#f7fee7" },
  { walls: "#c8b6e8", roof: "#57416d", trim: "#faf5ff" },
  { walls: "#f1a7a7", roof: "#783c3c", trim: "#fff1f2" },
  { walls: "#8fd3c7", roof: "#285e61", trim: "#f0fdfa" },
  { walls: "#f7c59f", roof: "#7c4a32", trim: "#fffbeb" },
  { walls: "#b9c6e4", roof: "#394867", trim: "#f8fafc" },
  { walls: "#d4df9e", roof: "#53622d", trim: "#f7fee7" },
  { walls: "#e7b8de", roof: "#704264", trim: "#fdf4ff" },
  { walls: "#c9b49b", roof: "#584534", trim: "#fafaf9" }
];

export const neighborhoodLots: NeighborhoodLot[] = Array.from({ length: NEIGHBORHOOD_SIZE }, (_, index) => {
  const westSide = index < NEIGHBORHOOD_SIZE / 2;
  const sideIndex = westSide ? index : index - NEIGHBORHOOD_SIZE / 2;
  return {
    x: westSide ? -18 : 18,
    z: -30 + sideIndex * 12,
    rotation: westSide ? Math.PI / 2 : -Math.PI / 2
  };
});

type NeighborhoodNpc = {
  username: string;
  level: number;
  careerLevel: number;
  houseLevel: number;
  colors: NeighborhoodHouseColors;
  avatar: User["avatar"];
  homeStyle: NonNullable<User["homeStyle"]>;
  placedItems: PlacedItem[];
};

function npcItems(username: string, variant: number): PlacedItem[] {
  const prefix = `npc-${username.toLowerCase()}`;
  return [
    {
      instanceId: `${prefix}-bed`,
      itemId: "kenney-beddouble",
      x: -2.8,
      y: 0,
      z: -2.5,
      rotation: variant % 2 === 0 ? 0 : Math.PI
    },
    {
      instanceId: `${prefix}-desk`,
      itemId: "kenney-desk",
      x: 2.4,
      y: 0,
      z: -2.6,
      rotation: Math.PI
    },
    {
      instanceId: `${prefix}-chair`,
      itemId: "kaykit-armchair",
      x: variant % 3 - 1,
      y: 0,
      z: 1.2,
      rotation: (variant % 4) * Math.PI / 2
    },
    {
      instanceId: `${prefix}-rug`,
      itemId: "kenney-rugrectangle",
      x: 0,
      y: 0.01,
      z: 0.4,
      rotation: variant % 2 === 0 ? 0 : Math.PI / 2
    }
  ];
}

const npcSeeds: Array<Pick<NeighborhoodNpc, "username" | "level" | "careerLevel" | "houseLevel" | "avatar">> = [
  { username: "Akira", level: 8, careerLevel: 5, houseLevel: 4, avatar: { character: "quaternius-superhero-male", outfit: "jacket-cyber", hair: "hair-silver" } },
  { username: "Miyu", level: 6, careerLevel: 4, houseLevel: 3, avatar: { character: "quaternius-superhero-female", outfit: "dress-sakura", hair: "hair-rose", pet: "pet-cat-mochi" } },
  { username: "Ren", level: 11, careerLevel: 7, houseLevel: 5, avatar: { character: "quaternius-superhero-male", outfit: "hoodie-black", hair: "hair-silver" } },
  { username: "Hana", level: 4, careerLevel: 3, houseLevel: 2, avatar: { character: "quaternius-superhero-female", outfit: "kimono-summer", hair: "hair-rose", pet: "pet-bunny" } },
  { username: "Sora", level: 14, careerLevel: 9, houseLevel: 6, avatar: { character: "quaternius-superhero-male", outfit: "armor-neo", hair: "hair-violet", pet: "pet-robot" } },
  { username: "Yuki", level: 9, careerLevel: 6, houseLevel: 4, avatar: { character: "quaternius-superhero-female", outfit: "dress-night", hair: "hair-silver", pet: "pet-fox" } },
  { username: "Kaito", level: 5, careerLevel: 3, houseLevel: 3, avatar: { character: "quaternius-superhero-male", outfit: "school-blue", hair: "hair-violet" } },
  { username: "Aoi", level: 7, careerLevel: 5, houseLevel: 4, avatar: { character: "quaternius-superhero-female", outfit: "idol-stage", hair: "hair-rose", pet: "pet-star" } },
  { username: "Nami", level: 3, careerLevel: 2, houseLevel: 2, avatar: { character: "quaternius-superhero-female", outfit: "hoodie-pink", hair: "hair-rose" } },
  { username: "Riku", level: 12, careerLevel: 8, houseLevel: 5, avatar: { character: "quaternius-superhero-male", outfit: "jacket-cyber", hair: "hair-silver", pet: "pet-dragon" } },
  { username: "Emi", level: 10, careerLevel: 6, houseLevel: 5, avatar: { character: "quaternius-superhero-female", outfit: "dress-sakura", hair: "hair-violet", pet: "pet-panda" } },
  { username: "Haruto", level: 16, careerLevel: 10, houseLevel: 7, avatar: { character: "quaternius-superhero-male", outfit: "armor-neo", hair: "hair-silver", pet: "pet-owl" } }
];

export const neighborhoodNpcs: NeighborhoodNpc[] = npcSeeds.map((seed, index) => ({
  ...seed,
  colors: housePalettes[index],
  homeStyle: {
    floorColor: ["#9b6a3c", "#6f472a", "#c08a4a", "#8f7a5d"][index % 4],
    wallColor: seed.avatar.character === "quaternius-superhero-female" ? "#f7e7ef" : "#e2e8f0"
  },
  placedItems: npcItems(seed.username, index)
}));

export function createDefaultProgress(now = Date.now()): UserProgress {
  return {
    level: 1,
    xp: 0,
    careerLevel: 1,
    houseLevel: 1,
    incomePerHour: incomePerHourForCareer(1),
    lastIncomeClaimAt: now,
    workAvailableAt: 0
  };
}

export function xpRequiredForLevel(level: number) {
  return 100 + (Math.max(1, level) - 1) * 50;
}

export function incomePerHourForCareer(careerLevel: number) {
  return 120 + (Math.max(1, careerLevel) - 1) * 75;
}

export function careerUpgradeCost(careerLevel: number) {
  return Math.round(500 * 1.65 ** (Math.max(1, careerLevel) - 1));
}

export function houseUpgradeCost(houseLevel: number) {
  return Math.round(900 * 1.7 ** (Math.max(1, houseLevel) - 1));
}

export function careerRequiredLevel(careerLevel: number) {
  return careerLevel + 1;
}

export function houseRequiredLevel(houseLevel: number) {
  return houseLevel * 2;
}

export function calculateHomeValue(houseLevel: number, placedItems: PlacedItem[], catalog: CatalogItem[]) {
  const prices = new Map(catalog.map((item) => [item.id, item.price]));
  const placedValue = placedItems.reduce((total, placed) => total + (prices.get(placed.itemId) ?? 0), 0);
  return BASE_HOME_VALUE + (Math.max(1, houseLevel) - 1) * HOME_VALUE_PER_LEVEL + placedValue;
}

export function calculatePendingIncome(progress: UserProgress, now = Date.now()) {
  const elapsed = Math.max(0, now - progress.lastIncomeClaimAt);
  const cappedElapsed = Math.min(elapsed, MAX_OFFLINE_INCOME_HOURS * HOUR_MS);
  return Math.floor(progress.incomePerHour * cappedElapsed / HOUR_MS);
}

export function grantXp(progress: UserProgress, amount: number) {
  const previousLevel = progress.level;
  progress.xp += Math.max(0, Math.round(amount));

  while (progress.level < MAX_PLAYER_LEVEL && progress.xp >= xpRequiredForLevel(progress.level)) {
    progress.xp -= xpRequiredForLevel(progress.level);
    progress.level += 1;
  }

  if (progress.level >= MAX_PLAYER_LEVEL) {
    progress.level = MAX_PLAYER_LEVEL;
    progress.xp = Math.min(progress.xp, xpRequiredForLevel(progress.level) - 1);
  }

  return progress.level - previousLevel;
}

export function activityXp(reward: number) {
  return Math.max(10, Math.round(reward / 3));
}

export function makeProgressView(user: User, catalog: CatalogItem[], now = Date.now()): NeighborhoodProgress {
  const progress = user.progress;
  const careerAtMax = progress.careerLevel >= MAX_CAREER_LEVEL;
  const houseAtMax = progress.houseLevel >= MAX_HOUSE_LEVEL;
  return {
    level: progress.level,
    xp: progress.xp,
    xpToNext: progress.level >= MAX_PLAYER_LEVEL ? 0 : xpRequiredForLevel(progress.level) - progress.xp,
    careerLevel: progress.careerLevel,
    houseLevel: progress.houseLevel,
    homeValue: calculateHomeValue(progress.houseLevel, user.placedItems, catalog),
    incomePerHour: progress.incomePerHour,
    pendingIncome: calculatePendingIncome(progress, now),
    nextCareerCost: careerAtMax ? null : careerUpgradeCost(progress.careerLevel),
    nextCareerRequiredLevel: careerAtMax ? null : careerRequiredLevel(progress.careerLevel),
    nextHouseCost: houseAtMax ? null : houseUpgradeCost(progress.houseLevel),
    nextHouseRequiredLevel: houseAtMax ? null : houseRequiredLevel(progress.houseLevel),
    workAvailableAt: progress.workAvailableAt
  };
}

function colorsForUser(user: User, plotIndex: number): NeighborhoodHouseColors {
  const palette = housePalettes[plotIndex % housePalettes.length];
  return {
    ...palette,
    walls: user.homeStyle?.wallColor ?? palette.walls
  };
}

function residentFromUser(user: User, plotIndex: number, catalog: CatalogItem[]): NeighborhoodResident {
  return {
    plotId: plotIndex + 1,
    username: user.username,
    isNpc: false,
    level: user.progress.level,
    careerLevel: user.progress.careerLevel,
    houseLevel: user.progress.houseLevel,
    homeValue: calculateHomeValue(user.progress.houseLevel, user.placedItems, catalog),
    incomePerHour: user.progress.incomePerHour,
    colors: colorsForUser(user, plotIndex),
    avatar: user.avatar,
    lot: neighborhoodLots[plotIndex]
  };
}

function residentFromNpc(npc: NeighborhoodNpc, plotIndex: number, catalog: CatalogItem[]): NeighborhoodResident {
  return {
    plotId: plotIndex + 1,
    username: npc.username,
    isNpc: true,
    level: npc.level,
    careerLevel: npc.careerLevel,
    houseLevel: npc.houseLevel,
    homeValue: calculateHomeValue(npc.houseLevel, npc.placedItems, catalog),
    incomePerHour: incomePerHourForCareer(npc.careerLevel),
    colors: npc.colors,
    avatar: npc.avatar,
    lot: neighborhoodLots[plotIndex]
  };
}

export function makeNeighborhoodResidents(users: User[], catalog: CatalogItem[]) {
  const realResidents = [...users]
    .sort((left, right) => left.createdAt - right.createdAt || left.username.localeCompare(right.username))
    .slice(0, NEIGHBORHOOD_SIZE);
  const realNames = new Set(users.map((user) => user.username.toLowerCase()));
  const availableNpcs = neighborhoodNpcs.filter((npc) => !realNames.has(npc.username.toLowerCase()));
  const residents: NeighborhoodResident[] = realResidents.map((user, index) => residentFromUser(user, index, catalog));

  for (const npc of availableNpcs) {
    if (residents.length >= NEIGHBORHOOD_SIZE) {
      break;
    }
    residents.push(residentFromNpc(npc, residents.length, catalog));
  }

  return residents;
}

export function findNeighborhoodNpc(username: string) {
  return neighborhoodNpcs.find((npc) => npc.username.toLowerCase() === username.toLowerCase());
}

export function makeNpcHome(username: string) {
  const npc = findNeighborhoodNpc(username);
  if (!npc) {
    return undefined;
  }

  return {
    owner: npc.username,
    avatar: npc.avatar,
    homeStyle: npc.homeStyle,
    placedItems: npc.placedItems,
    inventory: [] as string[]
  };
}
