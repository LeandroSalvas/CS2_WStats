import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RawGsiPayload } from "../gsi/types.js";
import type { KillFeedEntry } from "../gsi/killTypes.js";

export interface RouteDeps {
  /** preHandler que valida o segredo compartilhado (se configurado). */
  secretGuard: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Callback chamado a cada payload GSI recebido (buffer + liveState). */
  onGsiPayload: (raw: RawGsiPayload) => void;
  /** Callback de /api/webhooks/kills — enfileira o frag no kill buffer (delay do radar). */
  onKillEvent: (kill: KillFeedEntry) => void;
  /** Callback de /api/webhooks/round-end (atualiza placar corrente em memória). */
  onRoundEnd: (info: {
    mapName?: string;
    scoreCT?: number;
    scoreTR?: number;
    winner?: string;
  }) => void;
}

/** Recebe os payloads do Game State Integration enviados pelo servidor CS2. */
export async function gsiRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post<{ Body: RawGsiPayload }>(
    "/api/gsi",
    { preHandler: deps.secretGuard },
    async (req, reply) => {
      const body = req.body;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "payload inválido" });
      }
      // Heartbeat vazio (só "provider") também conta como sinal de vida.
      deps.onGsiPayload(body);
      return reply.code(204).send();
    },
  );
}
