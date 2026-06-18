import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { activities, catalog, starterItems } from "./data/catalog";
import { findUserByName, readDb, toPublicUser, writeDb } from "./db";
import type { ChatMessage, PlacedItem, User } from "./types";

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "animegame-dev-secret-change-me";
const fastify = Fastify({ logger: true });
const io = new Server(fastify.server, {
  cors: {
    origin: true,
    credentials: true
  }
});

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

function starterPlacedItems(): PlacedItem[] {
  return [
    { instanceId: crypto.randomUUID(), itemId: "kenney-beddouble", x: -2.8, y: 0, z: -2.5, rotation: 0 },
    { instanceId: crypto.randomUUID(), itemId: "kenney-desk", x: 2.4, y: 0, z: -2.6, rotation: Math.PI },
    { instanceId: crypto.randomUUID(), itemId: "kaykit-armchair", x: 2.4, y: 0, z: -1.7, rotation: 0 },
    { instanceId: crypto.randomUUID(), itemId: "kenney-rugrectangle", x: 0, y: 0.01, z: 0.4, rotation: 0 }
  ];
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

fastify.get("/api/catalog", async () => ({ catalog, activities }));

fastify.get("/api/players", async () => {
  const db = readDb();
  return { players: db.users.map((user) => ({ username: user.username, coins: user.coins })) };
});

fastify.get("/api/home/:username", async (request, reply) => {
  const params = request.params as { username: string };
  const user = findUserByName(params.username);
  if (!user) {
    return reply.code(404).send({ error: "Дом не найден" });
  }

  return {
    owner: user.username,
    avatar: user.avatar,
    placedItems: user.placedItems,
    inventory: user.inventory,
    chats: readDb().chats.filter((message) => message.homeOwner === user.username).slice(-50)
  };
});

fastify.post("/api/earn", async (request, reply) => {
  try {
    const user = requireUser(request);
    const body = request.body as { activityId?: string };
    const activity = activities.find((entry) => entry.id === body.activityId);
    if (!activity) {
      return reply.code(400).send({ error: "Нет такой работы" });
    }

    const db = readDb();
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
    const item = catalog.find((entry) => entry.id === body.itemId && entry.type !== "activity");
    if (!item) {
      return reply.code(400).send({ error: "Нет такого товара" });
    }

    const db = readDb();
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
      dbUser.avatar.outfit = item.id;
    }
    if (item.type === "pet") {
      dbUser.avatar.pet = item.id;
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
    const item = catalog.find((entry) => entry.id === body.itemId && ["furniture", "decor"].includes(entry.type));
    if (!item || !user.inventory.includes(item.id)) {
      return reply.code(400).send({ error: "Предмета нет в инвентаре" });
    }

    const placed: PlacedItem = {
      instanceId: crypto.randomUUID(),
      itemId: item.id,
      x: Number(body.x ?? 0),
      y: 0,
      z: Number(body.z ?? 0),
      rotation: Number(body.rotation ?? 0)
    };

    const db = readDb();
    const dbUser = db.users.find((entry) => entry.id === user.id)!;
    dbUser.placedItems.push(placed);
    writeDb(db);
    io.to(`home:${dbUser.username}`).emit("home:placed", placed);

    return { user: toPublicUser(dbUser), placed };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
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
    const room = `home:${homeOwner}`;
    socket.join(room);
    socket.data.homeOwner = homeOwner;
    socket.to(room).emit("player:joined", { username: socket.data.username });
  });

  socket.on("player:move", (position: { x: number; y: number; z: number; rotation?: number }) => {
    const room = `home:${socket.data.homeOwner}`;
    socket.to(room).emit("player:moved", {
      username: socket.data.username,
      position
    });
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

  socket.on("disconnect", () => {
    if (socket.data.homeOwner) {
      socket.to(`home:${socket.data.homeOwner}`).emit("player:left", { username: socket.data.username });
    }
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, () => {
  fastify.log.info(`AnimeGame API listening on http://localhost:${PORT}`);
});
