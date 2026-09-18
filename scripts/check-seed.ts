import assert from "node:assert/strict";
import { compare } from "bcryptjs";
import { isolatedDatabase } from "./isolated-database";
import { seedTestUser, TEST_USER_ID, TEST_USERNAME } from "../prisma/seed-test-user";

async function main() {
  const cleanup = await isolatedDatabase();
  const { prisma } = await import("../src/lib/db");
  const env: Record<string, string | undefined> = process.env;
  const localUrl = env.DATABASE_URL;
  try {
    delete env.SEED_TEST_USER;
    assert.equal(await seedTestUser(prisma), null);
    assert.equal(await prisma.user.count(), 0, "seed comum não cria conta de teste");

    env.SEED_TEST_USER = "true";
    env.NODE_ENV = "production";
    await assert.rejects(seedTestUser(prisma), /fora de produção/);
    env.NODE_ENV = "test";
    const remoteUrl = new URL(localUrl!);
    remoteUrl.hostname = "banco.example.com";
    env.DATABASE_URL = remoteUrl.toString();
    await assert.rejects(seedTestUser(prisma), /PostgreSQL local/);
    env.DATABASE_URL = localUrl;
    env.SEED_TEST_PASSWORD = "curta";
    await assert.rejects(seedTestUser(prisma), /SEED_TEST_PASSWORD/);
    assert.equal(await prisma.user.count(), 0, "falhas não criam usuário parcialmente");

    env.SEED_TEST_PASSWORD = "SenhaTeste!SomenteLocal2026";
    const credentials = await seedTestUser(prisma);
    assert.equal(credentials?.username, TEST_USERNAME);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: TEST_USER_ID } });
    assert.equal(user.role, "ADMINISTRADOR");
    assert.equal(user.status, "ATIVO");
    assert.ok(await compare(credentials!.password, user.passwordHash!));
    assert.equal(await prisma.highValueApprover.count({ where: { userId: user.id } }), 1);
    assert.equal((await prisma.paymentRequestSettings.findUniqueOrThrow({ where: { id: "singleton" } })).highValueThreshold, null,
      "conta de teste não altera o limite da alçada");

    const work = await prisma.work.create({ data: { name: "Obra do teste de seed", slug: "obra-seed-teste" } });
    const request = await prisma.paymentRequest.create({ data: {
      supplierName: "Fornecedor de teste", description: "Solicitação anterior ao seed", amount: 8000,
      dueDate: new Date(), workId: work.id, requestedById: user.id, requiresOwnerApproval: true,
    } });
    env.SEED_TEST_PASSWORD = "OutraSenha!QueNaoDeveTrocar";
    assert.equal(await seedTestUser(prisma), null);
    assert.equal(await seedTestUser(prisma), null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, user.passwordHash);
    assert.equal(await prisma.paymentRequestApproval.count({ where: { requestId: request.id, approverId: user.id } }), 1,
      "pedidos de alto valor abertos também aceitam o designado de teste, sem duplicação");

    await prisma.user.update({ where: { id: user.id }, data: { status: "INATIVO" } });
    await assert.rejects(seedTestUser(prisma), /não substitui contas nem reativa acessos/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, "INATIVO");
    console.log("Seed: ativação explícita, bloqueio em produção/remoto, senha, alçada e idempotência validados.");
  } finally {
    env.DATABASE_URL = localUrl;
    await prisma.$disconnect();
    await cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
