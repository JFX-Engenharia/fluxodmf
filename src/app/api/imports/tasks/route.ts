import { ImportStatus } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processImportTask } from "@/lib/import-worker";

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

    const stalePendingBefore = new Date(Date.now() - 60_000);
    for (const task of tasks) {
      if (task.status === ImportStatus.PENDENTE && task.createdAt < stalePendingBefore) {
        void processImportTask(task.id).catch(() => {});
      }
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
