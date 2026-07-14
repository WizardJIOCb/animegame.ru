import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import {
  createDefaultExpeditionProfile,
  EXPEDITION_AMMO_PACK,
  EXPEDITION_CONTAINERS,
  EXPEDITION_CONTAINER_IDS,
  EXPEDITION_ENEMIES,
  EXPEDITION_ENEMY_IDS,
  EXPEDITION_EXTRACT_REWARD,
  EXPEDITION_HIT_MULTIPLIERS,
  EXPEDITION_HIT_ZONES,
  EXPEDITION_QUEST_ID,
  EXPEDITION_RECIPES,
  EXPEDITION_RECIPE_IDS,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_START_AMMO,
  EXPEDITION_WEAPONS,
  EXPEDITION_WEAPON_IDS,
  type ExpeditionContainerId,
  type ExpeditionEnemyId,
  type ExpeditionHitInput,
  type ExpeditionHitZone,
  type ExpeditionRecipeId,
  type ExpeditionRunSnapshot,
  type ExpeditionSkillId,
  type ExpeditionWeaponId,
  type ItemStack,
  type PartyInvite,
  type PartyInvitesSnapshot,
  type PartySnapshot
} from "../shared/expedition";
import { activities as baseActivities, catalog as baseCatalog, starterItems } from "./data/catalog";
import {
  activityXp,
  calculateHomeValue,
  calculatePendingIncome,
  careerRequiredLevel,
  careerUpgradeCost,
  createDefaultProgress,
  grantXp,
  houseRequiredLevel,
  houseUpgradeCost,
  incomePerHourForCareer,
  makeNeighborhoodResidents,
  makeNpcHome,
  makeProgressView,
  MAX_CAREER_LEVEL,
  MAX_HOUSE_LEVEL
} from "./data/neighborhood";
import { findUserByName, readDb, toPublicUser, writeDb } from "./db";
import type { Activity, CatalogItem, ChatMessage, DbShape, NeighborhoodResident, PlacedItem, User } from "./types";

const PORT = Number(process.env.PORT ?? 4000);
const configuredJwtSecret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && (!configuredJwtSecret || configuredJwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}
const JWT_SECRET = configuredJwtSecret ?? "animegame-dev-secret-change-me";
const fastify = Fastify({ logger: true });
const io = new Server(fastify.server, {
  cors: {
    origin: true,
    credentials: true
  }
});
const voiceRooms = new Map<string, Map<string, string>>();
const NEIGHBORHOOD_ROOM = "neighborhood:street";
const HOME_WATCH_ROOM_PREFIX = "home:watch:";

function homeWatchRoom(homeOwner: string) {
  return `${HOME_WATCH_ROOM_PREFIX}${homeOwner}`;
}

function emitHomeEvent(event: string, homeOwner: string, payload: unknown) {
  io.to(`home:${homeOwner}`).to(homeWatchRoom(homeOwner)).emit(event, payload);
}

function homeSnapshotPayload(resident: NeighborhoodResident) {
  return {
    owner: resident.username,
    homeStyle: resident.homeStyle,
    placedItems: resident.placedItems,
    homeValue: resident.homeValue,
    houseLevel: resident.houseLevel,
    level: resident.level,
    careerLevel: resident.careerLevel,
    incomePerHour: resident.incomePerHour,
    colors: resident.colors,
    avatar: resident.avatar
  };
}
type LivePlayer = {
  id: string;
  username: string;
  position: { x: number; y: number; z: number; rotation?: number; vehicle?: boolean };
  avatar?: User["avatar"];
};
const homePlayers = new Map<string, Map<string, LivePlayer>>();
const neighborhoodPlayers = new Map<string, LivePlayer>();
const lastNeighborhoodPositions = new Map<string, LivePlayer["position"]>();
const neighborhoodMovementStates = new Map<string, { lastAt: number; budget: number; needsInitialCitySync: boolean }>();

type ActiveExpeditionRun = ExpeditionRunSnapshot & {
  userId: string;
  containerLoot: Record<ExpeditionContainerId, ItemStack[]>;
  nextHitAt: number;
};

type InternalPartyMember = {
  userId: string;
  username: string;
  joinedAt: number;
};

type InternalParty = {
  id: string;
  leaderUserId: string;
  members: InternalPartyMember[];
};

const activeExpeditionRuns = new Map<string, ActiveExpeditionRun>();
const parties = new Map<string, InternalParty>();
const partyIdByUserId = new Map<string, string>();
const partyInvites = new Map<string, PartyInvite>();
const partyDisconnectTimers = new Map<string, NodeJS.Timeout>();
const PARTY_MAX_SIZE = 4 as const;
const PARTY_INVITE_LIFETIME_MS = 120_000;
const PARTY_RECONNECT_GRACE_MS = 45_000;
const NEIGHBORHOOD_MAX_SPEED = 14;
const NEIGHBORHOOD_MOVE_BUDGET_CAPACITY = 3.5;
const NEIGHBORHOOD_INITIAL_MOVE_BUDGET = 0.75;
const NEIGHBORHOOD_MIN_MOVE_INTERVAL_MS = 12;
const INITIAL_CITY_SYNC_MIN_X = -95;
const INITIAL_CITY_SYNC_MAX_X = 95;
const INITIAL_CITY_SYNC_MIN_Z = -80;
const INITIAL_CITY_SYNC_MAX_Z = 95;

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

function defaultNeighborhoodPosition() {
  return { x: 0, y: 0, z: 68, rotation: Math.PI };
}

function finiteNumber(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeRotation(value: unknown, fallback = 0) {
  const rotation = finiteNumber(value, fallback);
  return Math.atan2(Math.sin(rotation), Math.cos(rotation));
}

function sanitizeNeighborhoodPosition(position: unknown) {
  const candidate = position && typeof position === "object"
    ? position as { x?: unknown; y?: unknown; z?: unknown; rotation?: unknown; vehicle?: unknown }
    : {};
  return {
    x: Math.max(-170, Math.min(170, finiteNumber(candidate.x, 0))),
    y: Math.max(0, Math.min(4, finiteNumber(candidate.y, 0))),
    z: Math.max(-330, Math.min(90, finiteNumber(candidate.z, 68))),
    rotation: normalizeRotation(candidate.rotation),
    vehicle: candidate.vehicle === true
  };
}

function sanitizeHomePosition(position: unknown) {
  const candidate = position && typeof position === "object"
    ? position as { x?: unknown; y?: unknown; z?: unknown; rotation?: unknown }
    : {};
  return {
    x: Math.max(-7.6, Math.min(7.6, finiteNumber(candidate.x, 0))),
    y: Math.max(0, Math.min(4, finiteNumber(candidate.y, 0))),
    z: Math.max(-7.6, Math.min(7.6, finiteNumber(candidate.z, 1.2))),
    rotation: normalizeRotation(candidate.rotation)
  };
}

function creditPendingIncome(user: User, now = Date.now()) {
  const pending = calculatePendingIncome(user.progress, now);
  if (pending <= 0) {
    return 0;
  }

  const previousCoins = user.coins;
  user.coins = Math.min(999_999_999, user.coins + pending);
  user.progress.lastIncomeClaimAt = now;
  return user.coins - previousCoins;
}

function leaveNeighborhoodPresence(socket: Socket) {
  if (!socket.data.inNeighborhood) {
    return;
  }

  const previousPlayer = neighborhoodPlayers.get(socket.id);
  neighborhoodPlayers.delete(socket.id);
  socket.data.inNeighborhood = false;
  socket.leave(NEIGHBORHOOD_ROOM);

  if (previousPlayer) {
    const sameUserStillPresent = [...neighborhoodPlayers.values()]
      .some((player) => player.username === previousPlayer.username);
    if (!sameUserStillPresent) {
      socket.to(NEIGHBORHOOD_ROOM).emit("player:left", {
        id: socket.id,
        username: previousPlayer.username
      });
    }
  }
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
    socket.to(`home:${homeOwner}`).to(homeWatchRoom(homeOwner)).emit("voice:userLeft", { id: socket.id, username: socket.data.username });
  }
  socket.data.voiceHomeOwner = undefined;
}

const expeditionWeaponIds = new Set<string>(EXPEDITION_WEAPON_IDS);
const expeditionRecipeIds = new Set<string>(EXPEDITION_RECIPE_IDS);
const expeditionSkillIds = new Set<string>(EXPEDITION_SKILL_IDS);
const expeditionContainerIds = new Set<string>(EXPEDITION_CONTAINER_IDS);
const expeditionEnemyIds = new Set<string>(EXPEDITION_ENEMY_IDS);
const expeditionHitZones = new Set<string>(EXPEDITION_HIT_ZONES);

function cloneItemStacks(stacks: ItemStack[]) {
  return stacks.map((stack) => ({ ...stack }));
}

function itemStackQuantity(stacks: ItemStack[], itemId: ItemStack["itemId"]) {
  return stacks.reduce((total, stack) => stack.itemId === itemId ? total + stack.quantity : total, 0);
}

function mergeItemStacks(target: ItemStack[], incoming: ItemStack[]) {
  for (const item of incoming) {
    const existing = target.find((stack) => stack.itemId === item.itemId);
    if (existing) {
      existing.quantity = Math.min(999_999, existing.quantity + item.quantity);
    } else {
      target.push({ ...item });
    }
  }
}

function deductItemStacks(stash: ItemStack[], ingredients: ItemStack[]) {
  const required = new Map<ItemStack["itemId"], number>();
  for (const ingredient of ingredients) {
    required.set(ingredient.itemId, (required.get(ingredient.itemId) ?? 0) + ingredient.quantity);
  }

  for (const [itemId, quantity] of required) {
    const available = stash
      .filter((stack) => stack.itemId === itemId)
      .reduce((total, stack) => total + stack.quantity, 0);
    if (available < quantity) {
      return null;
    }
  }

  const nextStash = cloneItemStacks(stash);
  for (const [itemId, quantity] of required) {
    let remaining = quantity;
    for (const stack of nextStash) {
      if (stack.itemId !== itemId || remaining <= 0) {
        continue;
      }
      const spent = Math.min(stack.quantity, remaining);
      stack.quantity -= spent;
      remaining -= spent;
    }
  }
  return nextStash.filter((stack) => stack.quantity > 0);
}

function makeRunObjective(run: Pick<ActiveExpeditionRun, "backpack" | "killedEnemyIds">) {
  const powerCells = run.backpack
    .filter((stack) => stack.itemId === "power-cell")
    .reduce((total, stack) => total + stack.quantity, 0);
  const hostileKills = run.killedEnemyIds.filter((enemyId) => EXPEDITION_ENEMIES[enemyId].hostile).length;
  return {
    powerCells,
    hostileKills,
    requiredPowerCells: 1,
    requiredHostileKills: 2,
    complete: powerCells >= 1 && hostileKills >= 2
  };
}

function makeEnemyHealth(
  stored?: Partial<Record<ExpeditionEnemyId, number>>,
  killedEnemyIds: readonly ExpeditionEnemyId[] = []
) {
  return Object.fromEntries(EXPEDITION_ENEMY_IDS.map((enemyId) => {
    const maximum = EXPEDITION_ENEMIES[enemyId].maxHealth;
    if (killedEnemyIds.includes(enemyId)) return [enemyId, 0];
    const candidate = Number(stored?.[enemyId]);
    return [enemyId, Number.isFinite(candidate) ? Math.max(0, Math.min(maximum, candidate)) : maximum];
  })) as Record<ExpeditionEnemyId, number>;
}

function makeRunSnapshot(run: ActiveExpeditionRun): ExpeditionRunSnapshot {
  return {
    id: run.id,
    startedAt: run.startedAt,
    selectedWeapon: run.selectedWeapon,
    backpack: cloneItemStacks(run.backpack),
    lootedContainerIds: [...run.lootedContainerIds],
    killedEnemyIds: [...run.killedEnemyIds],
    enemyHealth: { ...run.enemyHealth },
    objective: makeRunObjective(run)
  };
}

function makeContainerLoot() {
  return Object.fromEntries(EXPEDITION_CONTAINER_IDS.map((containerId) => [
    containerId,
    cloneItemStacks(EXPEDITION_CONTAINERS[containerId].loot)
  ])) as Record<ExpeditionContainerId, ItemStack[]>;
}

function createActiveExpeditionRun(user: User): ActiveExpeditionRun {
  const ammoToPack = Math.min(
    EXPEDITION_START_AMMO[user.expedition.selectedWeapon],
    itemStackQuantity(user.expedition.stash, "ammo")
  );
  const nextStash = deductItemStacks(user.expedition.stash, [{ itemId: "ammo", quantity: ammoToPack }]);
  if (nextStash) user.expedition.stash = nextStash;
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    startedAt: Date.now(),
    selectedWeapon: user.expedition.selectedWeapon,
    backpack: ammoToPack > 0 ? [{ itemId: "ammo", quantity: ammoToPack }] : [],
    lootedContainerIds: [],
    killedEnemyIds: [],
    enemyHealth: makeEnemyHealth(),
    objective: {
      powerCells: 0,
      hostileKills: 0,
      requiredPowerCells: 1,
      requiredHostileKills: 2,
      complete: false
    },
    containerLoot: makeContainerLoot(),
    nextHitAt: 0
  };
}

function activeRunForUser(user: User) {
  const active = activeExpeditionRuns.get(user.id);
  if (active) return active;
  if (!user.expeditionRun) return undefined;
  const storedRun = user.expeditionRun as Partial<NonNullable<User["expeditionRun"]>>;
  const lootedContainerIds = Array.isArray(storedRun.lootedContainerIds)
    ? [...new Set(storedRun.lootedContainerIds.filter((id): id is ExpeditionContainerId => expeditionContainerIds.has(String(id))))]
    : [];
  const killedEnemyIds = Array.isArray(storedRun.killedEnemyIds)
    ? [...new Set(storedRun.killedEnemyIds.filter((id): id is ExpeditionEnemyId => expeditionEnemyIds.has(String(id))))]
    : [];
  const restored: ActiveExpeditionRun = {
    id: typeof storedRun.id === "string" && storedRun.id ? storedRun.id : crypto.randomUUID(),
    startedAt: Number.isFinite(Number(storedRun.startedAt)) ? Number(storedRun.startedAt) : Date.now(),
    selectedWeapon: expeditionWeaponIds.has(String(storedRun.selectedWeapon))
      ? storedRun.selectedWeapon as ExpeditionWeaponId
      : user.expedition.selectedWeapon,
    userId: user.id,
    backpack: Array.isArray(storedRun.backpack) ? cloneItemStacks(storedRun.backpack) : [],
    lootedContainerIds,
    killedEnemyIds,
    enemyHealth: makeEnemyHealth(storedRun.enemyHealth, killedEnemyIds),
    objective: {
      powerCells: 0,
      hostileKills: 0,
      requiredPowerCells: 1,
      requiredHostileKills: 2,
      complete: false
    },
    containerLoot: makeContainerLoot(),
    nextHitAt: Number.isFinite(Number(storedRun.nextHitAt)) ? Math.max(0, Number(storedRun.nextHitAt)) : 0
  };
  activeExpeditionRuns.set(user.id, restored);
  return restored;
}

function persistActiveRun(user: User, run: ActiveExpeditionRun) {
  user.expeditionRun = { ...makeRunSnapshot(run), nextHitAt: run.nextHitAt };
}

function liveNeighborhoodPosition(userId: string) {
  const hasLiveNeighborhoodSocket = [...io.sockets.sockets.values()].some((socket) => (
    socket.connected
    && String(socket.data.userId) === userId
    && neighborhoodPlayers.has(socket.id)
  ));
  return hasLiveNeighborhoodSocket ? lastNeighborhoodPositions.get(userId) : undefined;
}

function isNearExpeditionPoint(userId: string, point: readonly [number, number], radius: number) {
  const position = liveNeighborhoodPosition(userId);
  if (!position) return false;
  return (position.x - point[0]) ** 2 + (position.z - point[1]) ** 2 <= radius ** 2;
}

function isAtExpeditionCheckpoint(userId: string) {
  const position = liveNeighborhoodPosition(userId);
  return Boolean(position
    && Math.abs(position.x) <= 14
    && position.z >= -100
    && position.z <= -82);
}

function cleanExpiredPartyInvites(now = Date.now()) {
  for (const [key, invite] of partyInvites) {
    if (invite.expiresAt <= now || !parties.has(invite.partyId)) {
      partyInvites.delete(key);
      notifyPartyInviteResolved(invite);
    }
  }
}

function connectedSocketsForUser(userId: string, excludedSocketId?: string) {
  return [...io.sockets.sockets.values()].filter((candidate) => (
    candidate.id !== excludedSocketId && candidate.data.userId === userId && candidate.connected
  ));
}

function emitToPartyUser(userId: string, event: string, payload: unknown) {
  for (const targetSocket of connectedSocketsForUser(userId)) {
    targetSocket.emit(event, payload);
  }
}

function currentPartyOnlinePlayers() {
  const players = new Map<string, { userId: string; username: string }>();
  for (const candidate of io.sockets.sockets.values()) {
    if (!candidate.connected) continue;
    const userId = String(candidate.data.userId ?? "");
    const username = String(candidate.data.username ?? "").trim();
    if (userId && username) players.set(userId, { userId, username });
  }
  return [...players.values()].sort((left, right) => left.username.localeCompare(right.username, "ru"));
}

function emitPartyOnlinePlayers() {
  io.emit("party:online-players", { players: currentPartyOnlinePlayers() });
}

function notifyPartyInviteResolved(invite: PartyInvite) {
  const payload = { inviteId: invite.id, partyId: invite.partyId };
  emitToPartyUser(invite.fromUserId, "party:invite-resolved", payload);
  emitToPartyUser(invite.toUserId, "party:invite-resolved", payload);
}

function makePartySnapshot(party: InternalParty): PartySnapshot {
  return {
    id: party.id,
    leaderUserId: party.leaderUserId,
    maxSize: PARTY_MAX_SIZE,
    members: party.members.map((member) => ({
      ...member,
      isLeader: member.userId === party.leaderUserId,
      online: connectedSocketsForUser(member.userId).length > 0
    }))
  };
}

function emitPartySnapshot(party: InternalParty) {
  const snapshot = makePartySnapshot(party);
  for (const member of party.members) {
    emitToPartyUser(member.userId, "party:snapshot", snapshot);
  }
}

function destroyParty(party: InternalParty) {
  parties.delete(party.id);
  for (const member of party.members) {
    partyIdByUserId.delete(member.userId);
    emitToPartyUser(member.userId, "party:snapshot", null);
  }
  for (const [key, invite] of partyInvites) {
    if (invite.partyId === party.id) {
      partyInvites.delete(key);
      notifyPartyInviteResolved(invite);
    }
  }
}

function leaveParty(userId: string) {
  const partyId = partyIdByUserId.get(userId);
  const party = partyId ? parties.get(partyId) : undefined;
  if (!party) {
    partyIdByUserId.delete(userId);
    emitToPartyUser(userId, "party:snapshot", null);
    return;
  }

  party.members = party.members.filter((member) => member.userId !== userId);
  partyIdByUserId.delete(userId);
  emitToPartyUser(userId, "party:snapshot", null);
  for (const [key, invite] of partyInvites) {
    if (invite.fromUserId === userId || invite.toUserId === userId) {
      partyInvites.delete(key);
      notifyPartyInviteResolved(invite);
    }
  }

  if (party.members.length === 0) {
    destroyParty(party);
    return;
  }
  if (party.leaderUserId === userId) {
    party.leaderUserId = party.members[0].userId;
  }
  emitPartySnapshot(party);
}

function partyError(socket: Socket, error: string) {
  socket.emit("party:error", { error });
}

function parsePartyId(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && "partyId" in value) {
    return String((value as { partyId?: unknown }).partyId ?? "").trim();
  }
  return "";
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
    expedition: createDefaultExpeditionProfile(),
    progress: createDefaultProgress(),
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

fastify.get("/api/expedition/profile", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const activeRun = activeRunForUser(user);
    return {
      profile: user.expedition,
      run: activeRun ? makeRunSnapshot(activeRun) : null
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/loadout", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { weaponId?: unknown };
    const weaponId = String(body.weaponId ?? "");
    if (!expeditionWeaponIds.has(weaponId)) {
      return reply.code(400).send({ error: "Неизвестное оружие" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (!user.expedition.unlockedWeapons.includes(weaponId as ExpeditionWeaponId)) {
      return reply.code(403).send({ error: "Сначала откройте или купите это оружие" });
    }
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Нельзя менять снаряжение во время экспедиции" });
    }

    user.expedition.selectedWeapon = weaponId as ExpeditionWeaponId;
    writeDb(db);
    return { profile: user.expedition, weapon: EXPEDITION_WEAPONS[user.expedition.selectedWeapon] };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/buy-weapon", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { weaponId?: unknown };
    const weaponId = String(body.weaponId ?? "");
    if (!expeditionWeaponIds.has(weaponId)) {
      return reply.code(400).send({ error: "Неизвестное оружие" });
    }

    const typedWeaponId = weaponId as ExpeditionWeaponId;
    const weapon = EXPEDITION_WEAPONS[typedWeaponId];
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Нельзя покупать оружие во время экспедиции" });
    }
    if (user.expedition.unlockedWeapons.includes(typedWeaponId)) {
      return reply.code(409).send({ error: "Это оружие уже открыто" });
    }
    if (user.coins < weapon.price) {
      return reply.code(400).send({ error: "Не хватает монет" });
    }

    user.coins -= weapon.price;
    user.expedition.unlockedWeapons.push(typedWeaponId);
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      weapon,
      spent: weapon.price
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/buy-ammo", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Покупать патроны можно только дома или в городе" });
    }
    if (user.coins < EXPEDITION_AMMO_PACK.price) {
      return reply.code(400).send({ error: "Не хватает монет на боеприпасы" });
    }

    user.coins -= EXPEDITION_AMMO_PACK.price;
    mergeItemStacks(user.expedition.stash, [{ itemId: "ammo", quantity: EXPEDITION_AMMO_PACK.quantity }]);
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      purchased: { itemId: "ammo", quantity: EXPEDITION_AMMO_PACK.quantity },
      spent: EXPEDITION_AMMO_PACK.price
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/craft", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { recipeId?: unknown };
    const recipeId = String(body.recipeId ?? "");
    if (!expeditionRecipeIds.has(recipeId)) {
      return reply.code(400).send({ error: "Неизвестный рецепт" });
    }

    const typedRecipeId = recipeId as ExpeditionRecipeId;
    const recipe = EXPEDITION_RECIPES[typedRecipeId];
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Верстак доступен только дома или в городе" });
    }
    if ("weaponId" in recipe.output && user.expedition.unlockedWeapons.includes(recipe.output.weaponId)) {
      return reply.code(409).send({ error: "Это оружие уже изготовлено" });
    }

    const nextStash = deductItemStacks(user.expedition.stash, recipe.ingredients);
    if (!nextStash) {
      return reply.code(400).send({ error: "Не хватает материалов для изготовления" });
    }

    user.expedition.stash = nextStash;
    if ("weaponId" in recipe.output) {
      user.expedition.unlockedWeapons.push(recipe.output.weaponId);
    } else {
      mergeItemStacks(user.expedition.stash, [recipe.output]);
    }
    writeDb(db);
    return { profile: user.expedition, recipe };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/upgrade-skill", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { skillId?: unknown };
    const skillId = String(body.skillId ?? "");
    if (!expeditionSkillIds.has(skillId)) {
      return reply.code(400).send({ error: "Неизвестный навык" });
    }
    const typedSkillId = skillId as ExpeditionSkillId;
    const skill = EXPEDITION_SKILLS[typedSkillId];
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Навыки можно улучшать только на базе" });
    }
    if (user.expedition.skillPoints < 1) {
      return reply.code(400).send({ error: "Нет свободных очков навыков" });
    }
    if (user.expedition.skills[typedSkillId] >= skill.maxLevel) {
      return reply.code(409).send({ error: "Навык уже достиг максимального уровня" });
    }

    user.expedition.skillPoints -= 1;
    user.expedition.skills[typedSkillId] += 1;
    writeDb(db);
    return { profile: user.expedition, skill };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/start", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const partyId = partyIdByUserId.get(user.id);
    const party = partyId ? parties.get(partyId) : undefined;
    if (party && party.leaderUserId !== user.id) {
      return reply.code(403).send({ error: "Начать групповую экспедицию может только лидер" });
    }

    const participantIds = party?.members.map((member) => member.userId) ?? [user.id];
    const participants = participantIds.map((userId) => db.users.find((entry) => entry.id === userId)).filter(Boolean) as User[];
    if (participants.length !== participantIds.length) {
      return reply.code(409).send({ error: "Один из участников группы больше недоступен" });
    }
    const offlineMember = party?.members.find((member) => connectedSocketsForUser(member.userId).length === 0);
    if (offlineMember) {
      return reply.code(409).send({ error: `${offlineMember.username} не в сети` });
    }
    const activeMember = participants.find((participant) => activeRunForUser(participant));
    if (activeMember) {
      return reply.code(409).send({ error: `${activeMember.username} уже находится в экспедиции` });
    }
    const unarmedMember = participants.find((participant) => itemStackQuantity(participant.expedition.stash, "ammo") < 1);
    if (unarmedMember) {
      return reply.code(400).send({ error: `${unarmedMember.username}: нет боеприпасов для выхода` });
    }

    const runs = participants.map((participant) => {
      const run = createActiveExpeditionRun(participant);
      participant.expedition.stats.expeditionsStarted += 1;
      persistActiveRun(participant, run);
      return { participant, run };
    });
    writeDb(db);
    for (const entry of runs) {
      activeExpeditionRuns.set(entry.participant.id, entry.run);
      if (entry.participant.id !== user.id) {
        emitToPartyUser(entry.participant.id, "expedition:started", {
          run: makeRunSnapshot(entry.run),
          profile: entry.participant.expedition,
          partySize: runs.length,
          leaderUsername: user.username
        });
      }
    }
    const ownRun = runs.find((entry) => entry.participant.id === user.id)!.run;
    return { run: makeRunSnapshot(ownRun), profile: user.expedition, partySize: runs.length };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/loot", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { containerId?: unknown };
    const containerId = String(body.containerId ?? "");
    if (!expeditionContainerIds.has(containerId)) {
      return reply.code(400).send({ error: "Неизвестный контейнер" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }
    const typedContainerId = containerId as ExpeditionContainerId;
    if (run.lootedContainerIds.includes(typedContainerId)) {
      return reply.code(409).send({ error: "Этот контейнер уже был обыскан" });
    }
    const container = EXPEDITION_CONTAINERS[typedContainerId];
    if (!isNearExpeditionPoint(user.id, container.position, 5.5)) {
      return reply.code(403).send({ error: "Подойдите к контейнеру ближе" });
    }

    const scavengingLevel = user.expedition.skills.scavenging;
    const loot = cloneItemStacks(run.containerLoot[typedContainerId]).map((stack) => ({
      ...stack,
      quantity: Math.min(999_999, stack.quantity + Math.floor(stack.quantity * scavengingLevel * 0.1))
    }));
    const nextBackpack = cloneItemStacks(run.backpack);
    mergeItemStacks(nextBackpack, loot);
    run.backpack = nextBackpack;
    run.lootedContainerIds.push(typedContainerId);
    persistActiveRun(user, run);
    user.expedition.stats.containersLooted += 1;
    writeDb(db);
    return {
      run: makeRunSnapshot(run),
      container,
      loot
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/hit", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { hits?: unknown };
    if (!Array.isArray(body.hits) || body.hits.length > EXPEDITION_ENEMY_IDS.length) {
      return reply.code(400).send({ error: "Передайте список до пяти попаданий одного выстрела" });
    }

    const hitByEnemy = new Map<ExpeditionEnemyId, ExpeditionHitInput>();
    for (const candidate of body.hits) {
      if (!candidate || typeof candidate !== "object") {
        return reply.code(400).send({ error: "Некорректные данные попадания" });
      }
      const raw = candidate as { enemyId?: unknown; zone?: unknown; damageScale?: unknown };
      const enemyId = String(raw.enemyId ?? "");
      const zone = String(raw.zone ?? "");
      if (!expeditionEnemyIds.has(enemyId) || !expeditionHitZones.has(zone)) {
        return reply.code(400).send({ error: "Неизвестный противник или зона попадания" });
      }
      const typedEnemyId = enemyId as ExpeditionEnemyId;
      if (hitByEnemy.has(typedEnemyId)) continue;
      const numericScale = Number(raw.damageScale);
      hitByEnemy.set(typedEnemyId, {
        enemyId: typedEnemyId,
        zone: zone as ExpeditionHitZone,
        damageScale: Number.isFinite(numericScale) ? numericScale : 1
      });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }
    const requestedHits = [...hitByEnemy.values()].filter((hit) => !run.killedEnemyIds.includes(hit.enemyId));
    if (body.hits.length > 0 && requestedHits.length === 0) {
      return reply.code(409).send({ error: "Все указанные противники уже были побеждены" });
    }

    const weapon = EXPEDITION_WEAPONS[run.selectedWeapon];
    if (run.selectedWeapon !== "rocket" && requestedHits.length > 1) {
      return reply.code(400).send({ error: "Это оружие поражает только одну цель за выстрел" });
    }
    const patrolTolerance = 35;
    for (const hit of requestedHits) {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      if (!isNearExpeditionPoint(user.id, enemy.position, weapon.range + patrolTolerance)) {
        return reply.code(403).send({ error: `${enemy.name}: цель слишком далеко от вашей позиции` });
      }
    }

    const now = Date.now();
    if (now < run.nextHitAt) {
      return reply.code(429).send({
        error: "Оружие ещё не готово к следующему выстрелу",
        retryAfterMs: Math.max(1, run.nextHitAt - now)
      });
    }

    const nextBackpack = deductItemStacks(run.backpack, [{ itemId: "ammo", quantity: 1 }]);
    if (!nextBackpack) {
      return reply.code(409).send({ error: "Боеприпасы закончились — эвакуируйтесь или завершите вылазку" });
    }
    run.backpack = nextBackpack;

    const weaponsLevel = user.expedition.skills.weapons;
    const baseDamage = weapon.damage * (1 + weaponsLevel * 0.05);
    const hitResults = requestedHits.map((hit) => {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      const damageMultiplier = run.selectedWeapon === "rocket"
        ? Math.max(0.28, Math.min(1, hit.damageScale ?? 1))
        : EXPEDITION_HIT_MULTIPLIERS[hit.zone];
      const damage = Math.max(1, Math.round(baseDamage * damageMultiplier));
      const remainingHealth = Math.max(0, (run.enemyHealth[hit.enemyId] ?? enemy.maxHealth) - damage);
      const killed = remainingHealth <= 0;
      const loot = killed ? cloneItemStacks(enemy.loot) : [];
      run.enemyHealth[hit.enemyId] = remainingHealth;
      if (killed) {
        mergeItemStacks(run.backpack, loot);
        run.killedEnemyIds.push(hit.enemyId);
        user.expedition.stats.enemiesKilled += 1;
        if (enemy.hostile) {
          user.expedition.stats.hostileEnemiesKilled += 1;
        }
      }
      return {
        enemy,
        weaponId: run.selectedWeapon,
        damage,
        remainingHealth,
        killed,
        loot
      };
    });
    run.nextHitAt = now + Math.max(40, weapon.fireIntervalMs - 20);
    persistActiveRun(user, run);
    writeDb(db);
    return {
      run: makeRunSnapshot(run),
      hits: hitResults
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/kill", async (request, reply) => {
  try {
    requireUser(request);
    return reply.code(410).send({ error: "Прямое подтверждение убийства отключено; используйте регистрацию попаданий" });
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/extract", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Активная экспедиция не найдена" });
    }
    if (!isAtExpeditionCheckpoint(user.id)) {
      return reply.code(403).send({ error: "Доберитесь до точки эвакуации" });
    }

    const objective = makeRunObjective(run);
    const extracted = cloneItemStacks(run.backpack);
    mergeItemStacks(user.expedition.stash, extracted);
    user.expedition.stats.successfulExtracts += 1;

    let coins = 0;
    let xp = 0;
    let levelsGained = 0;
    if (objective.complete) {
      coins = EXPEDITION_EXTRACT_REWARD.coins;
      xp = EXPEDITION_EXTRACT_REWARD.xp;
      user.coins = Math.min(999_999_999, user.coins + coins);
      levelsGained = grantXp(user.progress, xp);
      if (!user.expedition.completedQuestIds.includes(EXPEDITION_QUEST_ID)) {
        user.expedition.completedQuestIds.push(EXPEDITION_QUEST_ID);
        user.expedition.skillPoints += 1;
      }
    }

    delete user.expeditionRun;
    writeDb(db);
    activeExpeditionRuns.delete(user.id);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      extracted,
      reward: {
        coins,
        xp,
        levelsGained,
        objectiveCompleted: objective.complete
      }
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/abandon", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Активная экспедиция не найдена" });
    }

    user.expedition.stats.abandonedRuns += 1;
    delete user.expeditionRun;
    writeDb(db);
    activeExpeditionRuns.delete(user.id);
    return { profile: user.expedition, lost: cloneItemStacks(run.backpack) };
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

fastify.get("/api/neighborhood", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const catalog = getGameCatalog(db);
    const now = Date.now();
    const residents = makeNeighborhoodResidents(db.users, catalog);
    if (!residents.some((resident) => !resident.isNpc && resident.username === user.username)) {
      return reply.code(409).send({ error: "На этой улице все 12 участков уже заняты", code: "NEIGHBORHOOD_FULL" });
    }
    return {
      residents,
      progress: makeProgressView(user, catalog, now),
      generatedAt: now
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.get("/api/home/:username", async (request, reply) => {
  const params = request.params as { username: string };
  const db = readDb();
  const user = db.users.find((entry) => entry.username.toLowerCase() === params.username.toLowerCase());
  if (!user) {
    const npcHome = makeNpcHome(params.username);
    if (!npcHome) {
      return reply.code(404).send({ error: "Дом не найден" });
    }
    return {
      ...npcHome,
      chats: db.chats.filter((message) => message.homeOwner.toLowerCase() === npcHome.owner.toLowerCase()).slice(-50)
    };
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
    emitHomeEvent("home:styleUpdated", dbUser.username, { owner: dbUser.username, homeStyle: dbUser.homeStyle });
    return { user: toPublicUser(dbUser), homeStyle: dbUser.homeStyle };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/neighborhood/claim-income", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const now = Date.now();
    const pendingBeforeClaim = calculatePendingIncome(user.progress, now);
    const claimed = creditPendingIncome(user, now);
    if (pendingBeforeClaim > 0) {
      writeDb(db);
    }
    return {
      user: toPublicUser(user),
      progress: makeProgressView(user, getGameCatalog(db), now),
      claimed
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/neighborhood/upgrade-career", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const currentLevel = user.progress.careerLevel;
    if (currentLevel >= MAX_CAREER_LEVEL) {
      return reply.code(400).send({ error: "Карьера уже максимального уровня", code: "MAX_CAREER_LEVEL" });
    }

    const requiredLevel = careerRequiredLevel(currentLevel);
    if (user.progress.level < requiredLevel) {
      return reply.code(400).send({
        error: `Нужен ${requiredLevel} уровень персонажа`,
        code: "PLAYER_LEVEL_REQUIRED",
        requiredLevel
      });
    }

    const cost = careerUpgradeCost(currentLevel);
    const now = Date.now();
    const pendingIncome = calculatePendingIncome(user.progress, now);
    if (user.coins + pendingIncome < cost) {
      return reply.code(400).send({ error: "Не хватает монет", code: "NOT_ENOUGH_COINS", cost });
    }

    const claimed = creditPendingIncome(user, now);
    user.coins -= cost;
    user.progress.careerLevel += 1;
    user.progress.incomePerHour = incomePerHourForCareer(user.progress.careerLevel);
    user.progress.lastIncomeClaimAt = now;
    writeDb(db);
    return {
      user: toPublicUser(user),
      progress: makeProgressView(user, getGameCatalog(db), now),
      spent: cost,
      claimed
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/neighborhood/upgrade-house", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const currentLevel = user.progress.houseLevel;
    if (currentLevel >= MAX_HOUSE_LEVEL) {
      return reply.code(400).send({ error: "Дом уже максимального уровня", code: "MAX_HOUSE_LEVEL" });
    }

    const requiredLevel = houseRequiredLevel(currentLevel);
    if (user.progress.level < requiredLevel) {
      return reply.code(400).send({
        error: `Нужен ${requiredLevel} уровень персонажа`,
        code: "PLAYER_LEVEL_REQUIRED",
        requiredLevel
      });
    }

    const cost = houseUpgradeCost(currentLevel);
    if (user.coins < cost) {
      return reply.code(400).send({ error: "Не хватает монет", code: "NOT_ENOUGH_COINS", cost });
    }

    user.coins -= cost;
    user.progress.houseLevel += 1;
    writeDb(db);
    const activeCatalog = getGameCatalog(db);
    const resident = makeNeighborhoodResidents(db.users, activeCatalog)
      .find((entry) => entry.username === user.username);
    if (resident) {
      emitHomeEvent("home:snapshot", user.username, homeSnapshotPayload(resident));
    }
    return {
      user: toPublicUser(user),
      progress: makeProgressView(user, activeCatalog),
      spent: cost
    };
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
    const now = Date.now();
    if (dbUser.progress.workAvailableAt > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((dbUser.progress.workAvailableAt - now) / 1000));
      return reply.code(429).send({
        error: `Работа ещё идёт: ${retryAfterSeconds} сек.`,
        code: "WORK_IN_PROGRESS",
        retryAfterSeconds,
        workAvailableAt: dbUser.progress.workAvailableAt
      });
    }

    dbUser.progress.workAvailableAt = now + activity.seconds * 1000;
    dbUser.coins = Math.min(999_999_999, dbUser.coins + activity.reward);
    const xpEarned = activityXp(activity.reward);
    const levelsGained = grantXp(dbUser.progress, xpEarned);
    writeDb(db);
    return {
      user: toPublicUser(dbUser),
      activity,
      progress: makeProgressView(dbUser, getGameCatalog(db)),
      xpEarned,
      levelsGained
    };
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
    emitHomeEvent("home:placed", dbUser.username, {
      owner: dbUser.username,
      placed,
      homeValue: calculateHomeValue(dbUser.progress.houseLevel, dbUser.placedItems, getGameCatalog(db))
    });

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
    emitHomeEvent("home:itemUpdated", dbUser.username, {
      owner: dbUser.username,
      placed,
      homeValue: calculateHomeValue(dbUser.progress.houseLevel, dbUser.placedItems, getGameCatalog(db))
    });

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
    emitHomeEvent("home:itemUpdated", dbUser.username, {
      owner: dbUser.username,
      placed,
      homeValue: calculateHomeValue(dbUser.progress.houseLevel, dbUser.placedItems, getGameCatalog(db))
    });

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
    emitHomeEvent("home:itemUpdated", dbUser.username, {
      owner: dbUser.username,
      placed,
      homeValue: calculateHomeValue(dbUser.progress.houseLevel, dbUser.placedItems, getGameCatalog(db))
    });

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
    emitHomeEvent("home:itemSold", dbUser.username, {
      owner: dbUser.username,
      instanceId: placed.instanceId,
      refund,
      homeValue: calculateHomeValue(dbUser.progress.houseLevel, dbUser.placedItems, getGameCatalog(db))
    });

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
  const connectedUserId = String(socket.data.userId);
  const disconnectTimer = partyDisconnectTimers.get(connectedUserId);
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    partyDisconnectTimers.delete(connectedUserId);
  }
  const currentPartyId = partyIdByUserId.get(String(socket.data.userId));
  const currentParty = currentPartyId ? parties.get(currentPartyId) : undefined;
  if (currentParty) {
    socket.emit("party:snapshot", makePartySnapshot(currentParty));
    emitPartySnapshot(currentParty);
  } else {
    socket.emit("party:snapshot", null);
  }
  cleanExpiredPartyInvites();
  const pendingPartyInvites: PartyInvitesSnapshot = {
    incoming: [...partyInvites.values()].filter((invite) => invite.toUserId === connectedUserId),
    outgoing: [...partyInvites.values()].filter((invite) => invite.fromUserId === connectedUserId)
  };
  socket.emit("party:invites", pendingPartyInvites);
  emitPartyOnlinePlayers();

  socket.on("party:online-players", () => {
    socket.emit("party:online-players", { players: currentPartyOnlinePlayers() });
  });

  socket.on("party:invite", (requestedUsername: unknown) => {
    cleanExpiredPartyInvites();
    const username = typeof requestedUsername === "string"
      ? requestedUsername.trim()
      : String((requestedUsername as { username?: unknown } | null)?.username ?? "").trim();
    if (!username) {
      partyError(socket, "Укажите имя игрока");
      return;
    }
    if (username.toLowerCase() === String(socket.data.username).toLowerCase()) {
      partyError(socket, "Нельзя пригласить самого себя");
      return;
    }

    const targetSocket = [...io.sockets.sockets.values()].find((candidate) => (
      candidate.connected
      && String(candidate.data.username).toLowerCase() === username.toLowerCase()
      && candidate.data.userId !== socket.data.userId
    ));
    if (!targetSocket) {
      partyError(socket, "Игрок не в сети");
      return;
    }

    const targetUserId = String(targetSocket.data.userId);
    const targetUsername = String(targetSocket.data.username);
    if (partyIdByUserId.has(targetUserId)) {
      partyError(socket, "Игрок уже состоит в группе");
      return;
    }

    const inviterUserId = String(socket.data.userId);
    let partyId = partyIdByUserId.get(inviterUserId);
    let party = partyId ? parties.get(partyId) : undefined;
    if (partyId && !party) {
      partyIdByUserId.delete(inviterUserId);
      partyId = undefined;
    }
    if (party && party.leaderUserId !== inviterUserId) {
      partyError(socket, "Приглашать игроков может только лидер группы");
      return;
    }

    const pendingCount = party
      ? [...partyInvites.values()].filter((invite) => invite.partyId === party!.id).length
      : 0;
    if (party && party.members.length + pendingCount >= PARTY_MAX_SIZE) {
      partyError(socket, "Группа уже заполнена или места зарезервированы приглашениями");
      return;
    }

    if (!party) {
      party = {
        id: crypto.randomUUID(),
        leaderUserId: inviterUserId,
        members: [{
          userId: inviterUserId,
          username: String(socket.data.username),
          joinedAt: Date.now()
        }]
      };
      parties.set(party.id, party);
      partyIdByUserId.set(inviterUserId, party.id);
    }

    const inviteKey = `${party.id}:${targetUserId}`;
    if (partyInvites.has(inviteKey)) {
      partyError(socket, "Приглашение этому игроку уже отправлено");
      return;
    }

    const now = Date.now();
    const invite: PartyInvite = {
      id: crypto.randomUUID(),
      partyId: party.id,
      fromUserId: inviterUserId,
      fromUsername: String(socket.data.username),
      toUserId: targetUserId,
      toUsername: targetUsername,
      createdAt: now,
      expiresAt: now + PARTY_INVITE_LIFETIME_MS
    };
    partyInvites.set(inviteKey, invite);
    emitPartySnapshot(party);
    socket.emit("party:invite-sent", invite);
    emitToPartyUser(targetUserId, "party:invited", invite);
  });

  socket.on("party:accept", (value: unknown) => {
    cleanExpiredPartyInvites();
    const partyId = parsePartyId(value);
    const userId = String(socket.data.userId);
    const invite = partyInvites.get(`${partyId}:${userId}`);
    if (!partyId || !invite) {
      partyError(socket, "Приглашение не найдено или уже истекло");
      return;
    }
    if (partyIdByUserId.has(userId)) {
      partyError(socket, "Вы уже состоите в группе");
      return;
    }

    const party = parties.get(partyId);
    if (!party) {
      partyInvites.delete(`${partyId}:${userId}`);
      notifyPartyInviteResolved(invite);
      partyError(socket, "Группа больше не существует");
      return;
    }
    if (party.members.length >= PARTY_MAX_SIZE) {
      partyInvites.delete(`${partyId}:${userId}`);
      notifyPartyInviteResolved(invite);
      partyError(socket, "В группе больше нет свободных мест");
      return;
    }

    party.members.push({
      userId,
      username: String(socket.data.username),
      joinedAt: Date.now()
    });
    partyIdByUserId.set(userId, party.id);
    for (const [key, pendingInvite] of partyInvites) {
      if (pendingInvite.toUserId === userId) {
        partyInvites.delete(key);
        notifyPartyInviteResolved(pendingInvite);
      }
    }
    emitPartySnapshot(party);
  });

  socket.on("party:decline", (value?: unknown) => {
    cleanExpiredPartyInvites();
    const requestedPartyId = parsePartyId(value);
    const userId = String(socket.data.userId);
    let declined = false;
    for (const [key, invite] of partyInvites) {
      if (invite.toUserId === userId && (!requestedPartyId || invite.partyId === requestedPartyId)) {
        partyInvites.delete(key);
        notifyPartyInviteResolved(invite);
        declined = true;
      }
    }
    if (!declined) {
      partyError(socket, "Приглашение не найдено или уже истекло");
    }
  });

  socket.on("party:leave", () => {
    const userId = String(socket.data.userId);
    if (!partyIdByUserId.has(userId)) {
      partyError(socket, "Вы не состоите в группе");
      return;
    }
    leaveParty(userId);
  });

  socket.on("party:snapshot", () => {
    const partyId = partyIdByUserId.get(String(socket.data.userId));
    const party = partyId ? parties.get(partyId) : undefined;
    socket.emit("party:snapshot", party ? makePartySnapshot(party) : null);
  });

  socket.on("neighborhood:join", () => {
    const previousHomeOwner = socket.data.homeOwner as string | undefined;
    if (previousHomeOwner) {
      leaveVoiceRoom(socket);
      leaveHomePresence(socket);
      socket.leave(`home:${previousHomeOwner}`);
      socket.data.homeOwner = undefined;
    }

    const previousWatchedHomeOwner = socket.data.watchedHomeOwner as string | undefined;
    if (previousWatchedHomeOwner) {
      leaveVoiceRoom(socket);
      socket.leave(homeWatchRoom(previousWatchedHomeOwner));
      socket.data.watchedHomeOwner = undefined;
    }

    const wasAlreadyPresent = neighborhoodPlayers.has(socket.id);
    socket.join(NEIGHBORHOOD_ROOM);
    socket.data.inNeighborhood = true;
    const neighborhoodUserId = String(socket.data.userId);
    const hasStoredNeighborhoodPosition = lastNeighborhoodPositions.has(neighborhoodUserId);
    const initialPosition = {
      ...(lastNeighborhoodPositions.get(neighborhoodUserId) ?? defaultNeighborhoodPosition())
    };
    const currentPlayer: LivePlayer = {
      id: socket.id,
      username: socket.data.username,
      position: initialPosition,
      avatar: getPublicAvatar(socket.data.username)
    };
    lastNeighborhoodPositions.set(neighborhoodUserId, { ...initialPosition });
    if (!neighborhoodMovementStates.has(neighborhoodUserId)) {
      neighborhoodMovementStates.set(neighborhoodUserId, {
        lastAt: Date.now(),
        budget: NEIGHBORHOOD_INITIAL_MOVE_BUDGET,
        needsInitialCitySync: !hasStoredNeighborhoodPosition
      });
    }
    socket.emit("player:present", {
      players: [...neighborhoodPlayers.entries()]
        .filter(([id]) => id !== socket.id)
        .map(([, player]) => player)
    });
    neighborhoodPlayers.set(socket.id, currentPlayer);
    if (!wasAlreadyPresent) {
      socket.to(NEIGHBORHOOD_ROOM).emit("player:joined", currentPlayer);
    }
  });

  socket.on("neighborhood:move", (position: unknown) => {
    if (!socket.data.inNeighborhood || !neighborhoodPlayers.has(socket.id)) {
      return;
    }

    const requestedPosition = sanitizeNeighborhoodPosition(position);
    const neighborhoodUserId = String(socket.data.userId);
    const previousPosition = lastNeighborhoodPositions.get(neighborhoodUserId)
      ?? neighborhoodPlayers.get(socket.id)!.position;
    const now = Date.now();
    const movementState = neighborhoodMovementStates.get(neighborhoodUserId) ?? {
      lastAt: now,
      budget: 0,
      needsInitialCitySync: true
    };
    neighborhoodMovementStates.set(neighborhoodUserId, movementState);
    const acceptsInitialCitySync = movementState.needsInitialCitySync
      && requestedPosition.x >= INITIAL_CITY_SYNC_MIN_X
      && requestedPosition.x <= INITIAL_CITY_SYNC_MAX_X
      && requestedPosition.z >= INITIAL_CITY_SYNC_MIN_Z
      && requestedPosition.z <= INITIAL_CITY_SYNC_MAX_Z;
    if (movementState.needsInitialCitySync) {
      movementState.needsInitialCitySync = false;
    }

    if (acceptsInitialCitySync) {
      movementState.lastAt = now;
      movementState.budget = NEIGHBORHOOD_INITIAL_MOVE_BUDGET;
    } else {
      const elapsedMs = Math.max(0, now - movementState.lastAt);
      if (elapsedMs < NEIGHBORHOOD_MIN_MOVE_INTERVAL_MS) {
        return;
      }

      const elapsedSeconds = elapsedMs / 1000;
      let movementBudget = Math.min(
        NEIGHBORHOOD_MOVE_BUDGET_CAPACITY,
        Math.max(0, movementState.budget) + NEIGHBORHOOD_MAX_SPEED * elapsedSeconds
      );
      const dx = requestedPosition.x - previousPosition.x;
      const dz = requestedPosition.z - previousPosition.z;
      const requestedDistance = Math.hypot(dx, dz);
      const acceptedDistance = Math.min(requestedDistance, movementBudget);
      if (requestedDistance > acceptedDistance && requestedDistance > 0) {
        const scale = acceptedDistance / requestedDistance;
        requestedPosition.x = previousPosition.x + dx * scale;
        requestedPosition.z = previousPosition.z + dz * scale;
      }
      movementBudget = Math.max(0, movementBudget - acceptedDistance);
      movementState.lastAt = now;
      movementState.budget = movementBudget;
    }
    lastNeighborhoodPositions.set(neighborhoodUserId, { ...requestedPosition });
    const player: LivePlayer = {
      id: socket.id,
      username: socket.data.username,
      position: requestedPosition,
      avatar: getPublicAvatar(socket.data.username)
    };
    neighborhoodPlayers.set(socket.id, player);
    socket.to(NEIGHBORHOOD_ROOM).emit("player:moved", player);
  });

  socket.on("neighborhood:leave", () => {
    leaveNeighborhoodPresence(socket);
  });

  socket.on("home:watch", (requestedOwner: unknown) => {
    const homeOwner = String(requestedOwner ?? "").trim();
    const previousHomeOwner = socket.data.watchedHomeOwner as string | undefined;
    if (previousHomeOwner === homeOwner) {
      return;
    }

    if (previousHomeOwner) {
      leaveVoiceRoom(socket);
      socket.leave(homeWatchRoom(previousHomeOwner));
      socket.data.watchedHomeOwner = undefined;
    }

    if (!homeOwner) {
      return;
    }

    const db = readDb();
    const resident = makeNeighborhoodResidents(db.users, getGameCatalog(db))
      .find((entry) => entry.username.toLowerCase() === homeOwner.toLowerCase());
    if (!resident) {
      return;
    }

    socket.join(homeWatchRoom(resident.username));
    socket.data.watchedHomeOwner = resident.username;
    socket.emit("home:snapshot", homeSnapshotPayload(resident));
  });

  socket.on("home:join", (homeOwner: string) => {
    leaveNeighborhoodPresence(socket);
    const watchedHomeOwner = socket.data.watchedHomeOwner as string | undefined;
    if (watchedHomeOwner) {
      leaveVoiceRoom(socket);
      socket.leave(homeWatchRoom(watchedHomeOwner));
      socket.data.watchedHomeOwner = undefined;
    }
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
    const homeOwner = socket.data.homeOwner as string | undefined;
    if (!homeOwner || !homePlayers.get(homeOwner)?.has(socket.id)) {
      return;
    }
    const room = `home:${homeOwner}`;
    const player: LivePlayer = {
      id: socket.id,
      username: socket.data.username,
      position: sanitizeHomePosition(position),
      avatar: getPublicAvatar(socket.data.username)
    };
    const players = homePlayers.get(homeOwner) ?? new Map<string, LivePlayer>();
    players.set(socket.id, player);
    homePlayers.set(homeOwner, players);
    socket.to(room).emit("player:moved", player);
  });

  socket.on("chat:send", (text: string) => {
    const cleanText = String(text).trim().slice(0, 300);
    const homeOwner = String(socket.data.watchedHomeOwner ?? socket.data.homeOwner ?? socket.data.username);
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
    emitHomeEvent("chat:message", homeOwner, message);
  });

  socket.on("world:interact", (payload: { itemId?: string; action?: string }) => {
    const homeOwner = String(socket.data.watchedHomeOwner ?? socket.data.homeOwner ?? "");
    if (!homeOwner) return;
    socket.to(`home:${homeOwner}`).to(homeWatchRoom(homeOwner)).emit("world:interaction", {
      username: socket.data.username,
      itemId: payload.itemId,
      action: payload.action ?? "interact",
      createdAt: Date.now()
    });
  });

  socket.on("voice:join", () => {
    const homeOwner = String(socket.data.watchedHomeOwner ?? socket.data.homeOwner ?? socket.data.username);
    leaveVoiceRoom(socket);
    const roomUsers = voiceRooms.get(homeOwner) ?? new Map<string, string>();
    const users = [...roomUsers.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, username]) => ({ id, username }));
    roomUsers.set(socket.id, socket.data.username);
    voiceRooms.set(homeOwner, roomUsers);
    socket.data.voiceHomeOwner = homeOwner;
    socket.emit("voice:users", { users });
    socket.to(`home:${homeOwner}`).to(homeWatchRoom(homeOwner)).emit("voice:userJoined", { id: socket.id, username: socket.data.username });
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
    leaveNeighborhoodPresence(socket);
    const userId = String(socket.data.userId);
    if (connectedSocketsForUser(userId, socket.id).length === 0) {
      const partyId = partyIdByUserId.get(userId);
      const party = partyId ? parties.get(partyId) : undefined;
      if (party) emitPartySnapshot(party);
      const timer = setTimeout(() => {
        partyDisconnectTimers.delete(userId);
        if (connectedSocketsForUser(userId).length === 0) leaveParty(userId);
      }, PARTY_RECONNECT_GRACE_MS);
      partyDisconnectTimers.set(userId, timer);
    }
    emitPartyOnlinePlayers();
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, () => {
  fastify.log.info(`AnimeGame API listening on http://localhost:${PORT}`);
});
