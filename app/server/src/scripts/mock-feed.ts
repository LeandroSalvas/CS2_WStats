/**
 * Mock feed — simula um servidor CS2 enviando GSI + webhooks.
 * Útil para desenvolver/testar a stack sem subir o jogo.
 *
 * Uso:
 *   npm run mock -- --url http://localhost:3000 [--secret SEGREDO] [--rounds 5] [--interval 500]
 */

interface Args {
  url: string;
  secret?: string;
  rounds: number;
  intervalMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    url: (get("--url") ?? "http://localhost:3000").replace(/\/$/, ""),
    secret: get("--secret") ?? process.env.WEBHOOK_SECRET,
    rounds: Number.parseInt(get("--rounds") ?? "8", 10),
    intervalMs: Math.max(100, Number.parseInt(get("--interval") ?? "500", 10)),
  };
}

const PLAYERS = [
  { steamId: "76561198000000001", name: "zueira_king", team: "CT" },
  { steamId: "76561198000000002", name: "picle", team: "CT" },
  { steamId: "76561198000000003", name: "SniperBR", team: "CT" },
  { steamId: "76561198000000004", name: "xX_fraldinha_Xx", team: "CT" },
  { steamId: "76561198000000005", name: "GordoDoCS", team: "CT" },
  { steamId: "76561198000000006", name: "maluco_do_awp", team: "TR" },
  { steamId: "76561198000000007", name: "RushB_Sempre", team: "TR" },
  { steamId: "76561198000000008", name: "clutchMaster", team: "TR" },
  { steamId: "76561198000000009", name: "eco_warrior", team: "TR" },
  { steamId: "76561198000000010", name: "Teteco", team: "TR" },
];

// Centro aproximado da de_dust2 em coordenadas de mundo.
const CENTER = { x: -500, y: 200 };

function circlePos(i: number, t: number, radius: number, phase: number) {
  const ang = (t / 40 + phase) * ((2 * Math.PI) / PLAYERS.length);
  return { x: CENTER.x + Math.cos(ang) * radius, y: CENTER.y + Math.sin(ang) * radius * 0.8 };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  secret?: string,
): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-webhook-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) {
    console.error(`[mock] ${path} -> ${res.status}`, await res.text().catch(() => ""));
  }
  return res.status;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const headers = { "x-webhook-secret": args.secret ?? "" };

  console.log(`[mock] alimentando ${args.url} (${args.rounds} rodadas, ${args.intervalMs}ms/tick)`);

  let scoreCT = 0;
  let scoreTR = 0;
  const stats = new Map<string, { kills: number; deaths: number; assists: number; headshots: number; name: string; team: string }>();
  for (const p of PLAYERS) {
    stats.set(p.steamId, { kills: 0, deaths: 0, assists: 0, headshots: 0, name: p.name, team: p.team });
  }

  for (let round = 1; round <= args.rounds; round++) {
    // freeze time
    for (let tick = 0; tick < 4; tick++) {
      await sendSnapshot(args, round, "freezetime", tick, stats, scoreCT, scoreTR, null);
      await sleep(args.intervalMs);
    }

    // live
    let bombState: string | null = null;
    for (let tick = 0; tick < 30; tick++) {
      if (tick === 15) bombState = "planted";
      await sendSnapshot(args, round, "live", tick, stats, scoreCT, scoreTR, bombState);

      // frags aleatórios
      if (tick % 4 === 3) {
        const killerIdx = Math.floor(Math.random() * PLAYERS.length);
        let victimIdx = Math.floor(Math.random() * PLAYERS.length);
        if (victimIdx === killerIdx) victimIdx = (victimIdx + 1) % PLAYERS.length;
        const killer = PLAYERS[killerIdx];
        const victim = PLAYERS[victimIdx];
        const headshot = Math.random() < 0.45;

        await post(args.url, "/api/webhooks/kills",
          {
            attacker: { steamId: killer.steamId, name: killer.name, team: killer.team },
            victim: { steamId: victim.steamId, name: victim.name, team: victim.team },
            headshot,
            weapon: killer.team === "CT" ? "m4a1_silencer" : "weapon_ak47",
          },
          args.secret,
        );
        const ks = stats.get(killer.steamId)!;
        const vs = stats.get(victim.steamId)!;
        ks.kills += 1;
        if (headshot) ks.headshots += 1;
        vs.deaths += 1;

        // vítima morre por alguns ticks no snapshot seguinte
        deadUntil.set(victim.steamId, Date.now() + args.intervalMs * 5);
      }
      await sleep(args.intervalMs);
    }

    // round-end
    if (Math.random() < 0.55) scoreCT++; else scoreTR++;
    bombState = null;
    await post(args.url, "/api/webhooks/round-end",
      { mapName: "de_dust2", scoreCT, scoreTR, winner: scoreCT > scoreTR ? "CT" : "TR" },
      args.secret,
    );
    console.log(`[mock] round ${round} encerrou: CT ${scoreCT} x ${scoreTR} TR`);
  }

  // match-end
  const res = await fetch(`${args.url}/api/webhooks/match-end`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      mapName: "de_dust2",
      scoreCT,
      scoreTR,
      durationSeconds: args.rounds * 115,
      players: [...stats.entries()].map(([steamId, s]) => ({
        steamId,
        name: s.name,
        team: s.team,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        headshots: s.headshots,
      })),
    }),
  });
  console.log(`[mock] match-end -> ${res.status}`, await res.text().catch(() => ""));
  console.log("[mock] concluído.");
}

const deadUntil = new Map<string, number>();

async function sendSnapshot(
  args: Args,
  round: number,
  phase: string,
  tick: number,
  stats: Map<string, { kills: number; deaths: number; assists: number; headshots: number; name: string; team: string }>,
  scoreCT: number,
  scoreTR: number,
  bombState: string | null,
): Promise<void> {
  const now = Date.now();
  const allplayers_position: Record<string, string> = {};
  const allplayers_state: Record<string, Record<string, unknown>> = {};
  const allplayers_id: Record<string, Record<string, unknown>> = {};
  const allplayers_match_stats: Record<string, Record<string, unknown>> = {};
  const allplayers_teams: Record<string, string> = {};

  PLAYERS.forEach((p, i) => {
    const pos = circlePos(i, tick, 700 + (i % 3) * 150, i);
    allplayers_position[String(i)] = `${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${(64 + (i % 2)).toFixed(2)}`;
    const dead = (deadUntil.get(p.steamId) ?? 0) > now;
    allplayers_state[String(i)] = {
      health: dead ? 0 : 100,
      armor: dead ? 0 : 50 + i,
      helmet: !dead,
      money: 3000 + i * 250,
      weapon: p.team === "CT" ? "weapon_m4a1_silencer" : "weapon_ak47",
    };
    allplayers_id[String(i)] = { name: p.name, steamid: p.steamId, team: p.team };
    allplayers_teams[String(i)] = p.team;
    const s = stats.get(p.steamId)!;
    allplayers_match_stats[String(i)] = {
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      mvps: Math.floor(s.kills / 3),
      score: s.kills * 2,
    };
  });

  const payload = {
    auth: { token: args.secret ?? "" },
    provider: { name: "Counter-Strike 2", appid: 730, timestamp: Math.floor(now / 1000) },
    map: {
      name: "de_dust2",
      phase: phase,
      round: round,
      team_ct: { score: scoreCT },
      team_t: { score: scoreTR },
    },
    round: { phase: phase === "live" ? "live" : "freeze" },
    bomb: bombState
      ? { state: bombState, position: `${CENTER.x.toFixed(2)} ${(CENTER.y - 200).toFixed(2)} 62.00` }
      : undefined,
    phase_countdowns:
      phase === "freezetime"
        ? { phase: "freeze", phase_ends_in: String((4 - tick) * 2) }
        : { phase: "live", phase_ends_in: String(Math.max(1, 115 - tick)) },
    allplayers_id,
    allplayers_position,
    allplayers_state,
    allplayers_match_stats,
    allplayers_teams,
  };

  await post(args.url, "/api/gsi", payload, args.secret);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[mock] falhou:", err);
  process.exit(1);
});
