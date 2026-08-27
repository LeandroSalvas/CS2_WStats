-- CreateTable
CREATE TABLE "kill_records" (
    "id" SERIAL NOT NULL,
    "attackerSteamId" TEXT NOT NULL,
    "victimSteamId" TEXT NOT NULL,
    "victimName" TEXT NOT NULL,
    "victimIsBot" BOOLEAN NOT NULL DEFAULT false,
    "weapon" TEXT,
    "isHeadshot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kill_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kill_records_attackerSteamId_createdAt_idx" ON "kill_records"("attackerSteamId", "createdAt");

-- AddForeignKey
ALTER TABLE "kill_records" ADD CONSTRAINT "kill_records_attackerSteamId_fkey" FOREIGN KEY ("attackerSteamId") REFERENCES "players"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;
