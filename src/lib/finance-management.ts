import { StandardReasonAction } from "@prisma-generated/enums";

type NumberLike = number | string | { toNumber?: () => number; toString?: () => string };

export function numberValue(value: NumberLike | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value.toString?.() ?? 0);
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
