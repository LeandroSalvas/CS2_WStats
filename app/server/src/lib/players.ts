import { Prisma } from "@prisma/client";
import type { Player } from "@prisma/client";

export interface PlayerRankDTO {
  rank: number;
  steamId: string;
  name: string;
  totalKills: number;
  totalDeaths: number;
  totalHeadshots: number;
  totalMatches: number;
  kd: string; // "1.85"
  hsPercent: string; // "52.3"
  skill: number;
}

/** Fórmula de habilidade simples e documentada no README. */
export function skillScore(p: Pick<Player, "totalKills" | "totalDeaths" | "totalHeadshots">): number {
  return p.totalKills * 2 + p.totalHeadshots - p.totalDeaths;
}

export function toRankDTO(p: Player, rank: number): PlayerRankDTO {
  const kd = p.totalDeaths > 0 ? p.totalKills / p.totalDeaths : p.totalKills > 0 ? p.totalKills : 0;
  const hs = p.totalKills > 0 ? (p.totalHeadshots / p.totalKills) * 100 : 0;
  return {
    rank,
    steamId: p.steamId,
    name: p.name,
    totalKills: p.totalKills,
    totalDeaths: p.totalDeaths,
    totalHeadshots: p.totalHeadshots,
    totalMatches: p.totalMatches,
    kd: kd.toFixed(2),
    hsPercent: hs.toFixed(1),
    skill: skillScore(p),
  };
}

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const limitRaw = Number.parseInt(String(query.limit ?? "20"), 10) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  return { page, limit, skip: (page - 1) * limit };
}

export function buildSearchWhere(search?: string): Prisma.PlayerWhereInput | undefined {
  if (!search || search.trim().length === 0) return undefined;
  const term = search.trim();
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { steamId: { contains: term } },
    ],
  };
}
