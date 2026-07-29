import { ActionType, PaymentStatus } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireTab("aprovados");
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim();
    const flowId = url.searchParams.get("flowId")?.trim() || undefined;
    const approvedOnRaw = url.searchParams.get("approvedOn")?.trim();
    const approvedOn =
      approvedOnRaw && /^\d{4}-\d{2}-\d{2}$/.test(approvedOnRaw) ? approvedOnRaw : undefined;
    const dayStart = approvedOn ? new Date(`${approvedOn}T00:00:00-03:00`) : undefined;
    const dayEnd = dayStart ? new Date(dayStart.getTime() + 86_400_000) : undefined;
    const [payments, flows] = await Promise.all([
      prisma.payment.findMany({
        where: {
          status: PaymentStatus.APROVADO,
          importBatch: {
            importedById: user.id,
            ...(flowId ? { dailyFlow: { id: flowId } } : {}),
          },
          ...(search
            ? {
                OR: [
                  { supplierName: { contains: search, mode: "insensitive" as const } },
                  { description: { contains: search, mode: "insensitive" as const } },
                  { category: { contains: search, mode: "insensitive" as const } },
                  { costCenter: { contains: search, mode: "insensitive" as const } },
                  { importBatch: { fileName: { contains: search, mode: "insensitive" as const } } },
                ],
              }
            : {}),
          ...(dayStart
            ? {
                actions: {
                  some: {
                    type: ActionType.APROVAR,
                    newStatus: PaymentStatus.APROVADO,
                    createdAt: { gte: dayStart, lt: dayEnd },
                  },
                },
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { supplierName: "asc" }],
        select: {
          id: true,
          supplierName: true,
          description: true,
          amount: true,
          category: true,
          currentDueDate: true,
          costCenter: true,
          updatedAt: true,
          work: { select: { id: true, name: true } },
          importBatch: {
            select: {
              id: true,
              fileName: true,
              dailyFlow: { select: { id: true } },
            },
          },
          actions: {
            where: { type: ActionType.APROVAR },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              createdAt: true,
              actor: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.dailyFlow.findMany({
        where: { importBatch: { importedById: user.id } },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          createdAt: true,
          importBatch: { select: { fileName: true } },
        },
      }),
    ]);

    const rows = payments.map((payment) => ({
      id: payment.id,
      supplierName: payment.supplierName,
      description: payment.description,
      amount: Number(payment.amount),
      category: payment.category,
      currentDueDate: payment.currentDueDate.toISOString(),
      costCenter: payment.costCenter,
      work: payment.work,
      flow: {
        id: payment.importBatch.dailyFlow?.id ?? null,
        batchId: payment.importBatch.id,
        name: payment.importBatch.fileName,
      },
      approvedAt: (payment.actions[0]?.createdAt ?? payment.updatedAt).toISOString(),
      approvedBy: payment.actions[0]?.actor ?? null,
    }));

    return ok({
      payments: rows,
      flows: flows.map((flow) => ({
        id: flow.id,
        name: flow.importBatch.fileName,
        createdAt: flow.createdAt.toISOString(),
      })),
      summary: {
        count: rows.length,
        amount: Number(rows.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)),
        flows: new Set(rows.map((payment) => payment.flow.batchId)).size,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
