import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DbShape, PublicUser, User } from "./types";

const dbPath = resolve(process.cwd(), "data", "db.json");

const initialDb: DbShape = {
  users: [],
  chats: []
};

export function readDb(): DbShape {
  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    writeDb(initialDb);
  }

  return JSON.parse(readFileSync(dbPath, "utf8")) as DbShape;
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

