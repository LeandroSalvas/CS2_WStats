import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  buildSearchWhere,
  parsePagination,
  toRankDTO,
} from "../lib/players.js";

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  /** Lista paginada de jogadores com busca por nome/steamId. */
  app.get<{ Querystring: Record<string, string> }>(
    "/api/players",
    async (req) => {
      const { page, limit, skip } = parsePagination(req.query);
      const where = buildSearchWhere(req.query.search);

      const [total, players] = await Promise.all([
        prisma.player.count({ where }),
        prisma.player.findMany({
          where,
          orderBy: [{ totalKills: "desc" }, { steamId: "asc" }],
          skip,
          take: limit,
        }),
      ]);

      return {
        items: players.map((p, i) => toRankDTO(p, skip + i + 1)),
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      };
    },
  );

  /** Perfil completo de um jogador: métricas, série diária e últimas partidas. */
  app.get<{ Params: { steamId: string } }>(
    "/api/players/:steamId",
    async (req, reply) => {
      const player = await prisma.player.findUnique({
        where: { steamId: req.params.steamId },
        include: {
          matchStats: {
            orderBy: { matchId: "desc" },
            take: 20,
            include: { match: { select: { id: true, mapName: true, endedAt: true, durationSeconds: true } } },
          },
          dailyStats: { orderBy: { day: "asc" } },
        },
      });
      if (!player) return reply.code(404).send({ error: "jogador não encontrado" });

      // Posição global (por kills).
      const betterPlayers = await prisma.player.count({
        where: { totalKills: { gt: player.totalKills } },
      });

      const matchDurations = await prisma.match.findMany({
        where: { stats: { some: { playerId: player.steamId } } },
        select: { durationSeconds: true },
      });
      const secondsFromMatches = matchDurations.reduce((acc, m) => acc + m.durationSeconds, 0);
      const secondsPlayed =
        player.secondsPlayed > 0
          ? player.secondsPlayed
          : secondsFromMatches;

      const shotsFired = Number(player.totalShotsFired);
      const shotsHit = Number(player.totalShotsHit);

      return {
        identity: {
          steamId: player.steamId,
          name: player.name,
          rank: betterPlayers + 1,
          createdAt: player.createdAt,
        },
        combat: {
          kills: player.totalKills,
          deaths: player.totalDeaths,
          headshots: player.totalHeadshots,
          hsPercent: toRankDTO(player, 0).hsPercent,
          kd: toRankDTO(player, 0).kd,
          skill: toRankDTO(player, 0).skill,
          accuracyPercent:
            shotsFired > 0
              ? ((shotsHit / shotsFired) * 100).toFixed(1)
              : null, // null = ainda sem dados do plugin estendido
          assists: player.totalAssists,
          tk: player.totalTk,
          damageTotal: Number(player.totalDamage),
        },
        bomb: {
          plants: player.totalPlants,
          defusions: player.totalDefusions,
        },
        time: {
          hoursPlayed: Math.round((secondsPlayed / 3600) * 10) / 10,
          connections: player.connections,
          firstSeenAt: player.createdAt,
          lastMapName: player.lastMapName ?? player.matchStats[0]?.match.mapName ?? null,
        },
        series: player.dailyStats.map((d) => ({
          day: d.day.toISOString().slice(0, 10),
          kills: d.kills,
          deaths: d.deaths,
          headshots: d.headshots,
          assists: d.assists,
        })),
        matches: player.matchStats.map((s) => ({
          matchId: s.match.id,
          mapName: s.match.mapName,
          endedAt: s.match.endedAt,
          durationSeconds: s.match.durationSeconds,
          team: s.team,
          kills: s.kills,
          deaths: s.deaths,
          assists: s.assists,
          headshots: s.headshots,
        })),
      };
    },
  );
}
