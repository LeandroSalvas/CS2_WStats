import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, type AuthedRequest } from "../plugins/rbac.js";
import {
  banUser,
  exec,
  isCommandBlocked,
  kickUser,
  listPlayers,
  rconConfigured,
  sanitizeError,
} from "../services/rconService.js";

const MAX_RESPONSE_CHARS = 8_000;

export function registerRconRoutes(app: FastifyInstance): void {
  const admin = requireRole("ADMIN");

  // ---- Console livre ---------------------------------------------------------
  app.post("/api/rcon/exec", { preHandler: admin }, async (req, reply) => {
    if (!rconConfigured()) {
      return reply.code(503).send({ error: "rcon_nao_configurado" });
    }
    const session = (req as AuthedRequest).session!;
    const body = z.object({ command: z.string().min(1).max(512) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    const command = body.data.command.trim();
    if (isCommandBlocked(command, session.role)) {
      await audit(app, session.uid, command, "[BLOQUEADO] comando restrito a SUPER_ADMIN");
      return reply.code(403).send({
        error: "comando_bloqueado",
        message: "Comando restrito a SUPER_ADMIN.",
      });
    }

    try {
      const response = await exec(command);
      await audit(app, session.uid, command, response);
      return reply.send({ ok: true, response });
    } catch (err) {
      const msg = sanitizeError(err);
      app.log.error({ err: msg }, "[rcon] Falha ao executar comando");
      return reply.code(502).send({ error: "rcon_falhou", message: msg });
    }
  });

  // ---- Jogadores conectados (status + GSI ao vivo) -----------------------------
  app.get("/api/rcon/players", { preHandler: admin }, async (_req, reply) => {
    if (!rconConfigured()) {
      return reply.code(503).send({ error: "rcon_nao_configurado" });
    }
    try {
      const { players } = await listPlayers();
      return reply.send({ players });
    } catch (err) {
      const msg = sanitizeError(err);
      app.log.error({ err: msg }, "[rcon] Falha ao listar jogadores");
      return reply.code(502).send({ error: "rcon_falhou", message: msg });
    }
  });

  // ---- Kick ----------------------------------------------------------------------
  app.post("/api/rcon/players/:userid/kick", { preHandler: admin }, async (req, reply) => {
    if (!rconConfigured()) {
      return reply.code(503).send({ error: "rcon_nao_configurado" });
    }
    const userid = (req.params as { userid?: string }).userid ?? "";
    if (!/^\d+$/.test(userid)) return reply.code(400).send({ error: "userid_invalido" });
    const session = (req as AuthedRequest).session!;

    try {
      await kickUser(userid);
      const cmd = `kickid ${userid}`;
      await audit(app, session.uid, cmd, "ok");
      return reply.send({ ok: true });
    } catch (err) {
      const msg = sanitizeError(err);
      app.log.error({ err: msg }, "[rcon] Falha no kick");
      return reply.code(502).send({ error: "rcon_falhou", message: msg });
    }
  });

  // ---- Ban --------------------------------------------------------------------------
  app.post("/api/rcon/players/:userid/ban", { preHandler: admin }, async (req, reply) => {
    if (!rconConfigured()) {
      return reply.code(503).send({ error: "rcon_nao_configurado" });
    }
    const userid = (req.params as { userid?: string }).userid ?? "";
    if (!/^\d+$/.test(userid)) return reply.code(400).send({ error: "userid_invalido" });
    const body = z
      .object({
        minutes: z.number().int().min(0).default(0),
        reason: z.string().max(200).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const session = (req as AuthedRequest).session!;
    const minutes = body.data.minutes;

    try {
      await banUser(userid, minutes);
      const motivo = body.data.reason ? ` // motivo: ${body.data.reason}` : "";
      await audit(app, session.uid, `banid ${minutes} ${userid}${motivo}`, "ok");
      return reply.send({ ok: true, permanent: minutes === 0 });
    } catch (err) {
      const msg = sanitizeError(err);
      app.log.error({ err: msg }, "[rcon] Falha no ban");
      return reply.code(502).send({ error: "rcon_falhou", message: msg });
    }
  });
}

async function audit(
  app: FastifyInstance,
  userId: number,
  command: string,
  response: string,
): Promise<void> {
  try {
    await prisma.rconLog.create({
      data: { userId, command, response: response.slice(0, MAX_RESPONSE_CHARS) },
    });
  } catch (err) {
    app.log.error({ err }, "[rcon] Falha ao gravar auditoria");
  }
}
