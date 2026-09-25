import assert from "node:assert/strict";
import { Role, UserStatus } from "../generated/prisma/enums";
import { isolatedDatabase } from "./isolated-database";

async function main() {
  const cleanup = await isolatedDatabase();
  const { prisma } = await import("../src/lib/db");
  try {
    const { createPaymentRequest, applyRequestAction, saveRequestSettings, validateRequestAttachments, getRequestActions } = await import("../src/lib/payment-requests");
    const { ApiError } = await import("../src/lib/api");
    const denies = (code: number) => (error: unknown) => error instanceof ApiError && error.status === code;
    const users = await Promise.all([
      ["solicitante", Role.OPERADOR], ["obra1", Role.GESTOR], ["obra2", Role.GESTOR],
      ["dono", Role.APROVADOR], ["substituto", Role.OPERADOR], ["admin", Role.ADMINISTRADOR],
      ["colaborador", Role.COLABORADOR],
    ].map(([name, role]) => prisma.user.create({ data: {
      name, username: name, email: `${name}@local.test`, role: role as Role, status: UserStatus.ATIVO,
    } })));
    const [requester, work1, work2, owner, substitute, admin, collaborator] = users;
    const work = await prisma.work.create({ data: {
      name: "Obra de teste", slug: "requests-test",
      approvers: { create: [work1, work2].map(user => ({ userId: user.id })) },
      users: { create: { userId: requester.id } },
    } });
    const pdf = () => new File(["%PDF-1.7\nconteudo"], "nota.pdf", { type: "application/pdf" });
    const attachments = await validateRequestAttachments([pdf()]);
    const create = (amount: number) => createPaymentRequest(requester, {
      supplierName: "Fornecedor de teste", description: "Compra para a obra", amount,
      dueDate: "2026-10-10", category: "Material", workId: work.id,
    }, attachments);
    const load = (id: string) => prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: { approvals: { include: { approver: true } }, events: true, attachments: true } });

    await assert.rejects(validateRequestAttachments([]), denies(400));
    assert.deepEqual(await validateRequestAttachments([new File([], "", { type: "application/octet-stream" })], true), [], "campo de arquivo vazio permite resposta só com texto");
    await assert.rejects(validateRequestAttachments([new File([], "vazio.pdf", { type: "application/pdf" })], true), denies(400));
    await assert.rejects(validateRequestAttachments([new File(["html"], "nota.pdf", { type: "application/pdf" })]), denies(400));
    await assert.rejects(saveRequestSettings(admin, 5000, []), denies(400));
    await assert.rejects(saveRequestSettings(admin, 5000, [collaborator.id]), denies(400));
    await assert.rejects(saveRequestSettings(requester, 5000, [owner.id]), denies(403));
    await saveRequestSettings(admin, 5000, [owner.id, substitute.id]);

    const low = await create(3000);
    const exact = await create(5000);
    assert.equal(low.requiresOwnerApproval, false);
    assert.equal(exact.requiresOwnerApproval, false, "o limite é estritamente maior");
    assert.deepEqual((await load(low.id)).approvals.map(a => a.approverId).sort(), [work1.id, work2.id].sort());
    assert.equal((await applyRequestAction(work1, low.id, "approve")).status, "PENDENTE");
    await assert.rejects(applyRequestAction(work1, low.id, "approve"), denies(409));
    assert.equal((await applyRequestAction(work2, low.id, "approve")).status, "APROVADO");
    assert.equal((await applyRequestAction(admin, exact.id, "approve")).status, "APROVADO", "override da obra preservado");

    const high = await create(8000);
    assert.equal(high.requiresOwnerApproval, true);
    assert.deepEqual((await load(high.id)).approvals.map(a => a.approverId).sort(), [owner.id, substitute.id].sort());
    for (const action of ["approve", "reject", "request_info"] as const) {
      await assert.rejects(applyRequestAction(admin, high.id, action, "Nota"), denies(403));
      await assert.rejects(applyRequestAction(work1, high.id, action, "Nota"), denies(403));
    }
    assert.equal(getRequestActions(admin, await load(high.id)).approve, false);
    await assert.rejects(applyRequestAction(owner, high.id, "request_info", " "), denies(400));
    await applyRequestAction(owner, high.id, "request_info", "Envie a proposta final.");
    await assert.rejects(applyRequestAction(owner, high.id, "approve"), denies(409));
    await assert.rejects(applyRequestAction(substitute, high.id, "respond", "Resposta"), denies(403));
    await applyRequestAction(requester, high.id, "respond", "Proposta anexada.", attachments);
    await applyRequestAction(substitute, high.id, "request_info", "Confirme o prazo.");
    await applyRequestAction(requester, high.id, "respond", "Entrega em dez dias.");
    await applyRequestAction(owner, high.id, "approve", "Conforme negociação.");
    const done = await load(high.id);
    assert.equal(done.status, "APROVADO");
    assert.equal(done.reviewReason, "Conforme negociação.");
    assert.equal(done.approvals.filter(a => a.approvedAt).length, 1);
    assert.equal(done.attachments.length, 2);
    assert.deepEqual(done.events.map(e => e.type), ["CRIADA", "INFO_SOLICITADA", "INFO_RESPONDIDA", "INFO_SOLICITADA", "INFO_RESPONDIDA", "APROVADA"]);
    assert.equal(await prisma.auditLog.count({ where: { entityId: high.id } }), done.events.length);
    assert.equal(await prisma.payment.count(), 0, "aprovação não gera Payment");
    await assert.rejects(applyRequestAction(substitute, high.id, "reject", "Tarde demais"), denies(409));

    const waiting = await create(8000);
    const needsInfo = await create(8000);
    const waitingLow = await create(3000);
    await applyRequestAction(owner, needsInfo.id, "request_info", "Mais detalhes");
    await saveRequestSettings(admin, 9000, [substitute.id]);
    assert.equal((await load(waiting.id)).requiresOwnerApproval, true);
    assert.equal((await load(waitingLow.id)).requiresOwnerApproval, false);
    for (const id of [waiting.id, needsInfo.id]) {
      assert.deepEqual((await load(id)).approvals.map(a => a.approverId), [substitute.id]);
    }
    assert.equal((await load(high.id)).approvals.length, 2, "decisão encerrada preserva designados anteriores");
    assert.equal((await create(8000)).requiresOwnerApproval, false, "novo limite só vale para novos pedidos");
    await assert.rejects(applyRequestAction(owner, waiting.id, "approve"), denies(403));
    await assert.rejects(saveRequestSettings(admin, null, []), denies(409), "abertos não podem ficar órfãos");
    await applyRequestAction(admin, needsInfo.id, "cancel", "Solicitação cancelada.");

    const race = await Promise.allSettled([
      applyRequestAction(substitute, waiting.id, "approve"),
      applyRequestAction(substitute, waiting.id, "reject", "Decisão simultânea"),
    ]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    const loser = race.find(r => r.status === "rejected");
    assert.ok(loser?.status === "rejected" && denies(409)(loser.reason));
    assert.equal((await load(waiting.id)).events.length, 2, "sem evento da decisão perdedora");

    await saveRequestSettings(admin, 5000, [admin.id]);
    const adminOwner = await create(6000);
    await applyRequestAction(admin, adminOwner.id, "approve");
    await saveRequestSettings(admin, 5000, [owner.id]);
    const full = await create(8000);
    await applyRequestAction(owner, full.id, "request_info", "Documentos");
    await applyRequestAction(requester, full.id, "respond", "Nove documentos", Array(9).fill(attachments[0]));
    await applyRequestAction(owner, full.id, "request_info", "Outro detalhe");
    await assert.rejects(applyRequestAction(requester, full.id, "respond", "Mais um", attachments), denies(400));
    assert.equal((await load(full.id)).status, "INFO_SOLICITADA", "falha não altera status nem conversa");
    assert.equal((await load(full.id)).attachments.length, 10);
    await applyRequestAction(requester, full.id, "cancel");
    await prisma.user.update({ where: { id: owner.id }, data: { status: UserStatus.INATIVO } });
    await assert.rejects(create(8000), denies(409));
    await saveRequestSettings(admin, null, []);
    assert.equal((await create(8000)).requiresOwnerApproval, false);
    console.log("Solicitações: alçada, permissões, conversa, anexos, reconfiguração e concorrência validadas.");
  } finally {
    await prisma.$disconnect();
    await cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
