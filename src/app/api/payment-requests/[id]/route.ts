import { PaymentRequestStatus, Role } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
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
    const actor = await requireUser();
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { work: { select: { name: true, responsibleUserId: true } } },
    });
    if (!paymentRequest) throw new ApiError(404, "Solicitação não encontrada.");
    if (paymentRequest.status !== PaymentRequestStatus.PENDENTE) {
      throw new ApiError(409, "Esta solicitação já foi decidida.");
    }

    const isCoordinator = actor.role === Role.ADMINISTRADOR;
    const isResponsible = paymentRequest.work.responsibleUserId === actor.id;
    if (body.action === "cancel") {
      if (paymentRequest.requestedById !== actor.id && !isCoordinator) {
        throw new ApiError(403, "Somente quem solicitou pode cancelar esta solicitação.");
      }
    } else {
      if (!isCoordinator && !isResponsible) {
        throw new ApiError(403, "Somente o responsável pela obra pode decidir esta solicitação.");
      }
      if (body.action === "reject" && !body.reason) {
        throw new ApiError(400, "Informe o motivo da reprovação.");
      }
    }

    const status =
      body.action === "approve"
        ? PaymentRequestStatus.APROVADO
        : body.action === "reject"
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
        body.action === "approve"
          ? "SOLICITACAO_PAGAMENTO_APROVADA"
          : body.action === "reject"
            ? "SOLICITACAO_PAGAMENTO_REPROVADA"
            : "SOLICITACAO_PAGAMENTO_CANCELADA",
      entity: "PaymentRequest",
      entityId: id,
      metadata: { obra: paymentRequest.work.name, motivo: body.reason || null },
    });
    return ok({ status });
  } catch (error) {
    return handleApiError(error);
  }
}
