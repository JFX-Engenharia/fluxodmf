import { Role, StandardReasonAction } from "@prisma-generated/enums";

type NumberLike = number | string | { toNumber?: () => number; toString?: () => string };

export function numberValue(value: NumberLike | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value.toString?.() ?? 0);
}

const roleRank: Record<Role, number> = {
  // Abaixo de zero: o colaborador de campo nao participa de alcada nenhuma,
  // entao nunca satisfaz uma regra de aprovacao, nem a de menor exigencia.
  [Role.COLABORADOR]: -1,
  [Role.OPERADOR]: 0,
  [Role.GESTOR]: 1,
  [Role.APROVADOR]: 2,
  [Role.ADMINISTRADOR]: 3,
};

export function roleAtLeast(actual: Role, required: Role) {
  return roleRank[actual] >= roleRank[required];
}

type ApprovalRuleCandidate = {
  id: string;
  minAmount: NumberLike;
  maxAmount: NumberLike | null;
  workId: string | null;
  category: string | null;
  tagId: string | null;
  requiredRole: Role;
  requiredApprovals: number;
  preventSelfApproval: boolean;
  priority: number;
};

type PaymentForPolicy = {
  amount: NumberLike;
  workId: string;
  category: string;
  tags?: Array<{ tagId: string }>;
};

export function chooseApprovalRule(
  payment: PaymentForPolicy,
  rules: ApprovalRuleCandidate[],
) {
  const amount = numberValue(payment.amount);
  const category = payment.category.trim().toLocaleLowerCase("pt-BR");
  const tagIds = new Set(payment.tags?.map((item) => item.tagId) ?? []);

  return rules
    .filter((rule) => {
      if (amount < numberValue(rule.minAmount)) return false;
      if (rule.maxAmount !== null && amount > numberValue(rule.maxAmount)) return false;
      if (rule.workId && rule.workId !== payment.workId) return false;
      if (rule.category && rule.category.trim().toLocaleLowerCase("pt-BR") !== category) {
        return false;
      }
      if (rule.tagId && !tagIds.has(rule.tagId)) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const specificity = (rule: ApprovalRuleCandidate) =>
        Number(Boolean(rule.workId)) + Number(Boolean(rule.category)) + Number(Boolean(rule.tagId));
      return specificity(b) - specificity(a);
    })[0] ?? null;
}

type AllocationRuleCandidate = {
  id: string;
  category: string | null;
  supplierPattern: string | null;
  priority: number;
  splits: Array<{ workId: string; percentage: NumberLike }>;
};

export function chooseAllocationRule(
  payment: { category: string; supplierName: string },
  rules: AllocationRuleCandidate[],
) {
  const category = payment.category.trim().toLocaleLowerCase("pt-BR");
  const supplier = payment.supplierName.trim().toLocaleLowerCase("pt-BR");

  return rules
    .filter((rule) => {
      if (rule.category && rule.category.trim().toLocaleLowerCase("pt-BR") !== category) {
        return false;
      }
      if (
        rule.supplierPattern &&
        !supplier.includes(rule.supplierPattern.trim().toLocaleLowerCase("pt-BR"))
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.priority - a.priority)[0] ?? null;
}

export function allocationRows(
  amount: NumberLike,
  splits: Array<{ workId: string; percentage: NumberLike }>,
) {
  const total = splits.reduce((sum, split) => sum + numberValue(split.percentage), 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new Error("Os percentuais do rateio precisam somar 100%.");
  }

  const baseAmount = numberValue(amount);
  let allocated = 0;
  return splits.map((split, index) => {
    const percentage = numberValue(split.percentage);
    const splitAmount =
      index === splits.length - 1
        ? Number((baseAmount - allocated).toFixed(2))
        : Number(((baseAmount * percentage) / 100).toFixed(2));
    allocated += splitAmount;
    return { workId: split.workId, percentage, amount: splitAmount };
  });
}

export const reasonActionByPaymentAction: Record<string, StandardReasonAction> = {
  reject: StandardReasonAction.REPROVAR,
  transfer: StandardReasonAction.TRANSFERIR,
  cancel: StandardReasonAction.CANCELAR,
  request_info: StandardReasonAction.SOLICITAR_INFO,
  reopen: StandardReasonAction.REABRIR,
};
