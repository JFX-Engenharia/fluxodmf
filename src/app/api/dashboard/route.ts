import { DailyFlowStatus, PaymentStatus } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializePayment } from "@/lib/serializers";

function numberValue(value: unknown) {
  return Number((value as { toString?: () => string })?.toString?.() ?? value ?? 0);
}

function round(value: number) {
  return Number(value.toFixed(2));
}

/**
 * Ainda comprometem o aporte. Aprovado entra aqui: aprovar nao devolve dinheiro
 * ao caixa, so reprovar, cancelar ou remarcar para outro dia liberam o valor.
 * Serve para as metricas de cobertura (aporte x a pagar).
 */
const COMMITTED_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDENTE,
  PaymentStatus.EM_ANALISE,
  PaymentStatus.APROVADO,
  PaymentStatus.INFO_SOLICITADA,
  PaymentStatus.CORRIGIDO,
];

/**
 * Ainda esperam decisao: e o que aparece no "Fluxo em aberto". Assim que o
 * pagamento e pago (aprovado), reprovado ou tem a data alterada, ele sai da
 * lista; quando a sessao do dia termina, a lista fica vazia.
 */
const UNDECIDED_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDENTE,
  PaymentStatus.EM_ANALISE,
  PaymentStatus.INFO_SOLICITADA,
  PaymentStatus.CORRIGIDO,
];

export async function GET() {
  try {
    await requireTab("dashboard");

    const statuses = Object.values(PaymentStatus);
    const activeFlows = await prisma.dailyFlow.findMany({
      where: { status: { not: DailyFlowStatus.FECHADO } },
      select: { importBatchId: true },
    });
    const activeBatchIds = activeFlows.map((flow) => flow.importBatchId);


    const [statusGroups, works, accountPayments, byCategoryGroups, contributionGroups] =
      await Promise.all([
        prisma.payment.groupBy({
          where: { importBatchId: { in: activeBatchIds } },
          by: ["status"],
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.work.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
        prisma.payment.findMany({
          where: { importBatchId: { in: activeBatchIds } },
          select: {
            id: true,
            workId: true,
            status: true,
            amount: true,
            allocations: { select: { workId: true, amount: true } },
          },
        }),
        prisma.payment.groupBy({
          where: { importBatchId: { in: activeBatchIds } },
          by: ["category"],
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.contribution.groupBy({
          where: { importBatchId: { in: activeBatchIds } },
          by: ["workId"],
          _sum: { amount: true },
        }),
      ]);

    const statusCards = statuses.map((status) => {
      const found = statusGroups.find((row) => row.status === status);
      return {
        status,
        count: found?._count._all ?? 0,
        amount: round(numberValue(found?._sum.amount)),
      };
    });

    /**
     * Metrica central da planilha: cada conta recebe um aporte que precisa
     * cobrir os pagamentos em aberto. Saldo negativo = aporte insuficiente.
     */
    const byAccount = works.map((work) => {
      const rows = accountPayments.flatMap((payment) => {
        const allocations = payment.allocations.length
          ? payment.allocations
          : [{ workId: payment.workId, amount: payment.amount }];
        return allocations
          .filter((allocation) => allocation.workId === work.id)
          .map((allocation) => ({
            paymentId: payment.id,
            status: payment.status,
            amount: numberValue(allocation.amount),
          }));
      });
      const open = rows.filter((row) => COMMITTED_STATUSES.includes(row.status));
      const openAmount = round(
        open.reduce((sum, row) => sum + row.amount, 0),
      );
      const totalAmount = round(
        rows.reduce((sum, row) => sum + row.amount, 0),
      );
      const contribution = round(
        numberValue(
          contributionGroups.find((row) => row.workId === work.id)?._sum.amount,
        ),
      );

      return {
        workId: work.id,
        name: work.name,
        count: new Set(rows.map((row) => row.paymentId)).size,
        totalAmount,
        openAmount,
        contribution,
        balance: round(contribution - openAmount),
        coverage: openAmount > 0 ? round((contribution / openAmount) * 100) : null,
        statuses: statuses.map((status) => ({
          status,
          count: new Set(
            rows.filter((row) => row.status === status).map((row) => row.paymentId),
          ).size,
        })),
      };
    });

    const byCategory = byCategoryGroups
      .map((row) => ({
        category: row.category || "(sem categoria)",
        count: row._count._all,
        amount: round(numberValue(row._sum.amount)),
      }))
      .sort((a, b) => b.amount - a.amount);

    const totals = {
      count: statusCards.reduce((sum, card) => sum + card.count, 0),
      amount: round(statusCards.reduce((sum, card) => sum + card.amount, 0)),
      openAmount: round(
        statusCards
          .filter((card) => COMMITTED_STATUSES.includes(card.status))
          .reduce((sum, card) => sum + card.amount, 0),
      ),
      contribution: round(byAccount.reduce((sum, row) => sum + row.contribution, 0)),
    };

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    /**
     * O fluxo mostrado e tudo que esta em aberto, ordenado por vencimento, e
     * nao so o que vence hoje: a planilha do dia costuma ser importada depois
     * das datas que ela lista (a de 13/07 chega no 14/07), entao filtrar por
     * "hoje" ou "futuro" escondia justamente os vencidos, que sao os urgentes.
     */
    const openFlow = await prisma.payment.findMany({
      where: {
        importBatchId: { in: activeBatchIds },
        status: { in: UNDECIDED_STATUSES },
      },
      orderBy: [{ currentDueDate: "asc" }, { supplierName: "asc" }],
      take: 100,
      include: { work: true },
    });

    const flow = openFlow.map((payment) => ({
      ...serializePayment(payment),
      overdue: payment.currentDueDate < dayStart,
      dueToday: payment.currentDueDate >= dayStart && payment.currentDueDate < dayEnd,
    }));

    const overdueRows = flow.filter((row) => row.overdue);
    const todayRows = flow.filter((row) => row.dueToday);

    return ok({
      totals: {
        ...totals,
        overdueCount: overdueRows.length,
        overdueAmount: round(overdueRows.reduce((sum, row) => sum + row.amount, 0)),
        todayCount: todayRows.length,
        todayAmount: round(todayRows.reduce((sum, row) => sum + row.amount, 0)),
      },
      referenceDate: today,
      statusCards,
      byAccount,
      byCategory,
      flow,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
