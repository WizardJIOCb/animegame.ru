import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

    if (user.username.toLowerCase() === "rodion" && !user.isAdmin) {
      user.isAdmin = true;
      changed = true;
    }
  }

  return changed;
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
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function findUserByName(username: string) {
  const db = readDb();
  return db.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
}
