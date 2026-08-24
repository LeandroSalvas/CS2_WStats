import { env } from "../config/env.js";
import type { LivePlayer, LiveSnapshot, Team } from "./types.js";

const HEARTBEAT_TIMEOUT_MS = env.HEARTBEAT_TIMEOUT_SECONDS * 1000;

interface InternalState {
  serverName: string;
  lastPayloadAt: number;
  mapName: string | null;
  phase: string | null;
  roundNumber: number | null;
  phaseEndsIn: number | null;
  scoreCT: number;
  scoreTR: number;
  bombState: string | null;
  playersOnline: number;
  playersAlive: number;
  /** Aprendido via webhooks (MatchZy informa o time nos eventos de kill). */
  learnedTeams: Map<string, Team>;
  lastPlayers: LivePlayer[];
}

const state: InternalState = {
  serverName: env.SERVER_NAME,
  lastPayloadAt: 0,
  mapName: null,
  phase: null,
  roundNumber: null,
  phaseEndsIn: null,
  scoreCT: 0,
  scoreTR: 0,
  bombState: null,
  playersOnline: 0,
  playersAlive: 0,
  learnedTeams: new Map(),
  lastPlayers: [],
};

/** Webhooks (kills/round-end) podem informar o time do jogador; guardamos p/ colorir o radar. */
export function learnTeam(steamId: string, team: string): void {
  const t: Team = team === "CT" ? "CT" : team === "T" || team === "TR" ? "TR" : "UNASSIGNED";
  if (t !== "UNASSIGNED") state.learnedTeams.set(steamId, t);
}

export function updateFromSnapshot(snap: LiveSnapshot): void {
  state.lastPayloadAt = Date.now();
  if (snap.mapName) state.mapName = snap.mapName;
  state.phase = snap.phase;
  state.roundNumber = snap.roundNumber ?? state.roundNumber;
  state.phaseEndsIn = snap.phaseEndsIn;
  state.scoreCT = snap.scoreCT;
  state.scoreTR = snap.scoreTR;
  state.bombState = snap.bomb.state;
  // Jogadores com posição = conectados na partida.
  state.playersOnline = snap.players.length > 0
    ? snap.players.length
    : state.playersOnline;
  state.playersAlive = snap.players.filter((p) => p.alive).length;
  state.lastPlayers = snap.players;

  // Enriquece times faltantes com o que foi aprendido pelos webhooks.
  for (const p of snap.players) {
    if (p.team === "UNASSIGNED" && p.steamId) {
      const t = state.learnedTeams.get(p.steamId);
      if (t) p.team = t;
    }
  }
}

/** Placar vindo de /api/webhooks/round-end sobrepõe o placar corrente em memória. */
export function applyRoundScore(scoreCT?: number, scoreTR?: number): void {
  if (scoreCT != null && Number.isFinite(scoreCT)) state.scoreCT = scoreCT;
  if (scoreTR != null && Number.isFinite(scoreTR)) state.scoreTR = scoreTR;
}

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

export function getStatus(): ServerStatusDTO {
  const online = Date.now() - state.lastPayloadAt < HEARTBEAT_TIMEOUT_MS && state.lastPayloadAt > 0;
  return {
    online,
    serverName: state.serverName,
    mapName: state.mapName,
    phase: state.phase,
    roundNumber: state.roundNumber,
    phaseEndsIn: state.phaseEndsIn,
    scoreCT: state.scoreCT,
    scoreTR: state.scoreTR,
    bombState: state.bombState,
    playersOnline: online ? state.playersOnline : 0,
    playersAlive: online ? state.playersAlive : 0,
    secondsSinceLastUpdate:
      state.lastPayloadAt > 0 ? Math.floor((Date.now() - state.lastPayloadAt) / 1000) : null,
  };
}

/** Jogadores do último snapshot GSI (para enriquecer a tabela RCON com time/K-D). */
export function getLivePlayers(): LivePlayer[] {
  const online = Date.now() - state.lastPayloadAt < HEARTBEAT_TIMEOUT_MS && state.lastPayloadAt > 0;
  return online ? state.lastPlayers : [];
}
