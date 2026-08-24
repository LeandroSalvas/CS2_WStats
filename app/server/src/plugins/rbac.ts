import type { FastifyReply, FastifyRequest } from "fastify";
import { readSession } from "../services/authService.js";

export type Role = "PENDENTE" | "ADMIN" | "SUPER_ADMIN";

const ROLE_ORDER: Record<Role, number> = {
  PENDENTE: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

export interface AuthedRequest extends FastifyRequest {
  session?: { uid: number; email: string; role: Role; isLocalAdmin?: boolean };
}

/** Exige sessão válida com role > PENDENTE. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = readSession(req);
  if (!session) {
    await reply.code(401).send({ error: "unauthenticated" });
    return;
  }
  if (session.role === "PENDENTE") {
    await reply.code(403).send({ error: "forbidden", code: "PENDING_APPROVAL" });
    return;
  }
  (req as AuthedRequest).session = session;
}

/** Exige papel mínimo. SUPER_ADMIN satisfaz qualquer exigência. */
export function requireRole(minimum: Exclude<Role, "PENDENTE">) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = readSession(req);
    if (!session) {
      await reply.code(401).send({ error: "unauthenticated" });
      return;
    }
    if (ROLE_ORDER[session.role] < ROLE_ORDER[minimum]) {
      await reply.code(403).send({
        error: "forbidden",
        code: session.role === "PENDENTE" ? "PENDING_APPROVAL" : "INSUFFICIENT_ROLE",
      });
      return;
    }
    (req as AuthedRequest).session = session;
  };
}
