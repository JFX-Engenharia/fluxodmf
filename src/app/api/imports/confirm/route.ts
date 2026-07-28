import { ImportStatus } from "@prisma-generated/enums";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { confirmSchema, processImportTask } from "@/lib/import-worker";
import { withIdempotency } from "@/lib/idempotency";

function defaultFlowName() {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  })
    .format(new Date())
    .replace("/", ".");
  return `FLUXO DE PAGAMENTOS ${date}`;
}

export async function POST(request: Request) {
  try {
    const user = await requireTab("importar");
    await requireMutationAllowed(user);
    return await withIdempotency({
      request,
      scope: "imports:confirm",
      actorId: user.id,
      execute: async () => {
        const body = confirmSchema.parse(await request.json());
        const flowName = body.importName || defaultFlowName();
        const validRows = body.rows.filter(
          (row) => row.errors.length === 0 && !row.duplicate,
        );
        const validContributions = body.contributions.filter(
          (row) => row.errors.length === 0,
        );

        if (validRows.length === 0) {
          throw new ApiError(400, "Não há linhas válidas para importar.");
        }

        const alreadyImported = await prisma.payment.findMany({
          where: { uniqueKey: { in: validRows.map((row) => row.uniqueKey) } },
          select: { uniqueKey: true },
        });
        const existingKeys = new Set(alreadyImported.map(({ uniqueKey }) => uniqueKey));
        const rowsToImport = validRows.filter((row) => !existingKeys.has(row.uniqueKey));
        if (rowsToImport.length === 0) {
          throw new ApiError(409, "Todas as linhas desta planilha já foram importadas.");
        }

        const batch = await prisma.importBatch.create({
          data: {
            status: ImportStatus.PENDENTE,
            fileName: flowName,
            sourceFileName: body.fileName,
            flowName,
            totalRows: body.totalRows,
            validRows: rowsToImport.length,
            invalidRows: body.rows.length - rowsToImport.length,
            importedById: user.id,
            payload: JSON.stringify({
              rows: rowsToImport,
              contributions: validContributions,
            }),
          },
        });

        void processImportTask(batch.id).catch(() => {});
        return ok({ taskId: batch.id, status: ImportStatus.PENDENTE }, 202);
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
