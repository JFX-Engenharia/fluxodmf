import { ImportStatus } from "@prisma-generated/enums";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processImportTask } from "@/lib/import-worker";

const STALE_AFTER_MS = 15 * 60_000;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireTab("importar");
    await requireMutationAllowed(user);
    const { id } = await context.params;
    const batch = await prisma.importBatch.findUnique({
      where: { id },
      select: { importedById: true, status: true, startedAt: true },
    });
    if (!batch || batch.importedById !== user.id) {
      throw new ApiError(404, "Tarefa de importação não encontrada.");
    }

    const staleProcessing =
      batch.status === ImportStatus.PROCESSANDO &&
      (!batch.startedAt || batch.startedAt < new Date(Date.now() - STALE_AFTER_MS));
    if (batch.status !== ImportStatus.FALHOU && !staleProcessing) {
      throw new ApiError(409, "Esta importação não pode ser reprocessada.");
    }

    void processImportTask(id).catch(() => {});
    return ok({ status: ImportStatus.PENDENTE }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
