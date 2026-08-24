import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { parsePagination } from "../lib/players.js";

export interface MatchListItemDTO {
  id: number;
  mapName: string;
  scoreCT: number;
  scoreTR: number;
  durationSeconds: number;
  endedAt: string;
  mvpName: string | null;
  mvpKills: number | null;
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  /** Lista paginada de partidas encerradas, com filtro por mapa. */
  app.get<{ Querystring: Record<string, string> }>("/api/matches", async (req) => {
    const { page, limit, skip } = parsePagination(req.query);
    const mapName = req.query.map?.trim();
    const where = mapName ? { mapName } : undefined;

    const [total, matches] = await Promise.all([
      prisma.match.count({ where }),
      prisma.match.findMany({
        where,
        orderBy: { endedAt: "desc" },
        skip,
        take: limit,
        include: {
          stats: {
            orderBy: [{ kills: "desc" }, { assists: "desc" }],
            take: 1,
            include: { player: { select: { name: true } } },
          },
        },
      }),
    ]);

    const items: MatchListItemDTO[] = matches.map((m) => ({
      id: m.id,
      mapName: m.mapName,
      scoreCT: m.scoreCT,
      scoreTR: m.scoreTR,
      durationSeconds: m.durationSeconds,
      endedAt: m.endedAt.toISOString(),
      mvpName: m.stats[0]?.player.name ?? null,
      mvpKills: m.stats[0]?.kills ?? null,
    }));

    return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
  });

  /** Mapas distintos (para o filtro da tela /partidas). */
  app.get("/api/maps", async () => {
    const rows = await prisma.match.findMany({
      distinct: ["mapName"],
      select: { mapName: true },
      orderBy: { mapName: "asc" },
    });
    return { maps: rows.map((r) => r.mapName) };
  });

  /** Detalhe da partida com scoreboard CT vs TR + MVP. */
  app.get<{ Params: { id: string } }>("/api/matches/:id", async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "id inválido" });

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: { select: { steamId: true, name: true } } },
          orderBy: [{ kills: "desc" }, { assists: "desc" }, { deaths: "asc" }],
        },
      },
    });
    if (!match) return reply.code(404).send({ error: "partida não encontrada" });

    const toRow = (s: (typeof match.stats)[number]) => ({
      steamId: s.player.steamId,
      name: s.player.name,
      team: s.team,
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      headshots: s.headshots,
    });

    const ct = match.stats.filter((s) => s.team !== "TR").map(toRow);
    const tr = match.stats.filter((s) => s.team === "TR").map(toRow);

    // MVP = maior pontuação simples dentro da partida.
    let mvp: ReturnType<typeof toRow> | null = null;
    for (const s of match.stats) {
      if (!mvp || s.kills * 2 + s.assists > mvp.kills * 2 + mvp.assists) {
        mvp = toRow(s);
      }
    }

    return {
      match: {
        id: match.id,
        mapName: match.mapName,
        scoreCT: match.scoreCT,
        scoreTR: match.scoreTR,
        durationSeconds: match.durationSeconds,
        endedAt: match.endedAt.toISOString(),
      },
      ct,
      tr,
      mvp,
    };
  });
}
