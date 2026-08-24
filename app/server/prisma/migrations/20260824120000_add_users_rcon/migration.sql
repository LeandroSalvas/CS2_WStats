-- Cria RBAC de usuários e auditoria RCON.
-- Convenção do projeto: tabelas em snake_case (@@map), colunas em camelCase.
CREATE TYPE "Role" AS ENUM ('PENDENTE', 'ADMIN', 'SUPER_ADMIN');

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "googleSub" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PENDENTE',
    "isLocalAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

CREATE TABLE "rcon_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rcon_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rcon_logs_userId_idx" ON "rcon_logs"("userId");
CREATE INDEX "rcon_logs_createdAt_idx" ON "rcon_logs"("createdAt");

ALTER TABLE "rcon_logs" ADD CONSTRAINT "rcon_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
