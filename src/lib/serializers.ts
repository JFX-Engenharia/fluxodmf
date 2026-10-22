type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type ActionRecord = Record<string, unknown> & {
  createdAt: Date;
  newDueDate?: Date | null;
};

type PaymentRecord = Record<string, unknown> & {
  amount: DecimalLike | number | string;
  originalDueDate: Date;
  currentDueDate: Date;
  createdAt: Date;
  updatedAt: Date;
  actions?: ActionRecord[];
  receiptReceivedAt?: Date | null;
  approvals?: Array<Record<string, unknown> & { createdAt: Date }>;
  allocations?: Array<Record<string, unknown> & {
    percentage: DecimalLike | number | string;
    amount: DecimalLike | number | string;
  }>;
};

function decimalToNumber(value: DecimalLike | number | string) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value.toString?.() ?? 0);
}

export function serializePayment(payment: PaymentRecord) {
  return {
    ...payment,
    amount: decimalToNumber(payment.amount),
    originalDueDate: payment.originalDueDate.toISOString(),
    currentDueDate: payment.currentDueDate.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    receiptReceivedAt: payment.receiptReceivedAt?.toISOString() ?? null,
    actions: payment.actions?.map((action) => ({
      ...action,
      createdAt: action.createdAt.toISOString(),
      newDueDate: action.newDueDate?.toISOString() ?? null,
    })),
    approvals: payment.approvals?.map((approval) => ({
      ...approval,
      createdAt: approval.createdAt.toISOString(),
    })),
    allocations: payment.allocations?.map((allocation) => ({
      ...allocation,
      percentage: decimalToNumber(allocation.percentage),
      amount: decimalToNumber(allocation.amount),
    })),
  };
}

export function serializeDateFields<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}
