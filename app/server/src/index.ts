import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";

import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./services/authService.js";
import { GSIBufferManager } from "./gsi/GSIBufferManager.js";
import { normalizeGsiPayload } from "./gsi/normalize.js";
import type { LiveSnapshot, RawGsiPayload } from "./gsi/types.js";
import type { KillFeedEntry } from "./gsi/killTypes.js";
import { applyRoundScore, getStatus, updateFromSnapshot } from "./gsi/liveState.js";
import { WsHub } from "./lib/wsHub.js";
import { makeSecretGuard } from "./plugins/auth.js";
import { gsiRoutes, type RouteDeps } from "./routes/gsi.routes.js";
import { webhookRoutes } from "./routes/webhooks.routes.js";
import { statusRoutes } from "./routes/status.routes.js";
import { playerRoutes } from "./routes/players.routes.js";
import { matchRoutes } from "./routes/matches.routes.js";
import { rankingRoutes } from "./routes/ranking.routes.js";
import { dashboardRoutes } from "./routes/dashboard.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerAdminUsersRoutes } from "./routes/adminUsers.routes.js";
import { registerRconRoutes } from "./routes/rcon.routes.js";
import type { PrismaClient } from "@prisma/client";

/** Cria (ou repara) o admin local fixo. Idempotente — roda a cada boot. */
async function ensureLocalAdmin(db: PrismaClient): Promise<void> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.trim() === "") {
    if ((await db.user.count({ where: { isLocalAdmin: true } })) === 0) {
      console.warn("[bootstrap] ADMIN_PASSWORD ausente e nenhum admin local existe.");
    }
    return;
  }
  await db.user.upsert({
    where: { email },
    update: {
      // Repara papel/hash se alguém mexeu; nunca derruba isLocalAdmin.
      passwordHash: hashPassword(env.ADMIN_PASSWORD),
      role: "SUPER_ADMIN",
      isLocalAdmin: true,
    },
    create: {
      email,
      name: "Admin",
      passwordHash: hashPassword(env.ADMIN_PASSWORD),
      role: "SUPER_ADMIN",
      isLocalAdmin: true,
    },
  });
  console.log(`[bootstrap] Admin local garantido: ${email}`);
}

async function main(): Promise<void> {
  // Prefixo público da SPA atrás de proxy reverso com sub-path (ex.: /cs2/).
  // Injetado no index.html em runtime e aceito diretamente nas requisições,
  // então raiz e sub-path funcionam na mesma instância.
  const publicBase = `${(process.env.PUBLIC_BASE_PATH ?? "/").trim().replace(/\/?$/, "/")}`;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
    trustProxy: true,
    rewriteUrl(req) {
      const url = req.url ?? "/";
      if (publicBase === "/") return url;
      if (url === publicBase) return "/";
      if (url.startsWith(publicBase)) return `/${url.slice(publicBase.length)}`;
      return url;
    },
  });

  // GSI pode chegar como application/json (padrão), text/plain ou form-encoded.
  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string" },
    (_req, body: string, done) => {
      try {
        done(null, JSON.parse(body));
      } catch {
        done(new Error("body não é JSON válido"), undefined);
      }
    },
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body: string, done) => {
      const payload = new URLSearchParams(body).get("payload");
      if (!payload) return done(null, {});
      try {
        done(null, JSON.parse(payload));
      } catch {
        done(new Error("campo 'payload' não é JSON válido"), undefined);
      }
    },
  );

  await app.register(cors, { origin: true });

  // --------------------- Buffer FIFO com delay (RAM) --------------------
  // Snapshot do radar e eventos de kill feed passam por buffers separados
  // com EXATAMENTE o mesmo delay — checam sincronizados no cliente.
  const buffer = new GSIBufferManager<LiveSnapshot>({
    delayMs: () => env.GSI_DELAY_SECONDS * 1000,
    maxItems: env.MAX_BUFFER_ITEMS,
    onRelease: (snapshot: LiveSnapshot) => wsHub.broadcast("live", "snapshot", snapshot),
  });
  buffer.start();

  const killBuffer = new GSIBufferManager<KillFeedEntry>({
    delayMs: () => env.GSI_DELAY_SECONDS * 1000,
    maxItems: 500, // ~tiros de uma partida inteira; sobra folga
    onRelease: (kill: KillFeedEntry) => wsHub.broadcast("live", "kill", kill),
  });
  killBuffer.start();

  // ------------------------- WebSocket /ws/live -------------------------
  const wsHub = new WsHub();
  await app.register(websocket, { options: { maxPayload: 1024 * 512 } });

  app.get("/ws/live", { websocket: true }, (socket: WebSocket) => {
    wsHub.join("live", socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        data: { delaySeconds: buffer.delaySeconds, buffered: buffer.size, status: getStatus() },
      }),
    );
  });

  // --------------------------- Rotas da API ----------------------------
  const deps: RouteDeps = {
    secretGuard: makeSecretGuard(env.WEBHOOK_SECRET),
    onGsiPayload: (raw: RawGsiPayload) => {
      const snap = normalizeGsiPayload(raw);
      updateFromSnapshot(snap);
      buffer.push(snap);
    },
    onKillEvent: (kill: KillFeedEntry) => {
      // Mesmo delay do radar: o abatimento aparece sincronizado com o minimapa.
      killBuffer.push(kill);
    },
    onRoundEnd: (info) => applyRoundScore(info.scoreCT, info.scoreTR),
  };

  await app.register(async (instance) => {
    await gsiRoutes(instance, deps);
    await webhookRoutes(instance, deps);
  });
  await statusRoutes(app);
  await playerRoutes(app);
  await matchRoutes(app);
  await rankingRoutes(app);
  await dashboardRoutes(app);
  registerAuthRoutes(app);
  await registerAdminUsersRoutes(app);
  await registerRconRoutes(app);

  // ---------------------- Frontend (SPA do Vite) -----------------------
  const webDist = process.env.WEB_DIST_DIR || path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: false });

    const indexHtml = fs
      .readFileSync(path.join(webDist, "index.html"), "utf8")
      .replaceAll("%APP_BASE%", publicBase)
      // O Vite emite refs relativas ("./assets/..."), que quebram em rotas de
      // 2+ níveis (/cs2/admin/rcon -> /cs2/admin/assets/...). Absolutiza com o
      // prefixo público para deep-refresh funcionar em qualquer profundidade.
      .replaceAll('src="./', `src="${publicBase}`)
      .replaceAll('href="./', `href="${publicBase}`);

    app.get("/", (_req, reply) => {
      void reply.type("text/html; charset=utf-8").send(indexHtml);
    });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "/";
      if (req.method === "GET" && !url.startsWith("/api") && !url.startsWith("/ws")) {
        void reply.type("text/html; charset=utf-8").send(indexHtml);
      } else {
        void reply.code(404).send({ error: "not found" });
      }
    });
  } else {
    app.log.warn(`WEB_DIST_DIR não encontrado (${webDist}) — apenas a API estará disponível.`);
  }

  // ------------------------------ Bootstrap ----------------------------
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} recebido; encerrando...`);
    buffer.stop();
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "erro no shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Seed idempotente do admin local fixo (protegido contra exclusão/demissão).
  try {
    await ensureLocalAdmin(prisma);
  } catch (err) {
    app.log.error({ err }, "[bootstrap] Falha ao garantir o admin local");
  }

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error("Falha fatal ao iniciar o servidor:", err);
  process.exit(1);
});
