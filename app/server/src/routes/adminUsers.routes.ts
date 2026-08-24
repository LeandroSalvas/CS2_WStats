import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../plugins/rbac.js";

export function registerAdminUsersRoutes(app: FastifyInstance): void {
  // ---- Lista usuários (pendentes ou ativos) ---------------------------------
  app.get("/api/admin/users", { preHandler: requireRole("SUPER_ADMIN") }, async (req, reply) => {
    const status = (req.query as { status?: string }).status ?? "pending";

    if (status === "pending") {
      const users = await prisma.user.findMany({
        where: { role: "PENDENTE" },
        orderBy: { createdAt: "asc" },
        select: PUBLIC_FIELDS,
      });
      return reply.send({ users });
    }

    const users = await prisma.user.findMany({
      where: { role: { not: "PENDENTE" } },
      orderBy: [{ isLocalAdmin: "desc" }, { createdAt: "asc" }],
      select: PUBLIC_FIELDS,
    });
    return reply.send({ users });
  });

  // ---- Aprovar pendente com papel escolhido -----------------------------------
  app.post("/api/admin/users/:id/approve", { preHandler: requireRole("SUPER_ADMIN") }, async (req, reply) => {
    const id = parseId(req);
    if (id == null) return reply.code(400).send({ error: "id_invalido" });
    const body = z
      .object({ role: z.enum(["ADMIN", "SUPER_ADMIN"]) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "role_invalida" });

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: "nao_encontrado" });
    if (user.role !== "PENDENTE") {
      return reply.code(409).send({ error: "usuario_nao_pendente" });
    }
    if (user.isLocalAdmin) {
      // Defesa em profundidade — o admin local nunca nasce PENDENTE.
      return reply.code(409).send({ error: "admin_local_protegido" });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { role: body.data.role },
      select: PUBLIC_FIELDS,
    });
    return reply.send({ user: updated });
  });

  // ---- Rejeitar/remover pendente ------------------------------------------------
  app.post("/api/admin/users/:id/reject", { preHandler: requireRole("SUPER_ADMIN") }, async (req, reply) => {
    const id = parseId(req);
    if (id == null) return reply.code(400).send({ error: "id_invalido" });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: "nao_encontrado" });
    if (user.role !== "PENDENTE") {
      return reply.code(409).send({ error: "usuario_nao_pendente" });
    }
    await prisma.user.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // ---- Alterar papel de usuário ativo ---------------------------------------------
  app.patch("/api/admin/users/:id/role", { preHandler: requireRole("SUPER_ADMIN") }, async (req, reply) => {
    const session = (req as AuthedRequest).session!;
    const id = parseId(req);
    if (id == null) return reply.code(400).send({ error: "id_invalido" });
    const body = z
      .object({ role: z.enum(["ADMIN", "SUPER_ADMIN"]) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "role_invalida" });

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: "nao_encontrado" });
    if (user.isLocalAdmin) {
      return reply.code(403).send({ error: "admin_local_protegido" });
    }
    if (user.id === session.uid && body.data.role !== "SUPER_ADMIN") {
      return reply.code(400).send({ error: "auto_rebaixamento" });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { role: body.data.role },
      select: PUBLIC_FIELDS,
    });
    return reply.send({ user: updated });
  });

  // ---- Remover usuário ativo ---------------------------------------------------------
  app.delete("/api/admin/users/:id", { preHandler: requireRole("SUPER_ADMIN") }, async (req, reply) => {
    const session = (req as AuthedRequest).session!;
    const id = parseId(req);
    if (id == null) return reply.code(400).send({ error: "id_invalido" });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: "nao_encontrado" });
    if (user.isLocalAdmin) {
      return reply.code(403).send({ error: "admin_local_protegido" });
    }
    if (user.id === session.uid) {
      return reply.code(400).send({ error: "auto_exclusao" });
    }
    await prisma.user.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // ---- Auditoria RCON ------------------------------------------------------------------
  app.get("/api/rcon/logs", { preHandler: requireRole("SUPER_ADMIN") }, async (_req, reply) => {
    const logs = await prisma.rconLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    });
    return reply.send({ logs });
  });
}

// -------------------------------------------------------------------------------------------

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  avatar: true,
  role: true,
  isLocalAdmin: true,
  createdAt: true,
} as const;

function parseId(req: FastifyRequest): number | null {
  const raw = (req.params as { id?: string }).id;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
