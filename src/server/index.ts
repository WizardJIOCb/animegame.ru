import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import { activities as baseActivities, catalog as baseCatalog, starterItems } from "./data/catalog";
import { findUserByName, readDb, toPublicUser, writeDb } from "./db";
import type { Activity, CatalogItem, ChatMessage, DbShape, PlacedItem, User } from "./types";

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "animegame-dev-secret-change-me";
const fastify = Fastify({ logger: true });
const io = new Server(fastify.server, {
  cors: {
    origin: true,
    credentials: true
  }
});
const voiceRooms = new Map<string, Map<string, string>>();
type LivePlayer = {
  id: string;
  username: string;
  position: { x: number; y: number; z: number; rotation?: number };
  avatar?: User["avatar"];
};
const homePlayers = new Map<string, Map<string, LivePlayer>>();

type AuthedRequest = {
  headers: { authorization?: string };
};

type JwtPayload = {
  userId: string;
  username: string;
};

function signToken(user: User) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "14d" });
}

function requireUser(request: AuthedRequest) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    throw new Error("NO_TOKEN");
  }

  const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  const db = readDb();
  const user = db.users.find((entry) => entry.id === payload.userId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
}

function requireAdmin(request: AuthedRequest) {
  const user = requireUser(request);
  if (!user.isAdmin) {
    throw new Error("NOT_ADMIN");
  }
  return user;
}

function normalizeItemType(value: unknown, fallback: CatalogItem["type"]) {
  return ["furniture", "clothing", "pet", "decor", "outdoor", "character", "activity"].includes(String(value))
    ? value as CatalogItem["type"]
    : fallback;
}

function normalizeRarity(value: unknown, fallback: CatalogItem["rarity"]) {
  return ["common", "rare", "epic", "legendary"].includes(String(value))
    ? value as CatalogItem["rarity"]
    : fallback;
}

function normalizeColor(value: unknown, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? "")) ? String(value) : fallback;
}

function normalizeSize(value: unknown, fallback?: CatalogItem["size"]) {
  if (!Array.isArray(value) || value.length !== 3) {
    return fallback;
  }
  const next = value.map((entry) => Math.max(0.01, Math.min(20, Number(entry))));
  return next.every(Number.isFinite) ? next as [number, number, number] : fallback;
}

function sanitizeCatalogOverride(baseItem: CatalogItem, patch: Partial<CatalogItem>): CatalogItem {
  return {
    ...baseItem,
    ...patch,
    id: baseItem.id,
    type: normalizeItemType(patch.type, baseItem.type),
    name: String(patch.name ?? baseItem.name).trim().slice(0, 80) || baseItem.name,
    price: Math.max(0, Math.min(99999999, Math.round(Number(patch.price ?? baseItem.price) || 0))),
    rarity: normalizeRarity(patch.rarity, baseItem.rarity),
    color: normalizeColor(patch.color, baseItem.color),
    emoji: String(patch.emoji ?? baseItem.emoji).trim().slice(0, 16) || baseItem.emoji,
    size: normalizeSize(patch.size, baseItem.size),
    modelUrl: patch.modelUrl === "" ? undefined : patch.modelUrl ?? baseItem.modelUrl,
    modelScale: patch.modelScale === undefined ? baseItem.modelScale : Math.max(0.1, Math.min(10, Number(patch.modelScale) || 1)),
    clothingModelUrl: patch.clothingModelUrl === "" ? undefined : patch.clothingModelUrl ?? baseItem.clothingModelUrl,
    clothingModelScale: patch.clothingModelScale === undefined ? baseItem.clothingModelScale : Math.max(0.1, Math.min(10, Number(patch.clothingModelScale) || 1)),
    clothingPaintStyle: patch.clothingPaintStyle === "" ? undefined : patch.clothingPaintStyle ?? baseItem.clothingPaintStyle
  };
}

function getGameCatalog(db: DbShape = readDb()) {
  const overrides = db.content?.catalogItems ?? {};
  return baseCatalog.map((item) => sanitizeCatalogOverride(item, overrides[item.id] ?? {}));
}

function sanitizeActivityOverride(baseActivity: Activity, patch: Partial<Activity>): Activity {
  return {
    id: baseActivity.id,
    name: String(patch.name ?? baseActivity.name).trim().slice(0, 80) || baseActivity.name,
    reward: Math.max(0, Math.min(99999999, Math.round(Number(patch.reward ?? baseActivity.reward) || 0))),
    seconds: Math.max(1, Math.min(86400, Math.round(Number(patch.seconds ?? baseActivity.seconds) || 1)))
  };
}

function getGameActivities(db: DbShape = readDb()) {
  const overrides = db.content?.activities ?? {};
  return baseActivities.map((activity) => sanitizeActivityOverride(activity, overrides[activity.id] ?? {}));
}

function starterPlacedItems(): PlacedItem[] {
  return [
    { instanceId: crypto.randomUUID(), itemId: "kenney-beddouble", x: -2.8, y: 0, z: -2.5, rotation: 0 },
    { instanceId: crypto.randomUUID(), itemId: "kenney-desk", x: 2.4, y: 0, z: -2.6, rotation: Math.PI },
    { instanceId: crypto.randomUUID(), itemId: "kaykit-armchair", x: 2.4, y: 0, z: -1.7, rotation: 0 },
    { instanceId: crypto.randomUUID(), itemId: "kenney-rugrectangle", x: 0, y: 0.01, z: 0.4, rotation: 0 }
  ];
}

const legacyPlacedItemMap: Record<string, string> = {
  "bed-cloud": "kenney-beddouble",
  "bed-neon": "kaykit-bed-double-b",
  "sofa-mochi": "kaykit-couch-pillows",
  "sofa-starlight": "kenney-loungedesignsofa",
  "desk-streamer": "kenney-desk",
  "pc-rgb": "kenney-computerscreen",
  "fridge-mini": "kenney-kitchenfridgesmall",
  "kitchen-cute": "kenney-kitchencabinet",
  "bath-round": "kenney-bathtub",
  "wardrobe-glass": "kenney-cabinetbed",
  "mirror-heart": "kenney-bathroommirror",
  "table-boba": "kaykit-table-medium",
  "chair-cat": "kaykit-armchair",
  "chair-royal": "kenney-loungechairrelax",
  "arcade-pixel": "kenney-computerscreen",
  "piano-dream": "kenney-tablecross",
  "plant-luna": "kenney-pottedplant",
  "lamp-orbit": "kaykit-lamp-standing",
  "rug-sakura": "kenney-rugrectangle",
  "shelf-figure": "kaykit-shelf-b-large-decorated"
};

function upgradedItemId(itemId: string) {
  return legacyPlacedItemMap[itemId] ?? itemId;
}

function clampPlacedScale(value: unknown) {
  const numberValue = Number(value ?? 1);
  const finiteValue = Number.isFinite(numberValue) ? numberValue : 1;
  return Math.max(0.5, Math.min(2.5, Number(finiteValue.toFixed(2))));
}

function upgradeLegacyPlacedItems(user: User, activeCatalog: CatalogItem[]) {
  let changed = false;
  for (const placed of user.placedItems) {
    const nextItemId = upgradedItemId(placed.itemId);
    if (nextItemId !== placed.itemId && activeCatalog.some((item) => item.id === nextItemId)) {
      placed.itemId = nextItemId;
      changed = true;
    }
  }
  return changed;
}

function getPlacedItemValue(itemId: string, activeCatalog: CatalogItem[]) {
  const item = activeCatalog.find((entry) => entry.id === itemId);
  return item ? Math.floor(item.price * 0.7) : 0;
}

function clampHomeCoordinate(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Math.max(-7.6, Math.min(7.6, Number.isFinite(numberValue) ? numberValue : 0));
}

function getPublicAvatar(username: string) {
  const user = findUserByName(username);
  return user?.avatar;
}

function defaultPlayerPosition() {
  return { x: 0, y: 0, z: 1.2, rotation: 0 };
}

function leaveHomePresence(socket: Socket) {
  const homeOwner = socket.data.homeOwner as string | undefined;
  if (!homeOwner) {
    return;
  }

  const players = homePlayers.get(homeOwner);
  if (players?.delete(socket.id)) {
    const sameUserStillPresent = [...players.values()].some((player) => player.username === socket.data.username);
    if (players.size === 0) {
      homePlayers.delete(homeOwner);
    }
    if (!sameUserStillPresent) {
      socket.to(`home:${homeOwner}`).emit("player:left", { id: socket.id, username: socket.data.username });
    }
  }
}

function leaveVoiceRoom(socket: Socket) {
  const homeOwner = socket.data.voiceHomeOwner as string | undefined;
  if (!homeOwner) {
    return;
  }

  const roomUsers = voiceRooms.get(homeOwner);
  if (!roomUsers) {
    socket.data.voiceHomeOwner = undefined;
    return;
  }

  if (roomUsers.get(socket.id) === socket.data.username) {
    roomUsers.delete(socket.id);
    if (roomUsers.size === 0) {
      voiceRooms.delete(homeOwner);
    }
    socket.to(`home:${homeOwner}`).emit("voice:userLeft", { id: socket.id, username: socket.data.username });
  }
  socket.data.voiceHomeOwner = undefined;
}

await fastify.register(cors, {
  origin: true,
  credentials: true
});

fastify.get("/api/health", async () => ({ ok: true }));

fastify.post("/api/auth/register", async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password ?? "";

  if (!username || username.length < 3 || !/^[a-zA-Z0-9_а-яА-Я-]+$/.test(username)) {
    return reply.code(400).send({ error: "Имя: минимум 3 символа, буквы/цифры/_/-" });
  }

  if (password.length < 6) {
    return reply.code(400).send({ error: "Пароль должен быть минимум 6 символов" });
  }

  const db = readDb();
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return reply.code(409).send({ error: "Такой ник уже занят" });
  }

  const user: User = {
    id: crypto.randomUUID(),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    coins: 1200,
    inventory: [...starterItems],
    placedItems: starterPlacedItems(),
    avatar: {
      character: "quaternius-superhero-female",
      outfit: "hoodie-pink",
      hair: "hair-rose"
    },
    homeStyle: {
      floorColor: "#9b6a3c",
      wallColor: "#d8d1c3"
    },
    createdAt: Date.now()
  };

  db.users.push(user);
  writeDb(db);

  return { token: signToken(user), user: toPublicUser(user) };
});

fastify.post("/api/auth/login", async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const user = findUserByName(body.username?.trim() ?? "");

  if (!user || !(await bcrypt.compare(body.password ?? "", user.passwordHash))) {
    return reply.code(401).send({ error: "Неверный логин или пароль" });
  }

  return { token: signToken(user), user: toPublicUser(user) };
});

fastify.get("/api/me", async (request, reply) => {
  try {
    return { user: toPublicUser(requireUser(request)) };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.get("/api/catalog", async () => {
  const db = readDb();
  return { catalog: getGameCatalog(db), activities: getGameActivities(db) };
});

fastify.get("/api/players", async () => {
  const db = readDb();
  return { players: db.users.map((user) => ({ username: user.username, coins: user.coins })) };
});

fastify.get("/api/home/:username", async (request, reply) => {
  const params = request.params as { username: string };
  const db = readDb();
  const user = db.users.find((entry) => entry.username.toLowerCase() === params.username.toLowerCase());
  if (!user) {
    return reply.code(404).send({ error: "Дом не найден" });
  }

  const activeCatalog = getGameCatalog(db);
  if (upgradeLegacyPlacedItems(user, activeCatalog)) {
    writeDb(db);
  }

  return {
    owner: user.username,
    avatar: user.avatar,
    homeStyle: user.homeStyle ?? { floorColor: "#9b6a3c", wallColor: "#d8d1c3" },
    placedItems: user.placedItems,
    inventory: user.inventory,
    chats: db.chats.filter((message) => message.homeOwner === user.username).slice(-50)
  };
});

fastify.post("/api/home/style", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { floorColor?: string; wallColor?: string };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    dbUser.homeStyle = {
      floorColor: /^#[0-9a-fA-F]{6}$/.test(body.floorColor ?? "") ? body.floorColor! : dbUser.homeStyle?.floorColor ?? "#9b6a3c",
      wallColor: /^#[0-9a-fA-F]{6}$/.test(body.wallColor ?? "") ? body.wallColor! : dbUser.homeStyle?.wallColor ?? "#d8d1c3"
    };
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:styleUpdated", dbUser.homeStyle);
    return { user: toPublicUser(dbUser), homeStyle: dbUser.homeStyle };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/earn", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { activityId?: string };
    const db = readDb();
    const activity = getGameActivities(db).find((entry) => entry.id === body.activityId);
    if (!activity) {
      return reply.code(400).send({ error: "Нет такой работы" });
    }

    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    dbUser.coins += activity.reward;
    writeDb(db);
    return { user: toPublicUser(dbUser), activity };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/buy", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { itemId?: string };
    const db = readDb();
    const item = getGameCatalog(db).find((entry) => entry.id === body.itemId && entry.type !== "activity");
    if (!item) {
      return reply.code(400).send({ error: "Нет такого товара" });
    }

    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const alreadyOwned = dbUser.inventory.includes(item.id);
    const equipOnly = alreadyOwned && ["character", "clothing", "pet"].includes(item.type);

    if (!equipOnly && dbUser.coins < item.price) {
      return reply.code(400).send({ error: "Не хватает монет" });
    }

    if (!alreadyOwned) {
      dbUser.coins -= item.price;
      dbUser.inventory.push(item.id);
    }
    if (item.type === "character") {
      dbUser.avatar.character = item.id;
    }
    if (item.type === "clothing") {
      if (alreadyOwned && dbUser.avatar.outfit === item.id) {
        delete dbUser.avatar.outfit;
      } else {
        dbUser.avatar.outfit = item.id;
      }
    }
    if (item.type === "pet") {
      if (alreadyOwned && dbUser.avatar.pet === item.id) {
        delete dbUser.avatar.pet;
      } else {
        dbUser.avatar.pet = item.id;
      }
    }
    writeDb(db);

    return { user: toPublicUser(dbUser), item };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/place", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { itemId?: string; x?: number; z?: number; rotation?: number };
    const db = readDb();
    const item = getGameCatalog(db).find((entry) => entry.id === body.itemId && ["furniture", "decor", "outdoor"].includes(entry.type));
    if (!item || !user.inventory.includes(item.id)) {
      return reply.code(400).send({ error: "Предмета нет в инвентаре" });
    }

    const placed: PlacedItem = {
      instanceId: crypto.randomUUID(),
      itemId: upgradedItemId(item.id),
      x: clampHomeCoordinate(body.x),
      y: 0,
      z: clampHomeCoordinate(body.z),
      rotation: Number(body.rotation ?? 0),
      scale: 1
    };

    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const inventoryIndex = dbUser.inventory.indexOf(item.id);
    if (inventoryIndex === -1) {
      return reply.code(400).send({ error: "Предмета нет в инвентаре" });
    }

    dbUser.inventory.splice(inventoryIndex, 1);
    dbUser.placedItems.push(placed);
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:placed", placed);

    return { user: toPublicUser(dbUser), placed };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/placed/move", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { instanceId?: string; x?: number; z?: number };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const placed = dbUser.placedItems.find((entry) => entry.instanceId === body.instanceId);
    if (!placed) {
      return reply.code(404).send({ error: "Предмет не найден" });
    }

    placed.x = clampHomeCoordinate(body.x);
    placed.z = clampHomeCoordinate(body.z);
    placed.y = 0;
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:itemUpdated", placed);

    return { user: toPublicUser(dbUser), placed };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/placed/rotate", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { instanceId?: string; rotation?: number };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const placed = dbUser.placedItems.find((entry) => entry.instanceId === body.instanceId);
    if (!placed) {
      return reply.code(404).send({ error: "Предмет не найден" });
    }

    placed.rotation = Number(body.rotation ?? placed.rotation);
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:itemUpdated", placed);

    return { user: toPublicUser(dbUser), placed };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/placed/scale", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { instanceId?: string; scale?: number };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const placed = dbUser.placedItems.find((entry) => entry.instanceId === body.instanceId);
    if (!placed) {
      return reply.code(404).send({ error: "РџСЂРµРґРјРµС‚ РЅРµ РЅР°Р№РґРµРЅ" });
    }

    placed.scale = clampPlacedScale(body.scale);
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:itemUpdated", placed);

    return { user: toPublicUser(dbUser), placed };
  } catch {
    return reply.code(401).send({ error: "РќСѓР¶РЅРѕ РІРѕР№С‚Рё" });
  }
});

fastify.post("/api/placed/sell", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { instanceId?: string };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    const placedIndex = dbUser.placedItems.findIndex((entry) => entry.instanceId === body.instanceId);
    if (placedIndex === -1) {
      return reply.code(404).send({ error: "Предмет не найден" });
    }

    const [placed] = dbUser.placedItems.splice(placedIndex, 1);
    const refund = getPlacedItemValue(placed.itemId, getGameCatalog(db));
    dbUser.coins += refund;
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:itemSold", { instanceId: placed.instanceId, refund });

    return { user: toPublicUser(dbUser), placed, refund };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.get("/api/admin/overview", async (request, reply) => {
  try {
    requireAdmin(request);
    const db = readDb();
    return {
      users: db.users.map((entry) => ({
        id: entry.id,
        username: entry.username,
        coins: entry.coins,
        isAdmin: Boolean(entry.isAdmin),
        inventoryCount: entry.inventory.length,
        placedCount: entry.placedItems.length,
        createdAt: entry.createdAt,
        avatar: entry.avatar
      })),
      catalog: getGameCatalog(db),
      activities: getGameActivities(db),
      stats: {
        users: db.users.length,
        chats: db.chats.length,
        catalogItems: baseCatalog.length,
        activities: baseActivities.length
      }
    };
  } catch {
    return reply.code(403).send({ error: "Admin only" });
  }
});

fastify.patch("/api/admin/users/:id", async (request, reply) => {
  try {
    requireAdmin(request);
    const params = request.params as { id: string };
    const body = request.body as { coins?: number; isAdmin?: boolean; inventory?: string[] };
    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === params.id);
    if (!dbUser) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (body.coins !== undefined) {
      dbUser.coins = Math.max(0, Math.min(999999999, Math.round(Number(body.coins) || 0)));
    }
    if (body.isAdmin !== undefined) {
      dbUser.isAdmin = dbUser.username.toLowerCase() === "rodion" ? true : Boolean(body.isAdmin);
    }
    if (Array.isArray(body.inventory)) {
      const validIds = new Set(getGameCatalog(db).map((item) => item.id));
      dbUser.inventory = body.inventory.map(String).filter((id) => validIds.has(id)).slice(0, 1000);
    }

    writeDb(db);
    return { user: toPublicUser(dbUser) };
  } catch {
    return reply.code(403).send({ error: "Admin only" });
  }
});

fastify.patch("/api/admin/catalog/:id", async (request, reply) => {
  try {
    requireAdmin(request);
    const params = request.params as { id: string };
    const body = request.body as Partial<CatalogItem>;
    const baseItem = baseCatalog.find((item) => item.id === params.id);
    if (!baseItem) {
      return reply.code(404).send({ error: "Item not found" });
    }

    const db = readDb();
    db.content ??= {};
    db.content.catalogItems ??= {};
    db.content.catalogItems[baseItem.id] = sanitizeCatalogOverride(baseItem, body);
    writeDb(db);

    const item = getGameCatalog(db).find((entry) => entry.id === baseItem.id)!;
    return { item, catalog: getGameCatalog(db) };
  } catch {
    return reply.code(403).send({ error: "Admin only" });
  }
});

fastify.patch("/api/admin/activities/:id", async (request, reply) => {
  try {
    requireAdmin(request);
    const params = request.params as { id: string };
    const body = request.body as Partial<Activity>;
    const baseActivity = baseActivities.find((activity) => activity.id === params.id);
    if (!baseActivity) {
      return reply.code(404).send({ error: "Activity not found" });
    }

    const db = readDb();
    db.content ??= {};
    db.content.activities ??= {};
    db.content.activities[baseActivity.id] = sanitizeActivityOverride(baseActivity, body);
    writeDb(db);

    const activity = getGameActivities(db).find((entry) => entry.id === baseActivity.id)!;
    return { activity, activities: getGameActivities(db) };
  } catch {
    return reply.code(403).send({ error: "Admin only" });
  }
});

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token ?? "");
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    socket.data.userId = payload.userId;
    socket.data.username = payload.username;
    next();
  } catch {
    next(new Error("Нужно войти"));
  }
});

io.on("connection", (socket) => {
  socket.on("home:join", (homeOwner: string) => {
    const previousHomeOwner = socket.data.homeOwner as string | undefined;
    if (previousHomeOwner && previousHomeOwner !== homeOwner) {
      leaveVoiceRoom(socket);
      leaveHomePresence(socket);
      socket.leave(`home:${previousHomeOwner}`);
    }

    const room = `home:${homeOwner}`;
    socket.join(room);
    socket.data.homeOwner = homeOwner;

    const players = homePlayers.get(homeOwner) ?? new Map<string, LivePlayer>();
    players.delete(socket.id);
    const currentPlayer: LivePlayer = {
      id: socket.id,
      username: socket.data.username,
      position: defaultPlayerPosition(),
      avatar: getPublicAvatar(socket.data.username)
    };
    socket.emit("player:present", { players: [...players.values()] });
    players.set(socket.id, currentPlayer);
    homePlayers.set(homeOwner, players);
    socket.to(room).emit("player:joined", currentPlayer);
  });

  socket.on("player:move", (position: { x: number; y: number; z: number; rotation?: number }) => {
    const homeOwner = String(socket.data.homeOwner ?? socket.data.username);
    const room = `home:${homeOwner}`;
    const player: LivePlayer = {
      id: socket.id,
      username: socket.data.username,
      position,
      avatar: getPublicAvatar(socket.data.username)
    };
    const players = homePlayers.get(homeOwner) ?? new Map<string, LivePlayer>();
    players.set(socket.id, player);
    homePlayers.set(homeOwner, players);
    socket.to(room).emit("player:moved", player);
  });

  socket.on("chat:send", (text: string) => {
    const cleanText = String(text).trim().slice(0, 300);
    const homeOwner = String(socket.data.homeOwner ?? socket.data.username);
    if (!cleanText) {
      return;
    }

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      homeOwner,
      from: socket.data.username,
      text: cleanText,
      createdAt: Date.now()
    };
    const db = readDb();
    db.chats.push(message);
    db.chats = db.chats.slice(-500);
    writeDb(db);
    io.to(`home:${homeOwner}`).emit("chat:message", message);
  });

  socket.on("world:interact", (payload: { itemId?: string; action?: string }) => {
    const room = `home:${socket.data.homeOwner}`;
    socket.to(room).emit("world:interaction", {
      username: socket.data.username,
      itemId: payload.itemId,
      action: payload.action ?? "interact",
      createdAt: Date.now()
    });
  });

  socket.on("voice:join", () => {
    const homeOwner = String(socket.data.homeOwner ?? socket.data.username);
    leaveVoiceRoom(socket);
    const roomUsers = voiceRooms.get(homeOwner) ?? new Map<string, string>();
    const users = [...roomUsers.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, username]) => ({ id, username }));
    roomUsers.set(socket.id, socket.data.username);
    voiceRooms.set(homeOwner, roomUsers);
    socket.data.voiceHomeOwner = homeOwner;
    socket.emit("voice:users", { users });
    socket.to(`home:${homeOwner}`).emit("voice:userJoined", { id: socket.id, username: socket.data.username });
  });

  socket.on("voice:leave", () => {
    leaveVoiceRoom(socket);
  });

  socket.on("voice:signal", (payload: { to?: string; signal?: unknown }) => {
    const homeOwner = socket.data.voiceHomeOwner as string | undefined;
    const targetSocketId = String(payload.to ?? "");
    if (!homeOwner || !targetSocketId || !payload.signal) {
      return;
    }

    if (!voiceRooms.get(homeOwner)?.has(targetSocketId)) {
      return;
    }

    io.to(targetSocketId).emit("voice:signal", {
      from: { id: socket.id, username: socket.data.username },
      signal: payload.signal
    });
  });

  socket.on("disconnect", () => {
    leaveVoiceRoom(socket);
    leaveHomePresence(socket);
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, () => {
  fastify.log.info(`AnimeGame API listening on http://localhost:${PORT}`);
});
