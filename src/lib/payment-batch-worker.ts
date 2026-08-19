/**
 * Processamento em segundo plano de uma acao aplicada a varios pagamentos, no
 * mesmo molde do import-worker: o estado do job vive no banco, o claim e
 * atomico e o trabalho e retomavel.
 *
 * O ganho nao vem de fazer menos coisa por pagamento — as invariantes sao as
 * mesmas, e o nucleo executado e literalmente o mesmo modulo que a rota
 * individual usa. Vem de parar de REPETIR o que nao varia: uma autenticacao no
 * lugar de N, uma leitura de regras de aprovacao no lugar de N, um findMany no
 * lugar de N findUnique, e uma requisicao HTTP no lugar de N.
 */

import { ImportStatus } from "@prisma-generated/enums";
import { auditLogMany } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  applyPaymentAction,
  assertActorCanAct,
  assertPaymentAcceptsAction,
  resolveEffectiveReason,
  type ApprovalRuleRecord,
  type PaymentActionInput,
  type PaymentActionName,
} from "@/lib/payment-actions";

/**
 * Granularidade de leitura e auditoria, nao de transacao: cada pagamento e
 * aplicado na sua propria transacao, entao o bloco so dita o tamanho do
 * findMany e do auditLogMany.
 */
const CHUNK_SIZE = 25;
/**
 * Depois disto um PROCESSANDO nao e mais trabalho em andamento, e sim trabalho
 * abandonado por um processo que morreu no meio. Exportado porque a rota de
 * polling decide o redisparo pelo MESMO limiar: se ela chamasse antes, o claim
 * aqui recusaria e o lote ficaria preso do mesmo jeito.
 */
export const STALE_AFTER_MS = 15 * 60_000;

export type BatchItemResult = {
  paymentId: string;
  ok: boolean;
  /** Rotulo legivel do pagamento, para a tela nao precisar de outra consulta. */
  supplierName?: string;
  status?: string;
  error?: string;
};

function parseIdList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function parseBatchResults(raw: string): BatchItemResult[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BatchItemResult[]) : [];
  } catch {
    return [];
  }
}

function messageFrom(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return String(error instanceof Error ? error.message : error).slice(0, 300);
}

export async function processPaymentBatch(jobId: string): Promise<void> {
  const startedAt = new Date();
  // Claim atomico: dois disparos concorrentes (o POST e a auto-cura do polling)
  // nao processam o mesmo job duas vezes.
  const claimed = await prisma.paymentBatchAction.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: ImportStatus.PENDENTE },
        { status: ImportStatus.FALHOU },
        {
          status: ImportStatus.PROCESSANDO,
          startedAt: { lt: new Date(startedAt.getTime() - STALE_AFTER_MS) },
        },
      ],
    },
    data: {
      status: ImportStatus.PROCESSANDO,
      startedAt,
      finishedAt: null,
      attempts: { increment: 1 },
      error: "",
    },
  });
  if (claimed.count === 0) return;

  try {
    const job = await prisma.paymentBatchAction.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        actorId: true,
        action: true,
        reason: true,
        standardReasonId: true,
        newDueDate: true,
        paymentIds: true,
        results: true,
      },
    });

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: job.actorId },
      select: { id: true, role: true },
    });
    const action = job.action as PaymentActionName;
    assertActorCanAct(actor, action);

    const input: PaymentActionInput = {
      action,
      reason: job.reason || undefined,
      standardReasonId: job.standardReasonId || undefined,
      newDueDate: job.newDueDate ? job.newDueDate.toISOString().slice(0, 10) : undefined,
    };

    // Tudo o que nao varia por pagamento sai do laco: motivo padronizado e
    // regras de aprovacao, lidos UMA vez para o lote inteiro.
    const standardReason = job.standardReasonId
      ? await prisma.standardReason.findUnique({ where: { id: job.standardReasonId } })
      : null;
    const effectiveReason = resolveEffectiveReason(input, standardReason);
    const approvalRules: ApprovalRuleRecord[] = await prisma.approvalRule.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
    });

    // Retomada: o que ja tem resultado gravado nao e reaplicado. Sem isso, um
    // retry criaria PaymentAction duplicado nas acoes que nao sao protegidas
    // pela constraint unica de aprovacao.
    const previousResults = parseBatchResults(job.results);
    const settled = new Map(previousResults.map((item) => [item.paymentId, item]));

    // Ordem estavel: dois lotes concorrentes sobre os mesmos pagamentos pegam os
    // locks na mesma sequencia e nao travam um ao outro.
    const paymentIds = [...new Set(parseIdList(job.paymentIds))].sort();
    const pendingIds = paymentIds.filter((id) => !settled.has(id));

    for (let offset = 0; offset < pendingIds.length; offset += CHUNK_SIZE) {
      const chunkIds = pendingIds.slice(offset, offset + CHUNK_SIZE);

      // Um findMany por bloco no lugar de um findUnique por pagamento.
      const payments = await prisma.payment.findMany({
        where: { id: { in: chunkIds } },
        select: {
          id: true,
          status: true,
          supplierName: true,
          createdById: true,
          appliedApprovalRuleId: true,
          requiredApprovals: true,
          requiredApprovalRole: true,
          work: { select: { name: true } },
          approvals: { select: { actorId: true } },
          importBatch: { select: { dailyFlow: { select: { status: true } } } },
        },
      });
      const byId = new Map(payments.map((payment) => [payment.id, payment]));

      const chunkAudits: Parameters<typeof auditLogMany>[0] = [];

      for (const id of chunkIds) {
        const payment = byId.get(id);
        let result: BatchItemResult;
        if (!payment) {
          result = { paymentId: id, ok: false, error: "Pagamento não encontrado." };
        } else {
          try {
            assertPaymentAcceptsAction(payment, action);
            // Uma transacao POR pagamento: o SELECT ... FOR UPDATE de
            // applyPaymentAction dura milissegundos em vez de prender um bloco
            // inteiro de linhas — nem estoura o timeout do Prisma em lotes
            // grandes, nem faz quem aprova pela tela esperar o lote.
            const outcome = await prisma.$transaction((tx) =>
              applyPaymentAction({
                tx,
                payment,
                actor,
                input,
                effectiveReason,
                approvalRules,
              }),
            );
            result = {
              paymentId: id,
              ok: true,
              supplierName: payment.supplierName,
              status: outcome.newStatus,
            };
            chunkAudits.push({
              actorId: actor.id,
              event: "PAGAMENTO_ACAO",
              entity: "Payment",
              entityId: id,
              metadata: outcome.auditMetadata,
            });
          } catch (error) {
            // Falha parcial e requisito: um lote heterogeneo aprova o que a
            // alcada permite e recusa o resto, com o motivo de cada recusa. A
            // falha desfaz apenas a transacao DESTE pagamento; os demais nao
            // sao afetados.
            result = {
              paymentId: id,
              ok: false,
              supplierName: payment.supplierName,
              error: messageFrom(error),
            };
          }
        }

        // Progresso gravado por pagamento: com commits individuais, um item
        // aplicado mas sem resultado persistido seria reaplicado na retomada
        // (PaymentAction duplicado). Assim a janela de reaplicacao e de no
        // maximo 1 pagamento.
        settled.set(result.paymentId, result);
        const allResults = [...settled.values()];
        await prisma.paymentBatchAction.update({
          where: { id: job.id },
          data: {
            results: JSON.stringify(allResults),
            processedCount: allResults.length,
            successCount: allResults.filter((item) => item.ok).length,
            failedCount: allResults.filter((item) => !item.ok).length,
            // Batida de coracao, escrita na mesma linha do progresso: nao custa
            // consulta nenhuma e muda o sentido de "parado". Sem ela,
            // STALE_AFTER_MS conta desde o INICIO, e um lote grande que ainda
            // esta trabalhando seria considerado abandonado aos 15 minutos —
            // dois workers no mesmo job. Com ela, parado passa a ser o que
            // realmente importa: 15 minutos SEM progresso.
            startedAt: new Date(),
          },
        });
      }

      // Fora de transacao e em massa por bloco, como sempre foi: auditoria nao
      // deve prender lock nem custar um INSERT por pagamento.
      await auditLogMany(chunkAudits);
    }

    const finalResults = [...settled.values()];
    await prisma.paymentBatchAction.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.CONFIRMADO,
        results: JSON.stringify(finalResults),
        processedCount: finalResults.length,
        successCount: finalResults.filter((item) => item.ok).length,
        failedCount: finalResults.filter((item) => !item.ok).length,
        finishedAt: new Date(),
        error: "",
      },
    });
  } catch (error) {
    await prisma.paymentBatchAction.updateMany({
      where: { id: jobId, status: { not: ImportStatus.CONFIRMADO } },
      data: {
        status: ImportStatus.FALHOU,
        error: messageFrom(error).slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }
}
