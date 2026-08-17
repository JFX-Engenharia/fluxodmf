import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";
import {
  applyPaymentAction,
  assertActorCanAct,
  assertPaymentAcceptsAction,
  PAYMENT_ACTIONS,
  resolveEffectiveReason,
} from "@/lib/payment-actions";
import { serializePayment } from "@/lib/serializers";

const actionSchema = z.object({
  action: z.enum(PAYMENT_ACTIONS),
  reason: z.string().trim().optional(),
  standardReasonId: z.string().trim().optional(),
  newDueDate: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

/**
 * Acao sobre UM pagamento. As invariantes moram em @/lib/payment-actions, que e
 * o mesmo nucleo que o processamento em lote executa — esta rota so carrega o
 * pagamento, resolve o motivo padronizado e devolve a compra ja atualizada no
 * formato que a tela espera.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    await requireMutationAllowed(user);
    return await withIdempotency({
      request,
      scope: `payment:${id}:${body.action}`,
      actorId: user.id,
      execute: async () => {
        assertActorCanAct(user, body.action);

        const payment = await prisma.payment.findUnique({
          where: { id },
          include: {
            work: true,
            tags: true,
            approvals: true,
            appliedApprovalRule: true,
            importBatch: { include: { dailyFlow: true } },
          },
        });
        if (!payment) throw new ApiError(404, "Pagamento não encontrado.");
        assertPaymentAcceptsAction(payment, body.action);

        const standardReason = body.standardReasonId
          ? await prisma.standardReason.findUnique({ where: { id: body.standardReasonId } })
          : null;
        const effectiveReason = resolveEffectiveReason(body, standardReason);

        const { outcome, updated } = await prisma.$transaction(async (tx) => {
          const outcome = await applyPaymentAction({
            tx,
            payment,
            actor: user,
            input: body,
            effectiveReason,
            // Uma acao so: as regras sao lidas dentro da transacao, ja sob o
            // lock, exatamente como antes desta extracao.
            approvalRules: null,
          });

          // O nucleo grava com select minimo; a tela precisa do pagamento
          // inteiro, entao ele e relido aqui, ainda dentro da transacao.
          const updated = await tx.payment.findUniqueOrThrow({
            where: { id: payment.id },
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

          return { outcome, updated };
        });

        await auditLog({
          actorId: user.id,
          event: "PAGAMENTO_ACAO",
          entity: "Payment",
          entityId: payment.id,
          metadata: outcome.auditMetadata,
        });

        return ok({
          payment: serializePayment(updated),
          approval: outcome.approval,
        });
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
