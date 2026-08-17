/**
 * Regressao da acao em lote. O que se testa aqui nao e o ganho de tempo — e que
 * a pressa nao custou uma invariante: a alcada por valor, o bloqueio de
 * auto-aprovacao e a contagem de aprovacoes parciais sao a parte do sistema
 * onde um erro aprova pagamento indevido.
 *
 * Uso: npm run check:payment-batch
 */

import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { ImportStatus, PaymentStatus, Role, UserStatus } from "../generated/prisma/enums";
import { getDatabaseUrl } from "../src/lib/database-url";
import { parseBatchResults, processPaymentBatch } from "../src/lib/payment-batch-worker";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
});
const suffix = `check-batch-${Date.now()}`;
const created = { userIds: [] as string[], workId: "", batchId: "", ruleIds: [] as string[] };

async function user(name: string, role: Role) {
  const row = await prisma.user.create({
    data: {
      name: `${name} ${suffix}`,
      username: `${suffix}-${name}`,
      email: `${suffix}-${name}@local.test`,
      passwordHash: "teste",
      role,
      status: UserStatus.ATIVO,
    },
    select: { id: true, role: true },
  });
  created.userIds.push(row.id);
  return row;
}

async function payment(supplierName: string, amount: number, createdById: string) {
  return prisma.payment.create({
    data: {
      supplierName,
      description: "compra de teste",
      amount,
      originalDueDate: new Date(),
      currentDueDate: new Date(),
      costCenter: "TESTE",
      uniqueKey: `${suffix}-${supplierName}`,
      workId: created.workId,
      importBatchId: created.batchId,
      createdById,
    },
    select: { id: true },
  });
}

async function runBatch(actorId: string, paymentIds: string[]) {
  const job = await prisma.paymentBatchAction.create({
    data: { actorId, action: "approve", paymentIds: JSON.stringify(paymentIds), totalCount: paymentIds.length },
    select: { id: true },
  });
  await processPaymentBatch(job.id);
  const done = await prisma.paymentBatchAction.findUniqueOrThrow({ where: { id: job.id } });
  return { job: done, results: parseBatchResults(done.results) };
}

async function main() {
  const importer = await user("importador", Role.ADMINISTRADOR);
  const aprovador = await user("aprovador", Role.APROVADOR);

  const work = await prisma.work.create({
    data: { name: `Obra ${suffix}`, slug: `obra-${suffix}` },
    select: { id: true },
  });
  created.workId = work.id;

  const batch = await prisma.importBatch.create({
    data: { fileName: `${suffix}.xlsx`, totalRows: 0, validRows: 0, invalidRows: 0, importedById: importer.id },
    select: { id: true },
  });
  created.batchId = batch.id;

  // ---- 1. lote comum: tudo aprovado, um resultado por item ----
  const comuns = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => payment(`comum-${n}`, 100 + n, importer.id)),
  );
  const primeiro = await runBatch(aprovador.id, comuns.map((p) => p.id));

  assert.equal(primeiro.job.status, ImportStatus.CONFIRMADO);
  assert.equal(primeiro.job.successCount, 5, `successCount=${primeiro.job.successCount}`);
  assert.equal(primeiro.job.failedCount, 0);
  assert.equal(primeiro.results.length, 5, "um resultado POR ITEM, nao um agregado");

  const aprovados = await prisma.payment.findMany({
    where: { id: { in: comuns.map((p) => p.id) } },
    select: { status: true },
  });
  assert.ok(aprovados.every((p) => p.status === PaymentStatus.APROVADO), "todos aprovados");

  // Historico por pagamento: e do que vivem o relatorio do fluxo e a auditoria.
  const acoes = await prisma.paymentAction.count({
    where: { paymentId: { in: comuns.map((p) => p.id) } },
  });
  assert.equal(acoes, 5, `PaymentAction por pagamento, nao por lote (${acoes})`);
  const auditorias = await prisma.auditLog.count({
    where: { entityId: { in: comuns.map((p) => p.id) } },
  });
  assert.equal(auditorias, 5, `AuditLog por pagamento (${auditorias})`);
  console.log("OK lote comum: 5 aprovados, historico e auditoria por pagamento.");

  // ---- 2. auto-aprovacao continua bloqueada ----
  const proprio = await payment("proprio", 500, aprovador.id);
  const segundo = await runBatch(aprovador.id, [proprio.id]);

  assert.equal(segundo.job.failedCount, 1, "quem criou nao pode aprovar");
  assert.equal(segundo.job.successCount, 0);
  assert.ok(segundo.results[0]?.error, "a recusa precisa dizer o motivo");
  const naoAprovado = await prisma.payment.findUniqueOrThrow({ where: { id: proprio.id } });
  assert.equal(naoAprovado.status, PaymentStatus.PENDENTE, "o status nao pode ter mudado");
  console.log("OK auto-aprovacao bloqueada, com motivo e sem alterar o pagamento.");

  // ---- 3. lote heterogeneo: a alcada depende do VALOR de cada pagamento ----
  const regra = await prisma.approvalRule.create({
    data: {
      name: `Alta alcada ${suffix}`,
      minAmount: 10_000,
      requiredRole: Role.ADMINISTRADOR,
      requiredApprovals: 1,
      priority: 100,
      active: true,
    },
    select: { id: true },
  });
  created.ruleIds.push(regra.id);

  // O aprovador atende a alcada padrao (APROVADOR) mas nao a da regra acima de
  // 10 mil, que exige ADMINISTRADOR. Um GESTOR nao serviria para o teste: ele
  // fica abaixo do padrao e reprovaria os dois, escondendo a distincao.
  const barato = await payment("barato", 50, importer.id);
  const caro = await payment("caro", 50_000, importer.id);
  const terceiro = await runBatch(aprovador.id, [barato.id, caro.id]);

  assert.equal(terceiro.job.successCount, 1, "o barato passa");
  assert.equal(terceiro.job.failedCount, 1, "o caro exige administrador");
  const recusado = terceiro.results.find((item) => !item.ok);
  assert.ok(recusado?.error, "a recusa por alcada precisa de motivo");
  const caroDepois = await prisma.payment.findUniqueOrThrow({ where: { id: caro.id } });
  assert.equal(caroDepois.status, PaymentStatus.PENDENTE, "acima da alcada nao pode ser aprovado");
  console.log("OK lote heterogeneo: aprova o que a alcada permite e recusa o resto.");

  // ---- 4. reprocessar o mesmo job nao duplica nada ----
  const idsRepetidos = comuns.slice(0, 2).map((p) => p.id);
  const job = await prisma.paymentBatchAction.create({
    data: {
      actorId: aprovador.id,
      action: "approve",
      paymentIds: JSON.stringify(idsRepetidos),
      totalCount: idsRepetidos.length,
    },
    select: { id: true },
  });
  await processPaymentBatch(job.id);
  await processPaymentBatch(job.id);
  const acoesDepois = await prisma.paymentAction.count({
    where: { paymentId: { in: idsRepetidos } },
  });
  assert.equal(acoesDepois, 2, `reprocessar nao pode criar historico duplicado (${acoesDepois})`);
  console.log("OK reprocessamento idempotente: sem historico duplicado.");

  console.log("check:payment-batch OK");
}

async function cleanup() {
  const where = { supplierName: { startsWith: "" }, importBatchId: created.batchId };
  if (created.batchId) {
    const ids = (await prisma.payment.findMany({ where, select: { id: true } })).map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.paymentBatchAction.deleteMany({ where: { actorId: { in: created.userIds } } });
    await prisma.importBatch.deleteMany({ where: { id: created.batchId } });
  }
  if (created.ruleIds.length) {
    await prisma.approvalRule.deleteMany({ where: { id: { in: created.ruleIds } } });
  }
  if (created.workId) await prisma.work.deleteMany({ where: { id: created.workId } });
  if (created.userIds.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: created.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
