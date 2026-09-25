import { z } from "zod";
import { DailyFlowStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAdminister } from "@/lib/permissions";

const deleteSchema = z.object({
  reason: z.string().trim().min(3, "Informe o motivo da exclusão."),
});

/**
 * Apaga o fluxo diario inteiro. O fluxo nasce da importacao, entao quem e
 * removido e o ImportBatch: o cascade leva junto o fluxo, seus eventos, os
 * pagamentos importados (e tudo que pende deles) e as contribuicoes.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireTab("pagamentos");
    await requireMutationAllowed(actor);
    if (!canAdminister(actor.role)) {
      throw new ApiError(403, "Somente o administrador pode apagar um fluxo diário.");
    }

    const { id } = await context.params;
    const body = deleteSchema.parse(await request.json());

    const flow = await prisma.dailyFlow.findUnique({
      where: { id },
      include: {
        importBatch: {
          select: { id: true, fileName: true, flowName: true, _count: { select: { payments: true } } },
        },
      },
    });
    if (!flow) throw new ApiError(404, "Fluxo diário não encontrado.");
    if (flow.status === DailyFlowStatus.FECHADO) {
      throw new ApiError(409, "Reabra o fechamento antes de apagar o fluxo.");
    }

    await prisma.importBatch.delete({ where: { id: flow.importBatch.id } });

    await auditLog({
      actorId: actor.id,
      event: "FLUXO_APAGADO",
      entity: "DailyFlow",
      entityId: flow.id,
      metadata: {
        nome: flow.importBatch.flowName || flow.importBatch.fileName,
        status: flow.status,
        pagamentos: flow.importBatch._count.payments,
        motivo: body.reason,
      },
    });

    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
