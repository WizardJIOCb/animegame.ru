import type { Activity, CatalogItem, HomeState, PublicUser } from "./types";

const TOKEN_KEY = "animegame_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const payload = await response.json().catch(() => ({}));
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

export function getCatalog() {
  return request<{ catalog: CatalogItem[]; activities: Activity[] }>("/api/catalog");
}

export function getPlayers() {
  return request<{ players: Array<{ username: string; coins: number }> }>("/api/players");
}

export function getHome(username: string) {
  return request<HomeState>(`/api/home/${encodeURIComponent(username)}`);
}

export function earn(activityId: string) {
  return request<{ user: PublicUser; activity: Activity }>("/api/earn", {
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
  return request<{ user: PublicUser }>("/api/place", {
    method: "POST",
    body: JSON.stringify({ itemId, x, z, rotation })
  });
}

