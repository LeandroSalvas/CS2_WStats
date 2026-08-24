import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { buildSearchWhere, parsePagination, toRankDTO } from "../lib/players.js";

/** Ranking completo paginado com busca por nome/SteamID. */
export async function rankingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string> }>("/api/ranking", async (req) => {
    const { page, limit, skip } = parsePagination(req.query);
    const where = buildSearchWhere(req.query.search);

    const [total, players] = await Promise.all([
      prisma.player.count({ where }),
      prisma.player.findMany({
        where,
        orderBy: [
          { totalKills: "desc" },
          { totalDeaths: "asc" },
          { steamId: "asc" },
        ],
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
  });
}
