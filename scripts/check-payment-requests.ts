import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { PaymentRequestStatus, Role, UserStatus } from "../generated/prisma/enums";
import { getDatabaseUrl } from "../src/lib/database-url";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
});
const suffix = `check-payment-request-${Date.now()}`;

async function main() {
  const responsible = await prisma.user.create({
    data: {
      name: `Responsável ${suffix}`,
      username: `${suffix}-responsavel`,
      email: `${suffix}-responsavel@local.test`,
      passwordHash: "teste",
      role: Role.GESTOR,
      status: UserStatus.ATIVO,
    },
  });
  const requester = await prisma.user.create({
    data: {
      name: `Solicitante ${suffix}`,
      username: `${suffix}-solicitante`,
      email: `${suffix}-solicitante@local.test`,
      passwordHash: "teste",
      role: Role.OPERADOR,
      status: UserStatus.ATIVO,
    },
  });
  const work = await prisma.work.create({
    data: {
      name: suffix,
      slug: suffix,
      responsibleUserId: responsible.id,
      users: { create: { userId: requester.id } },
    },
  });

  try {
    const request = await prisma.paymentRequest.create({
      data: {
        supplierName: "Fornecedor de teste",
        description: "Solicitação criada pela validação automatizada.",
        amount: 125.5,
        dueDate: new Date("2026-07-30T00:00:00.000Z"),
        workId: work.id,
        requestedById: requester.id,
        attachments: {
          create: {
            fileName: "nota.pdf",
            mimeType: "application/pdf",
            size: 4,
            data: Buffer.from("test"),
          },
        },
      },
      include: { attachments: true, work: true },
    });
    assert.equal(request.status, PaymentRequestStatus.PENDENTE);
    assert.equal(request.work.responsibleUserId, responsible.id);
    assert.equal(request.attachments.length, 1);

    const approved = await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: PaymentRequestStatus.PENDENTE },
      data: {
        status: PaymentRequestStatus.APROVADO,
        reviewedById: responsible.id,
        reviewedAt: new Date(),
      },
    });
    assert.equal(approved.count, 1, "a solicitação pendente deve ser aprovada uma única vez");

    const duplicateDecision = await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: PaymentRequestStatus.PENDENTE },
      data: { status: PaymentRequestStatus.REPROVADO },
    });
    assert.equal(duplicateDecision.count, 0, "uma decisão concorrente não pode sobrescrever a aprovação");
  } finally {
    await prisma.paymentRequest.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    await prisma.user.deleteMany({ where: { id: { in: [responsible.id, requester.id] } } });
  }
}

main()
  .then(() => console.log("Solicitações de pagamento validadas."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
