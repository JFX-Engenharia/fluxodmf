import { z } from "zod";
import { AllocationSource, ActionType, DailyFlowEventType, PaymentStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { matchWork, normalizeName, uniqueSlug } from "@/lib/cost-center";
import { prisma } from "@/lib/db";
import { allocationRows, chooseAllocationRule } from "@/lib/finance-management";

// workId e opcional: a conta pode nao existir ainda e ser criada aqui. Quem
// decide qual conta vale e o servidor, a partir do nome do centro de custo.
const rowSchema = z.object({
  externalReference: z.string().optional(),
  supplierName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().default(""),
  originalDueDate: z.string().min(1),
  currentDueDate: z.string().min(1),
  costCenter: z.string().min(1),
  workId: z.string().optional(),
  uniqueKey: z.string().min(1),
  errors: z.array(z.string()),
  duplicate: z.boolean(),
});

const contributionSchema = z.object({
  accountLabel: z.string().min(1),
  amount: z.number().positive(),
  workId: z.string().optional(),
  errors: z.array(z.string()),
});

const confirmSchema = z.object({
  fileName: z.string().min(1),
  importName: z.string().trim().max(120).optional(),
  totalRows: z.number().int().nonnegative(),
  rows: z.array(rowSchema),
  contributions: z.array(contributionSchema).default([]),
});

function dateFromIsoDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

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
    const body = confirmSchema.parse(await request.json());
    const flowName = body.importName || defaultFlowName();

    const validRows = body.rows.filter((row) => row.errors.length === 0 && !row.duplicate);
    const validContributions = body.contributions.filter((row) => row.errors.length === 0);

    if (validRows.length === 0) {
      throw new ApiError(400, "Não há linhas válidas para importar.");
    }

    // O cliente manda uniqueKey, mas quem decide o que e duplicado e o banco:
    // a preview pode estar velha se outra pessoa importou nesse meio tempo.
    const keys = validRows.map((row) => row.uniqueKey);
    const alreadyImported = await prisma.payment.findMany({
      where: { uniqueKey: { in: keys } },
      select: { uniqueKey: true },
    });
    const existingKeys = new Set(alreadyImported.map((row) => row.uniqueKey));
    const rowsToImport = validRows.filter((row) => !existingKeys.has(row.uniqueKey));

    if (rowsToImport.length === 0) {
      throw new ApiError(409, "Todas as linhas desta planilha já foram importadas.");
    }

    const batch = await prisma.$transaction(async (tx) => {
      /**
       * Resolve o centro de custo pelo nome e cria a conta se ela ainda nao
       * existir. O `workId` que o cliente mandou e so uma dica da previa: quem
       * decide e o servidor, e entre a previa e a confirmacao a conta pode ter
       * sido criada por outra importacao.
       */
      const existingWorks = await tx.work.findMany();
      const allocationRules = await tx.allocationRule.findMany({
        where: { active: true },
        orderBy: { priority: "desc" },
        include: { splits: true },
      });
      const takenSlugs = new Set(existingWorks.map((work) => work.slug));
      const resolved = new Map<string, string>();
      const createdAccounts: string[] = [];

      async function resolveWorkId(costCenter: string) {
        const key = normalizeName(costCenter);
        const cached = resolved.get(key);
        if (cached) return cached;

        const match = matchWork(costCenter, existingWorks);
        if (match) {
          resolved.set(key, match.id);
          return match.id;
        }

        const slug = uniqueSlug(costCenter, takenSlugs);
        takenSlugs.add(slug);

        const created = await tx.work.create({
          data: {
            name: costCenter.trim(),
            slug,
            costCenterAliases: JSON.stringify([costCenter.trim()]),
          },
        });

        existingWorks.push(created);
        resolved.set(key, created.id);
        createdAccounts.push(created.name);
        return created.id;
      }

      const importBatch = await tx.importBatch.create({
        data: {
          fileName: flowName,
          totalRows: body.totalRows,
          validRows: rowsToImport.length,
          invalidRows: body.rows.length - rowsToImport.length,
          importedById: user.id,
        },
      });

      const dailyFlow = await tx.dailyFlow.create({
        data: {
          importBatchId: importBatch.id,
          events: {
            create: {
              actorId: user.id,
              type: DailyFlowEventType.CRIADO,
              metadata: JSON.stringify({ arquivoOrigem: body.fileName, nome: flowName }),
            },
          },
        },
      });

      for (const row of rowsToImport) {
        const payment = await tx.payment.create({
          data: {
            externalReference: row.externalReference,
            supplierName: row.supplierName,
            description: row.description,
            amount: row.amount,
            category: row.category,
            originalDueDate: dateFromIsoDay(row.originalDueDate),
            currentDueDate: dateFromIsoDay(row.currentDueDate),
            costCenter: row.costCenter,
            uniqueKey: row.uniqueKey,
            workId: await resolveWorkId(row.costCenter),
            importBatchId: importBatch.id,
            createdById: user.id,
            status: PaymentStatus.PENDENTE,
          },
        });

        await tx.paymentAction.create({
          data: {
            paymentId: payment.id,
            actorId: user.id,
            type: ActionType.IMPORTAR,
            newStatus: PaymentStatus.PENDENTE,
            note: `Importado no fluxo ${flowName}`,
          },
        });

        const allocationRule = chooseAllocationRule(payment, allocationRules);
        if (allocationRule) {
          await tx.paymentAllocation.createMany({
            data: allocationRows(payment.amount, allocationRule.splits).map((split) => ({
              paymentId: payment.id,
              ...split,
              source: AllocationSource.REGRA,
            })),
          });
        }
      }

      for (const contribution of validContributions) {
        await tx.contribution.create({
          data: {
            accountLabel: contribution.accountLabel,
            amount: contribution.amount,
            workId: await resolveWorkId(contribution.accountLabel),
            importBatchId: importBatch.id,
          },
        });
      }

      return { importBatch, dailyFlow, createdAccounts };
    });

    const { importBatch, dailyFlow, createdAccounts } = batch;

    await auditLog({
      actorId: user.id,
      event: "IMPORT_CONFIRM",
      entity: "ImportBatch",
      entityId: importBatch.id,
      metadata: {
        fileName: importBatch.fileName,
        arquivoOrigem: body.fileName,
        fluxoDiarioId: dailyFlow.id,
        importedRows: rowsToImport.length,
        skippedRows: validRows.length - rowsToImport.length,
        contributions: validContributions.length,
        totalAmount: Number(
          rowsToImport.reduce((sum, row) => sum + row.amount, 0).toFixed(2),
        ),
        ...(createdAccounts.length ? { contasCriadas: createdAccounts } : {}),
      },
    });

    return ok(
      {
        batchId: importBatch.id,
        flowId: dailyFlow.id,
        flowName: importBatch.fileName,
        importedRows: rowsToImport.length,
        skippedRows: validRows.length - rowsToImport.length,
        importedContributions: validContributions.length,
        createdAccounts,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
