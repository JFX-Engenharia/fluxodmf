import { AllocationSource, PaymentStatus, Role } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { allocationRows } from "@/lib/finance-management";
import { prisma } from "@/lib/db";
import { serializePayment } from "@/lib/serializers";

const schema = z.object({
  tagIds: z.array(z.string()).optional(),
  allocations: z.array(
    z.object({ workId: z.string().min(1), percentage: z.number().positive().max(100) }),
  ).optional(),
  hasReceipt: z.boolean().optional(),
  receiptReceivedAt: z.string().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireTab("pagamentos");
    await requireMutationAllowed(actor);
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Pagamento não encontrado.");

    const structuralChange = body.tagIds !== undefined || body.allocations !== undefined;
    if (structuralChange && payment.status === PaymentStatus.APROVADO) {
      throw new ApiError(409, "Reabra o pagamento antes de alterar tags ou rateio.");
    }

    const allocations = body.allocations
      ? body.allocations.length
        ? allocationRows(payment.amount, body.allocations)
        : []
      : null;

    const updated = await prisma.$transaction(async (tx) => {
      if (body.tagIds) {
        await tx.paymentTag.deleteMany({ where: { paymentId: id } });
        if (body.tagIds.length) {
          await tx.paymentTag.createMany({
            data: [...new Set(body.tagIds)].map((tagId) => ({ paymentId: id, tagId })),
          });
        }
      }
      if (allocations) {
        await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
        await tx.paymentAllocation.createMany({
          data: allocations.map((row) => ({
            paymentId: id,
            ...row,
            source: AllocationSource.MANUAL,
          })),
        });
      }
      if (structuralChange && payment.status !== PaymentStatus.APROVADO) {
        await tx.paymentApproval.deleteMany({ where: { paymentId: id } });
      }

      return tx.payment.update({
        where: { id },
        data: {
          hasReceipt: body.hasReceipt,
          receiptReceivedAt:
            body.receiptReceivedAt === undefined
              ? undefined
              : body.receiptReceivedAt
                ? new Date(body.receiptReceivedAt)
                : null,
          ...(structuralChange && payment.status !== PaymentStatus.APROVADO
            ? {
                appliedApprovalRuleId: null,
                requiredApprovals: 1,
                requiredApprovalRole: Role.APROVADOR,
              }
            : {}),
        },
        include: {
          work: true,
          importBatch: true,
          tags: { include: { tag: true } },
          allocations: { include: { work: true } },
          approvals: {
            orderBy: { createdAt: "asc" },
            include: { actor: { select: { id: true, name: true, role: true } } },
          },
          appliedApprovalRule: true,
          actions: {
            orderBy: { createdAt: "desc" },
            include: { actor: { select: { id: true, name: true, role: true } } },
          },
        },
      });
    });

    await auditLog({
      actorId: actor.id,
      event: "PAGAMENTO_METADADOS",
      entity: "Payment",
      entityId: id,
      metadata: {
        tags: body.tagIds?.length,
        rateios: body.allocations?.length,
        comprovante: body.hasReceipt,
      },
    });
    return ok({ payment: serializePayment(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
