import { z } from "zod";
import { ActionType, DailyFlowStatus, PaymentStatus, Role } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";
import {
  chooseApprovalRule,
  reasonActionByPaymentAction,
  roleAtLeast,
} from "@/lib/finance-management";
import { canAdminister, canEditPayments } from "@/lib/permissions";
import { serializePayment } from "@/lib/serializers";

const actionSchema = z.object({
  action: z.enum([
    "approve",
    "reject",
    "transfer",
    "request_info",
    "answer_info",
    "cancel",
    "reopen",
    "analyze",
  ]),
  reason: z.string().trim().optional(),
  standardReasonId: z.string().trim().optional(),
  newDueDate: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

const CRITICAL_ACTIONS = ["cancel", "reopen"];

function requireReason(reason: string | undefined, message: string) {
  if (!reason || reason.length < 3) throw new ApiError(400, message);
}

function dateFromIsoDay(day: string | undefined) {
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    await requireMutationAllowed(user);
    return withIdempotency({
      request,
      scope: `payment:${id}:${body.action}`,
      actorId: user.id,
      execute: async () => {

    if (!canEditPayments(user.role)) {
      throw new ApiError(403, "Seu perfil não tem permissão para agir sobre pagamentos.");
    }
    if (CRITICAL_ACTIONS.includes(body.action) && !canAdminister(user.role)) {
      throw new ApiError(403, "Somente o administrador pode cancelar ou reabrir pagamentos.");
    }

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
    if (payment.importBatch.dailyFlow?.status === DailyFlowStatus.FECHADO) {
      throw new ApiError(409, "Este fluxo está fechado. Reabra-o antes de fazer alterações.");
    }
    if (payment.status === PaymentStatus.APROVADO && body.action !== "reopen") {
      throw new ApiError(409, "Pagamento aprovado fica bloqueado para novas ações diretas.");
    }
    if (payment.status === PaymentStatus.CANCELADO && body.action !== "reopen") {
      throw new ApiError(409, "Pagamento cancelado precisa voltar para em aberto.");
    }

    let effectiveReason = body.reason;
    if (body.standardReasonId) {
      const standardReason = await prisma.standardReason.findUnique({
        where: { id: body.standardReasonId },
      });
      const expectedAction = reasonActionByPaymentAction[body.action];
      if (!standardReason || !standardReason.active || standardReason.action !== expectedAction) {
        throw new ApiError(400, "O motivo padronizado não é válido para esta ação.");
      }
      effectiveReason = body.reason?.trim()
        ? `${standardReason.label}: ${body.reason.trim()}`
        : standardReason.label;
    }

    let newStatus: PaymentStatus = payment.status;
    let actionType: ActionType = ActionType.APROVAR;
    let newDueDate: Date | null = null;
    let approvalRuleId: string | null = payment.appliedApprovalRuleId;
    let requiredApprovals = payment.requiredApprovals;
    let requiredApprovalRole = payment.requiredApprovalRole;
    let approvalCount = payment.approvals.length;
    let previousStatus = payment.status;

    if (body.action === "approve") {
      actionType = ActionType.APROVAR;
    } else if (body.action === "reject") {
      requireReason(effectiveReason, "Informe o motivo da reprovação.");
      newStatus = PaymentStatus.REPROVADO;
      actionType = ActionType.REPROVAR;
    } else if (body.action === "transfer") {
      requireReason(effectiveReason, "Informe o motivo da transferência.");
      newDueDate = dateFromIsoDay(body.newDueDate);
      if (!newDueDate) throw new ApiError(400, "Informe uma nova data válida.");
      newStatus = PaymentStatus.TRANSFERIDO;
      actionType = ActionType.TRANSFERIR;
    } else if (body.action === "request_info") {
      requireReason(effectiveReason, "Informe o que precisa ser complementado.");
      newStatus = PaymentStatus.INFO_SOLICITADA;
      actionType = ActionType.SOLICITAR_INFO;
    } else if (body.action === "answer_info") {
      requireReason(effectiveReason ?? body.note, "Informe a resposta.");
      newStatus = PaymentStatus.CORRIGIDO;
      actionType = ActionType.RESPONDER_INFO;
    } else if (body.action === "cancel") {
      requireReason(effectiveReason, "Informe o motivo do cancelamento.");
      newStatus = PaymentStatus.CANCELADO;
      actionType = ActionType.CANCELAR;
    } else if (body.action === "analyze") {
      newStatus =
        payment.status === PaymentStatus.EM_ANALISE
          ? PaymentStatus.PENDENTE
          : PaymentStatus.EM_ANALISE;
      actionType = ActionType.ANALISAR;
    } else if (body.action === "reopen") {
      requireReason(effectiveReason, "Informe o motivo para voltar a em aberto.");
      newStatus = PaymentStatus.PENDENTE;
      actionType = ActionType.REABRIR;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.action === "approve") {
        // Serializa aprovações do mesmo pagamento. Sem o lock, dois aprovadores
        // simultâneos poderiam contar apenas a própria linha e deixar uma dupla
        // aprovação indevidamente pendente mesmo após os dois registros.
        await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
        const lockedPayment = await tx.payment.findUnique({
          where: { id: payment.id },
          include: { tags: true, approvals: true, appliedApprovalRule: true },
        });
        if (!lockedPayment) throw new ApiError(404, "Pagamento não encontrado.");
        if (lockedPayment.status === PaymentStatus.APROVADO) {
          throw new ApiError(409, "Pagamento aprovado fica bloqueado para novas ações diretas.");
        }
        if (lockedPayment.status === PaymentStatus.CANCELADO) {
          throw new ApiError(409, "Pagamento cancelado precisa voltar para em aberto.");
        }

        const activeRules = lockedPayment.appliedApprovalRule
          ? []
          : await tx.approvalRule.findMany({
              where: { active: true },
              orderBy: { priority: "desc" },
            });
        const rule =
          lockedPayment.appliedApprovalRule ?? chooseApprovalRule(lockedPayment, activeRules);
        approvalRuleId = rule?.id ?? null;
        requiredApprovals = rule?.requiredApprovals ?? 1;
        requiredApprovalRole = rule?.requiredRole ?? Role.APROVADOR;
        const preventSelfApproval = rule?.preventSelfApproval ?? true;

        if (preventSelfApproval && lockedPayment.createdById === user.id) {
          throw new ApiError(403, "Quem criou ou importou o pagamento não pode aprová-lo.");
        }
        if (!roleAtLeast(user.role, requiredApprovalRole)) {
          throw new ApiError(
            403,
            requiredApprovalRole === Role.ADMINISTRADOR
              ? "Este pagamento exige aprovação de administrador."
              : "Seu perfil não atende à alçada deste pagamento.",
          );
        }
        if (lockedPayment.approvals.some((approval) => approval.actorId === user.id)) {
          throw new ApiError(409, "Você já registrou sua aprovação neste pagamento.");
        }

        await tx.paymentApproval.create({
          data: { paymentId: payment.id, actorId: user.id, approvalRuleId },
        });
        approvalCount = await tx.paymentApproval.count({ where: { paymentId: payment.id } });
        newStatus =
          approvalCount >= requiredApprovals
            ? PaymentStatus.APROVADO
            : PaymentStatus.PENDENTE;
        previousStatus = lockedPayment.status;
      } else {
        await tx.paymentApproval.deleteMany({ where: { paymentId: payment.id } });
      }

      await tx.paymentAction.create({
        data: {
          paymentId: payment.id,
          actorId: user.id,
          type: actionType,
          previousStatus,
          newStatus,
          reason: effectiveReason,
          note:
            body.action === "approve" && newStatus !== PaymentStatus.APROVADO
              ? `Aprovação ${approvalCount} de ${requiredApprovals}`
              : body.note,
          newDueDate,
        },
      });

      return tx.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          currentDueDate: newDueDate ?? undefined,
          appliedApprovalRuleId: body.action === "approve" ? approvalRuleId : null,
          requiredApprovals: body.action === "approve" ? requiredApprovals : 1,
          requiredApprovalRole: body.action === "approve" ? requiredApprovalRole : Role.APROVADOR,
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
          actions: { orderBy: { createdAt: "desc" }, include: { actor: true } },
        },
      });
    });

    await auditLog({
      actorId: user.id,
      event: "PAGAMENTO_ACAO",
      entity: "Payment",
      entityId: payment.id,
      metadata: {
        acao: body.action,
        fornecedor: payment.supplierName,
        conta: payment.work.name,
        de: previousStatus,
        para: newStatus,
        motivo: effectiveReason,
        aprovacoes: body.action === "approve" ? `${approvalCount}/${requiredApprovals}` : undefined,
        ...(newDueDate ? { novaData: newDueDate.toISOString().slice(0, 10) } : {}),
      },
    });

    return ok({
      payment: serializePayment(updated),
      approval: body.action === "approve"
        ? {
            count: approvalCount,
            required: requiredApprovals,
            completed: newStatus === PaymentStatus.APROVADO,
          }
        : null,
    });
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
