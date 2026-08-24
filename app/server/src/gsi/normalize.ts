import type { LivePlayer, LiveSnapshot, RawGsiPayload } from "./types";

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/** "x y z" | "x,y,z" | "x y z;p y r" -> [x,y,z] */
function parseVec(s: string | undefined): [number, number, number] | null {
  if (!s) return null;
  const coords = (s.includes(";") ? s.split(";")[0] : s)
    .split(/[\s,]+/)
    .filter(Boolean);
  if (coords.length >= 3) {
    return [num(coords[0]), num(coords[1]), num(coords[2])];
  }
  return null;
}

/** "-13.65 141.44 0.00" (pitch yaw roll) vindo do player_pos. */
function parseYaw(angles: string | undefined): number | null {
  if (!angles) return null;
  const seg = angles.split(";");
  if (seg.length < 2) return null;
  const p = seg[1].trim().split(/[\s,]+/).filter(Boolean);
  if (p.length >= 2) return num(p[1]);
  return null;
}

/**
 * Converte o payload bruto do GSI em um LiveSnapshot normalizado.
 * Tolerante: qualquer seção ausente é simplesmente ignorada.
 */
export function normalizeGsiPayload(raw: RawGsiPayload, receivedAt = Date.now()): LiveSnapshot {
  const ids = raw.allplayers_id ?? {};
  const positions = raw.allplayers_position ?? {};
  const states = raw.allplayers_state ?? {};
  const matchStats = raw.allplayers_match_stats ?? {};
  const extraTeams = raw.allplayers_teams ?? {};

  // Yaw explícito apenas para o jogador espectado (player_pos), quando presente.
  let spectatedSteamId: string | null = null;
  if (raw.player_id?.steamid && raw.player_pos) spectatedSteamId = String(raw.player_id.steamid);

  const players = Object.entries(ids).map(([slot, info]) => {
    const pos = parseVec(positions[slot]);
    const st = states[slot] ?? {};
    const ms = matchStats[slot] ?? {};

    let team: LivePlayer["team"] = "UNASSIGNED";
    const rawTeam = info.team ?? st.team ?? extraTeams[slot];
    if (rawTeam === "CT") team = "CT";
    else if (rawTeam === "T" || rawTeam === "TR" || rawTeam === "TERRORIST") team = "TR";

    const steamId = info.steamid ? String(info.steamid) : null;
    const hp = Math.max(0, num(st.health, 0));
    const alive = hp > 0;

    return {
      id: steamId ?? slot,
      steamId,
      name: info.name ?? `slot ${slot}`,
      team,
      x: pos?.[0] ?? 0,
      y: pos?.[1] ?? 0,
      z: pos?.[2] ?? 0,
      // Cada jogador traz ";pitch yaw roll" no próprio allplayers_position;
      // fallback para o player_pos espectado quando ausente.
      yaw: parseYaw(positions[slot]) ??
        (steamId && steamId === spectatedSteamId ? parseYaw(raw.player_pos) : null),
      hp,
      armor: num(st.armor, 0),
      helmet: Boolean(st.helmet),
      money: st.money != null ? num(st.money) : null,
      alive,
      weapon: st.weapon ?? st.active_weapon ?? null,
      kills: ms.kills != null ? num(ms.kills) : null,
      deaths: ms.deaths != null ? num(ms.deaths) : null,
      assists: ms.assists != null ? num(ms.assists) : null,
    };
  });

  const bombPos = parseVec(raw.bomb?.position);

  return {
    ts: receivedAt,
    mapName: raw.map?.name?.trim() || null,
    phase: raw.map?.phase ?? null,
    roundNumber: raw.map?.round != null ? num(raw.map.round) : null,
    phaseEndsIn:
      raw.phase_countdowns?.phase_ends_in != null
        ? num(raw.phase_countdowns.phase_ends_in)
        : null,
    scoreCT: num(raw.map?.team_ct?.score, 0),
    scoreTR: num(raw.map?.team_t?.score, 0),
    bomb: {
      state: (raw.bomb?.state as LiveSnapshot["bomb"]["state"]) ?? null,
      x: bombPos?.[0] ?? null,
      y: bombPos?.[1] ?? null,
      z: bombPos?.[2] ?? null,
    },
    players,
  };
}
