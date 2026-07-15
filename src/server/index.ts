import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import {
  createDefaultExpeditionProfile,
  expeditionEnemyPatrolTolerance,
  expeditionGearUpgradeCost,
  expeditionVehicleImpactDamage,
  expeditionWeaponStats,
  expeditionWeaponUpgradeCost,
  EXPEDITION_AMMO_PACK,
  EXPEDITION_BANDAGE_HEAL,
  EXPEDITION_DOWNED_BLEED_OUT_MS,
  EXPEDITION_ARTIFACTS,
  EXPEDITION_ARTIFACT_IDS,
  EXPEDITION_CONTAINERS,
  EXPEDITION_CONTAINER_IDS,
  EXPEDITION_ENEMIES,
  EXPEDITION_ENEMY_IDS,
  EXPEDITION_EXTRACT_REWARD,
  EXPEDITION_HIT_MULTIPLIERS,
  EXPEDITION_HIT_ZONES,
  EXPEDITION_GEAR,
  EXPEDITION_GEAR_IDS,
  EXPEDITION_GEAR_SLOTS,
  EXPEDITION_GEAR_MAX_UPGRADE,
  EXPEDITION_GRENADES,
  EXPEDITION_GRENADE_IDS,
  EXPEDITION_ITEM_IDS,
  EXPEDITION_ITEMS,
  EXPEDITION_QUEST_ID,
  EXPEDITION_QUESTS,
  EXPEDITION_QUEST_IDS,
  EXPEDITION_RECIPES,
  EXPEDITION_RECIPE_IDS,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_START_AMMO,
  EXPEDITION_START_BANDAGES,
  EXPEDITION_START_SHIELD_MODULES,
  EXPEDITION_SHIELD_PER_MODULE,
  EXPEDITION_TRADER_BUY_PRICES,
  EXPEDITION_TRADER_SELL_PRICES,
  EXPEDITION_VEHICLE_MAX_IMPACT_SPEED,
  EXPEDITION_VEHICLE_MIN_IMPACT_SPEED,
  EXPEDITION_WEAPONS,
  EXPEDITION_WEAPON_IDS,
  EXPEDITION_WEAPON_UPGRADE_PATHS,
  EXPEDITION_WEAPON_UPGRADE_STATS,
  type ExpeditionContainerId,
  type ExpeditionEnemyId,
  type ExpeditionArtifactId,
  type ExpeditionGearId,
  type ExpeditionGearSlot,
  type ExpeditionGrenadeId,
  type ExpeditionHitInput,
  type ExpeditionHitZone,
  type ExpeditionItemId,
  type ExpeditionRecipeId,
  type ExpeditionQuestId,
  type ExpeditionRunSnapshot,
  type ExpeditionSkillId,
  type ExpeditionTacticalId,
  type ExpeditionTacticalTarget,
  type ExpeditionVehicleHitInput,
  type ExpeditionWeaponId,
  type ExpeditionWeaponUpgradeStat,
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
  enemyDeathPositions: Partial<Record<ExpeditionEnemyId, { x: number; z: number }>>;
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
const lastExpeditionPositionPersistAt = new Map<string, number>();
const nextExpeditionVehicleHitAt = new Map<string, number>();
const nextExpeditionVehicleEnemyHitAt = new Map<string, Map<ExpeditionEnemyId, number>>();
const neighborhoodVehicleMovementTelemetry = new Map<string, {
  observedSpeed: number;
  observedAt: number;
  vehicle: boolean;
}>();
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
const EXPEDITION_VEHICLE_HIT_COOLDOWN_MS = 180;
const EXPEDITION_VEHICLE_ENEMY_HIT_COOLDOWN_MS = 650;
const EXPEDITION_VEHICLE_HIT_RADIUS = 7;
const EXPEDITION_VEHICLE_MAX_TARGETS_PER_IMPACT = 6;
const EXPEDITION_VEHICLE_TELEMETRY_MAX_AGE_MS = 450;
const EXPEDITION_VEHICLE_SPEED_TOLERANCE = 0.75;
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
    x: Math.max(-420, Math.min(420, finiteNumber(candidate.x, 0))),
    y: Math.max(0, Math.min(4, finiteNumber(candidate.y, 0))),
    z: Math.max(-1_400, Math.min(90, finiteNumber(candidate.z, 68))),
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
      updateActiveExpeditionPosition(String(socket.data.userId), previousPlayer.position, true);
      neighborhoodVehicleMovementTelemetry.delete(String(socket.data.userId));
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
const expeditionItemIds = new Set<string>(EXPEDITION_ITEM_IDS);
const expeditionRecipeIds = new Set<string>(EXPEDITION_RECIPE_IDS);
const expeditionSkillIds = new Set<string>(EXPEDITION_SKILL_IDS);
const expeditionContainerIds = new Set<string>(EXPEDITION_CONTAINER_IDS);
const expeditionEnemyIds = new Set<string>(EXPEDITION_ENEMY_IDS);
const expeditionHitZones = new Set<string>(EXPEDITION_HIT_ZONES);
const expeditionGearIds = new Set<string>(EXPEDITION_GEAR_IDS);
const expeditionGrenadeIds = new Set<string>(EXPEDITION_GRENADE_IDS);
const expeditionArtifactIds = new Set<string>(EXPEDITION_ARTIFACT_IDS);
const expeditionGearSlots = new Set<string>(EXPEDITION_GEAR_SLOTS);
const expeditionQuestIds = new Set<string>(EXPEDITION_QUEST_IDS);
const expeditionWeaponUpgradeStats = new Set<string>(EXPEDITION_WEAPON_UPGRADE_STATS);
const deepExpeditionContainerIds = new Set<ExpeditionContainerId>([
  "marsh-cache",
  "relay-armory",
  "fortress-vault",
  "reactor-core"
]);
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

function advanceExpeditionQuest(user: User, questId: ExpeditionQuestId, amount = 1) {
  const quest = EXPEDITION_QUESTS[questId];
  const state = user.expedition.quests[questId];
  if (!state || state.claimed || state.completed) return false;
  state.progress = Math.min(quest.target, state.progress + Math.max(0, amount));
  state.completed = state.progress >= quest.target;
  return state.completed;
}

function recordExpeditionEnemyDefeat(user: User, enemyId: ExpeditionEnemyId) {
  for (const questId of EXPEDITION_QUEST_IDS) {
    const quest = EXPEDITION_QUESTS[questId];
    if (quest.kind === "boss" && quest.targetEnemyId === enemyId) {
      advanceExpeditionQuest(user, questId, 1);
    }
  }
}

function deterministicExpeditionRoll(runId: string, key: string) {
  let hash = 2_166_136_261;
  const input = `${runId}:${key}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function containerCoinsForRun(runId: string, containerId: ExpeditionContainerId) {
  const roll = deterministicExpeditionRoll(runId, `container-coins:${containerId}`);
  return roll < 0.38 ? 0 : 45 + Math.floor(roll * 155);
}

function corpseLootForRun(runId: string, enemyId: ExpeditionEnemyId) {
  const enemy = EXPEDITION_ENEMIES[enemyId];
  const loot = cloneItemStacks(enemy.loot);
  const extraRoll = deterministicExpeditionRoll(runId, `corpse-extra:${enemyId}`);
  if (enemy.faction === "robot" && extraRoll > 0.46) {
    mergeItemStacks(loot, [{ itemId: "electronics", quantity: extraRoll > 0.84 ? 2 : 1 }]);
  } else if (enemy.faction === "raider" && extraRoll > 0.42) {
    mergeItemStacks(loot, [{ itemId: "bandage", quantity: 1 }]);
  }
  if (deterministicExpeditionRoll(runId, `corpse-blueprint:${enemyId}`) > 0.91) {
    mergeItemStacks(loot, [{ itemId: "rifle-blueprint", quantity: 1 }]);
  }

  const weaponCandidates: Partial<Record<ExpeditionEnemyId, { weaponId: ExpeditionWeaponId; chance: number }>> = {
    "quad-warden": { weaponId: "laser", chance: 0.12 },
    "quad-hunter": { weaponId: "rocket", chance: 0.1 },
    "raider-vika": { weaponId: "rifle", chance: 0.28 },
    "raider-boris": { weaponId: "sniper", chance: 0.16 },
    "eye-sentinel": { weaponId: "laser", chance: 0.08 },
    "eye-scorcher": { weaponId: "laser", chance: 0.14 },
    "quad-bulwark": { weaponId: "rocket", chance: 0.2 },
    "quad-stalker": { weaponId: "laser", chance: 0.12 },
    "raider-scout": { weaponId: "sniper", chance: 0.22 },
    "raider-heavy": { weaponId: "rifle", chance: 0.35 },
    "drone-skimmer": { weaponId: "laser", chance: 0.18 },
    "quad-artificer": { weaponId: "rocket", chance: 0.24 },
    "raider-medic": { weaponId: "rifle", chance: 0.3 },
    "mutant-brute": { weaponId: "rocket", chance: 0.12 },
    "boss-iron-colossus": { weaponId: "rocket", chance: 0.65 },
    "boss-storm-seraph": { weaponId: "laser", chance: 0.75 },
    "boss-void-warden": { weaponId: "sniper", chance: 0.8 }
  };
  const candidate = weaponCandidates[enemyId];
  const weaponId = candidate
    && deterministicExpeditionRoll(runId, `corpse-weapon:${enemyId}`) < candidate.chance
    ? candidate.weaponId
    : null;
  const coinRoll = deterministicExpeditionRoll(runId, `corpse-coins:${enemyId}`);
  const coins = (enemy.rewardCoins ?? 0) + 20 + Math.floor(coinRoll * (enemy.hostile ? 180 : 70));
  return { loot, coins, weaponId };
}

function tradeQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
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
    playerPosition: { ...run.playerPosition },
    backpack: cloneItemStacks(run.backpack),
    lootedContainerIds: [...run.lootedContainerIds],
    lootedEnemyIds: [...run.lootedEnemyIds],
    killedEnemyIds: [...run.killedEnemyIds],
    carriedCoins: run.carriedCoins,
    carriedWeaponIds: [...run.carriedWeaponIds],
    playerHealth: run.playerHealth,
    playerMaxHealth: run.playerMaxHealth,
    playerShield: run.playerShield,
    supportRobotUntil: run.supportRobotUntil,
    scannerUntil: run.scannerUntil,
    downedAt: run.downedAt,
    bleedOutAt: run.bleedOutAt,
    enemyHealth: { ...run.enemyHealth },
    objective: makeRunObjective(run)
  };
}

function makeContainerLoot(runId: string) {
  return Object.fromEntries(EXPEDITION_CONTAINER_IDS.map((containerId) => [
    containerId,
    (() => {
      const loot = cloneItemStacks(EXPEDITION_CONTAINERS[containerId].loot);
      const roll = deterministicExpeditionRoll(runId, `container-extra:${containerId}`);
      if (roll > 0.72) {
        mergeItemStacks(loot, [{ itemId: "bandage", quantity: 1 }]);
      } else if (roll > 0.38) {
        mergeItemStacks(loot, [{ itemId: "electronics", quantity: 1 }]);
      } else {
        mergeItemStacks(loot, [{ itemId: "fabric", quantity: 2 }]);
      }
      return loot.length > 0 ? loot : [{ itemId: "scrap", quantity: 1 }];
    })()
  ])) as Record<ExpeditionContainerId, ItemStack[]>;
}

function createActiveExpeditionRun(user: User): ActiveExpeditionRun {
  const id = crypto.randomUUID();
  const playerPosition = sanitizeNeighborhoodPosition(
    lastNeighborhoodPositions.get(user.id) ?? defaultNeighborhoodPosition()
  );
  const ammoToPack = Math.min(
    EXPEDITION_START_AMMO[user.expedition.selectedWeapon],
    itemStackQuantity(user.expedition.stash, "ammo")
  );
  const bandagesToPack = Math.min(
    EXPEDITION_START_BANDAGES,
    itemStackQuantity(user.expedition.stash, "bandage")
  );
  const shieldModulesToPack = Math.min(
    EXPEDITION_START_SHIELD_MODULES,
    itemStackQuantity(user.expedition.stash, "shield-module")
  );
  const tacticalItems = ([...EXPEDITION_GRENADE_IDS, ...EXPEDITION_ARTIFACT_IDS] as ExpeditionTacticalId[])
    .map((itemId) => ({
      itemId,
      quantity: Math.min(itemStackQuantity(user.expedition.stash, itemId), expeditionGrenadeIds.has(itemId) ? 3 : 1)
    }))
    .filter((stack) => stack.quantity > 0);
  const packedItems = ([
    { itemId: "ammo", quantity: ammoToPack },
    { itemId: "bandage", quantity: bandagesToPack },
    { itemId: "shield-module", quantity: shieldModulesToPack },
    ...tacticalItems
  ] satisfies ItemStack[]).filter((stack) => stack.quantity > 0);
  const nextStash = deductItemStacks(user.expedition.stash, packedItems);
  if (nextStash) user.expedition.stash = nextStash;
  const playerMaxHealth = 100 + user.expedition.skills.survival * 10;
  const gearShield = EXPEDITION_GEAR_SLOTS.reduce((total, slot) => {
    const gearId = user.expedition.equippedGear[slot];
    const upgradeLevel = gearId ? user.expedition.gearUpgrades[gearId] : 0;
    return total + (gearId ? EXPEDITION_GEAR[gearId].bonusShield * (1 + upgradeLevel * 0.08) : 0);
  }, 0);
  const armorEffectiveness = 1 + user.expedition.skills.armor * 0.04;
  return {
    id,
    userId: user.id,
    startedAt: Date.now(),
    selectedWeapon: user.expedition.selectedWeapon,
    playerPosition,
    backpack: cloneItemStacks(packedItems),
    lootedContainerIds: [],
    lootedEnemyIds: [],
    killedEnemyIds: [],
    carriedCoins: 0,
    carriedWeaponIds: [],
    playerHealth: playerMaxHealth,
    playerMaxHealth,
    playerShield: Math.round((shieldModulesToPack * EXPEDITION_SHIELD_PER_MODULE + gearShield) * armorEffectiveness),
    supportRobotUntil: null,
    scannerUntil: null,
    downedAt: null,
    bleedOutAt: null,
    enemyHealth: makeEnemyHealth(),
    objective: {
      powerCells: 0,
      hostileKills: 0,
      requiredPowerCells: 1,
      requiredHostileKills: 2,
      complete: false
    },
    containerLoot: makeContainerLoot(id),
    enemyDeathPositions: {},
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
  const lootedEnemyIds = Array.isArray(storedRun.lootedEnemyIds)
    ? [...new Set(storedRun.lootedEnemyIds.filter((id): id is ExpeditionEnemyId => (
      expeditionEnemyIds.has(String(id)) && killedEnemyIds.includes(id as ExpeditionEnemyId)
    )))]
    : [...killedEnemyIds];
  const restoredId = typeof storedRun.id === "string" && storedRun.id ? storedRun.id : crypto.randomUUID();
  const enemyDeathPositions: ActiveExpeditionRun["enemyDeathPositions"] = {};
  for (const enemyId of killedEnemyIds) {
    const rawPosition = storedRun.enemyDeathPositions?.[enemyId];
    const x = Number(rawPosition?.x);
    const z = Number(rawPosition?.z);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      enemyDeathPositions[enemyId] = { x, z };
    }
  }
  const playerMaxHealth = 100 + user.expedition.skills.survival * 10;
  const maximumShield = Math.round(((Array.isArray(storedRun.backpack) ? storedRun.backpack : []).reduce((total, stack) => (
    stack.itemId === "shield-module"
      ? total + stack.quantity * EXPEDITION_SHIELD_PER_MODULE
      : total
  ), 0) + EXPEDITION_GEAR_SLOTS.reduce((total, slot) => {
    const gearId = user.expedition.equippedGear[slot];
    const upgradeLevel = gearId ? user.expedition.gearUpgrades[gearId] : 0;
    return total + (gearId ? EXPEDITION_GEAR[gearId].bonusShield * (1 + upgradeLevel * 0.08) : 0);
  }, 0)) * (1 + user.expedition.skills.armor * 0.04));
  const storedPlayerHealth = Number(storedRun.playerHealth);
  const playerHealth = Number.isFinite(storedPlayerHealth)
    ? Math.max(0, Math.min(playerMaxHealth, Math.round(storedPlayerHealth)))
    : playerMaxHealth;
  const storedPlayerShield = Number(storedRun.playerShield);
  const playerShield = Number.isFinite(storedPlayerShield)
    ? Math.max(0, Math.min(maximumShield, Math.round(storedPlayerShield)))
    : maximumShield;
  const storedDownedAt = Number(storedRun.downedAt);
  const downedAt = playerHealth <= 0 && Number.isFinite(storedDownedAt) && storedDownedAt > 0
    ? Math.round(storedDownedAt)
    : null;
  const storedBleedOutAt = Number(storedRun.bleedOutAt);
  const bleedOutAt = downedAt
    ? Number.isFinite(storedBleedOutAt) && storedBleedOutAt >= downedAt
      ? Math.round(storedBleedOutAt)
      : downedAt + EXPEDITION_DOWNED_BLEED_OUT_MS
    : null;
  const restored: ActiveExpeditionRun = {
    id: restoredId,
    startedAt: Number.isFinite(Number(storedRun.startedAt)) ? Number(storedRun.startedAt) : Date.now(),
    selectedWeapon: expeditionWeaponIds.has(String(storedRun.selectedWeapon))
      ? storedRun.selectedWeapon as ExpeditionWeaponId
      : user.expedition.selectedWeapon,
    playerPosition: sanitizeNeighborhoodPosition(storedRun.playerPosition ?? defaultNeighborhoodPosition()),
    userId: user.id,
    backpack: Array.isArray(storedRun.backpack) ? cloneItemStacks(storedRun.backpack) : [],
    lootedContainerIds,
    lootedEnemyIds,
    killedEnemyIds,
    carriedCoins: Number.isFinite(Number(storedRun.carriedCoins))
      ? Math.max(0, Math.min(999_999_999, Math.round(Number(storedRun.carriedCoins))))
      : 0,
    carriedWeaponIds: Array.isArray(storedRun.carriedWeaponIds)
      ? [...new Set(storedRun.carriedWeaponIds.filter((id): id is ExpeditionWeaponId => expeditionWeaponIds.has(String(id))))]
      : [],
    playerHealth,
    playerMaxHealth,
    playerShield,
    supportRobotUntil: Number.isFinite(Number(storedRun.supportRobotUntil)) && Number(storedRun.supportRobotUntil) > Date.now()
      ? Math.round(Number(storedRun.supportRobotUntil))
      : null,
    scannerUntil: Number.isFinite(Number(storedRun.scannerUntil)) && Number(storedRun.scannerUntil) > Date.now()
      ? Math.round(Number(storedRun.scannerUntil))
      : null,
    downedAt,
    bleedOutAt,
    enemyHealth: makeEnemyHealth(storedRun.enemyHealth, killedEnemyIds),
    objective: {
      powerCells: 0,
      hostileKills: 0,
      requiredPowerCells: 1,
      requiredHostileKills: 2,
      complete: false
    },
    containerLoot: makeContainerLoot(restoredId),
    enemyDeathPositions,
    nextHitAt: Number.isFinite(Number(storedRun.nextHitAt)) ? Math.max(0, Number(storedRun.nextHitAt)) : 0
  };
  activeExpeditionRuns.set(user.id, restored);
  return restored;
}

function persistActiveRun(user: User, run: ActiveExpeditionRun) {
  user.expeditionRun = {
    ...makeRunSnapshot(run),
    nextHitAt: run.nextHitAt,
    enemyDeathPositions: { ...run.enemyDeathPositions }
  };
}

function updateActiveExpeditionPosition(
  userId: string,
  position: LivePlayer["position"],
  forcePersist = false
) {
  const run = activeExpeditionRuns.get(userId);
  if (!run) return;
  run.playerPosition = sanitizeNeighborhoodPosition(position);

  const now = Date.now();
  const lastPersistedAt = lastExpeditionPositionPersistAt.get(userId) ?? 0;
  if (!forcePersist && now - lastPersistedAt < 1_000) return;

  const db = readDb();
  const user = db.users.find((entry) => entry.id === userId);
  if (!user || user.expeditionRun?.id !== run.id) {
    lastExpeditionPositionPersistAt.delete(userId);
    return;
  }
  persistActiveRun(user, run);
  writeDb(db);
  lastExpeditionPositionPersistAt.set(userId, now);
}

function discardActiveExpedition(db: DbShape, user: User, run: ActiveExpeditionRun) {
  const lost = cloneItemStacks(run.backpack);
  const lostCoins = run.carriedCoins;
  const lostWeapons = [...run.carriedWeaponIds];
  user.expedition.stats.abandonedRuns += 1;
  delete user.expeditionRun;
  writeDb(db);
  activeExpeditionRuns.delete(user.id);
  lastExpeditionPositionPersistAt.delete(user.id);
  resetNeighborhoodPositionAfterExpedition(user.id);
  return {
    profile: user.expedition,
    lost,
    lostCoins,
    lostWeapons
  };
}

function resetNeighborhoodPositionAfterExpedition(userId: string) {
  const position = { x: 0, y: 0, z: -72, rotation: Math.PI, vehicle: false };
  lastNeighborhoodPositions.set(userId, position);
  nextExpeditionVehicleHitAt.delete(userId);
  nextExpeditionVehicleEnemyHitAt.delete(userId);
  neighborhoodVehicleMovementTelemetry.delete(userId);
  neighborhoodMovementStates.set(userId, {
    lastAt: Date.now(),
    budget: NEIGHBORHOOD_INITIAL_MOVE_BUDGET,
    needsInitialCitySync: false
  });
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

fastify.post("/api/expedition/equip-gear", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { slot?: unknown; gearId?: unknown };
    const slot = String(body.slot ?? "");
    const rawGearId = body.gearId == null ? null : String(body.gearId);
    if (!expeditionGearSlots.has(slot) || (rawGearId !== null && !expeditionGearIds.has(rawGearId))) {
      return reply.code(400).send({ error: "Неизвестный слот или предмет экипировки" });
    }
    const typedSlot = slot as ExpeditionGearSlot;
    const typedGearId = rawGearId as ExpeditionGearId | null;
    if (typedGearId && EXPEDITION_GEAR[typedGearId].slot !== typedSlot) {
      return reply.code(400).send({ error: "Этот предмет нельзя надеть в выбранный слот" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Экипировку можно менять только в городе или дома" });
    }
    if (typedGearId && itemStackQuantity(user.expedition.stash, typedGearId) < 1) {
      return reply.code(403).send({ error: "Сначала купите или изготовьте этот предмет" });
    }

    user.expedition.equippedGear[typedSlot] = typedGearId;
    writeDb(db);
    return {
      profile: user.expedition,
      equipped: typedGearId ? EXPEDITION_GEAR[typedGearId] : null,
      slot: typedSlot
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/upgrade-weapon", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { weaponId?: unknown; stat?: unknown };
    const weaponId = String(body.weaponId ?? "");
    const stat = String(body.stat ?? "");
    if (!expeditionWeaponIds.has(weaponId) || !expeditionWeaponUpgradeStats.has(stat)) {
      return reply.code(400).send({ error: "Неизвестное оружие или направление улучшения" });
    }
    const typedWeaponId = weaponId as ExpeditionWeaponId;
    const typedStat = stat as ExpeditionWeaponUpgradeStat;
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Улучшать оружие можно только в городе или дома" });
    }
    if (!user.expedition.unlockedWeapons.includes(typedWeaponId)) {
      return reply.code(403).send({ error: "Сначала откройте это оружие" });
    }
    const currentLevel = user.expedition.weaponUpgrades[typedWeaponId][typedStat];
    if (currentLevel >= EXPEDITION_WEAPON_UPGRADE_PATHS[typedStat].maxLevel) {
      return reply.code(409).send({ error: "Это улучшение уже достигло максимального уровня" });
    }
    const cost = expeditionWeaponUpgradeCost(typedStat, currentLevel);
    if (user.coins < cost.coins) {
      return reply.code(400).send({ error: "Не хватает монет для улучшения" });
    }
    const nextStash = deductItemStacks(user.expedition.stash, cost.ingredients);
    if (!nextStash) {
      return reply.code(400).send({ error: "Не хватает ядер улучшения или деталей оружия" });
    }
    user.coins -= cost.coins;
    user.expedition.stash = nextStash;
    user.expedition.weaponUpgrades[typedWeaponId][typedStat] = currentLevel + 1;
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      weapon: EXPEDITION_WEAPONS[typedWeaponId],
      stat: typedStat,
      level: currentLevel + 1,
      stats: expeditionWeaponStats(typedWeaponId, user.expedition.weaponUpgrades[typedWeaponId]),
      spent: cost
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/upgrade-gear", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const gearId = String(((request.body ?? {}) as { gearId?: unknown }).gearId ?? "");
    if (!expeditionGearIds.has(gearId)) {
      return reply.code(400).send({ error: "Неизвестный предмет экипировки" });
    }
    const typedGearId = gearId as ExpeditionGearId;
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Улучшать экипировку можно только в городе или дома" });
    }
    if (itemStackQuantity(user.expedition.stash, typedGearId) < 1) {
      return reply.code(403).send({ error: "Сначала получите этот предмет" });
    }
    const currentLevel = user.expedition.gearUpgrades[typedGearId];
    if (currentLevel >= EXPEDITION_GEAR_MAX_UPGRADE) {
      return reply.code(409).send({ error: "Экипировка уже улучшена максимально" });
    }
    const cost = expeditionGearUpgradeCost(currentLevel);
    if (user.coins < cost.coins) {
      return reply.code(400).send({ error: "Не хватает монет для улучшения" });
    }
    const nextStash = deductItemStacks(user.expedition.stash, cost.ingredients);
    if (!nextStash) {
      return reply.code(400).send({ error: "Не хватает ядер улучшения или бронепластин" });
    }
    user.coins -= cost.coins;
    user.expedition.stash = nextStash;
    user.expedition.gearUpgrades[typedGearId] = currentLevel + 1;
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      gear: EXPEDITION_GEAR[typedGearId],
      level: currentLevel + 1,
      spent: cost
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/claim-quest", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const questId = String(((request.body ?? {}) as { questId?: unknown }).questId ?? "");
    if (!expeditionQuestIds.has(questId)) {
      return reply.code(400).send({ error: "Неизвестное задание" });
    }
    const typedQuestId = questId as ExpeditionQuestId;
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Награду можно забрать после возвращения в город" });
    }
    const state = user.expedition.quests[typedQuestId];
    if (!state.completed) {
      return reply.code(409).send({ error: "Задание ещё не выполнено" });
    }
    if (state.claimed) {
      return reply.code(409).send({ error: "Награда уже получена" });
    }
    const quest = EXPEDITION_QUESTS[typedQuestId];
    user.coins = Math.min(999_999_999, user.coins + quest.reward.coins);
    user.expedition.skillPoints = Math.min(9_999, user.expedition.skillPoints + quest.reward.skillPoints);
    mergeItemStacks(user.expedition.stash, quest.reward.items);
    state.claimed = true;
    if (!user.expedition.completedQuestIds.includes(typedQuestId)) {
      user.expedition.completedQuestIds.push(typedQuestId);
    }
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      quest,
      reward: quest.reward
    };
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

fastify.get("/api/expedition/trader", async (request, reply) => {
  try {
    requireUser(request);
    return {
      buyPrices: EXPEDITION_TRADER_BUY_PRICES,
      sellPrices: EXPEDITION_TRADER_SELL_PRICES
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/trader/buy", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { itemId?: unknown; quantity?: unknown };
    const itemId = String(body.itemId ?? "");
    const quantity = tradeQuantity(body.quantity);
    if (!expeditionItemIds.has(itemId) || !quantity) {
      return reply.code(400).send({ error: "Укажите товар и количество от 1 до 99" });
    }
    const typedItemId = itemId as ExpeditionItemId;
    const unitPrice = (EXPEDITION_TRADER_BUY_PRICES as Partial<Record<ExpeditionItemId, number>>)[typedItemId];
    if (!unitPrice) {
      return reply.code(400).send({ error: "Этот предмет продавец не продаёт" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Торговец доступен только в городе или дома" });
    }
    const spent = unitPrice * quantity;
    if (user.coins < spent) {
      return reply.code(400).send({ error: "Не хватает монет" });
    }

    const purchased: ItemStack = { itemId: typedItemId, quantity };
    user.coins -= spent;
    mergeItemStacks(user.expedition.stash, [purchased]);
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      purchased,
      spent
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/trader/sell", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { itemId?: unknown; quantity?: unknown };
    const itemId = String(body.itemId ?? "");
    const quantity = tradeQuantity(body.quantity);
    if (!expeditionItemIds.has(itemId) || !quantity) {
      return reply.code(400).send({ error: "Укажите предмет и количество от 1 до 99" });
    }
    const typedItemId = itemId as ExpeditionItemId;
    const unitPrice = EXPEDITION_TRADER_SELL_PRICES[typedItemId];
    if (!unitPrice) {
      return reply.code(400).send({ error: "Этот предмет продавец не принимает" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    if (activeRunForUser(user)) {
      return reply.code(409).send({ error: "Торговец доступен только в городе или дома" });
    }
    const nextStash = deductItemStacks(user.expedition.stash, [{ itemId: typedItemId, quantity }]);
    if (!nextStash) {
      return reply.code(400).send({ error: "В тайнике нет такого количества предметов" });
    }

    const earned = unitPrice * quantity;
    const sold: ItemStack = { itemId: typedItemId, quantity };
    user.expedition.stash = nextStash;
    for (const slot of EXPEDITION_GEAR_SLOTS) {
      if (user.expedition.equippedGear[slot] === typedItemId && itemStackQuantity(nextStash, typedItemId) < 1) {
        user.expedition.equippedGear[slot] = null;
      }
    }
    user.coins = Math.min(999_999_999, user.coins + earned);
    writeDb(db);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      sold,
      earned
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
    const missingRequirement = Object.entries(skill.requires ?? {}).find(([requiredSkillId, requiredLevel]) => (
      user.expedition.skills[requiredSkillId as ExpeditionSkillId] < Number(requiredLevel)
    ));
    if (missingRequirement) {
      const requiredSkill = EXPEDITION_SKILLS[missingRequirement[0] as ExpeditionSkillId];
      return reply.code(409).send({
        error: `Сначала повысьте навык «${requiredSkill.name}» до ${missingRequirement[1]} уровня`
      });
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
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "В тяжёлом состоянии обыскивать контейнеры нельзя" });
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
    const coins = containerCoinsForRun(run.id, typedContainerId);
    run.carriedCoins = Math.min(999_999_999, run.carriedCoins + coins);
    run.lootedContainerIds.push(typedContainerId);
    persistActiveRun(user, run);
    user.expedition.stats.containersLooted += 1;
    if (deepExpeditionContainerIds.has(typedContainerId)) {
      advanceExpeditionQuest(user, "deep-salvage", 1);
    }
    writeDb(db);
    return {
      profile: user.expedition,
      run: makeRunSnapshot(run),
      container,
      loot,
      coins
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/loot-enemy", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { enemyId?: unknown };
    const enemyId = String(body.enemyId ?? "");
    if (!expeditionEnemyIds.has(enemyId)) {
      return reply.code(400).send({ error: "Неизвестный противник" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "В тяжёлом состоянии обыскивать противников нельзя" });
    }
    const typedEnemyId = enemyId as ExpeditionEnemyId;
    if (!run.killedEnemyIds.includes(typedEnemyId)) {
      return reply.code(409).send({ error: "Сначала победите этого противника" });
    }
    if (run.lootedEnemyIds.includes(typedEnemyId)) {
      return reply.code(409).send({ error: "Этот противник уже был обыскан" });
    }

    const enemy = EXPEDITION_ENEMIES[typedEnemyId];
    const deathPosition = run.enemyDeathPositions[typedEnemyId]
      ?? { x: enemy.position[0], z: enemy.position[1] };
    if (!isNearExpeditionPoint(user.id, [deathPosition.x, deathPosition.z], 7.5)) {
      return reply.code(403).send({ error: "Подойдите ближе к телу противника" });
    }

    const generated = corpseLootForRun(run.id, typedEnemyId);
    const scavengingLevel = user.expedition.skills.scavenging;
    const loot = generated.loot.map((stack) => ({
      ...stack,
      quantity: Math.max(1, Math.min(
        999_999,
        stack.quantity + Math.floor(stack.quantity * scavengingLevel * 0.1)
      ))
    }));
    if (loot.length === 0) {
      loot.push({ itemId: "scrap", quantity: 1 });
    }

    let carriedWeapon: ExpeditionWeaponId | null = null;
    const converted: ItemStack[] = [];
    if (generated.weaponId) {
      if (
        user.expedition.unlockedWeapons.includes(generated.weaponId)
        || run.carriedWeaponIds.includes(generated.weaponId)
      ) {
        converted.push({ itemId: "weapon-parts", quantity: 4 });
        mergeItemStacks(loot, converted);
      } else {
        run.carriedWeaponIds.push(generated.weaponId);
        carriedWeapon = generated.weaponId;
      }
    }

    mergeItemStacks(run.backpack, loot);
    run.carriedCoins = Math.min(999_999_999, run.carriedCoins + generated.coins);
    run.lootedEnemyIds.push(typedEnemyId);
    persistActiveRun(user, run);
    writeDb(db);
    return {
      profile: user.expedition,
      run: makeRunSnapshot(run),
      enemy,
      loot,
      coins: generated.coins,
      weaponDrop: generated.weaponId,
      carriedWeapon,
      converted
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/player-status", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { health?: unknown; shield?: unknown; downed?: unknown };
    const reportedHealth = Number(body.health);
    const reportedShield = Number(body.shield);
    if (!Number.isFinite(reportedHealth) || !Number.isFinite(reportedShield)) {
      return reply.code(400).send({ error: "Некорректное состояние персонажа" });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }

    // The client may report damage immediately for responsive combat, but it
    // can never use this route to raise health or restore a depleted shield.
    run.playerHealth = Math.min(
      run.playerHealth,
      Math.max(0, Math.min(run.playerMaxHealth, Math.round(reportedHealth)))
    );
    run.playerShield = Math.min(
      run.playerShield,
      Math.max(0, Math.round(reportedShield))
    );
    if (body.downed === true || run.playerHealth <= 0) {
      run.playerHealth = 0;
      if (!run.downedAt) {
        run.downedAt = Date.now();
        run.bleedOutAt = run.downedAt + EXPEDITION_DOWNED_BLEED_OUT_MS;
      }
    }

    persistActiveRun(user, run);
    writeDb(db);
    return { run: makeRunSnapshot(run) };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/use-bandage", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Бинты можно использовать только в активной экспедиции" });
    }
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "После тяжёлого ранения бинт уже не поможет" });
    }
    if (run.playerHealth >= run.playerMaxHealth) {
      return reply.code(409).send({ error: "Здоровье уже полное" });
    }
    const used: ItemStack = { itemId: "bandage", quantity: 1 };
    const nextBackpack = deductItemStacks(run.backpack, [used]);
    if (!nextBackpack) {
      return reply.code(409).send({ error: "В рюкзаке нет бинтов" });
    }

    run.backpack = nextBackpack;
    const medicineMultiplier = 1 + user.expedition.skills.medicine * 0.08;
    const heal = Math.min(Math.round(EXPEDITION_BANDAGE_HEAL * medicineMultiplier), run.playerMaxHealth - run.playerHealth);
    run.playerHealth += heal;
    persistActiveRun(user, run);
    writeDb(db);
    return {
      run: makeRunSnapshot(run),
      used,
      heal
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/use-tactical", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as {
      itemId?: unknown;
      origin?: { x?: unknown; z?: unknown };
      targets?: unknown;
    };
    const itemId = String(body.itemId ?? "");
    if (!expeditionGrenadeIds.has(itemId) && !expeditionArtifactIds.has(itemId)) {
      return reply.code(400).send({ error: "Неизвестная граната или артефакт" });
    }
    const typedItemId = itemId as ExpeditionTacticalId;
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Тактические предметы доступны только в активной экспедиции" });
    }
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "В тяжёлом состоянии использовать предмет нельзя" });
    }

    const used: ItemStack = { itemId: typedItemId, quantity: 1 };
    const nextBackpack = deductItemStacks(run.backpack, [used]);
    if (!nextBackpack) {
      return reply.code(409).send({ error: "Этого предмета нет в рюкзаке" });
    }

    const now = Date.now();
    const livePosition = liveNeighborhoodPosition(user.id) ?? run.playerPosition;
    const originX = Number(body.origin?.x);
    const originZ = Number(body.origin?.z);
    const origin = {
      x: Number.isFinite(originX) ? originX : livePosition.x,
      z: Number.isFinite(originZ) ? originZ : livePosition.z
    };
    if ((origin.x - livePosition.x) ** 2 + (origin.z - livePosition.z) ** 2 > 34 ** 2) {
      return reply.code(403).send({ error: "Точка применения слишком далеко" });
    }

    const rawTargets = Array.isArray(body.targets) ? body.targets.slice(0, EXPEDITION_ENEMY_IDS.length) : [];
    const requestedTargets = new Map<ExpeditionEnemyId, ExpeditionTacticalTarget>();
    for (const rawTarget of rawTargets) {
      if (!rawTarget || typeof rawTarget !== "object") continue;
      const target = rawTarget as { enemyId?: unknown; distance?: unknown; position?: { x?: unknown; z?: unknown } };
      const enemyId = String(target.enemyId ?? "");
      if (!expeditionEnemyIds.has(enemyId)) continue;
      const typedEnemyId = enemyId as ExpeditionEnemyId;
      const positionX = Number(target.position?.x);
      const positionZ = Number(target.position?.z);
      const fallback = EXPEDITION_ENEMIES[typedEnemyId].position;
      const position = {
        x: Number.isFinite(positionX) ? positionX : fallback[0],
        z: Number.isFinite(positionZ) ? positionZ : fallback[1]
      };
      // Enemy patrols stay within roughly 30 metres of their authoritative
      // spawn. This keeps client-side animation responsive without allowing a
      // forged grenade payload to teleport a remote corpse to the blast.
      if (Math.hypot(position.x - fallback[0], position.z - fallback[1]) > expeditionEnemyPatrolTolerance(typedEnemyId)) continue;
      const distance = Math.hypot(position.x - origin.x, position.z - origin.z);
      if (!Number.isFinite(distance)) continue;
      requestedTargets.set(typedEnemyId, { enemyId: typedEnemyId, distance, position });
    }

    const isNuke = typedItemId === "artifact-nuke";
    const targets = [...requestedTargets.values()];

    run.backpack = nextBackpack;
    if (typedItemId === "artifact-robot-beacon") {
      run.supportRobotUntil = now + EXPEDITION_ARTIFACTS[typedItemId].durationMs;
    } else if (typedItemId === "artifact-scanner") {
      run.scannerUntil = now + EXPEDITION_ARTIFACTS[typedItemId].durationMs;
    }

    const grenade = expeditionGrenadeIds.has(typedItemId)
      ? EXPEDITION_GRENADES[typedItemId as ExpeditionGrenadeId]
      : null;
    const nukeRadius = 28;
    const radius = isNuke ? nukeRadius : (grenade?.radius ?? Number.POSITIVE_INFINITY);
    const demolitionMultiplier = 1 + user.expedition.skills.demolition * 0.08;
    const hits = targets.flatMap((target) => {
      if (run.killedEnemyIds.includes(target.enemyId) || target.distance > radius) return [];
      const enemy = EXPEDITION_ENEMIES[target.enemyId];
      const falloff = grenade
        ? Math.max(0.28, 1 - target.distance / (grenade.radius * 1.25))
        : isNuke
          ? Math.max(0.25, 1 - target.distance / (nukeRadius * 1.15))
          : 1;
      const factionMultiplier = grenade && enemy.faction === "robot" ? grenade.robotMultiplier : 1;
      const damage = isNuke
        ? enemy.boss
          ? Math.max(1, Math.round(420 * demolitionMultiplier * falloff))
          : 9_999
        : Math.max(1, Math.round((grenade?.damage ?? 0) * demolitionMultiplier * falloff * factionMultiplier));
      if (damage <= 0) return [];
      const remainingHealth = Math.max(0, (run.enemyHealth[target.enemyId] ?? enemy.maxHealth) - damage);
      const killed = remainingHealth <= 0;
      run.enemyHealth[target.enemyId] = remainingHealth;
      if (killed) {
        run.killedEnemyIds.push(target.enemyId);
        run.enemyDeathPositions[target.enemyId] = target.position
          ? { ...target.position }
          : { x: enemy.position[0], z: enemy.position[1] };
        user.expedition.stats.enemiesKilled += 1;
        if (enemy.hostile) user.expedition.stats.hostileEnemiesKilled += 1;
        recordExpeditionEnemyDefeat(user, target.enemyId);
      }
      return [{ enemy, damage, remainingHealth, killed, corpseLootAvailable: killed }];
    });

    persistActiveRun(user, run);
    writeDb(db);
    return {
      profile: user.expedition,
      run: makeRunSnapshot(run),
      used,
      item: EXPEDITION_ITEMS[typedItemId],
      effect: expeditionGrenadeIds.has(typedItemId)
        ? EXPEDITION_GRENADES[typedItemId as ExpeditionGrenadeId]
        : EXPEDITION_ARTIFACTS[typedItemId as ExpeditionArtifactId],
      hits
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
      return reply.code(400).send({ error: `Передайте список до ${EXPEDITION_ENEMY_IDS.length} попаданий одного выстрела` });
    }

    const hitByEnemy = new Map<ExpeditionEnemyId, ExpeditionHitInput>();
    for (const candidate of body.hits) {
      if (!candidate || typeof candidate !== "object") {
        return reply.code(400).send({ error: "Некорректные данные попадания" });
      }
      const raw = candidate as {
        enemyId?: unknown;
        zone?: unknown;
        damageScale?: unknown;
        position?: { x?: unknown; z?: unknown };
      };
      const enemyId = String(raw.enemyId ?? "");
      const zone = String(raw.zone ?? "");
      if (!expeditionEnemyIds.has(enemyId) || !expeditionHitZones.has(zone)) {
        return reply.code(400).send({ error: "Неизвестный противник или зона попадания" });
      }
      const typedEnemyId = enemyId as ExpeditionEnemyId;
      if (hitByEnemy.has(typedEnemyId)) continue;
      const numericScale = Number(raw.damageScale);
      const positionX = Number(raw.position?.x);
      const positionZ = Number(raw.position?.z);
      hitByEnemy.set(typedEnemyId, {
        enemyId: typedEnemyId,
        zone: zone as ExpeditionHitZone,
        damageScale: Number.isFinite(numericScale) ? numericScale : 1,
        position: Number.isFinite(positionX) && Number.isFinite(positionZ)
          ? { x: positionX, z: positionZ }
          : undefined
      });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "В тяжёлом состоянии стрелять нельзя" });
    }
    const requestedHits = [...hitByEnemy.values()].filter((hit) => !run.killedEnemyIds.includes(hit.enemyId));
    if (body.hits.length > 0 && requestedHits.length === 0) {
      return reply.code(409).send({ error: "Все указанные противники уже были побеждены" });
    }

    const upgradedWeapon = expeditionWeaponStats(
      run.selectedWeapon,
      user.expedition.weaponUpgrades[run.selectedWeapon]
    );
    if (run.selectedWeapon !== "rocket" && requestedHits.length > 1) {
      return reply.code(400).send({ error: "Это оружие поражает только одну цель за выстрел" });
    }
    const livePosition = liveNeighborhoodPosition(user.id);
    for (const hit of requestedHits) {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      const patrolTolerance = expeditionEnemyPatrolTolerance(hit.enemyId);
      if (!isNearExpeditionPoint(user.id, enemy.position, upgradedWeapon.range + patrolTolerance)) {
        return reply.code(403).send({ error: `${enemy.name}: цель слишком далеко от вашей позиции` });
      }
      if (hit.position) {
        const fromHomeSquared = (hit.position.x - enemy.position[0]) ** 2
          + (hit.position.z - enemy.position[1]) ** 2;
        const fromPlayerSquared = livePosition
          ? (hit.position.x - livePosition.x) ** 2 + (hit.position.z - livePosition.z) ** 2
          : Number.POSITIVE_INFINITY;
        if (fromHomeSquared > patrolTolerance ** 2 || fromPlayerSquared > (upgradedWeapon.range + 3) ** 2) {
          return reply.code(403).send({ error: `${enemy.name}: некорректная позиция попадания` });
        }
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
    const baseDamage = upgradedWeapon.damage * (1 + weaponsLevel * 0.05);
    const hitResults = requestedHits.map((hit) => {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      const damageMultiplier = run.selectedWeapon === "rocket"
        ? Math.max(0.28, Math.min(1, hit.damageScale ?? 1))
        : EXPEDITION_HIT_MULTIPLIERS[hit.zone];
      const damage = Math.max(1, Math.round(baseDamage * damageMultiplier));
      const remainingHealth = Math.max(0, (run.enemyHealth[hit.enemyId] ?? enemy.maxHealth) - damage);
      const killed = remainingHealth <= 0;
      run.enemyHealth[hit.enemyId] = remainingHealth;
      if (killed) {
        run.killedEnemyIds.push(hit.enemyId);
        run.enemyDeathPositions[hit.enemyId] = hit.position
          ? { x: hit.position.x, z: hit.position.z }
          : { x: enemy.position[0], z: enemy.position[1] };
        user.expedition.stats.enemiesKilled += 1;
        if (enemy.hostile) {
          user.expedition.stats.hostileEnemiesKilled += 1;
        }
        recordExpeditionEnemyDefeat(user, hit.enemyId);
      }
      return {
        enemy,
        weaponId: run.selectedWeapon,
        damage,
        remainingHealth,
        killed,
        loot: [] as ItemStack[],
        corpseLootAvailable: killed
      };
    });
    run.nextHitAt = now + Math.max(40, upgradedWeapon.fireIntervalMs - 20);
    persistActiveRun(user, run);
    writeDb(db);
    return {
      profile: user.expedition,
      run: makeRunSnapshot(run),
      hits: hitResults
    };
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/vehicle-hit", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const body = (request.body ?? {}) as { hits?: unknown };
    if (
      !Array.isArray(body.hits)
      || body.hits.length < 1
      || body.hits.length > EXPEDITION_VEHICLE_MAX_TARGETS_PER_IMPACT
    ) {
      return reply.code(400).send({
        error: `Передайте от 1 до ${EXPEDITION_VEHICLE_MAX_TARGETS_PER_IMPACT} столкновений`
      });
    }

    const seenEnemyIds = new Set<ExpeditionEnemyId>();
    const requestedHits: ExpeditionVehicleHitInput[] = [];
    for (const candidate of body.hits) {
      if (!candidate || typeof candidate !== "object") {
        return reply.code(400).send({ error: "Некорректные данные столкновения" });
      }
      const raw = candidate as {
        enemyId?: unknown;
        speed?: unknown;
        position?: { x?: unknown; z?: unknown };
      };
      const enemyId = String(raw.enemyId ?? "");
      if (!expeditionEnemyIds.has(enemyId)) {
        return reply.code(400).send({ error: "Неизвестный противник" });
      }
      const typedEnemyId = enemyId as ExpeditionEnemyId;
      if (seenEnemyIds.has(typedEnemyId)) {
        return reply.code(400).send({ error: "Один противник не может быть указан дважды" });
      }
      seenEnemyIds.add(typedEnemyId);

      const rawSpeed = Number(raw.speed);
      const rawPositionX = Number(raw.position?.x);
      const rawPositionZ = Number(raw.position?.z);
      if (!Number.isFinite(rawSpeed) || !Number.isFinite(rawPositionX) || !Number.isFinite(rawPositionZ)) {
        return reply.code(400).send({ error: "Укажите скорость и точку столкновения" });
      }
      const impactSpeed = Math.min(EXPEDITION_VEHICLE_MAX_IMPACT_SPEED, Math.abs(rawSpeed));
      if (impactSpeed < EXPEDITION_VEHICLE_MIN_IMPACT_SPEED) {
        return reply.code(400).send({ error: "Скорость машины слишком мала для нанесения урона" });
      }
      requestedHits.push({
        enemyId: typedEnemyId,
        speed: impactSpeed,
        position: { x: rawPositionX, z: rawPositionZ }
      });
    }

    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Сначала начните экспедицию" });
    }
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "В тяжёлом состоянии управлять машиной нельзя" });
    }

    const livePosition = liveNeighborhoodPosition(user.id);
    if (!livePosition || livePosition.vehicle !== true) {
      return reply.code(403).send({ error: "Столкновение доступно только при управлении машиной" });
    }

    const now = Date.now();
    const vehicleTelemetry = neighborhoodVehicleMovementTelemetry.get(user.id);
    if (
      !vehicleTelemetry
      || !vehicleTelemetry.vehicle
      || now - vehicleTelemetry.observedAt > EXPEDITION_VEHICLE_TELEMETRY_MAX_AGE_MS
    ) {
      return reply.code(403).send({ error: "Нет свежих данных о движении машины" });
    }
    if (vehicleTelemetry.observedSpeed < EXPEDITION_VEHICLE_MIN_IMPACT_SPEED) {
      return reply.code(400).send({ error: "Фактическая скорость машины слишком мала для нанесения урона" });
    }

    const liveHits = requestedHits
      .filter((hit) => !run.killedEnemyIds.includes(hit.enemyId))
      .map((hit) => ({
        ...hit,
        speed: Math.min(
          EXPEDITION_VEHICLE_MAX_IMPACT_SPEED,
          hit.speed,
          vehicleTelemetry.observedSpeed + EXPEDITION_VEHICLE_SPEED_TOLERANCE
        )
      }));
    if (liveHits.some((hit) => hit.speed < EXPEDITION_VEHICLE_MIN_IMPACT_SPEED)) {
      return reply.code(400).send({ error: "Подтверждённая скорость столкновения слишком мала" });
    }
    for (const hit of liveHits) {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      const distanceFromVehicle = Math.hypot(
        hit.position.x - livePosition.x,
        hit.position.z - livePosition.z
      );
      const distanceFromSpawn = Math.hypot(
        hit.position.x - enemy.position[0],
        hit.position.z - enemy.position[1]
      );
      if (distanceFromVehicle > EXPEDITION_VEHICLE_HIT_RADIUS) {
        return reply.code(403).send({ error: `${enemy.name}: столкновение слишком далеко от машины` });
      }
      if (distanceFromSpawn > expeditionEnemyPatrolTolerance(hit.enemyId)) {
        return reply.code(403).send({ error: `${enemy.name}: некорректная позиция столкновения` });
      }
    }

    if (liveHits.length === 0) {
      return {
        profile: user.expedition,
        run: makeRunSnapshot(run),
        hits: []
      };
    }

    const nextHitAt = nextExpeditionVehicleHitAt.get(user.id) ?? 0;
    if (now < nextHitAt) {
      return reply.code(429).send({
        error: "Следующее столкновение ещё не зарегистрировано",
        retryAfterMs: Math.max(1, nextHitAt - now)
      });
    }

    let enemyHitCooldowns = nextExpeditionVehicleEnemyHitAt.get(user.id);
    if (!enemyHitCooldowns) {
      enemyHitCooldowns = new Map<ExpeditionEnemyId, number>();
      nextExpeditionVehicleEnemyHitAt.set(user.id, enemyHitCooldowns);
    }
    const eligibleHits = liveHits.filter((hit) => now >= (enemyHitCooldowns!.get(hit.enemyId) ?? 0));
    if (eligibleHits.length === 0) {
      const retryAfterMs = Math.max(1, Math.min(...liveHits.map((hit) => (
        (enemyHitCooldowns!.get(hit.enemyId) ?? now + 1) - now
      ))));
      return reply.code(429).send({
        error: "Эта цель только что получила удар машиной",
        retryAfterMs
      });
    }

    const hitResults = eligibleHits.map((hit) => {
      const enemy = EXPEDITION_ENEMIES[hit.enemyId];
      const damage = expeditionVehicleImpactDamage(hit.speed);
      const remainingHealth = Math.max(0, (run.enemyHealth[hit.enemyId] ?? enemy.maxHealth) - damage);
      const killed = remainingHealth <= 0;
      run.enemyHealth[hit.enemyId] = remainingHealth;
      if (killed) {
        run.killedEnemyIds.push(hit.enemyId);
        run.enemyDeathPositions[hit.enemyId] = { ...hit.position };
        user.expedition.stats.enemiesKilled += 1;
        if (enemy.hostile) {
          user.expedition.stats.hostileEnemiesKilled += 1;
        }
        recordExpeditionEnemyDefeat(user, hit.enemyId);
      }
      return {
        enemy,
        impactSpeed: hit.speed,
        impactPosition: { ...hit.position },
        damage,
        remainingHealth,
        killed,
        corpseLootAvailable: killed
      };
    });

    nextExpeditionVehicleHitAt.set(user.id, now + EXPEDITION_VEHICLE_HIT_COOLDOWN_MS);
    for (const hit of eligibleHits) {
      enemyHitCooldowns.set(hit.enemyId, now + EXPEDITION_VEHICLE_ENEMY_HIT_COOLDOWN_MS);
    }
    persistActiveRun(user, run);
    writeDb(db);
    return {
      profile: user.expedition,
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
    if (run.downedAt || run.playerHealth <= 0) {
      return reply.code(409).send({ error: "Нельзя эвакуироваться в тяжёлом состоянии" });
    }
    if (!isAtExpeditionCheckpoint(user.id)) {
      return reply.code(403).send({ error: "Доберитесь до точки эвакуации" });
    }

    const objective = makeRunObjective(run);
    const extracted = cloneItemStacks(run.backpack);
    mergeItemStacks(user.expedition.stash, extracted);
    const extractedWeapons = run.carriedWeaponIds.filter((weaponId) => (
      !user.expedition.unlockedWeapons.includes(weaponId)
    ));
    user.expedition.unlockedWeapons.push(...extractedWeapons);
    user.expedition.stats.successfulExtracts += 1;

    const carriedCoins = run.carriedCoins;
    let objectiveCoins = 0;
    let xp = 0;
    let levelsGained = 0;
    if (objective.complete) {
      objectiveCoins = EXPEDITION_EXTRACT_REWARD.coins;
      xp = EXPEDITION_EXTRACT_REWARD.xp;
      levelsGained = grantXp(user.progress, xp);
      advanceExpeditionQuest(user, EXPEDITION_QUEST_ID, 1);
    }
    const coins = carriedCoins + objectiveCoins;
    user.coins = Math.min(999_999_999, user.coins + coins);

    delete user.expeditionRun;
    writeDb(db);
    activeExpeditionRuns.delete(user.id);
    lastExpeditionPositionPersistAt.delete(user.id);
    resetNeighborhoodPositionAfterExpedition(user.id);
    return {
      user: toPublicUser(user),
      profile: user.expedition,
      extracted,
      extractedWeapons,
      reward: {
        coins,
        carriedCoins,
        objectiveCoins,
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

    return discardActiveExpedition(db, user, run);
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/surrender", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Активная экспедиция не найдена" });
    }
    return discardActiveExpedition(db, user, run);
  } catch {
    return reply.code(401).send({ error: "Нужно войти" });
  }
});

fastify.post("/api/expedition/defeat", async (request, reply) => {
  try {
    const authenticatedUser = requireUser(request);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === authenticatedUser.id)!;
    const run = activeRunForUser(user);
    if (!run) {
      return reply.code(409).send({ error: "Активная экспедиция не найдена" });
    }
    return discardActiveExpedition(db, user, run);
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
    let activeRun = activeExpeditionRuns.get(neighborhoodUserId);
    if (!activeRun) {
      const db = readDb();
      const storedUser = db.users.find((entry) => entry.id === neighborhoodUserId);
      if (storedUser) activeRun = activeRunForUser(storedUser);
    }
    const expeditionPosition = activeRun?.playerPosition;
    const storedNeighborhoodPosition = lastNeighborhoodPositions.get(neighborhoodUserId) ?? expeditionPosition;
    const hasStoredNeighborhoodPosition = Boolean(storedNeighborhoodPosition);
    const initialPosition = {
      ...(storedNeighborhoodPosition ?? defaultNeighborhoodPosition())
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

    let acceptedMovementDistance = 0;
    let acceptedMovementElapsedMs = 0;
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
      acceptedMovementDistance = acceptedDistance;
      acceptedMovementElapsedMs = elapsedMs;
      if (requestedDistance > acceptedDistance && requestedDistance > 0) {
        const scale = acceptedDistance / requestedDistance;
        requestedPosition.x = previousPosition.x + dx * scale;
        requestedPosition.z = previousPosition.z + dz * scale;
      }
      movementBudget = Math.max(0, movementBudget - acceptedDistance);
      movementState.lastAt = now;
      movementState.budget = movementBudget;
    }

    const previousVehicleTelemetry = neighborhoodVehicleMovementTelemetry.get(neighborhoodUserId);
    if (!requestedPosition.vehicle) {
      neighborhoodVehicleMovementTelemetry.set(neighborhoodUserId, {
        observedSpeed: 0,
        observedAt: now,
        vehicle: false
      });
    } else if (acceptedMovementDistance > 0.001 && acceptedMovementElapsedMs > 0) {
      neighborhoodVehicleMovementTelemetry.set(neighborhoodUserId, {
        observedSpeed: Math.min(
          NEIGHBORHOOD_MAX_SPEED,
          acceptedMovementDistance / (acceptedMovementElapsedMs / 1000)
        ),
        observedAt: now,
        vehicle: true
      });
    } else if (
      !previousVehicleTelemetry
      || !previousVehicleTelemetry.vehicle
      || now - previousVehicleTelemetry.observedAt > EXPEDITION_VEHICLE_TELEMETRY_MAX_AGE_MS
    ) {
      neighborhoodVehicleMovementTelemetry.set(neighborhoodUserId, {
        observedSpeed: 0,
        observedAt: now,
        vehicle: true
      });
    }
    lastNeighborhoodPositions.set(neighborhoodUserId, { ...requestedPosition });
    updateActiveExpeditionPosition(neighborhoodUserId, requestedPosition);
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
