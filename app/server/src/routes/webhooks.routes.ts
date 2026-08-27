import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { learnTeam } from "../gsi/liveState.js";
import type { KillFeedEntry } from "../gsi/killTypes.js";
import type { RouteDeps } from "./gsi.routes.js";

/* ------------------------------------------------------------------ */
/* Contratos tolerantes: aceita formato aninhado (estilo MatchZy/CSSh) */
/* ou plano (chaves attackerSteamId, victimName, ...).                  */
/* ------------------------------------------------------------------ */

const participant = z.object({
  steamId: z.string().min(1),
  name: z.string().default("unknown"),
  team: z.string().optional(),
});

/** Limite de abates persistidos por jogador (FIFO por ordem de id). */
const MAX_KILL_RECORDS_PER_PLAYER = 500;

function readParticipant(
  body: Record<string, unknown>,
  prefix: string,
): { steamId: string; name: string; team?: string } | null {
  const nested = body[prefix];
  if (nested && typeof nested === "object") {
    const p = participant.safeParse(nested);
    if (p.success) return p.data;
    return null;
  }
  const flat = participant.safeParse({
    steamId: body[`${prefix}SteamId`],
    name: body[`${prefix}Name`] ?? "unknown",
    team: body[`${prefix}Team`],
  });
  return flat.success ? flat.data : null;
}

const killBodySchema = z.object({
  headshot: z.coerce.boolean().optional().default(false),
  weapon: z.string().optional(),
});

/** Delta de métricas estendidas por jogador (plugin envia a cada flush). */
const statDeltaSchema = z.object({
  steamId: z.string().min(1),
  name: z.string().default("unknown"),
  team: z.string().default("CT"),
  shotsFired: z.coerce.number().int().min(0).default(0),
  shotsHit: z.coerce.number().int().min(0).default(0),
  damage: z.coerce.number().int().min(0).default(0),
  tk: z.coerce.number().int().min(0).default(0),
  plants: z.coerce.number().int().min(0).default(0),
  defusions: z.coerce.number().int().min(0).default(0),
  connections: z.coerce.number().int().min(0).default(0),
  secondsPlayed: z.coerce.number().int().min(0).default(0),
});

type StatDelta = z.infer<typeof statDeltaSchema>;

/** Dia (UTC) corrente para a série diária dos gráficos. */
function utcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Garante o Player e devolve id para upserts de séries. */
async function ensurePlayer(steamId: string, name?: string): Promise<void> {
  await prisma.player.upsert({
    where: { steamId },
    create: { steamId, name: name?.trim() || "unknown" },
    update: name ? { name } : {},
  });
}

/** Incrementa a linha diária (kills/deaths/headshots/assists) de um jogador. */
async function bumpDaily(
  steamId: string,
  inc: { kills?: number; deaths?: number; headshots?: number; assists?: number },
): Promise<void> {
  if (!inc.kills && !inc.deaths && !inc.headshots && !inc.assists) return;
  await prisma.playerDailyStat.upsert({
    where: { playerId_day: { playerId: steamId, day: utcDay() } },
    create: {
      playerId: steamId,
      day: utcDay(),
      kills: inc.kills ?? 0,
      deaths: inc.deaths ?? 0,
      headshots: inc.headshots ?? 0,
      assists: inc.assists ?? 0,
    },
    update: {
      ...(inc.kills ? { kills: { increment: inc.kills } } : {}),
      ...(inc.deaths ? { deaths: { increment: inc.deaths } } : {}),
      ...(inc.headshots ? { headshots: { increment: inc.headshots } } : {}),
      ...(inc.assists ? { assists: { increment: inc.assists } } : {}),
    },
  });
}

/** Aplica um lote de deltas de métricas estendidas nas colunas globais. */
async function applyStatDeltas(stats: StatDelta[]): Promise<void> {
  for (const s of stats) {
    await ensurePlayer(s.steamId, s.name);
    await prisma.player.update({
      where: { steamId: s.steamId },
      data: {
        totalShotsFired: { increment: s.shotsFired },
        totalShotsHit: { increment: s.shotsHit },
        totalDamage: { increment: s.damage },
        totalTk: { increment: s.tk },
        totalPlants: { increment: s.plants },
        totalDefusions: { increment: s.defusions },
        connections: { increment: s.connections },
        secondsPlayed: { increment: s.secondsPlayed },
      },
    });
  }
}

/* ----------------------------- /kills ------------------------------ */

export async function webhookRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  /** Incrementa contadores globais de um jogador criando-o se necessário. */
  async function upsertAndIncrement(
    p: { steamId: string; name: string },
    inc: Partial<Record<"totalKills" | "totalDeaths" | "totalHeadshots", number>>,
  ): Promise<void> {
    await prisma.player.upsert({
      where: { steamId: p.steamId },
      create: {
        steamId: p.steamId,
        name: p.name,
        totalKills: inc.totalKills ?? 0,
        totalDeaths: inc.totalDeaths ?? 0,
        totalHeadshots: inc.totalHeadshots ?? 0,
      },
      update: {
        name: p.name,
        ...(inc.totalKills ? { totalKills: { increment: inc.totalKills } } : {}),
        ...(inc.totalDeaths ? { totalDeaths: { increment: inc.totalDeaths } } : {}),
        ...(inc.totalHeadshots ? { totalHeadshots: { increment: inc.totalHeadshots } } : {}),
      },
    });
  }

  /**
   * POST /api/webhooks/kills
   * Evento de frag: atualiza agregados globais em tempo real.
   */
  app.post(
    "/api/webhooks/kills",
    { preHandler: deps.secretGuard },
    async (req, reply) => {
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "payload inválido" });
      }

      const attacker = readParticipant(body, "attacker");
      const victim = readParticipant(body, "victim");
      const hs = killBodySchema.safeParse(body);

      if (!victim && !attacker) {
        return reply.code(422).send({ error: "evento sem attacker nem victim" });
      }

      // Aprende times para colorir o radar ao vivo.
      if (attacker?.team) learnTeam(attacker.steamId, attacker.team);
      if (victim?.team) learnTeam(victim.steamId, victim.team);

      // Kill feed: evento enfileirado no buffer com o mesmo delay do radar.
      if (victim) {
        deps.onKillEvent({
          attackerName: attacker?.name ?? null,
          attackerTeam: attacker?.team ?? null,
          victimName: victim.name,
          victimTeam: victim.team ?? "UNASSIGNED",
          victimIsBot: victim.steamId.toLowerCase().startsWith("bot:"),
          weapon: hs.success ? (hs.data.weapon ?? null) : null,
          isHeadshot: hs.success && hs.data.headshot,
        });
      }

      if (attacker) {
        await upsertAndIncrement(attacker, {
          totalKills: 1,
          totalHeadshots: hs.success && hs.data.headshot ? 1 : 0,
        });
        await bumpDaily(attacker.steamId, {
          kills: 1,
          headshots: hs.success && hs.data.headshot ? 1 : 0,
        });

        // Registra a vítima do abate (humana OU bot). Bots nunca são criados
        // como player — a vítima bot é denormalizada aqui no registro.
        if (victim) {
          const victimIsBot = victim.steamId.toLowerCase().startsWith("bot:");
          await prisma.killRecord.create({
            data: {
              attackerSteamId: attacker.steamId,
              victimSteamId: victimIsBot ? victim.steamId : (victim.steamId ?? ""),
              victimName: victim.name,
              victimIsBot,
              weapon: hs.success ? (hs.data.weapon ?? null) : null,
              isHeadshot: hs.success && hs.data.headshot,
            },
          });

          // Prune: mantém apenas os 500 abates mais recentes por jogador.
          const excess = await prisma.killRecord.count({
            where: { attackerSteamId: attacker.steamId },
          });
          if (excess > MAX_KILL_RECORDS_PER_PLAYER) {
            const rows = await prisma.killRecord.findMany({
              where: { attackerSteamId: attacker.steamId },
              orderBy: { id: "desc" },
              select: { id: true },
              take: MAX_KILL_RECORDS_PER_PLAYER,
              skip: MAX_KILL_RECORDS_PER_PLAYER,
            });
            if (rows.length > 0) {
              await prisma.killRecord.deleteMany({
                where: { id: { in: rows.map((r) => r.id) } },
              });
            }
          }
        }
      }
      // Death só conta para a vítima se humana — bots nunca viram player.
      if (victim && !victim.steamId.toLowerCase().startsWith("bot:")) {
        await upsertAndIncrement(victim, { totalDeaths: 1 });
        await bumpDaily(victim.steamId, { deaths: 1 });
      }

      return reply.code(204).send();
    },
  );

  /**
   * POST /api/webhooks/round-end
   * Atualiza o placar corrente exibido no dashboard (in-memory, sem persistir).
   * Payload: { mapName, scoreCT, scoreTR, winner?, players?: [...] }
   */
  app.post(
    "/api/webhooks/round-end",
    { preHandler: deps.secretGuard },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const mapName = typeof body.mapName === "string" ? body.mapName : undefined;
      const scoreCT = Number(body.scoreCT);
      const scoreTR = Number(body.scoreTR);
      const winner = typeof body.winner === "string" ? body.winner : undefined;

      deps.onRoundEnd({ mapName, scoreCT, scoreTR, winner });

      // Métricas estendidas em delta (plugin envia a cada round-end).
      const stats = statDeltaSchema.array().safeParse(body.stats ?? []);
      if (stats.success && stats.data.length > 0) {
        await applyStatDeltas(stats.data);
      }

      // Opcionalmente aprende os times enviados no array de jogadores.
      if (Array.isArray(body.players)) {
        for (const raw of body.players as Array<Record<string, unknown>>) {
          const steamId = raw?.steamId;
          const team = raw?.team;
          if (typeof steamId === "string" && typeof team === "string") {
            learnTeam(steamId, team);
          }
        }
      }
      return reply.code(204).send();
    },
  );

  /**
   * POST /api/webhooks/match-end
   * Persiste a partida + scoreboard individual e incrementa totalMatches.
   */
  app.post(
    "/api/webhooks/match-end",
    { preHandler: deps.secretGuard },
    async (req, reply) => {
      const schema = z.object({
        mapName: z.string().min(1),
        scoreCT: z.coerce.number().int().min(0),
        scoreTR: z.coerce.number().int().min(0),
        durationSeconds: z.coerce.number().int().min(0).default(0),
        endedAt: z.string().datetime().optional(),
        players: z
          .array(
            z.object({
              steamId: z.string().min(1),
              name: z.string().default("unknown"),
              team: z.string().default("CT"),
              kills: z.coerce.number().int().min(0).default(0),
              deaths: z.coerce.number().int().min(0).default(0),
              assists: z.coerce.number().int().min(0).default(0),
              headshots: z.coerce.number().int().min(0).default(0),
            }),
          )
          .min(1),
        stats: statDeltaSchema.array().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(422)
          .send({ error: "payload inválido", details: parsed.error.flatten() });
      }
      const data = parsed.data;

      const match = await prisma.$transaction(async (tx) => {
        const created = await tx.match.create({
          data: {
            mapName: data.mapName,
            scoreCT: data.scoreCT,
            scoreTR: data.scoreTR,
            durationSeconds: data.durationSeconds,
            ...(data.endedAt ? { endedAt: new Date(data.endedAt) } : {}),
          },
        });

        for (const p of data.players) {
          await tx.player.upsert({
            where: { steamId: p.steamId },
            create: { steamId: p.steamId, name: p.name, totalMatches: 1, lastMapName: data.mapName },
            update: { name: p.name, totalMatches: { increment: 1 }, lastMapName: data.mapName },
          });
          await tx.matchPlayerStat.upsert({
            where: { matchId_playerId: { matchId: created.id, playerId: p.steamId } },
            create: {
              matchId: created.id,
              playerId: p.steamId,
              team: p.team === "T" || p.team === "TR" ? "TR" : "CT",
              kills: p.kills,
              deaths: p.deaths,
              assists: p.assists,
              headshots: p.headshots,
            },
            update: {
              team: p.team === "T" || p.team === "TR" ? "TR" : "CT",
              kills: p.kills,
              deaths: p.deaths,
              assists: p.assists,
              headshots: p.headshots,
            },
          });
          // Série diária ganha os assists da partida (kills/deaths/hs já
          // foram contados em tempo real pelo /kills).
          if (p.assists > 0) {
            await bumpDaily(p.steamId, { assists: p.assists });
          }
        }
        return created;
      });

      // Métricas estendidas do flush final (fora da tx: increment puro).
      const endStats = statDeltaSchema.array().safeParse(data.stats ?? []);
      if (endStats.success && endStats.data.length > 0) {
        await applyStatDeltas(endStats.data);
      }

      return reply.code(201).send({ matchId: match.id });
    },
  );
}
