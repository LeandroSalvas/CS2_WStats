import { Rcon } from "rcon-client";
import { env } from "../config/env.js";
import type { Role } from "../plugins/rbac.js";

// ---------------------------------------------------------------------------
// Cliente RCON singleton com fila serializada e reconexão automática.
// A senha vive SOMENTE aqui (ambiente do container) — nunca trafega para o
// frontend nem aparece em payloads, logs ou auditoria.
// ---------------------------------------------------------------------------

const RCON_TIMEOUT_MS = 5_000;

let client: Rcon | null = null;
let connecting: Promise<Rcon> | null = null;

function rconConfig(): { host: string; port: number; password: string } | null {
  if (!env.RCON_PASSWORD || env.RCON_PASSWORD.trim() === "") return null;
  return {
    host: env.RCON_HOST,
    port: env.RCON_PORT,
    password: env.RCON_PASSWORD,
  };
}

export function rconConfigured(): boolean {
  return rconConfig() != null;
}

async function connect(): Promise<Rcon> {
  const cfg = rconConfig();
  if (!cfg) throw new Error("RCON não configurado (RCON_PASSWORD ausente no ambiente)");
  const c = await Rcon.connect({ ...cfg, timeout: RCON_TIMEOUT_MS });
  c.on("error", () => {
    /* reconexão sob demanda no próximo comando */
  });
  c.on("end", () => {
    client = null;
  });
  return c;
}

async function getClient(): Promise<Rcon> {
  if (client) return client;
  if (!connecting) {
    connecting = connect()
      .then((c) => {
        client = c;
        return c;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

/**
 * Executa um comando RCON. A lib já serializa internamente (maxPending=1);
 * aqui garantimos a ordem entre chamadas e descartamos a conexão em erro.
 */
let chain: Promise<unknown> = Promise.resolve();
export function exec(command: string): Promise<string> {
  const run = async (): Promise<string> => {
    const c = await getClient();
    try {
      return (await c.send(command)) ?? "";
    } catch (err) {
      client = null;
      throw err;
    }
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

/** Sanitiza mensagens de erro — a lib pode ecoar detalhes de autenticação. */
export function sanitizeError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  const cfg = rconConfig();
  if (cfg && cfg.password) {
    msg = msg.split(cfg.password).join("***");
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Parsing do `status` vanilla do CS2.
// Linhas de jogador têm o formato aproximado:
//   # 2 "Nome Do Bot" BOT active 64
//   # 3 "Jogador" [U:1:1234567] 12:34 45 0 active 786432
// As colunas variam entre versões; tokenizamos e classificamos por forma.
// ---------------------------------------------------------------------------

export interface StatusPlayer {
  userid: string;
  name: string;
  /** SteamID2 ([U:1:X]), "BOT" ou cru quando não reconhecido. */
  uniqueId: string;
  steamId64: string | null;
  connectedTime: string | null;
  ping: number | null;
}

export interface ParsedStatus {
  hostname: string | null;
  mapName: string | null;
  players: StatusPlayer[];
  raw: string;
}

export function parseStatus(raw: string): ParsedStatus {
  let hostname: string | null = null;
  let mapName: string | null = null;
  const players: StatusPlayer[] = [];

  const mapMatch = raw.match(/^\s*map\s*:\s*([^\s]+)/im);
  if (mapMatch) mapName = mapMatch[1];
  const hostMatch = raw.match(/^hostname:\s*(.+)$/im);
  if (hostMatch) hostname = hostMatch[1].trim();

  // Formato atual do CS2: bloco entre ---------players-------- e #end com colunas
  //   id time ping loss state rate adr 'name'
  // (time="BOT" para bots; sem coluna uniqueid no vanilla atual).
  const blockMatch = raw.match(/-{5,}players-{5,}\s*\n(.*?)\n#end/is);
  if (blockMatch) {
    for (const line of blockMatch[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^id\s+time/i.test(trimmed)) continue;

      // Nome é o último trecho entre apóstrofos.
      const nameMatch = trimmed.match(/'([^']*)'\s*$/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      // Canais GOTV/reserva aparecem como [NoChan] com nome vazio.
      if (name === "") continue;
      const head = trimmed.slice(0, nameMatch.index ?? 0).trim();

      // Remove o nome (pode conter espaços) e tokeniza o resto.
      const withoutName = trimmed.slice(0, trimmed.lastIndexOf("'")).trim();
      const tokens = withoutName.split(/\s+/); // ex.: ["0","BOT","0","0","active","0"]
      const userid = tokens.shift();
      if (!userid || !/^\d+$/.test(userid)) continue;

      const timeToken = tokens.shift() ?? "";
      const isTimeLike = /^\d{1,4}(:\d{2}){1,2}$/.test(timeToken);
      let ping: number | null = null;
      if (isTimeLike && tokens.length > 0 && /^\d+$/.test(tokens[0])) {
        ping = Number(tokens.shift());
      } else if (/^\d+$/.test(timeToken)) {
        ping = Number(timeToken);
      }
      const connectedTime =
        timeToken === "BOT" ? null : isTimeLike ? timeToken : null;

      // SourceTV/GOTV não é jogador.
      if (name === "SourceTV") continue;

      players.push({
        userid,
        name,
        uniqueId: timeToken === "BOT" ? "BOT" : "STEAM",
        steamId64: null, // vanilla CS2 não expõe SteamID no status; vem do GSI.
        connectedTime,
        ping: ping != null && Number.isFinite(ping) ? ping : null,
      });
    }
    return { hostname, mapName, players, raw };
  }

  // Fallback: formato clássico "# userid name uniqueid ..." (CSGO/plugins).
  for (const line of raw.split(/\r?\n/)) {
    const p = line.match(/^#\s+(\d+)\s+"([^"]*)"\s+(.+)$/);
    if (!p) continue;
    const [, userid, name, rest] = p;
    const tokens = rest.trim().split(/\s+/);

    const uniqueIdRaw = tokens.shift() ?? "";
    let uniqueId = uniqueIdRaw;
    let steamId64: string | null = null;
    const u32 = uniqueIdRaw.match(/\[U:1:(\d+)\]/);
    if (u32) {
      steamId64 = String(BigInt(u32[1]) + 76561197960265728n);
      uniqueId = u32[0];
    } else if (/^STEAM_\d:\d:\d+$/.test(uniqueIdRaw)) {
      const parts = uniqueIdRaw.split(":");
      const account = BigInt(parts[2]) * 2n + BigInt(parts[1]);
      steamId64 = String(account + 76561197960265728n);
      uniqueId = `[U:1:${account}]`;
    }

    const stateIdx = tokens.findIndex((t) =>
      /^(active|spawning|connecting|challenging)$/i.test(t),
    );
    if (stateIdx === -1) continue;

    const before = tokens.slice(0, stateIdx);
    const timeLike = before.find((t) => /^\d{1,4}(:\d{2}){1,2}$/.test(t));
    const numerics = before.filter((t) => /^\d+$/.test(t));
    const ping = numerics.length > 0 ? Number(numerics[numerics.length - 1]) : null;

    players.push({
      userid,
      name,
      uniqueId,
      steamId64,
      connectedTime: timeLike ?? null,
      ping: Number.isFinite(ping) ? ping : null,
    });
  }

  return { hostname, mapName, players, raw };
}

// ---------------------------------------------------------------------------
// Enriquecimento: status (autoritativo p/ userid) + GSI ao vivo (team/K-D).
// ---------------------------------------------------------------------------

export interface EnrichedPlayer extends StatusPlayer {
  team: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  alive: boolean | null;
}

export async function listPlayers(): Promise<{
  players: EnrichedPlayer[];
  raw: string;
}> {
  const { getLivePlayers } = await import("../gsi/liveState.js");
  const livePlayers = getLivePlayers();

  const bySteam = new Map(livePlayers.filter((p) => p.steamId).map((p) => [p.steamId!, p]));
  const byNameLower = new Map(livePlayers.map((p) => [p.name.toLowerCase(), p]));

  const raw = await exec("status");
  const parsed = parseStatus(raw);

  const enriched: EnrichedPlayer[] = parsed.players.map((sp) => {
    // No CS2 atual o status não traz SteamID; casamos por nome e herdamos
    // steamId/team/K-D do GSI ao vivo.
    const live =
      (sp.steamId64 ? bySteam.get(sp.steamId64) : undefined) ??
      byNameLower.get(sp.name.toLowerCase());
    return {
      ...sp,
      steamId64: sp.steamId64 ?? live?.steamId ?? null,
      team: live?.team === "UNASSIGNED" ? null : live?.team ?? null,
      kills: live?.kills ?? null,
      deaths: live?.deaths ?? null,
      assists: live?.assists ?? null,
      alive: live ? live.alive : null,
    };
  });

  // Jogadores vistos pelo GSI mas ausentes no `status` (raro): inclui p/ contexto.
  const seenIds = new Set(enriched.map((p) => p.steamId64 ?? p.name.toLowerCase()));
  for (const lp of livePlayers) {
    const key = lp.steamId ?? lp.name.toLowerCase();
    if (!lp.name || seenIds.has(key)) continue;
    seenIds.add(key);
    enriched.push({
      userid: "",
      name: lp.name,
      uniqueId: lp.steamId ? `[U:1:${BigInt(lp.steamId) - 76561197960265728n}]` : "GSI",
      steamId64: lp.steamId,
      connectedTime: null,
      ping: null,
      team: lp.team === "UNASSIGNED" ? null : lp.team,
      kills: lp.kills,
      deaths: lp.deaths,
      assists: lp.assists,
      alive: lp.alive,
    });
  }

  return { players: enriched, raw };
}

// ---------------------------------------------------------------------------
// Operações de moderação.
// ---------------------------------------------------------------------------

export async function kickUser(userid: string): Promise<void> {
  await exec(`kickid ${userid}`);
}

/**
 * Ban permanente (minutes=0) ou temporário. Sempre persiste via `writeid`
 * e desconecta o jogador na sequência.
 */
export async function banUser(userid: string, minutes: number): Promise<void> {
  await exec(`banid ${minutes} ${userid}`);
  await exec("writeid");
  try {
    await kickUser(userid);
  } catch {
    /* já pode ter saído */
  }
}

// ---------------------------------------------------------------------------
// Blocklist de comandos destrutivos (SUPER_ADMIN tem passagem livre).
// ---------------------------------------------------------------------------

export function blockedCommands(): string[] {
  return env.RCON_BLOCKED_COMMANDS.split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== "");
}

export function isCommandBlocked(command: string, role: Role): boolean {
  if (role === "SUPER_ADMIN") return false;
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return blockedCommands().includes(firstToken);
}
