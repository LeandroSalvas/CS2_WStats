/* Tipos espelhando os DTOs do backend (server/src). */

export type Team = "CT" | "TR" | "UNASSIGNED";

export interface ServerStatusDTO {
  online: boolean;
  serverName: string;
  mapName: string | null;
  phase: string | null;
  roundNumber: number | null;
  phaseEndsIn: number | null;
  scoreCT: number;
  scoreTR: number;
  bombState: string | null;
  playersOnline: number;
  playersAlive: number;
  secondsSinceLastUpdate: number | null;
}

export interface PlayerRank {
  rank: number;
  steamId: string;
  name: string;
  totalKills: number;
  totalDeaths: number;
  totalHeadshots: number;
  totalMatches: number;
  kd: string;
  hsPercent: string;
  skill: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface DashboardData {
  server: ServerStatusDTO;
  metrics: { players: number; kills: number; maps: number };
  lastMatch: {
    id: number;
    mapName: string;
    scoreCT: number;
    scoreTR: number;
    durationSeconds: number;
    endedAt: string;
    winner: "CT" | "TR";
    mvp: { steamId: string; name: string; kills: number; assists: number } | null;
  } | null;
  podium: Array<PlayerRank & { medal: number }>;
  recentRanking: PlayerRank[];
}

export interface MatchListItem {
  id: number;
  mapName: string;
  scoreCT: number;
  scoreTR: number;
  durationSeconds: number;
  endedAt: string;
  mvpName: string | null;
  mvpKills: number | null;
}

export interface MatchDetail {
  match: {
    id: number;
    mapName: string;
    scoreCT: number;
    scoreTR: number;
    durationSeconds: number;
    endedAt: string;
  };
  ct: MatchStatRow[];
  tr: MatchStatRow[];
  mvp: MatchStatRow | null;
}

export interface MatchStatRow {
  steamId: string;
  name: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
}

export interface PlayerProfile {
  identity: {
    steamId: string;
    name: string;
    rank: number;
    createdAt: string;
  };
  combat: {
    kills: number;
    deaths: number;
    headshots: number;
    hsPercent: string;
    kd: string;
    skill: number;
    accuracyPercent: string | null;
    assists: number;
    tk: number;
    damageTotal: number;
  };
  bomb: { plants: number; defusions: number };
  time: {
    hoursPlayed: number;
    connections: number;
    firstSeenAt: string;
    lastMapName: string | null;
  };
  series: Array<{
    day: string;
    kills: number;
    deaths: number;
    headshots: number;
    assists: number;
  }>;
  matches: Array<{
    matchId: number;
    mapName: string;
    endedAt: string;
    durationSeconds: number;
    team: string;
    kills: number;
    deaths: number;
    assists: number;
    headshots: number;
  }>;
}

/* ---------------- Radar ao vivo (WebSocket) ---------------- */

export interface LivePlayer {
  id: string;
  steamId: string | null;
  name: string;
  team: Team;
  x: number;
  y: number;
  z: number;
  yaw: number | null;
  hp: number;
  armor: number;
  helmet: boolean;
  money: number | null;
  alive: boolean;
  weapon: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

export interface LiveSnapshot {
  ts: number;
  mapName: string | null;
  phase: string | null;
  roundNumber: number | null;
  phaseEndsIn: number | null;
  scoreCT: number;
  scoreTR: number;
  bomb: { state: string | null; x: number | null; y: number | null; z: number | null };
  players: LivePlayer[];
}

/** Abatimento pós-delay, sincronizado com o radar. */
export interface KillFeedEntry {
  attackerName: string | null;
  attackerTeam: string | null;
  victimName: string;
  victimTeam: string;
  weapon: string | null;
  isHeadshot: boolean;
}

export type WsMessage =
  | { type: "hello"; data: { delaySeconds: number; buffered: number; status: ServerStatusDTO } }
  | { type: "snapshot"; data: LiveSnapshot }
  | { type: "kill"; data: KillFeedEntry };
