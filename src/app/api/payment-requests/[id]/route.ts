import { PaymentRequestStatus, Role } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  reason: z.string().trim().max(1_000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireTab("solicitacoes");
    await requireMutationAllowed(actor);
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: {
        work: { select: { name: true } },
        approvals: { select: { approverId: true, approvedAt: true } },
      },
    });
    if (!paymentRequest) throw new ApiError(404, "Solicitação não encontrada.");
    if (paymentRequest.status !== PaymentRequestStatus.PENDENTE) {
      throw new ApiError(409, "Esta solicitação já foi decidida.");
    }

    const isCoordinator = actor.role === Role.ADMINISTRADOR;
    const actorApproval = paymentRequest.approvals.find(({ approverId }) => approverId === actor.id);
    const total = paymentRequest.approvals.length;
    const initiallyDone = paymentRequest.approvals.filter(({ approvedAt }) => approvedAt !== null).length;

    if (body.action === "cancel") {
      if (paymentRequest.requestedById !== actor.id && !isCoordinator) {
        throw new ApiError(403, "Somente quem solicitou pode cancelar esta solicitação.");
      }
    } else if (body.action === "reject") {
      if (!isCoordinator && !actorApproval) {
        throw new ApiError(403, "Somente os responsáveis pela obra podem decidir esta solicitação.");
      }
      if (!body.reason) {
        throw new ApiError(400, "Informe o motivo da reprovação.");
      }
    }

    if (body.action !== "approve") {
      const status =
        body.action === "reject"
          ? PaymentRequestStatus.REPROVADO
          : PaymentRequestStatus.CANCELADO;
      const updated = await prisma.paymentRequest.updateMany({
        where: { id, status: PaymentRequestStatus.PENDENTE },
        data: {
          status,
          reviewedById: body.action === "cancel" ? null : actor.id,
          reviewedAt: body.action === "cancel" ? null : new Date(),
          reviewReason: body.reason || null,
        },
      });
      if (updated.count !== 1) {
        throw new ApiError(409, "Esta solicitação foi alterada por outra pessoa. Atualize a tela.");
      }

      await auditLog({
        actorId: actor.id,
        event:
          body.action === "reject"
            ? "SOLICITACAO_PAGAMENTO_REPROVADA"
            : "SOLICITACAO_PAGAMENTO_CANCELADA",
        entity: "PaymentRequest",
        entityId: id,
        metadata: { obra: paymentRequest.work.name, motivo: body.reason || null },
      });
      return ok({ status, approvals: { done: initiallyDone, total } });
    }

    if (isCoordinator && actorApproval?.approvedAt !== null) {
      const reviewedAt = new Date();
      const updated = await prisma.paymentRequest.updateMany({
        where: { id, status: PaymentRequestStatus.PENDENTE },
        data: {
          status: PaymentRequestStatus.APROVADO,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: body.reason || null,
        },
      });
      if (updated.count !== 1) {
        throw new ApiError(409, "Esta solicitação foi alterada por outra pessoa. Atualize a tela.");
      }
      await auditLog({
        actorId: actor.id,
        event: "SOLICITACAO_PAGAMENTO_APROVADA",
        entity: "PaymentRequest",
        entityId: id,
        metadata: { obra: paymentRequest.work.name, motivo: body.reason || null, override: true },
      });
      return ok({
        status: PaymentRequestStatus.APROVADO,
        approvals: { done: initiallyDone, total },
      });
    }

    const marked = await prisma.paymentRequestApproval.updateMany({
      where: { requestId: id, approverId: actor.id, approvedAt: null },
      data: { approvedAt: new Date() },
    });
    if (marked.count === 0) {
      if (actorApproval?.approvedAt) {
        throw new ApiError(409, "Você já aprovou esta solicitação.");
      }
      throw new ApiError(403, "Somente os responsáveis pela obra podem decidir esta solicitação.");
    }

    const remaining = await prisma.paymentRequestApproval.count({
      where: { requestId: id, approvedAt: null },
    });
    const done = total - remaining;
    if (remaining > 0) {
      await auditLog({
        actorId: actor.id,
        event: "SOLICITACAO_PAGAMENTO_APROVACAO_PARCIAL",
        entity: "PaymentRequest",
        entityId: id,
        metadata: { obra: paymentRequest.work.name, aprovadas: done, total },
      });
      return ok({
        status: PaymentRequestStatus.PENDENTE,
        approvals: { done, total },
      });
    }

    const reviewedAt = new Date();
    const updated = await prisma.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.PENDENTE },
      data: {
        status: PaymentRequestStatus.APROVADO,
        reviewedById: actor.id,
        reviewedAt,
        reviewReason: body.reason || null,
      },
    });
    if (updated.count === 0) {
      const current = await prisma.paymentRequest.findUnique({
        where: { id },
        select: { status: true },
      });
      if (current?.status === PaymentRequestStatus.APROVADO) {
        return ok({
          status: PaymentRequestStatus.APROVADO,
          approvals: { done, total },
        });
      }
      throw new ApiError(409, "Esta solicitação foi alterada por outra pessoa. Atualize a tela.");
    }

    await auditLog({
      actorId: actor.id,
      event: "SOLICITACAO_PAGAMENTO_APROVADA",
      entity: "PaymentRequest",
      entityId: id,
      metadata: { obra: paymentRequest.work.name, motivo: body.reason || null },
    });
    return ok({
      status: PaymentRequestStatus.APROVADO,
      approvals: { done, total },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
