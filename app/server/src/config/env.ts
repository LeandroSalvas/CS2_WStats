import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .default("postgresql://wstats:wstats@localhost:5432/wstats?schema=public"),
  GSI_DELAY_SECONDS: z.coerce.number().min(0).max(600).default(30),
  WEBHOOK_SECRET: z.string().optional(),
  MAX_BUFFER_ITEMS: z.coerce.number().int().min(10).default(900),
  SERVER_NAME: z.string().default("CS2 Server"),
  HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(5).default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // ---- Autenticação / RBAC -------------------------------------------------
  /** Segredo HMAC dos cookies-sessão. Se vazio, um segredo efêmero é gerado
   *  (sessões caem a cada restart). */
  AUTH_JWT_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().default("admin@wstats.local"),
  ADMIN_PASSWORD: z.string().optional(),

  // ---- Google OAuth (implementado, porém desligável via flag) --------------
  AUTH_GOOGLE_ENABLED: z.coerce.boolean().default(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** URL pública do app voltada ao navegador (ex.: https://domino/cs2). */
  APP_PUBLIC_URL: z.string().optional(),

  // ---- RCON -----------------------------------------------------------------
  RCON_HOST: z.string().default("cs2wstats"),
  RCON_PORT: z.coerce.number().int().min(1).max(65535).default(27015),
  RCON_PASSWORD: z.string().optional(),
  /** Comandos proibidos para quem não é SUPER_ADMIN (CSV). */
  RCON_BLOCKED_COMMANDS: z.string().default("quit,_restart,exit,sv_password"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Variáveis de ambiente inválidas:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? "";

/** Caminho base público ("" ou "/cs2"), derivado de PUBLIC_BASE_PATH. */
export function publicBasePath(): string {
  const raw = process.env.PUBLIC_BASE_PATH ?? "";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed;
}

/** URL pública do app voltada ao navegador, sem barra final. */
export function appPublicUrl(): string {
  if (env.APP_PUBLIC_URL && env.APP_PUBLIC_URL.trim() !== "") {
    return env.APP_PUBLIC_URL.replace(/\/+$/, "");
  }
  return `http://localhost:${env.PORT}${publicBasePath()}`;
}
