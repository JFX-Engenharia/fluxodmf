import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import type { PrismaClient } from "../generated/prisma/client";
import { Role, UserStatus } from "../generated/prisma/enums";
import { PASSWORD_MAX_BYTES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/lib/password-policy";

export const TEST_USER_ID = "seed-test-admin";
export const TEST_USERNAME = "teste";

/** Conta opcional para o banco local; nunca faz parte do seed de produção. */
export async function seedTestUser(prisma: PrismaClient) {
  if (process.env.SEED_TEST_USER !== "true") return null;

  const databaseHost = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(databaseHost)) {
    throw new Error("SEED_TEST_USER só pode ser habilitado fora de produção e com PostgreSQL local.");
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ id: TEST_USER_ID }, { username: TEST_USERNAME }] },
  });
  if (existing && (existing.id !== TEST_USER_ID || existing.username !== TEST_USERNAME ||
      existing.role !== Role.ADMINISTRADOR || existing.status !== UserStatus.ATIVO)) {
    throw new Error("A conta teste já existe ou foi alterada. O seed não substitui contas nem reativa acessos.");
  }

  const password = existing ? null : (process.env.SEED_TEST_PASSWORD?.trim() || randomBytes(18).toString("base64url"));
  if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH ||
      Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES)) {
    throw new Error(`SEED_TEST_PASSWORD deve ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres e no máximo ${PASSWORD_MAX_BYTES} bytes.`);
  }
  const passwordHash = password ? await hash(password, 12) : null;

  const created = await prisma.$transaction(async tx => {
    // Compartilha a ordem de locks da configuração de alçada e das decisões.
    await tx.$queryRaw`SELECT id FROM "PaymentRequestSettings" WHERE id = 'singleton' FOR UPDATE`;
    const result = passwordHash ? await tx.user.createMany({
      data: [{ id: TEST_USER_ID, name: "Administrador de teste", username: TEST_USERNAME,
        email: "teste@djfluxo.local", role: Role.ADMINISTRADOR, status: UserStatus.ATIVO, passwordHash }],
      skipDuplicates: true,
    }) : { count: 0 };
    const user = await tx.user.findUniqueOrThrow({ where: { id: TEST_USER_ID } });
    if (user.username !== TEST_USERNAME || user.role !== Role.ADMINISTRADOR || user.status !== UserStatus.ATIVO) {
      throw new Error("A conta de teste foi alterada durante o seed.");
    }

    // Designação real: o Administrador continua sem poder ignorar a alçada.
    await tx.highValueApprover.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const pending = await tx.paymentRequest.findMany({
      where: { requiresOwnerApproval: true, status: { in: ["PENDENTE", "INFO_SOLICITADA"] } },
      select: { id: true },
    });
    if (pending.length) await tx.paymentRequestApproval.createMany({
      data: pending.map(request => ({ requestId: request.id, approverId: user.id })), skipDuplicates: true,
    });
    return result.count > 0;
  });

  return created ? { username: TEST_USERNAME, password: password! } : null;
}
