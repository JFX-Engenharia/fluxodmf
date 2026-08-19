import { z } from "zod";
import { ImportStatus } from "@prisma-generated/enums";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";
import { assertActorCanAct, dateFromIsoDay, PAYMENT_ACTIONS } from "@/lib/payment-actions";
import {
  parseBatchResults,
  processPaymentBatch,
  STALE_AFTER_MS,
} from "@/lib/payment-batch-worker";

/** Teto por lote: acima disso o operador esta selecionando a lista inteira. */
const MAX_BATCH_SIZE = 500;

const batchSchema = z.object({
  action: z.enum(PAYMENT_ACTIONS),
  paymentIds: z
    .array(z.string().min(1))
    .min(1, "Selecione ao menos um pagamento.")
    .max(MAX_BATCH_SIZE, `Selecione no máximo ${MAX_BATCH_SIZE} pagamentos por lote.`),
  reason: z.string().trim().optional(),
  standardReasonId: z.string().trim().optional(),
  newDueDate: z.string().trim().optional(),
});

/**
 * Dispara a acao em lote e responde 202 na hora.
 *
 * Antes, a tela fazia uma requisicao HTTP POR PAGAMENTO, em serie: com 150
 * pagamentos eram 150 autenticacoes, 150 chaves de idempotencia e ~30
 * statements SQL cada uma — dezenas de segundos com a aba presa. Agora e uma
 * chamada, e o trabalho segue em segundo plano no molde da importacao de
 * planilha: sobrevive a fechar a aba e nao esbarra em tempo de requisicao.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = batchSchema.parse(await request.json());
    await requireMutationAllowed(user);

    return await withIdempotency({
      request,
      // UMA chave para o lote inteiro, nao por item: duplo clique no botao nao
      // cria dois jobs sobre os mesmos pagamentos.
      scope: "payments:batch",
      actorId: user.id,
      execute: async () => {
        // Vale a pena recusar aqui o que ja da para recusar: perfil sem
        // permissao nao ocupa job nenhum.
        assertActorCanAct(user, body.action);

        if (body.action === "transfer" && !dateFromIsoDay(body.newDueDate)) {
          throw new ApiError(400, "Informe uma nova data válida.");
        }

        const paymentIds = [...new Set(body.paymentIds)];
        const job = await prisma.paymentBatchAction.create({
          data: {
            actorId: user.id,
            action: body.action,
            reason: body.reason ?? "",
            standardReasonId: body.standardReasonId || null,
            newDueDate: dateFromIsoDay(body.newDueDate),
            paymentIds: JSON.stringify(paymentIds),
            status: ImportStatus.PENDENTE,
            totalCount: paymentIds.length,
          },
          select: { id: true, status: true, totalCount: true },
        });

        // Sem await: a resposta nao espera o lote. Se este processo morrer antes
        // de terminar, o GET abaixo redispara.
        void processPaymentBatch(job.id).catch(() => {});

        return ok({ jobId: job.id, status: job.status, totalCount: job.totalCount }, 202);
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Polling dos lotes do proprio usuario, com a auto-cura que a importacao ja usa,
 * o que dispensa cron. Sao dois abandonos diferentes:
 *
 * - PENDENTE parado ha mais de 60s: o processo caiu ANTES de o worker pegar o
 *   job, entao nada comecou e retomar e barato.
 * - PROCESSANDO parado ha mais de STALE_AFTER_MS: o worker pegou e morreu no
 *   meio. Sem este caso o lote ficava PROCESSANDO para sempre — o claim do
 *   worker ja aceitava retoma-lo, mas ninguem o chamava de volta.
 *
 * O limiar do segundo caso e o MESMO do claim, importado dali: redisparar antes
 * so gastaria uma chamada que o worker recusaria, e o job continuaria preso.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const jobs = await prisma.paymentBatchAction.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        status: true,
        totalCount: true,
        processedCount: true,
        successCount: true,
        failedCount: true,
        results: true,
        attempts: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    const now = Date.now();
    const stalePendingBefore = new Date(now - 60_000);
    const staleProcessingBefore = new Date(now - STALE_AFTER_MS);
    for (const job of jobs) {
      // `startedAt` nulo em PROCESSANDO nao existe na pratica (o claim grava os
      // dois juntos), e o `lt` do worker tambem nao casaria com nulo — sem esta
      // guarda o redisparo seria uma chamada morta.
      const abandonado =
        (job.status === ImportStatus.PENDENTE && job.createdAt < stalePendingBefore) ||
        (job.status === ImportStatus.PROCESSANDO &&
          job.startedAt !== null &&
          job.startedAt < staleProcessingBefore);
      if (abandonado) void processPaymentBatch(job.id).catch(() => {});
    }

    return ok({
      jobs: jobs.map((job) => ({
        id: job.id,
        action: job.action,
        status: job.status,
        totalCount: job.totalCount,
        processedCount: job.processedCount,
        successCount: job.successCount,
        failedCount: job.failedCount,
        results: parseBatchResults(job.results),
        attempts: job.attempts,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
