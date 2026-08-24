-- Métricas estendidas do jogador (painel de perfil) + série diária para gráficos.
-- Colunas camelCase por convenção do projeto (tabelas snake_case).

ALTER TABLE "players" ADD COLUMN "totalAssists" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalTk" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalShotsFired" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalShotsHit" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalDamage" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalPlants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "totalDefusions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "secondsPlayed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "connections" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "lastMapName" TEXT;

-- CreateTable
CREATE TABLE "player_daily_stats" (
    "id" SERIAL NOT NULL,
    "playerId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_daily_stats_playerId_day_idx" ON "player_daily_stats"("playerId", "day");

-- AddForeignKey
ALTER TABLE "player_daily_stats" ADD CONSTRAINT "player_daily_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique por jogador/dia (upsert dos webhooks)
CREATE UNIQUE INDEX "player_daily_stats_playerId_day_key" ON "player_daily_stats"("playerId", "day");
