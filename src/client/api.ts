import type { Activity, CatalogItem, HomeState, NeighborhoodProgress, NeighborhoodState, PlacedItem, PublicUser } from "./types";
import type {
  ExpeditionContainerDefinition,
  ExpeditionContainerId,
  ExpeditionEnemyDefinition,
  ExpeditionEnemyId,
  ExpeditionHitInput,
  ExpeditionProfile,
  ExpeditionRecipeDefinition,
  ExpeditionRecipeId,
  ExpeditionRunSnapshot,
  ExpeditionSkillDefinition,
  ExpeditionSkillId,
  ExpeditionWeaponDefinition,
  ExpeditionWeaponId,
  ItemStack
} from "../shared/expedition";

export {
  EXPEDITION_CONTAINERS,
  EXPEDITION_ENEMIES,
  EXPEDITION_ITEMS,
  EXPEDITION_RECIPES,
  EXPEDITION_WEAPONS
} from "../shared/expedition";
export type {
  ExpeditionContainerId,
  ExpeditionEnemyId,
  ExpeditionProfile,
  ExpeditionRecipeId,
  ExpeditionRunSnapshot,
  ExpeditionSkillId,
  ExpeditionWeaponId,
  ItemStack,
  PartyInvite,
  PartyInvitesSnapshot,
  PartySnapshot
} from "../shared/expedition";

const TOKEN_KEY = "animegame_token";
let authRevision = 0;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  authRevision += 1;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const requestAuthRevision = authRevision;
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (requestAuthRevision !== authRevision || token !== getToken()) {
    throw new Error("Сессия изменилась, повторите действие");
  }
  if (!response.ok) {
    throw new Error(payload.error ?? "Ошибка запроса");
  }

  return payload as T;
}

export function register(username: string, password: string) {
  return request<{ token: string; user: PublicUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function login(username: string, password: string) {
  return request<{ token: string; user: PublicUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function me() {
  return request<{ user: PublicUser }>("/api/me");
}

export function getExpeditionProfile() {
  return request<{ profile: ExpeditionProfile; run: ExpeditionRunSnapshot | null }>("/api/expedition/profile");
}

export function setExpeditionLoadout(weaponId: ExpeditionWeaponId) {
  return request<{ profile: ExpeditionProfile; weapon: ExpeditionWeaponDefinition }>("/api/expedition/loadout", {
    method: "POST",
    body: JSON.stringify({ weaponId })
  });
}

export function buyExpeditionWeapon(weaponId: ExpeditionWeaponId) {
  return request<{
    user: PublicUser;
    profile: ExpeditionProfile;
    weapon: ExpeditionWeaponDefinition;
    spent: number;
  }>("/api/expedition/buy-weapon", {
    method: "POST",
    body: JSON.stringify({ weaponId })
  });
}

export function buyExpeditionAmmo() {
  return request<{
    user: PublicUser;
    profile: ExpeditionProfile;
    purchased: ItemStack;
    spent: number;
  }>("/api/expedition/buy-ammo", { method: "POST" });
}

export function craftExpeditionItem(recipeId: ExpeditionRecipeId) {
  return request<{ profile: ExpeditionProfile; recipe: ExpeditionRecipeDefinition }>("/api/expedition/craft", {
    method: "POST",
    body: JSON.stringify({ recipeId })
  });
}

export function upgradeExpeditionSkill(skillId: ExpeditionSkillId) {
  return request<{ profile: ExpeditionProfile; skill: ExpeditionSkillDefinition }>("/api/expedition/upgrade-skill", {
    method: "POST",
    body: JSON.stringify({ skillId })
  });
}

export function startExpedition() {
  return request<{ run: ExpeditionRunSnapshot; profile: ExpeditionProfile; partySize: number }>("/api/expedition/start", { method: "POST" });
}

export function lootExpeditionContainer(containerId: ExpeditionContainerId) {
  return request<{
    run: ExpeditionRunSnapshot;
    container: ExpeditionContainerDefinition;
    loot: ItemStack[];
  }>("/api/expedition/loot", {
    method: "POST",
    body: JSON.stringify({ containerId })
  });
}

export type ExpeditionEnemyHitResult = {
  enemy: ExpeditionEnemyDefinition;
  weaponId: ExpeditionWeaponId;
  damage: number;
  remainingHealth: number;
  killed: boolean;
  loot: ItemStack[];
};

export type ExpeditionHitResult = {
  run: ExpeditionRunSnapshot;
  hits: ExpeditionEnemyHitResult[];
};

export function hitExpeditionEnemies(hits: ExpeditionHitInput[]) {
  return request<ExpeditionHitResult>("/api/expedition/hit", {
    method: "POST",
    body: JSON.stringify({ hits })
  });
}

export function extractExpedition() {
  return request<{
    user: PublicUser;
    profile: ExpeditionProfile;
    extracted: ItemStack[];
    reward: { coins: number; xp: number; levelsGained: number; objectiveCompleted: boolean };
  }>("/api/expedition/extract", { method: "POST" });
}

export function abandonExpedition() {
  return request<{ profile: ExpeditionProfile; lost: ItemStack[] }>("/api/expedition/abandon", { method: "POST" });
}

export function getCatalog() {
  return request<{ catalog: CatalogItem[]; activities: Activity[] }>("/api/catalog");
}

export function getPlayers() {
  return request<{ players: Array<{ username: string; coins: number }> }>("/api/players");
}

export function getNeighborhood() {
  return request<NeighborhoodState>("/api/neighborhood");
}

export function claimNeighborhoodIncome() {
  return request<{ user: PublicUser; progress: NeighborhoodProgress; claimed: number }>("/api/neighborhood/claim-income", {
    method: "POST"
  });
}

export function upgradeCareer() {
  return request<{ user: PublicUser; progress: NeighborhoodProgress; spent: number; claimed: number }>("/api/neighborhood/upgrade-career", {
    method: "POST"
  });
}

export function upgradeHouse() {
  return request<{ user: PublicUser; progress: NeighborhoodProgress; spent: number }>("/api/neighborhood/upgrade-house", {
    method: "POST"
  });
}

export function getHome(username: string) {
  return request<HomeState>(`/api/home/${encodeURIComponent(username)}`);
}

export function earn(activityId: string) {
  return request<{ user: PublicUser; activity: Activity; progress?: NeighborhoodProgress; xpEarned?: number; levelsGained?: number }>("/api/earn", {
    method: "POST",
    body: JSON.stringify({ activityId })
  });
}

export function buy(itemId: string) {
  return request<{ user: PublicUser; item: CatalogItem }>("/api/buy", {
    method: "POST",
    body: JSON.stringify({ itemId })
  });
}

export function place(itemId: string, x: number, z: number, rotation = 0) {
  return request<{ user: PublicUser; placed: PlacedItem }>("/api/place", {
    method: "POST",
    body: JSON.stringify({ itemId, x, z, rotation })
  });
}

export function movePlacedItem(instanceId: string, x: number, z: number) {
  return request<{ user: PublicUser; placed: PlacedItem }>("/api/placed/move", {
    method: "POST",
    body: JSON.stringify({ instanceId, x, z })
  });
}

export function rotatePlacedItem(instanceId: string, rotation: number) {
  return request<{ user: PublicUser; placed: PlacedItem }>("/api/placed/rotate", {
    method: "POST",
    body: JSON.stringify({ instanceId, rotation })
  });
}

export function scalePlacedItem(instanceId: string, scale: number) {
  return request<{ user: PublicUser; placed: PlacedItem }>("/api/placed/scale", {
    method: "POST",
    body: JSON.stringify({ instanceId, scale })
  });
}

export function sellPlacedItem(instanceId: string) {
  return request<{ user: PublicUser; placed: PlacedItem; refund: number }>("/api/placed/sell", {
    method: "POST",
    body: JSON.stringify({ instanceId })
  });
}

export function updateHomeStyle(floorColor: string, wallColor: string) {
  return request<{ user: PublicUser; homeStyle: PublicUser["homeStyle"] }>("/api/home/style", {
    method: "POST",
    body: JSON.stringify({ floorColor, wallColor })
  });
}

export type AdminUser = {
  id: string;
  username: string;
  coins: number;
  isAdmin: boolean;
  inventoryCount: number;
  placedCount: number;
  createdAt: number;
  avatar: PublicUser["avatar"];
};

export type AdminOverview = {
  users: AdminUser[];
  catalog: CatalogItem[];
  activities: Activity[];
  stats: {
    users: number;
    chats: number;
    catalogItems: number;
    activities: number;
  };
};

export function getAdminOverview() {
  return request<AdminOverview>("/api/admin/overview");
}

export function updateAdminUser(id: string, patch: Partial<Pick<AdminUser, "coins" | "isAdmin">> & { inventory?: string[] }) {
  return request<{ user: PublicUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function updateAdminCatalogItem(id: string, patch: Partial<CatalogItem>) {
  return request<{ item: CatalogItem; catalog: CatalogItem[] }>(`/api/admin/catalog/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function updateAdminActivity(id: string, patch: Partial<Activity>) {
  return request<{ activity: Activity; activities: Activity[] }>(`/api/admin/activities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}
