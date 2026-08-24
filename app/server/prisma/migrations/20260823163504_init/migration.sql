-- CreateTable
CREATE TABLE "players" (
    "steamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalKills" INTEGER NOT NULL DEFAULT 0,
    "totalDeaths" INTEGER NOT NULL DEFAULT 0,
    "totalHeadshots" INTEGER NOT NULL DEFAULT 0,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("steamId")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" SERIAL NOT NULL,
    "mapName" TEXT NOT NULL,
    "scoreCT" INTEGER NOT NULL,
    "scoreTR" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_player_stats" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "team" TEXT NOT NULL DEFAULT 'CT',
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "players_totalKills_idx" ON "players"("totalKills");

-- CreateIndex
CREATE INDEX "matches_endedAt_idx" ON "matches"("endedAt");

-- CreateIndex
CREATE INDEX "matches_mapName_idx" ON "matches"("mapName");

-- CreateIndex
CREATE INDEX "match_player_stats_playerId_idx" ON "match_player_stats"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "match_player_stats_matchId_playerId_key" ON "match_player_stats"("matchId", "playerId");

-- AddForeignKey
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;
