import { DailyFlowStatus, PaymentStatus } from "@prisma-generated/enums";

type DecimalLike = number | string | { toNumber?: () => number; toString?: () => string };

type PaymentForSummary = {
  status: PaymentStatus;
  amount: DecimalLike;
};

export type StatusSummary = { count: number; amount: number };

export type DailyFlowSummary = {
  total: StatusSummary;
  approved: StatusSummary;
  rejected: StatusSummary;
  transferred: StatusSummary;
  cancelled: StatusSummary;
  pending: StatusSummary;
  inAnalysis: StatusSummary;
  informationRequested: StatusSummary;
  corrected: StatusSummary;
  undecidedCount: number;
};

function numberValue(value: DecimalLike) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value.toString?.() ?? 0);
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export function summarizePayments(payments: PaymentForSummary[]): DailyFlowSummary {
  const status = (target: PaymentStatus): StatusSummary => {
    const rows = payments.filter((payment) => payment.status === target);
    return {
      count: rows.length,
      amount: round(rows.reduce((sum, payment) => sum + numberValue(payment.amount), 0)),
    };
  };

  const approved = status(PaymentStatus.APROVADO);
  const rejected = status(PaymentStatus.REPROVADO);
  const transferred = status(PaymentStatus.TRANSFERIDO);
  const cancelled = status(PaymentStatus.CANCELADO);
  const pending = status(PaymentStatus.PENDENTE);
  const inAnalysis = status(PaymentStatus.EM_ANALISE);
  const informationRequested = status(PaymentStatus.INFO_SOLICITADA);
  const corrected = status(PaymentStatus.CORRIGIDO);

  return {
    total: {
      count: payments.length,
      amount: round(payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0)),
    },
    approved,
    rejected,
    transferred,
    cancelled,
    pending,
    inAnalysis,
    informationRequested,
    corrected,
    undecidedCount:
      pending.count + informationRequested.count + corrected.count + inAnalysis.count,
  };
}

export function parseFlowSummary(value: string | null | undefined): DailyFlowSummary | null {
  if (!value || value === "{}") return null;
  try {
    return JSON.parse(value) as DailyFlowSummary;
  } catch {
    return null;
  }
}

type DailyFlowRecord = {
  id: string;
  status: DailyFlowStatus;
  startedAt: Date | null;
  closedAt: Date | null;
  finalSummary: string;
  createdAt: Date;
  updatedAt: Date;
  startedBy?: { id: string; name: string } | null;
  closedBy?: { id: string; name: string } | null;
  importBatch: {
    id: string;
    fileName: string;
    createdAt: Date;
    importedBy?: { id: string; name: string } | null;
    payments?: PaymentForSummary[];
  };
  events?: Array<{
    id: string;
    type: string;
    reason: string | null;
    metadata: string;
    createdAt: Date;
    actor: { id: string; name: string };
  }>;
};

export function serializeDailyFlow(flow: DailyFlowRecord) {
  const liveSummary = summarizePayments(flow.importBatch.payments ?? []);
  const finalSummary = parseFlowSummary(flow.finalSummary);

  return {
    id: flow.id,
    status: flow.status,
    name: flow.importBatch.fileName,
    importBatchId: flow.importBatch.id,
    importedBy: flow.importBatch.importedBy ?? null,
    startedBy: flow.startedBy ?? null,
    closedBy: flow.closedBy ?? null,
    startedAt: flow.startedAt?.toISOString() ?? null,
    closedAt: flow.closedAt?.toISOString() ?? null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
    summary:
      flow.status === DailyFlowStatus.FECHADO && finalSummary ? finalSummary : liveSummary,
    events: (flow.events ?? []).map((event) => ({
      id: event.id,
      type: event.type,
      reason: event.reason,
      metadata: parseMetadata(event.metadata),
      actor: event.actor,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

function parseMetadata(value: string) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
