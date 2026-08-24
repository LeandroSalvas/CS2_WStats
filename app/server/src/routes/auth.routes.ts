import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { appPublicUrl, env, publicBasePath } from "../config/env.js";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  makeOAuthState,
  readOAuthStateCookie,
  readSession,
  setOAuthStateCookie,
  setSessionCookie,
  signSession,
  verifyPassword,
} from "../services/authService.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function googleEnabled(): boolean {
  return env.AUTH_GOOGLE_ENABLED && !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

function googleRedirectUri(): string {
  return `${appPublicUrl()}/api/auth/google/callback`;
}

function redirectToLogin(reply: FastifyReply, erro: string): FastifyReply {
  return reply.redirect(`${publicBasePath() || ""}/login?erro=${erro}`);
}

interface MePayload {
  authenticated: true;
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  role: "PENDENTE" | "ADMIN" | "SUPER_ADMIN";
  isLocalAdmin: boolean;
}

function mePayload(user: {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  role: "PENDENTE" | "ADMIN" | "SUPER_ADMIN";
  isLocalAdmin: boolean;
}): MePayload {
  return {
    authenticated: true,
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    isLocalAdmin: user.isLocalAdmin,
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // ---- Login local ----------------------------------------------------------
  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const user = await prisma.user.findUnique({
      where: { email: body.data.username.toLowerCase().trim() },
    });

    if (!user?.passwordHash) {
      return reply.code(401).send({ error: "credenciais_invalidas" });
    }
    if (!verifyPassword(body.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "credenciais_invalidas" });
    }

    const token = signSession({
      uid: user.id,
      email: user.email,
      role: user.role,
      isLocalAdmin: user.isLocalAdmin || undefined,
    });
    setSessionCookie(reply, token);
    return reply.send(mePayload(user));
  });

  // ---- Quem sou eu ------------------------------------------------------------
  app.get("/api/auth/me", async (req, reply) => {
    const session = readSession(req);
    if (!session) {
      return reply.code(200).send({ authenticated: false, googleEnabled: googleEnabled() });
    }
    const user = await prisma.user.findUnique({ where: { id: session.uid } });
    if (!user) {
      clearSessionCookie(reply);
      return reply.code(200).send({ authenticated: false, googleEnabled: googleEnabled() });
    }
    return reply
      .code(200)
      .send({ ...mePayload(user), googleEnabled: googleEnabled() });
  });

  // ---- Logout -------------------------------------------------------------------
  app.post("/api/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  // ---- Google OAuth (implementado; ligado por AUTH_GOOGLE_ENABLED) --------------
  app.get("/api/auth/google", async (_req, reply) => {
    if (!googleEnabled()) {
      return redirectToLogin(reply, "google_desabilitado");
    }
    const state = makeOAuthState();
    setOAuthStateCookie(reply, state);
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", googleRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return reply.redirect(url.toString());
  });

  interface GoogleCallbackQuery {
    code?: string;
    state?: string;
    error?: string;
  }

  app.get(
    "/api/auth/google/callback",
    async (req: import("fastify").FastifyRequest<{ Querystring: GoogleCallbackQuery }>, reply) => {
      if (!googleEnabled()) {
        return redirectToLogin(reply, "google_desabilitado");
      }
      const base = publicBasePath() || "";
      if (req.query.error) {
        return reply.redirect(`${base}/login?erro=${encodeURIComponent(req.query.error)}`);
      }
      const { code, state } = req.query;
      const cookieState = readOAuthStateCookie(req);
      clearOAuthStateCookie(reply);
      if (!code || !state || !cookieState || state !== cookieState) {
        return reply.redirect(`${base}/login?erro=oauth_state_invalido`);
      }

      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID!,
            client_secret: env.GOOGLE_CLIENT_SECRET!,
            redirect_uri: googleRedirectUri(),
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) {
          app.log.warn("[auth] Google token endpoint recusou o code");
          return reply.redirect(`${base}/login?erro=oauth_token`);
        }
        const tokens = (await tokenRes.json()) as { id_token?: string };
        if (!tokens.id_token) {
          return reply.redirect(`${base}/login?erro=oauth_idtoken`);
        }
        // Payload do id_token: confiança vem da resposta direta do Google via TLS.
        const [, payloadB64] = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
          sub: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
          picture?: string;
        };
        const email = payload.email;
        if (!email || payload.email_verified === false) {
          return reply.redirect(`${base}/login?erro=email_nao_verificado`);
        }

        const user = await upsertGoogleUser({
          sub: payload.sub,
          email: email.toLowerCase(),
          name: payload.name,
          picture: payload.picture,
        });
        const token = signSession({
          uid: user.id,
          email: user.email,
          role: user.role,
          isLocalAdmin: user.isLocalAdmin || undefined,
        });
        setSessionCookie(reply, token);

        // Pendentes caem na tela de aprovação; aprovados vão ao dashboard.
        return reply.redirect(user.role === "PENDENTE" ? `${base}/aguardando` : `${base}/`);
      } catch (err) {
        app.log.error({ err }, "[auth] Falha no callback Google");
        const msg =
          err instanceof Error && err.message === "email_vinculado_outra_conta_google"
            ? "email_ja_registrado"
            : "oauth_falha";
        return reply.redirect(`${base}/login?erro=${msg}`);
      }
    },
  );

  /** Sobe o usuário (por googleSub ou email) garantindo papel/identidade. */
  async function upsertGoogleUser(info: {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  }) {
    const existing = await prisma.user.findUnique({ where: { email: info.email } });
    if (existing) {
      if (!existing.googleSub) {
        // Vincula a conta Google a um e-mail que já existia.
        return prisma.user.update({
          where: { id: existing.id },
          data: { googleSub: info.sub, avatar: info.picture ?? existing.avatar },
        });
      }
      if (existing.googleSub !== info.sub) {
        throw new Error("email_vinculado_outra_conta_google");
      }
      return existing;
    }
    return prisma.user.create({
      data: {
        email: info.email,
        name: info.name ?? info.email.split("@")[0],
        avatar: info.picture ?? null,
        googleSub: info.sub,
        role: "PENDENTE",
        isLocalAdmin: false,
      },
    });
  }
}
