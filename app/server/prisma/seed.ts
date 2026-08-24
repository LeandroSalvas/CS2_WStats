/**
 * Seed CLI: garante o admin local fixo.
 * Uso: npx tsx prisma/seed.ts  (requer ADMIN_EMAIL/ADMIN_PASSWORD no ambiente)
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/services/authService.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@wstats.local").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function main(): Promise<void> {
  if (!ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD ausente no ambiente.");
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {
        passwordHash: hashPassword(ADMIN_PASSWORD),
        role: "SUPER_ADMIN",
        isLocalAdmin: true,
      },
      create: {
        email: ADMIN_EMAIL,
        name: "Admin",
        passwordHash: hashPassword(ADMIN_PASSWORD),
        role: "SUPER_ADMIN",
        isLocalAdmin: true,
      },
    });
    console.log(`[seed] Admin local garantido: ${ADMIN_EMAIL}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
