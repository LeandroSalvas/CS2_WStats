import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getStatus } from "../gsi/liveState.js";
import { toRankDTO } from "../lib/players.js";

/**
 * Agregado da home em uma única chamada:
 * status do servidor, métricas globais, última partida (com MVP),
 * pódio top 3 e ranking resumido.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard", async () => {
    const [
      totalPlayers,
      killAgg,
      mapAgg,
      lastMatch,
      topPlayers,
      server,
    ] = await Promise.all([
      prisma.player.count(),
      prisma.player.aggregate({ _sum: { totalKills: true } }),
      prisma.match.findMany({ distinct: ["mapName"], select: { mapName: true } }),
      prisma.match.findFirst({
        orderBy: { endedAt: "desc" },
        include: {
          stats: {
            include: { player: { select: { steamId: true, name: true } } },
          },
        },
      }),
      prisma.player.findMany({
        orderBy: [{ totalKills: "desc" }, { totalDeaths: "asc" }],
        take: 10,
      }),
      Promise.resolve(getStatus()),
    ]);

    let mvp: { steamId: string; name: string; kills: number; assists: number } | null = null;
    if (lastMatch) {
      for (const s of lastMatch.stats) {
        if (!mvp || s.kills * 2 + s.assists > mvp.kills * 2 + mvp.assists) {
          mvp = { steamId: s.player.steamId, name: s.player.name, kills: s.kills, assists: s.assists };
        }
      }
    }

    return {
      server,
      metrics: {
        players: totalPlayers,
        kills: killAgg._sum.totalKills ?? 0,
        maps: mapAgg.length,
      },
      lastMatch:
        lastMatch == null
          ? null
          : {
              id: lastMatch.id,
              mapName: lastMatch.mapName,
              scoreCT: lastMatch.scoreCT,
              scoreTR: lastMatch.scoreTR,
              durationSeconds: lastMatch.durationSeconds,
              endedAt: lastMatch.endedAt.toISOString(),
              winner: lastMatch.scoreCT >= lastMatch.scoreTR ? ("CT" as const) : ("TR" as const),
              mvp,
            },
      podium: topPlayers.slice(0, 3).map((p, i) => ({ ...toRankDTO(p, i + 1), medal: i + 1 })),
      recentRanking: topPlayers.map((p, i) => toRankDTO(p, i + 1)),
    };
  });
}
