import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createDefaultExpeditionProfile,
  EXPEDITION_ITEM_IDS,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_WEAPON_IDS,
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
import type { DbShape, PublicUser, User } from "./types";

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

    if (user.username.toLowerCase() === "rodion" && !user.isAdmin) {
      user.isAdmin = true;
      changed = true;
    }
  }

  return changed;
}

const expeditionItemIds = new Set<string>(EXPEDITION_ITEM_IDS);
const expeditionWeaponIds = new Set<string>(EXPEDITION_WEAPON_IDS);

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

  return {
    stash: normalizeItemStacks(value?.stash, defaults.stash),
    unlockedWeapons,
    selectedWeapon,
    skillPoints: clampInteger(value?.skillPoints, 0, 9_999, defaults.skillPoints),
    skills: Object.fromEntries(EXPEDITION_SKILL_IDS.map((skillId) => [
      skillId,
      clampInteger(value?.skills?.[skillId], 0, EXPEDITION_SKILLS[skillId].maxLevel, defaults.skills[skillId])
    ])) as ExpeditionProfile["skills"],
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
