import { ActionType, PaymentStatus } from "@prisma-generated/enums";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializePayment } from "@/lib/serializers";

function parseDateParam(value: string | null, endOfDay = false) {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}

export async function GET(request: Request) {
  try {
    // Gestor, aprovador e administrador enxergam todas as contas; operador não entra aqui.
    await requireTab("pagamentos");

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as PaymentStatus | null;
    const workId = url.searchParams.get("workId");
    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"), true);
    const search = url.searchParams.get("search");
    const flowId = url.searchParams.get("flowId");

    const flow = flowId
      ? await prisma.dailyFlow.findUnique({
          where: { id: flowId },
          select: { importBatchId: true },
        })
      : null;
    if (flowId && !flow) throw new ApiError(404, "Fluxo diário não encontrado.");

    const flowWhere = flow ? { importBatchId: flow.importBatchId } : {};

    const [payments, statusTotals, alteredDateActions] = await Promise.all([
      prisma.payment.findMany({
        where: {
          ...flowWhere,
          status: status && Object.values(PaymentStatus).includes(status) ? status : undefined,
          workId: workId || undefined,
          currentDueDate: from || to ? { gte: from, lte: to } : undefined,
          OR: search
            ? [
                { supplierName: { contains: search } },
                { description: { contains: search } },
                { costCenter: { contains: search } },
                { category: { contains: search } },
              ]
            : undefined,
        },
        orderBy: [{ currentDueDate: "asc" }, { createdAt: "desc" }],
        take: 200,
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
            include: { actor: true },
          },
        },
      }),
      prisma.payment.groupBy({
        by: ["status"],
        where: flowWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.paymentAction.findMany({
        where: {
          type: ActionType.TRANSFERIR,
          payment: flow ? { importBatchId: flow.importBatchId } : undefined,
        },
        select: { paymentId: true },
        distinct: ["paymentId"],
      }),
    ]);

    const countStatus = (target: PaymentStatus) =>
      statusTotals.find((row) => row.status === target)?._count._all ?? 0;
    const total = statusTotals.reduce((sum, row) => sum + row._count._all, 0);
    const approved = countStatus(PaymentStatus.APROVADO);
    const rejected = countStatus(PaymentStatus.REPROVADO);

    return ok({
      payments: payments.map(serializePayment),
      summary: {
        total,
        approved,
        alteredDate: alteredDateActions.length,
        rejected,
        // A alteração de data é medida pelo histórico e não invalida uma
        // aprovação posterior: o status atual continua sendo a fonte da verdade.
        fullyApproved: total > 0 && approved === total,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
