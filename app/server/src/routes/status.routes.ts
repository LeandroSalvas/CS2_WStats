import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getStatus } from "../gsi/liveState.js";

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  /** Status do servidor dedicado — derivado exclusivamente dos heartbeats GSI em memória. */
  app.get("/api/server-status", async () => getStatus());

  app.get("/api/health", async () => {
    let db = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    return { ok: db, db };
  });
}
