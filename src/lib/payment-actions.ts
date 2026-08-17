/**
 * Nucleo das acoes sobre pagamento (aprovar, reprovar, transferir, ...),
 * compartilhado pela rota individual e pelo processamento em lote.
 *
 * Existe por um motivo so: as invariantes desta operacao — lock pessimista,
 * bloqueio de auto-aprovacao, alcada por valor, contagem de aprovacoes
 * parciais, regra sticky — sao a parte do sistema onde um erro aprova pagamento
 * indevido. Mante-las em dois lugares seria garantir que um dia divergem. A
 * rota carrega UM pagamento e chama isto; o worker carrega N e chama isto N
 * vezes, dentro da propria transacao de cada bloco.
 *
 * O que este modulo NAO faz, de proposito: autenticar (o lote autentica uma vez
 * so), abrir transacao (quem chama decide o escopo) e gravar auditoria (o lote
 * grava em massa). O texto da auditoria, esse sim, sai daqui pronto, para as
 * duas pontas registrarem exatamente a mesma coisa.
 */

import type { Prisma } from "@prisma-generated/client";
import { ActionType, DailyFlowStatus, PaymentStatus, Role } from "@prisma-generated/enums";
import { ApiError } from "@/lib/api";
import { chooseApprovalRule, reasonActionByPaymentAction, roleAtLeast } from "@/lib/finance-management";
import { canAdminister, canEditPayments } from "@/lib/permissions";

export const PAYMENT_ACTIONS = [
  "approve",
  "reject",
  "transfer",
  "request_info",
  "answer_info",
  "cancel",
  "reopen",
  "analyze",
] as const;

export type PaymentActionName = (typeof PAYMENT_ACTIONS)[number];

/** Acoes que so o administrador executa. */
const CRITICAL_ACTIONS: PaymentActionName[] = ["cancel", "reopen"];

export type PaymentActionInput = {
  action: PaymentActionName;
  reason?: string;
  standardReasonId?: string;
  newDueDate?: string;
  note?: string;
};

export type PaymentActionActor = { id: string; role: Role };

/** Motivo padronizado ja carregado: o lote busca uma vez para todos os itens. */
export type StandardReasonRecord = {
  id: string;
  label: string;
  action: string;
  active: boolean;
};

/**
 * Pagamento com o contexto que as validacoes precisam. O lote monta isto com um
 * unico findMany; a rota, com um findUnique.
 */
export type PaymentForAction = {
  id: string;
  status: PaymentStatus;
  supplierName: string;
  createdById: string;
  appliedApprovalRuleId: string | null;
  requiredApprovals: number;
  requiredApprovalRole: Role;
  work: { name: string };
  approvals: Array<{ actorId: string }>;
  importBatch: { dailyFlow: { status: DailyFlowStatus } | null };
};

export type PaymentActionOutcome = {
  paymentId: string;
  previousStatus: PaymentStatus;
  newStatus: PaymentStatus;
  actionType: ActionType;
  newDueDate: Date | null;
  effectiveReason?: string;
  approval: { count: number; required: number; completed: boolean } | null;
  /** Metadados da auditoria, identicos nas duas pontas. */
  auditMetadata: Record<string, unknown>;
};

/** Regras de aprovacao ja carregadas, avaliadas em memoria por chooseApprovalRule. */
export type ApprovalRuleRecord = {
  id: string;
  minAmount: Prisma.Decimal | number | string;
  maxAmount: Prisma.Decimal | number | string | null;
  workId: string | null;
  category: string | null;
  tagId: string | null;
  priority: number;
  requiredApprovals: number;
  requiredRole: Role;
  preventSelfApproval: boolean;
};

function requireReason(reason: string | undefined, message: string) {
  if (!reason || reason.length < 3) throw new ApiError(400, message);
}

export function dateFromIsoDay(day: string | undefined) {
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Permissao do ATOR, independente de qual pagamento. O lote chama uma vez, no
 * inicio; a rota, uma vez por requisicao.
 */
export function assertActorCanAct(actor: PaymentActionActor, action: PaymentActionName) {
  if (!canEditPayments(actor.role)) {
    throw new ApiError(403, "Seu perfil não tem permissão para agir sobre pagamentos.");
  }
  if (CRITICAL_ACTIONS.includes(action) && !canAdminister(actor.role)) {
    throw new ApiError(403, "Somente o administrador pode cancelar ou reabrir pagamentos.");
  }
}

/**
 * Junta o motivo padronizado com o texto livre. O motivo padronizado tem que
 * combinar com a acao — um motivo de reprovacao nao vale para cancelamento.
 */
export function resolveEffectiveReason(
  input: PaymentActionInput,
  standardReason: StandardReasonRecord | null,
) {
  if (!input.standardReasonId) return input.reason;

  const expectedAction = reasonActionByPaymentAction[input.action];
  if (!standardReason || !standardReason.active || standardReason.action !== expectedAction) {
    throw new ApiError(400, "O motivo padronizado não é válido para esta ação.");
  }

  return input.reason?.trim()
    ? `${standardReason.label}: ${input.reason.trim()}`
    : standardReason.label;
}

/**
 * Guardas que dependem do pagamento, mas nao da transacao. Ficam separadas para
 * o lote poder recusar um item cedo, com motivo, sem abrir transacao por ele.
 */
export function assertPaymentAcceptsAction(
  payment: PaymentForAction,
  action: PaymentActionName,
) {
  if (payment.importBatch.dailyFlow?.status === DailyFlowStatus.FECHADO) {
    throw new ApiError(409, "Este fluxo está fechado. Reabra-o antes de fazer alterações.");
  }
  if (payment.status === PaymentStatus.APROVADO && action !== "reopen") {
    throw new ApiError(409, "Pagamento aprovado fica bloqueado para novas ações diretas.");
  }
  if (payment.status === PaymentStatus.CANCELADO && action !== "reopen") {
    throw new ApiError(409, "Pagamento cancelado precisa voltar para em aberto.");
  }
}

/**
 * Executa a acao DENTRO da transacao recebida e devolve o que aconteceu.
 *
 * `approvalRules` avaliadas em memoria por chooseApprovalRule: no lote, ler as
 * regras uma vez para todos os pagamentos e boa parte do ganho. A regra sticky
 * continua vencendo quando existe — a lista so pesa quando o pagamento ainda
 * nao tem regra aplicada.
 *
 * `null` significa "nao pre-carreguei": a lista e lida AQUI DENTRO, ja sob o
 * lock. E o que a rota individual passa, e nao e detalhe — entre ler as regras
 * fora e pegar o lock, outra acao pode ter limpado a regra aplicada do
 * pagamento, e uma lista vazia carregada antes faria a aprovacao cair no padrao
 * (1 aprovacao, perfil APROVADOR), afrouxando a alcada exatamente no caso em
 * que ela deveria valer. O lote passa a lista porque a le uma vez, dentro do
 * mesmo ciclo de vida do job.
 */
export async function applyPaymentAction(params: {
  tx: Prisma.TransactionClient;
  payment: PaymentForAction;
  actor: PaymentActionActor;
  input: PaymentActionInput;
  effectiveReason?: string;
  approvalRules: ApprovalRuleRecord[] | null;
}): Promise<PaymentActionOutcome> {
  const { tx, payment, actor, input, effectiveReason, approvalRules } = params;

  let newStatus: PaymentStatus = payment.status;
  let actionType: ActionType = ActionType.APROVAR;
  let newDueDate: Date | null = null;
  let approvalRuleId: string | null = payment.appliedApprovalRuleId;
  let requiredApprovals = payment.requiredApprovals;
  let requiredApprovalRole = payment.requiredApprovalRole;
  let approvalCount = payment.approvals.length;
  let previousStatus = payment.status;

  if (input.action === "approve") {
    actionType = ActionType.APROVAR;
  } else if (input.action === "reject") {
    requireReason(effectiveReason, "Informe o motivo da reprovação.");
    newStatus = PaymentStatus.REPROVADO;
    actionType = ActionType.REPROVAR;
  } else if (input.action === "transfer") {
    requireReason(effectiveReason, "Informe o motivo da transferência.");
    newDueDate = dateFromIsoDay(input.newDueDate);
    if (!newDueDate) throw new ApiError(400, "Informe uma nova data válida.");
    newStatus = PaymentStatus.TRANSFERIDO;
    actionType = ActionType.TRANSFERIR;
  } else if (input.action === "request_info") {
    requireReason(effectiveReason, "Informe o que precisa ser complementado.");
    newStatus = PaymentStatus.INFO_SOLICITADA;
    actionType = ActionType.SOLICITAR_INFO;
  } else if (input.action === "answer_info") {
    requireReason(effectiveReason ?? input.note, "Informe a resposta.");
    newStatus = PaymentStatus.CORRIGIDO;
    actionType = ActionType.RESPONDER_INFO;
  } else if (input.action === "cancel") {
    requireReason(effectiveReason, "Informe o motivo do cancelamento.");
    newStatus = PaymentStatus.CANCELADO;
    actionType = ActionType.CANCELAR;
  } else if (input.action === "analyze") {
    newStatus =
      payment.status === PaymentStatus.EM_ANALISE
        ? PaymentStatus.PENDENTE
        : PaymentStatus.EM_ANALISE;
    actionType = ActionType.ANALISAR;
  } else if (input.action === "reopen") {
    requireReason(effectiveReason, "Informe o motivo para voltar a em aberto.");
    newStatus = PaymentStatus.PENDENTE;
    actionType = ActionType.REABRIR;
  }

  if (input.action === "approve") {
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

    let candidateRules: ApprovalRuleRecord[] = [];
    if (!lockedPayment.appliedApprovalRule) {
      candidateRules =
        approvalRules ??
        (await tx.approvalRule.findMany({
          where: { active: true },
          orderBy: { priority: "desc" },
        }));
    }
    const rule = lockedPayment.appliedApprovalRule ?? chooseApprovalRule(lockedPayment, candidateRules);
    approvalRuleId = rule?.id ?? null;
    requiredApprovals = rule?.requiredApprovals ?? 1;
    requiredApprovalRole = rule?.requiredRole ?? Role.APROVADOR;
    const preventSelfApproval = rule?.preventSelfApproval ?? true;

    if (preventSelfApproval && lockedPayment.createdById === actor.id) {
      throw new ApiError(403, "Quem criou ou importou o pagamento não pode aprová-lo.");
    }
    if (!roleAtLeast(actor.role, requiredApprovalRole)) {
      throw new ApiError(
        403,
        requiredApprovalRole === Role.ADMINISTRADOR
          ? "Este pagamento exige aprovação de administrador."
          : "Seu perfil não atende à alçada deste pagamento.",
      );
    }
    if (lockedPayment.approvals.some((approval) => approval.actorId === actor.id)) {
      throw new ApiError(409, "Você já registrou sua aprovação neste pagamento.");
    }

    await tx.paymentApproval.create({
      data: { paymentId: payment.id, actorId: actor.id, approvalRuleId },
    });
    approvalCount = await tx.paymentApproval.count({ where: { paymentId: payment.id } });
    newStatus =
      approvalCount >= requiredApprovals ? PaymentStatus.APROVADO : PaymentStatus.PENDENTE;
    previousStatus = lockedPayment.status;
  } else {
    await tx.paymentApproval.deleteMany({ where: { paymentId: payment.id } });
  }

  await tx.paymentAction.create({
    data: {
      paymentId: payment.id,
      actorId: actor.id,
      type: actionType,
      previousStatus,
      newStatus,
      reason: effectiveReason,
      note:
        input.action === "approve" && newStatus !== PaymentStatus.APROVADO
          ? `Aprovação ${approvalCount} de ${requiredApprovals}`
          : input.note,
      newDueDate,
    },
  });

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      currentDueDate: newDueDate ?? undefined,
      appliedApprovalRuleId: input.action === "approve" ? approvalRuleId : null,
      requiredApprovals: input.action === "approve" ? requiredApprovals : 1,
      requiredApprovalRole: input.action === "approve" ? requiredApprovalRole : Role.APROVADOR,
    },
    // Select minimo: quem precisa do pagamento inteiro (a rota individual) o
    // recarrega com os includes da tela. O lote descartaria esse trabalho.
    select: { id: true },
  });

  return {
    paymentId: payment.id,
    previousStatus,
    newStatus,
    actionType,
    newDueDate,
    effectiveReason,
    approval:
      input.action === "approve"
        ? {
            count: approvalCount,
            required: requiredApprovals,
            completed: newStatus === PaymentStatus.APROVADO,
          }
        : null,
    auditMetadata: {
      acao: input.action,
      fornecedor: payment.supplierName,
      conta: payment.work.name,
      de: previousStatus,
      para: newStatus,
      motivo: effectiveReason,
      aprovacoes:
        input.action === "approve" ? `${approvalCount}/${requiredApprovals}` : undefined,
      ...(newDueDate ? { novaData: newDueDate.toISOString().slice(0, 10) } : {}),
    },
  };
}
