import { DailyFlowStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { parseFlowSummary } from "@/lib/daily-flow";
import { prisma } from "@/lib/db";
import { buildDailyFlowReportPdf, pdfContentDisposition } from "@/lib/pdf-reports";

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "-").trim();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireTab("pagamentos");
    const { id } = await context.params;
    const flow = await prisma.dailyFlow.findUnique({
      where: { id },
      include: {
        importBatch: {
          include: {
            importedBy: { select: { name: true } },
            payments: {
              orderBy: [{ currentDueDate: "asc" }, { supplierName: "asc" }],
              include: {
                work: true,
                allocations: { include: { work: true } },
              },
            },
          },
        },
        closedBy: { select: { name: true } },
        events: {
          orderBy: { createdAt: "asc" },
          include: { actor: { select: { name: true } } },
        },
      },
    });

    if (!flow) throw new ApiError(404, "Fluxo diário não encontrado.");
    if (flow.status !== DailyFlowStatus.FECHADO) {
      throw new ApiError(409, "O relatório final só fica disponível após o fechamento.");
    }
    const summary = parseFlowSummary(flow.finalSummary);
    if (!summary) throw new ApiError(500, "Resumo final do fluxo não encontrado.");

    const pdf = await buildDailyFlowReportPdf({
      name: flow.importBatch.fileName,
      createdAt: flow.createdAt,
      closedAt: flow.closedAt,
      importedBy: flow.importBatch.importedBy.name,
      closedBy: flow.closedBy?.name ?? "-",
      summary,
      payments: flow.importBatch.payments,
      events: flow.events,
    });
    const fileName = `Relatório final - ${safeName(flow.importBatch.fileName)}.pdf`;

    await auditLog({
      actorId: actor.id,
      event: "RELATORIO_FLUXO_GERADO",
      entity: "DailyFlow",
      entityId: flow.id,
      metadata: { nome: flow.importBatch.fileName },
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": pdfContentDisposition(fileName),
        "Content-Length": String(pdf.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
