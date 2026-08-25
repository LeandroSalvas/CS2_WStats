import { BASE } from "../base";
import type {
  DashboardData,
  LiveSnapshot,
  MatchDetail,
  MatchListItem,
  Paginated,
  PlayerProfile,
  PlayerRank,
  ServerStatusDTO,
} from "../types";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export interface ApiError extends Error {
  status: number;
  code?: string;
}

async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(String(data.message ?? data.error ?? `${method} ${path} -> ${res.status}`)) as ApiError;
    err.status = res.status;
    err.code = typeof data.code === "string" ? data.code : undefined;
    throw err;
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Tipos de auth / admin / rcon
// ---------------------------------------------------------------------------

export type Role = "PENDENTE" | "ADMIN" | "SUPER_ADMIN";

export interface Me {
  authenticated: boolean;
  googleEnabled: boolean;
  id?: number;
  email?: string;
  name?: string;
  avatar?: string | null;
  role?: Role;
  isLocalAdmin?: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  role: Role;
  isLocalAdmin: boolean;
  createdAt: string;
}

export interface RconPlayer {
  userid: string;
  name: string;
  uniqueId: string;
  steamId64: string | null;
  connectedTime: string | null;
  ping: number | null;
  team: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  alive: boolean | null;
}

export interface RconLogEntry {
  id: number;
  userId: number;
  command: string;
  response: string;
  createdAt: string;
  user?: { name: string; email: string };
}

export const api = {
  dashboard: () => fetchJson<DashboardData>(`${BASE}api/dashboard`),
  serverStatus: () => fetchJson<ServerStatusDTO>(`${BASE}api/server-status`),
  ranking: (page: number, limit: number, search: string) =>
    fetchJson<Paginated<PlayerRank>>(
      `${BASE}api/ranking?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
    ),
  players: (page: number, limit: number, search: string) =>
    fetchJson<Paginated<PlayerRank>>(
      `${BASE}api/players?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
    ),
  player: (steamId: string) =>
    fetchJson<PlayerProfile>(`${BASE}api/players/${encodeURIComponent(steamId)}`),
  matches: (page: number, limit: number, map?: string) =>
    fetchJson<Paginated<MatchListItem>>(
      `${BASE}api/matches?page=${page}&limit=${limit}${map ? `&map=${encodeURIComponent(map)}` : ""}`,
    ),
  matchMaps: () => fetchJson<{ maps: string[] }>(`${BASE}api/maps`),
  match: (id: string | number) => fetchJson<MatchDetail>(`${BASE}api/matches/${id}`),

  // ---- Auth -----------------------------------------------------------------
  me: () => fetchJson<Me>(`${BASE}api/auth/me`),
  loginLocal: (username: string, password: string) =>
    sendJson<Me>("POST", `${BASE}api/auth/login`, { username, password }),
  logout: () => sendJson<{ ok: boolean }>("POST", `${BASE}api/auth/logout`),

  // ---- Admin: usuários ---------------------------------------------------------
  pendingUsers: () => fetchJson<{ users: AdminUser[] }>(`${BASE}api/admin/users?status=pending`),
  activeUsers: () => fetchJson<{ users: AdminUser[] }>(`${BASE}api/admin/users?status=active`),
  approveUser: (id: number, role: "ADMIN" | "SUPER_ADMIN") =>
    sendJson<{ user: AdminUser }>("POST", `${BASE}api/admin/users/${id}/approve`, { role }),
  rejectUser: (id: number) =>
    sendJson<{ ok: boolean }>("POST", `${BASE}api/admin/users/${id}/reject`),
  setUserRole: (id: number, role: "ADMIN" | "SUPER_ADMIN") =>
    sendJson<{ user: AdminUser }>("PATCH", `${BASE}api/admin/users/${id}/role`, { role }),
  deleteUser: (id: number) =>
    sendJson<{ ok: boolean }>("DELETE", `${BASE}api/admin/users/${id}`),

  // ---- RCON -----------------------------------------------------------------------
  rconExec: (command: string) =>
    sendJson<{ ok: boolean; response: string }>("POST", `${BASE}api/rcon/exec`, { command }),
  rconPlayers: () => fetchJson<{ players: RconPlayer[] }>(`${BASE}api/rcon/players`),
  rconKick: (userid: string) =>
    sendJson<{ ok: boolean }>("POST", `${BASE}api/rcon/players/${userid}/kick`),
  rconBan: (userid: string, minutes: number, reason?: string) =>
    sendJson<{ ok: boolean; permanent: boolean }>(
      "POST",
      `${BASE}api/rcon/players/${userid}/ban`,
      { minutes, reason },
    ),
  rconLogs: () => fetchJson<{ logs: RconLogEntry[] }>(`${BASE}api/rcon/logs`),
};

/** Conecta ao WebSocket do radar com reconexão automática. */
export function connectLiveSocket(
  onMessage: (msg: { type: string; data: unknown }) => void,
  onStateChange: (state: "connecting" | "open" | "closed") => void,
): () => void {
  let closedByUser = false;
  let retry = 0;
  let socket: WebSocket | null = null;

  const connect = (): void => {
    if (closedByUser) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    onStateChange("connecting");
    socket = new WebSocket(`${proto}//${location.host}${BASE}ws/live`);
    socket.onopen = () => {
      retry = 0;
      onStateChange("open");
    };
    socket.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string));
      } catch {
        /* payload inválido — ignora */
      }
    };
    socket.onclose = () => {
      if (closedByUser) return;
      onStateChange("closed");
      const delay = Math.min(15000, 1000 * 2 ** retry++);
      setTimeout(connect, delay);
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    closedByUser = true;
    socket?.close();
  };
}

export type { LiveSnapshot };
