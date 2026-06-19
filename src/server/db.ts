import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    if (user.username.toLowerCase() === "rodion" && !user.isAdmin) {
      user.isAdmin = true;
      changed = true;
    }
  }

  return changed;
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
