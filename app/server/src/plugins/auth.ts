import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Guarda compartilhado por /api/webhooks/* e /api/gsi.
 * Aceita o segredo via:
 *  - header X-Webhook-Secret (plugins HTTP)
 *  - campo auth do payload GSI (bloco "auth" do gamestate_integration_*.cfg)
 */
export function makeSecretGuard(secret: string | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!secret) return; // sem segredo configurado = endpoints abertos
    const header = req.headers["x-webhook-secret"];
    if (typeof header === "string" && header === secret) return;

    const body = req.body as { auth?: unknown } | null;
    if (body && typeof body === "object" && body.auth != null) {
      if (typeof body.auth === "string" && body.auth === secret) return;
      if (typeof body.auth === "object") {
        for (const value of Object.values(body.auth as Record<string, unknown>)) {
          if (String(value) === secret) return;
        }
      }
    }
    void reply.code(401).send({ error: "unauthorized" });
  };
}
