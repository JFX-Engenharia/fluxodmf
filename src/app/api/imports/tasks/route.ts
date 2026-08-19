import { ImportStatus } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processImportTask, STALE_AFTER_MS } from "@/lib/import-worker";

function createdAccounts(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const user = await requireTab("importar");
    const tasks = await prisma.importBatch.findMany({
      where: { importedById: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        totalRows: true,
        validRows: true,
        invalidRows: true,
        processedRows: true,
        importedRows: true,
        importedContributions: true,
        createdAccounts: true,
        attempts: true,
        error: true,
        sourceFileName: true,
        flowName: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        dailyFlow: { select: { id: true } },
      },
    });

    // Dois abandonos diferentes: PENDENTE parado ha mais de 60s e o processo que
    // caiu ANTES de o worker pegar a tarefa; PROCESSANDO parado ha mais de
    // STALE_AFTER_MS e o worker que pegou e morreu no meio. Sem o segundo caso a
    // importacao ficava PROCESSANDO para sempre — o claim do worker ja aceitava
    // retoma-la, mas ninguem o chamava de volta. O limiar e o MESMO do claim,
    // importado dali: redisparar antes so gastaria uma chamada recusada.
    const now = Date.now();
    const stalePendingBefore = new Date(now - 60_000);
    const staleProcessingBefore = new Date(now - STALE_AFTER_MS);
    for (const task of tasks) {
      // `startedAt` nulo em PROCESSANDO nao existe na pratica (o claim grava os
      // dois juntos), e o `lt` do worker tambem nao casaria com nulo.
      const abandonada =
        (task.status === ImportStatus.PENDENTE && task.createdAt < stalePendingBefore) ||
        (task.status === ImportStatus.PROCESSANDO &&
          task.startedAt !== null &&
          task.startedAt < staleProcessingBefore);
      if (abandonada) void processImportTask(task.id).catch(() => {});
    }

    return ok({
      tasks: tasks.map((task) => ({
        id: task.id,
        status: task.status,
        totalRows: task.totalRows,
        validRows: task.validRows,
        invalidRows: task.invalidRows,
        processedRows: task.processedRows,
        importedRows: task.importedRows,
        importedContributions: task.importedContributions,
        createdAccounts: createdAccounts(task.createdAccounts),
        attempts: task.attempts,
        error: task.error,
        sourceFileName: task.sourceFileName,
        flowName: task.flowName,
        flowId: task.dailyFlow?.id ?? null,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        finishedAt: task.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
