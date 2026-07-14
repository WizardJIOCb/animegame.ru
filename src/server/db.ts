import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createDefaultExpeditionProfile,
  EXPEDITION_CONTAINER_IDS,
  EXPEDITION_ENEMIES,
  EXPEDITION_ENEMY_IDS,
  EXPEDITION_GEAR,
  EXPEDITION_GEAR_IDS,
  EXPEDITION_GEAR_SLOTS,
  EXPEDITION_ITEM_IDS,
  EXPEDITION_DOWNED_BLEED_OUT_MS,
  EXPEDITION_SHIELD_PER_MODULE,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_WEAPON_IDS,
  type ExpeditionContainerId,
  type ExpeditionEnemyId,
  type ExpeditionGearId,
  type ExpeditionItemId,
  type ExpeditionProfile,
  type ExpeditionWeaponId,
  type ItemStack
} from "../shared/expedition";
import {
  createDefaultProgress,
  incomePerHourForCareer,
  MAX_CAREER_LEVEL,
  MAX_HOUSE_LEVEL,
  MAX_PLAYER_LEVEL,
  xpRequiredForLevel
} from "./data/neighborhood";
import type { DbShape, PersistedExpeditionRun, PublicUser, User } from "./types";

const dbPath = resolve(process.cwd(), "data", "db.json");

const initialDb: DbShape = {
  users: [],
  chats: [],
  content: {
    catalogItems: {},
    activities: {}
  }
};

function normalizeDb(db: DbShape) {
  let changed = false;
  const now = Date.now();

  if (!db.content) {
    db.content = {};
    changed = true;
  }
  if (!db.content.catalogItems) {
    db.content.catalogItems = {};
    changed = true;
  }
  if (!db.content.activities) {
    db.content.activities = {};
    changed = true;
  }

  for (const user of db.users) {
    const storedProgress = (user as User & { progress?: Partial<User["progress"]> }).progress;
    const defaults = createDefaultProgress(now);
    const level = clampInteger(storedProgress?.level, 1, MAX_PLAYER_LEVEL, defaults.level);
    const careerLevel = clampInteger(storedProgress?.careerLevel, 1, MAX_CAREER_LEVEL, defaults.careerLevel);
    const houseLevel = clampInteger(storedProgress?.houseLevel, 1, MAX_HOUSE_LEVEL, defaults.houseLevel);
    const lastIncomeClaimAt = Number(storedProgress?.lastIncomeClaimAt);
    const workAvailableAt = Number(storedProgress?.workAvailableAt);
    const normalizedProgress: User["progress"] = {
      level,
      xp: clampInteger(storedProgress?.xp, 0, xpRequiredForLevel(level) - 1, defaults.xp),
      careerLevel,
      houseLevel,
      incomePerHour: incomePerHourForCareer(careerLevel),
      lastIncomeClaimAt: Number.isFinite(lastIncomeClaimAt) && lastIncomeClaimAt > 0 && lastIncomeClaimAt <= now
        ? Math.round(lastIncomeClaimAt)
        : now,
      workAvailableAt: Number.isFinite(workAvailableAt) && workAvailableAt > now && workAvailableAt <= now + 86_400_000
        ? Math.round(workAvailableAt)
        : 0
    };

    if (!storedProgress || JSON.stringify(storedProgress) !== JSON.stringify(normalizedProgress)) {
      user.progress = normalizedProgress;
      changed = true;
    }

    const storedExpedition = (user as User & { expedition?: Partial<ExpeditionProfile> }).expedition;
    const normalizedExpedition = normalizeExpeditionProfile(storedExpedition);
    if (!storedExpedition || JSON.stringify(storedExpedition) !== JSON.stringify(normalizedExpedition)) {
      user.expedition = normalizedExpedition;
      changed = true;
    }

    const storedExpeditionRun = (user as User & { expeditionRun?: Partial<PersistedExpeditionRun> }).expeditionRun;
    if (storedExpeditionRun) {
      const normalizedExpeditionRun = normalizePersistedExpeditionRun(storedExpeditionRun, user);
      if (JSON.stringify(storedExpeditionRun) !== JSON.stringify(normalizedExpeditionRun)) {
        user.expeditionRun = normalizedExpeditionRun;
        changed = true;
      }
    }

    if (user.username.toLowerCase() === "rodion" && !user.isAdmin) {
      user.isAdmin = true;
      changed = true;
    }
  }

  return changed;
}

const expeditionItemIds = new Set<string>(EXPEDITION_ITEM_IDS);
const expeditionWeaponIds = new Set<string>(EXPEDITION_WEAPON_IDS);
const expeditionContainerIds = new Set<string>(EXPEDITION_CONTAINER_IDS);
const expeditionEnemyIds = new Set<string>(EXPEDITION_ENEMY_IDS);
const expeditionGearIds = new Set<string>(EXPEDITION_GEAR_IDS);

function normalizeItemStacks(value: unknown, fallback: ItemStack[]) {
  if (!Array.isArray(value)) {
    return fallback.map((stack) => ({ ...stack }));
  }

  const quantities = new Map<ExpeditionItemId, number>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const stack = candidate as { itemId?: unknown; quantity?: unknown };
    const itemId = String(stack.itemId ?? "");
    if (!expeditionItemIds.has(itemId)) {
      continue;
    }
    const numericQuantity = Number(stack.quantity);
    const quantity = Number.isFinite(numericQuantity)
      ? Math.min(999_999, Math.round(numericQuantity))
      : 0;
    if (quantity <= 0) {
      continue;
    }
    const typedItemId = itemId as ExpeditionItemId;
    quantities.set(typedItemId, Math.min(999_999, (quantities.get(typedItemId) ?? 0) + quantity));
  }
  return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }));
}

function normalizeExpeditionProfile(value: Partial<ExpeditionProfile> | undefined): ExpeditionProfile {
  const defaults = createDefaultExpeditionProfile();
  const stash = normalizeItemStacks(value?.stash, defaults.stash);
  const unlockedWeapons: ExpeditionWeaponId[] = ["pistol"];
  if (Array.isArray(value?.unlockedWeapons)) {
    for (const candidate of value.unlockedWeapons) {
      if (expeditionWeaponIds.has(String(candidate)) && !unlockedWeapons.includes(candidate as ExpeditionWeaponId)) {
        unlockedWeapons.push(candidate as ExpeditionWeaponId);
      }
    }
  }

  const selectedWeapon = unlockedWeapons.includes(value?.selectedWeapon as ExpeditionWeaponId)
    ? value?.selectedWeapon as ExpeditionWeaponId
    : defaults.selectedWeapon;
  const completedQuestIds = Array.isArray(value?.completedQuestIds)
    ? [...new Set(value.completedQuestIds.map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 200)
    : defaults.completedQuestIds;
  const equippedGear = Object.fromEntries(EXPEDITION_GEAR_SLOTS.map((slot) => {
    const candidate = value?.equippedGear?.[slot];
    const gearId = expeditionGearIds.has(String(candidate)) ? candidate as ExpeditionGearId : null;
    const owned = gearId ? stash.some((stack) => stack.itemId === gearId && stack.quantity > 0) : false;
    return [slot, gearId && owned && EXPEDITION_GEAR[gearId].slot === slot ? gearId : null];
  })) as ExpeditionProfile["equippedGear"];

  return {
    stash,
    unlockedWeapons,
    selectedWeapon,
    skillPoints: clampInteger(value?.skillPoints, 0, 9_999, defaults.skillPoints),
    skills: Object.fromEntries(EXPEDITION_SKILL_IDS.map((skillId) => [
      skillId,
      clampInteger(value?.skills?.[skillId], 0, EXPEDITION_SKILLS[skillId].maxLevel, defaults.skills[skillId])
    ])) as ExpeditionProfile["skills"],
    equippedGear,
    completedQuestIds,
    stats: {
      expeditionsStarted: clampInteger(value?.stats?.expeditionsStarted, 0, 999_999_999, 0),
      successfulExtracts: clampInteger(value?.stats?.successfulExtracts, 0, 999_999_999, 0),
      abandonedRuns: clampInteger(value?.stats?.abandonedRuns, 0, 999_999_999, 0),
      containersLooted: clampInteger(value?.stats?.containersLooted, 0, 999_999_999, 0),
      enemiesKilled: clampInteger(value?.stats?.enemiesKilled, 0, 999_999_999, 0),
      hostileEnemiesKilled: clampInteger(value?.stats?.hostileEnemiesKilled, 0, 999_999_999, 0)
    }
  };
}

function normalizePersistedExpeditionRun(
  value: Partial<PersistedExpeditionRun>,
  user: User
): PersistedExpeditionRun {
  const selectedWeapon = expeditionWeaponIds.has(String(value.selectedWeapon))
    ? value.selectedWeapon as ExpeditionWeaponId
    : user.expedition.selectedWeapon;
  const backpack = normalizeItemStacks(value.backpack, []);
  const lootedContainerIds = Array.isArray(value.lootedContainerIds)
    ? [...new Set(value.lootedContainerIds.filter((id): id is ExpeditionContainerId => expeditionContainerIds.has(String(id))))]
    : [];
  const killedEnemyIds = Array.isArray(value.killedEnemyIds)
    ? [...new Set(value.killedEnemyIds.filter((id): id is ExpeditionEnemyId => expeditionEnemyIds.has(String(id))))]
    : [];
  const lootedEnemyIds = Array.isArray(value.lootedEnemyIds)
    ? [...new Set(value.lootedEnemyIds.filter((id): id is ExpeditionEnemyId => (
      expeditionEnemyIds.has(String(id)) && killedEnemyIds.includes(id as ExpeditionEnemyId)
    )))]
    // Runs created before corpse looting already received their enemy drops at
    // kill time. Mark those corpses as searched during migration so the same
    // loot cannot be claimed twice after deploy.
    : [...killedEnemyIds];
  const carriedWeaponIds = Array.isArray(value.carriedWeaponIds)
    ? [...new Set(value.carriedWeaponIds.filter((id): id is ExpeditionWeaponId => expeditionWeaponIds.has(String(id))))]
    : [];
  const enemyHealth = Object.fromEntries(EXPEDITION_ENEMY_IDS.map((enemyId) => {
    const maximum = EXPEDITION_ENEMIES[enemyId].maxHealth;
    if (killedEnemyIds.includes(enemyId)) return [enemyId, 0];
    const candidate = Number(value.enemyHealth?.[enemyId]);
    return [enemyId, Number.isFinite(candidate) ? Math.max(0, Math.min(maximum, candidate)) : maximum];
  })) as PersistedExpeditionRun["enemyHealth"];
  const powerCells = backpack.reduce((total, stack) => (
    stack.itemId === "power-cell" ? total + stack.quantity : total
  ), 0);
  const hostileKills = killedEnemyIds.filter((enemyId) => EXPEDITION_ENEMIES[enemyId].hostile).length;
  const enemyDeathPositions: NonNullable<PersistedExpeditionRun["enemyDeathPositions"]> = {};
  for (const enemyId of killedEnemyIds) {
    const rawPosition = value.enemyDeathPositions?.[enemyId];
    const x = Number(rawPosition?.x);
    const z = Number(rawPosition?.z);
    if (Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= 1_000 && Math.abs(z) <= 1_000) {
      enemyDeathPositions[enemyId] = { x, z };
    }
  }
  const playerMaxHealth = 100 + user.expedition.skills.survival * 10;
  const maximumShield = Math.round((backpack.reduce((total, stack) => (
    stack.itemId === "shield-module"
      ? total + stack.quantity * EXPEDITION_SHIELD_PER_MODULE
      : total
  ), 0) + EXPEDITION_GEAR_SLOTS.reduce((total, slot) => {
    const gearId = user.expedition.equippedGear[slot];
    return total + (gearId ? EXPEDITION_GEAR[gearId].bonusShield : 0);
  }, 0)) * (1 + user.expedition.skills.armor * 0.04));
  const playerHealth = clampInteger(value.playerHealth, 0, playerMaxHealth, playerMaxHealth);
  const playerShield = clampInteger(value.playerShield, 0, maximumShield, maximumShield);
  const rawPlayerPosition = value.playerPosition;
  const rawPlayerRotation = clampNumber(rawPlayerPosition?.rotation, -Math.PI * 2, Math.PI * 2, 0);
  const playerPosition: PersistedExpeditionRun["playerPosition"] = {
    x: clampNumber(rawPlayerPosition?.x, -170, 170, 0),
    y: clampNumber(rawPlayerPosition?.y, 0, 4, 0),
    z: clampNumber(rawPlayerPosition?.z, -330, 90, 68),
    rotation: Math.atan2(Math.sin(rawPlayerRotation), Math.cos(rawPlayerRotation)),
    vehicle: rawPlayerPosition?.vehicle === true
  };
  const storedDownedAt = Number(value.downedAt);
  const downedAt = playerHealth <= 0 && Number.isFinite(storedDownedAt) && storedDownedAt > 0
    ? Math.round(storedDownedAt)
    : null;
  const storedBleedOutAt = Number(value.bleedOutAt);
  const bleedOutAt = downedAt
    ? Number.isFinite(storedBleedOutAt) && storedBleedOutAt >= downedAt
      ? Math.round(storedBleedOutAt)
      : downedAt + EXPEDITION_DOWNED_BLEED_OUT_MS
    : null;

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : crypto.randomUUID(),
    startedAt: Number.isFinite(Number(value.startedAt)) && Number(value.startedAt) > 0
      ? Math.round(Number(value.startedAt))
      : Date.now(),
    selectedWeapon,
    playerPosition,
    backpack,
    lootedContainerIds,
    lootedEnemyIds,
    killedEnemyIds,
    carriedCoins: clampInteger(value.carriedCoins, 0, 999_999_999, 0),
    carriedWeaponIds,
    playerHealth,
    playerMaxHealth,
    playerShield,
    supportRobotUntil: Number.isFinite(Number(value.supportRobotUntil)) && Number(value.supportRobotUntil) > Date.now()
      ? Math.round(Number(value.supportRobotUntil))
      : null,
    scannerUntil: Number.isFinite(Number(value.scannerUntil)) && Number(value.scannerUntil) > Date.now()
      ? Math.round(Number(value.scannerUntil))
      : null,
    downedAt,
    bleedOutAt,
    enemyHealth,
    objective: {
      powerCells,
      hostileKills,
      requiredPowerCells: 1,
      requiredHostileKills: 2,
      complete: powerCells >= 1 && hostileKills >= 2
    },
    nextHitAt: clampInteger(value.nextHitAt, 0, Date.now() + 60_000, 0),
    enemyDeathPositions
  };
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(numericValue)));
}

export function readDb(): DbShape {
  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    writeDb(initialDb);
  }

  const db = JSON.parse(readFileSync(dbPath, "utf8")) as DbShape;
  if (normalizeDb(db)) {
    writeDb(db);
  }
  return db;
}

export function writeDb(db: DbShape) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const temporaryPath = `${dbPath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(db, null, 2));
  renameSync(temporaryPath, dbPath);
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, expeditionRun: _expeditionRun, ...safeUser } = user;
  return safeUser;
}

export function findUserByName(username: string) {
  const db = readDb();
  return db.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(minimum, Math.min(maximum, numericValue));
}
