import { z } from "zod";
import {
  DailyFlowEventType,
  DailyFlowStatus,
  Role,
} from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { serializeDailyFlow, summarizePayments } from "@/lib/daily-flow";
import { withIdempotency } from "@/lib/idempotency";
import { prisma } from "@/lib/db";
import { canAdminister } from "@/lib/permissions";

const actionSchema = z.object({
  flowId: z.string().min(1),
  action: z.enum(["close", "reopen"]),
  reason: z.string().trim().optional(),
});

const includeFlow = {
  importBatch: {
    include: {
      importedBy: { select: { id: true, name: true } },
      payments: { select: { status: true, amount: true } },
    },
  },
  startedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  events: {
    orderBy: { createdAt: "desc" as const },
    include: { actor: { select: { id: true, name: true } } },
  },
};

export async function GET() {
  try {
    await requireTab("pagamentos");

    const flows = await prisma.dailyFlow.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: includeFlow,
    });

    return ok({ flows: flows.map(serializeDailyFlow) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("pagamentos");
    const body = actionSchema.parse(await request.json());
    await requireMutationAllowed(actor);
    return await withIdempotency({
      request,
      scope: `daily-flow:${body.flowId}:${body.action}`,
      actorId: actor.id,
      execute: async () => {

    const flow = await prisma.dailyFlow.findUnique({
      where: { id: body.flowId },
      include: includeFlow,
    });
    if (!flow) throw new ApiError(404, "Fluxo diário não encontrado.");

    const summary = summarizePayments(flow.importBatch.payments);
    let nextStatus: DailyFlowStatus;
    let eventType: DailyFlowEventType;
    let auditEvent: string;

    if (body.action === "close") {
      if (actor.role !== Role.APROVADOR && actor.role !== Role.ADMINISTRADOR) {
        throw new ApiError(403, "Somente um aprovador pode concluir o fluxo.");
      }
      if (flow.status === DailyFlowStatus.FECHADO) {
        throw new ApiError(409, "O fluxo diário já está fechado.");
      }
      if (summary.undecidedCount > 0) {
        throw new ApiError(
          409,
          `Ainda existem ${summary.undecidedCount} pagamento(s) aguardando decisão.`,
        );
      }
      nextStatus = DailyFlowStatus.FECHADO;
      eventType = DailyFlowEventType.FECHADO;
      auditEvent = "FLUXO_FECHADO";
    } else {
      if (!canAdminister(actor.role)) {
        throw new ApiError(403, "Somente o administrador pode reabrir um fechamento.");
      }
      if (flow.status !== DailyFlowStatus.FECHADO) {
        throw new ApiError(409, "Somente um fluxo fechado pode ser reaberto.");
      }
      if (!body.reason || body.reason.length < 3) {
        throw new ApiError(400, "Informe o motivo da reabertura.");
      }
      nextStatus = DailyFlowStatus.EM_APROVACAO;
      eventType = DailyFlowEventType.REABERTO;
      auditEvent = "FLUXO_REABERTO";
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.dailyFlowEvent.create({
        data: {
          dailyFlowId: flow.id,
          actorId: actor.id,
          type: eventType,
          reason: body.reason,
          metadata: JSON.stringify(
            body.action === "close" ? { resumo: summary } : { de: flow.status, para: nextStatus },
          ),
        },
      });

      return tx.dailyFlow.update({
        where: { id: flow.id },
        data:
          body.action === "close"
            ? {
                status: nextStatus,
                closedById: actor.id,
                closedAt: now,
                finalSummary: JSON.stringify(summary),
              }
            : {
                status: nextStatus,
                closedById: null,
                closedAt: null,
                finalSummary: "{}",
              },
        include: includeFlow,
      });
    });

    await auditLog({
      actorId: actor.id,
      event: auditEvent,
      entity: "DailyFlow",
      entityId: flow.id,
      metadata: {
        nome: flow.importBatch.fileName,
        de: flow.status,
        para: nextStatus,
        motivo: body.reason,
        ...(body.action === "close" ? { resumo: summary } : {}),
      },
    });

    return ok({ flow: serializeDailyFlow(updated) });
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
