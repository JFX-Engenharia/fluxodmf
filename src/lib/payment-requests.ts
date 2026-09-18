import { Prisma } from "@prisma-generated/client";
import { PaymentRequestEventType, PaymentRequestStatus, Role, UserStatus } from "@prisma-generated/enums";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { assertFileSignature } from "@/lib/file-signature";
import { MEGABYTE } from "@/lib/body-size";

type Actor = { id: string; role: Role };
export type RequestAction = "approve" | "reject" | "request_info" | "respond" | "cancel";
export const MAX_REQUEST_ATTACHMENTS = 10;
export const CREATE_REQUEST_BODY_SIZE = 30 * MEGABYTE;
export const RESPOND_REQUEST_BODY_SIZE = 55 * MEGABYTE;
const openStatuses = [PaymentRequestStatus.PENDENTE, PaymentRequestStatus.INFO_SOLICITADA];
const eligibleUser = { status: UserStatus.ATIVO, role: { not: Role.COLABORADOR } };

export const paymentRequestSchema = z.object({
  supplierName: z.string().trim().min(2, "Informe o fornecedor.").max(160),
  description: z.string().trim().min(5, "Descreva o pagamento.").max(2000),
  amount: z.coerce.number().positive("Informe um valor maior que zero.").max(10_000_000).multipleOf(0.01, "Use no máximo duas casas decimais."),
  dueDate: z.string().date("Informe a data de vencimento."),
  category: z.string().trim().max(120).optional().default(""),
  workId: z.string().min(1, "Selecione a obra."),
});
export const requestSettingsSchema = z.object({
  threshold: z.number().min(0).max(999_999_999_999.99).multipleOf(0.01).nullable(),
  approverIds: z.array(z.string().min(1)).max(100),
});
export const requestNoteSchema = z.string().trim().max(2000);

export async function validateRequestAttachments(files: File[], responding = false) {
  const max = responding ? MAX_REQUEST_ATTACHMENTS : 5;
  if (!responding && !files.length) throw new ApiError(400, "Anexe ao menos um documento (PDF, JPG ou PNG).");
  if (files.length > max) throw new ApiError(400, `Anexe no máximo ${max} documentos.`);
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  if (files.some(file => !allowed.has(file.type) || !file.size || file.size > 5 * MEGABYTE)) {
    throw new ApiError(400, "Cada anexo deve ser PDF, JPG ou PNG de até 5 MB.");
  }
  return Promise.all(files.map(async file => {
    const data = Buffer.from(await file.arrayBuffer());
    return { fileName: file.name.slice(0, 255), mimeType: assertFileSignature(data, file.type, file.name), size: data.length, data };
  }));
}
type AttachmentData = Awaited<ReturnType<typeof validateRequestAttachments>>;

// Ordem de locks em todos os caminhos: configuração, depois solicitação.
// SHARE permite decisões em pedidos diferentes, mas serializa com a troca de designados.
async function lockSettings(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM "PaymentRequestSettings" WHERE id = 'singleton' FOR SHARE`;
}

export async function getRequestSettings(client: Prisma.TransactionClient = prisma) {
  const [settings, designated] = await Promise.all([
    client.paymentRequestSettings.findUniqueOrThrow({ where: { id: "singleton" } }),
    client.highValueApprover.findMany({ include: { user: { select: { id: true, name: true, role: true, status: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { threshold: settings.highValueThreshold === null ? null : Number(settings.highValueThreshold),
    approvers: designated.map(a => a.user), updatedAt: settings.updatedAt.toISOString() };
}

export async function resolveApprovers(tx: Prisma.TransactionClient, work: { id: string }, amount: number) {
  await lockSettings(tx);
  const settings = await tx.paymentRequestSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const threshold = settings.highValueThreshold;
  const requiresOwnerApproval = threshold !== null && new Prisma.Decimal(amount).greaterThan(threshold);
  const approvers = requiresOwnerApproval
    ? (await tx.highValueApprover.findMany({ where: { user: eligibleUser }, select: { userId: true } })).map(a => a.userId)
    : (await tx.workApprover.findMany({ where: { workId: work.id, user: eligibleUser }, select: { userId: true } })).map(a => a.userId);
  if (!approvers.length) throw new ApiError(409, requiresOwnerApproval
    ? "Não há designados ativos para aprovar solicitações de alto valor. Peça ao Administrador para configurar a alçada."
    : "Esta obra ainda não possui responsáveis ativos para aprovar a solicitação.");
  return { approvers, requiresOwnerApproval, threshold: threshold === null ? null : Number(threshold) };
}

export const requestInclude = {
  work: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  approvals: { include: { approver: { select: { id: true, name: true, role: true, status: true } } } },
  attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
  events: { include: { actor: { select: { id: true, name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.PaymentRequestInclude;

type ActionRequest = {
  requestedById: string; status: PaymentRequestStatus; requiresOwnerApproval: boolean;
  approvals: Array<{ approverId: string; approvedAt: Date | null; approver: { status: UserStatus; role: Role } }>;
};

export function getRequestActions(actor: Actor, request: ActionRequest) {
  const approval = request.approvals.find(a => a.approverId === actor.id && a.approver.status === UserStatus.ATIVO && a.approver.role !== Role.COLABORADOR);
  const adminOverride = actor.role === Role.ADMINISTRADOR && !request.requiresOwnerApproval;
  const canDecide = !!approval || adminOverride;
  const pending = request.status === PaymentRequestStatus.PENDENTE;
  return {
    approve: pending && (adminOverride || (!!approval && !approval.approvedAt)),
    reject: pending && canDecide,
    request_info: pending && canDecide,
    respond: request.status === PaymentRequestStatus.INFO_SOLICITADA && request.requestedById === actor.id,
    cancel: openStatuses.includes(request.status as typeof openStatuses[number]) && (actor.role === Role.ADMINISTRADOR || request.requestedById === actor.id),
  };
}

export function serializeRequest(request: Prisma.PaymentRequestGetPayload<{ include: typeof requestInclude }>, actor: Actor) {
  return { ...request, amount: Number(request.amount), actions: getRequestActions(actor, request),
    attachments: request.attachments.map(file => ({ ...file, url: `/api/payment-requests/${request.id}/attachments/${file.id}` })) };
}

export async function createPaymentRequest(actor: Actor, input: z.input<typeof paymentRequestSchema>, attachments: AttachmentData) {
  const body = paymentRequestSchema.parse(input);
  if (!attachments.length || attachments.length > 5) throw new ApiError(400, "Anexe de 1 a 5 documentos.");
  return prisma.$transaction(async tx => {
    const work = await tx.work.findUnique({ where: { id: body.workId } });
    if (!work?.active) throw new ApiError(404, "Obra não encontrada ou inativa.");
    if (actor.role !== Role.ADMINISTRADOR && !await tx.userWork.findUnique({ where: { userId_workId: { userId: actor.id, workId: work.id } } })) {
      throw new ApiError(403, "Você só pode solicitar pagamentos para obras vinculadas a você.");
    }
    const resolved = await resolveApprovers(tx, work, body.amount);
    const saved = await tx.paymentRequest.create({ data: {
      ...body, dueDate: new Date(`${body.dueDate}T00:00:00.000Z`), requestedById: actor.id,
      requiresOwnerApproval: resolved.requiresOwnerApproval,
      attachments: { create: attachments }, approvals: { create: resolved.approvers.map(approverId => ({ approverId })) },
      events: { create: { actorId: actor.id, type: "CRIADA" } },
    }, include: requestInclude });
    await auditLog({ actorId: actor.id, event: "SOLICITACAO_PAGAMENTO_CRIADA", entity: "PaymentRequest", entityId: saved.id,
      metadata: { obra: work.name, fornecedor: body.supplierName, valor: body.amount, anexos: attachments.length,
        altoValor: resolved.requiresOwnerApproval, limite: resolved.threshold } }, tx);
    return saved;
  });
}

export async function saveRequestSettings(actor: Actor, threshold: number | null, approverIds: string[]) {
  if (actor.role !== Role.ADMINISTRADOR) throw new ApiError(403, "Apenas Administradores podem configurar a alçada.");
  const body = requestSettingsSchema.parse({ threshold, approverIds });
  const ids = [...new Set(body.approverIds)];
  if (threshold !== null && !ids.length) throw new ApiError(400, "Selecione ao menos um designado ativo para ativar a alçada.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PaymentRequestSettings" WHERE id = 'singleton' FOR UPDATE`;
    if (await tx.user.count({ where: { id: { in: ids }, ...eligibleUser } }) !== ids.length) {
      throw new ApiError(400, "Selecione apenas usuários ativos que não sejam Colaboradores.");
    }
    const open = await tx.paymentRequest.findMany({ where: { requiresOwnerApproval: true, status: { in: openStatuses } }, select: { id: true } });
    if (open.length && !ids.length) throw new ApiError(409, "Há solicitações de alto valor abertas. Mantenha ao menos um designado ativo.");
    const previous = await getRequestSettings(tx);
    await tx.paymentRequestSettings.update({ where: { id: "singleton" }, data: { highValueThreshold: threshold, updatedById: actor.id } });
    await tx.highValueApprover.deleteMany();
    await tx.highValueApprover.createMany({ data: ids.map(userId => ({ userId })) });
    const requestIds = open.map(r => r.id);
    await tx.paymentRequestApproval.deleteMany({ where: { requestId: { in: requestIds } } });
    await tx.paymentRequestApproval.createMany({ data: requestIds.flatMap(requestId => ids.map(approverId => ({ requestId, approverId }))) });
    await auditLog({ actorId: actor.id, event: "ALCADA_ALTO_VALOR_SALVA", entity: "PaymentRequestSettings", entityId: "singleton",
      metadata: { limiteAnterior: previous.threshold, limite: threshold, designadosAnteriores: previous.approvers.map(a => a.id), designados: ids, solicitaçõesAtualizadas: open.length } }, tx);
    return getRequestSettings(tx);
  });
}

export async function applyRequestAction(actor: Actor, id: string, action: RequestAction, note = "", attachments: AttachmentData = []) {
  const reason = requestNoteSchema.parse(note);
  return prisma.$transaction(async tx => {
    await lockSettings(tx);
    await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${id} FOR UPDATE`;
    const request = await tx.paymentRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new ApiError(404, "Solicitação não encontrada.");
    const expected = action === "respond" ? PaymentRequestStatus.INFO_SOLICITADA : PaymentRequestStatus.PENDENTE;
    if (action === "cancel" ? !openStatuses.includes(request.status as typeof openStatuses[number]) : request.status !== expected) {
      throw new ApiError(409, "A solicitação já foi alterada. Atualize a lista para continuar.");
    }
    const approval = request.approvals.find(a => a.approverId === actor.id);
    if (!getRequestActions(actor, request)[action]) {
      if (action === "approve" && approval?.approvedAt) throw new ApiError(409, "Você já aprovou esta solicitação.");
      throw new ApiError(403, "Você não tem permissão para esta decisão.");
    }
    if (["reject", "request_info", "respond"].includes(action) && !reason) throw new ApiError(400, "Informe o motivo ou a informação solicitada.");
    if (attachments.length && action !== "respond") throw new ApiError(400, "Envie anexos pela resposta à solicitação.");
    if (request.attachments.length + attachments.length > MAX_REQUEST_ATTACHMENTS) throw new ApiError(400, "A solicitação pode ter no máximo 10 anexos.");

    let status: PaymentRequestStatus = request.status;
    let type: PaymentRequestEventType;
    let event: string;
    let approvedCount = request.approvals.filter(a => a.approvedAt).length;
    if (action === "approve") {
      const override = actor.role === Role.ADMINISTRADOR && !request.requiresOwnerApproval && approval?.approvedAt !== null;
      if (!override) {
        const updated = await tx.paymentRequestApproval.updateMany({ where: { requestId: id, approverId: actor.id, approvedAt: null }, data: { approvedAt: new Date() } });
        if (updated.count !== 1) throw new ApiError(409, "Você já aprovou esta solicitação.");
        approvedCount++;
      }
      if (request.requiresOwnerApproval || override || approvedCount === request.approvals.length) status = PaymentRequestStatus.APROVADO;
      type = "APROVADA";
      event = status === PaymentRequestStatus.APROVADO ? "SOLICITACAO_PAGAMENTO_APROVADA" : "SOLICITACAO_PAGAMENTO_APROVACAO_PARCIAL";
    } else if (action === "reject") {
      status = PaymentRequestStatus.REPROVADO; type = "REPROVADA"; event = "SOLICITACAO_PAGAMENTO_REPROVADA";
    } else if (action === "request_info") {
      status = PaymentRequestStatus.INFO_SOLICITADA; type = "INFO_SOLICITADA"; event = "SOLICITACAO_PAGAMENTO_INFO_SOLICITADA";
    } else if (action === "respond") {
      status = PaymentRequestStatus.PENDENTE; type = "INFO_RESPONDIDA"; event = "SOLICITACAO_PAGAMENTO_INFO_RESPONDIDA";
    } else {
      status = PaymentRequestStatus.CANCELADO; type = "CANCELADA"; event = "SOLICITACAO_PAGAMENTO_CANCELADA";
    }
    const terminalDecision = status === PaymentRequestStatus.APROVADO || status === PaymentRequestStatus.REPROVADO;
    const updated = await tx.paymentRequest.updateMany({ where: { id, status: request.status }, data: {
      status, ...(terminalDecision ? { reviewedById: actor.id, reviewedAt: new Date(), reviewReason: reason || null } : {}),
    } });
    if (updated.count !== 1) throw new ApiError(409, "A solicitação já foi alterada. Atualize a lista.");
    if (attachments.length) await tx.paymentRequestAttachment.createMany({ data: attachments.map(file => ({ ...file, requestId: id })) });
    await tx.paymentRequestEvent.create({ data: { requestId: id, actorId: actor.id, type, note: reason || null } });
    await auditLog({ actorId: actor.id, event, entity: "PaymentRequest", entityId: id,
      metadata: { obra: request.work.name, altoValor: request.requiresOwnerApproval, motivo: reason || null, aprovacoes: approvedCount, total: request.approvals.length, anexos: attachments.length } }, tx);
    return { status, approvalsDone: approvedCount, approvalsTotal: request.approvals.length };
  });
}
