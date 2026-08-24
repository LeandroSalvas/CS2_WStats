/**
 * Tipos do fluxo AO VIVO (GSI -> Buffer -> WebSocket).
 * Nenhum destes dados é persistido em banco.
 */

export type Team = "CT" | "TR" | "UNASSIGNED";

export interface LivePlayer {
  /** Identificador estável: steamId64 quando disponível, senão o slot/userid do GSI. */
  id: string;
  steamId: string | null;
  name: string;
  team: Team;
  /** Coordenadas de mundo (unidades do Source). */
  x: number;
  y: number;
  z: number;
  /** Ângulo horizontal em graus (0 = +X, cresce anti-horário). */
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

export type BombLifecycle =
  | "planted"
  | "dropped"
  | "carried"
  | "defused"
  | "exploded"
  | null;

export interface BombState {
  state: BombLifecycle;
  x: number | null;
  y: number | null;
  z: number | null;
}

/** Snapshot completo transmitido aos clientes WebSocket após o delay. */
export interface LiveSnapshot {
  /** Epoch ms no servidor, na recepção do payload GSI. */
  ts: number;
  mapName: string | null;
  phase: string | null; // warmup | freezetime | live | over | ...
  roundNumber: number | null;
  /** Segundos restantes da fase atual (phase_countdowns). */
  phaseEndsIn: number | null;
  scoreCT: number;
  scoreTR: number;
  bomb: BombState;
  players: LivePlayer[];
}

/** Payload bruto do GSI (formato Valve CS2/CSGO), seções opcionais. */
export interface RawGsiPayload {
  auth?: Record<string, unknown>;
  provider?: { name?: string; steamid?: string; timestamp?: number };
  map?: {
    name?: string;
    phase?: string;
    round?: number;
    team_ct?: { score?: number };
    team_t?: { score?: number };
  };
  round?: { phase?: string; win_team?: string; bomb?: string };
  player_id?: { name?: string; steamid?: string; team?: string };
  player_state?: {
    health?: number;
    armor?: number;
    money?: number;
    weapon?: string;
    team?: string;
  };
  allplayers_id?: Record<string, { name?: string; steamid?: string; team?: string }>;
  allplayers_position?: Record<string, string>;
  player_pos?: string;
  allplayers_state?: Record<
    string,
    {
      health?: number;
      armor?: number;
      helmet?: boolean;
      money?: number;
      team?: string;
      weapon?: string;
      active_weapon?: string;
    }
  >;
  allplayers_match_stats?: Record<
    string,
    { kills?: number; deaths?: number; assists?: number; mvps?: number; score?: number }
  >;
  allplayers_weapons?: Record<string, Record<string, unknown>>;
  bomb?: { state?: string; position?: string };
  phase_countdowns?: { phase?: string; phase_ends_in?: string };
  // Campos extras tolerados (plugins como MatchZy/CounterStrikeSharp podem enriquecer):
  allplayers_teams?: Record<string, string>;
}
