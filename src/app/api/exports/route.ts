import ExcelJS from "exceljs";
import { z } from "zod";
import { PaymentStatus, Role } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

const querySchema = z.object({
  type: z.enum(["payments", "accounts", "advances", "requests", "documents", "audit"]),
  from: z.string().date(),
  to: z.string().date(),
});

const titles = {
  payments: "Pagamentos",
  accounts: "Contas e saldos",
  advances: "Prestações de contas",
  requests: "Solicitações",
  documents: "Pendências de documentos",
  audit: "Logs de auditoria",
};

function configureWorksheet(worksheet: ExcelJS.Worksheet, columns: Array<{ header: string; key: string; width: number }>) {
  worksheet.columns = columns;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + columns.length)}1` };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3157A4" } };
  worksheet.getRow(1).alignment = { vertical: "middle" };
}

export async function GET(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T23:59:59.999Z`);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DJ Fluxo";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(titles[query.type]);

    if (query.type === "payments") {
      configureWorksheet(worksheet, [
        { header: "Vencimento", key: "date", width: 14 }, { header: "Fornecedor", key: "supplier", width: 30 },
        { header: "Descrição", key: "description", width: 45 }, { header: "Conta", key: "work", width: 28 },
        { header: "Categoria", key: "category", width: 22 }, { header: "Referência", key: "reference", width: 20 },
        { header: "Valor", key: "amount", width: 16 }, { header: "Status", key: "status", width: 18 }, { header: "Comprovante", key: "receipt", width: 14 },
      ]);
      const rows = await prisma.payment.findMany({ where: { currentDueDate: { gte: from, lte: to } }, include: { work: true }, orderBy: { currentDueDate: "asc" } });
      worksheet.addRows(rows.map((row) => ({ date: row.currentDueDate, supplier: row.supplierName, description: row.description, work: row.work.name, category: row.category, reference: row.externalReference ?? "", amount: Number(row.amount), status: row.status, receipt: row.hasReceipt ? "Recebido" : "Pendente" })));
    } else if (query.type === "accounts") {
      configureWorksheet(worksheet, [
        { header: "Conta", key: "work", width: 32 }, { header: "Responsável", key: "responsible", width: 28 },
        { header: "Aportes", key: "contributions", width: 16 }, { header: "Comprometido", key: "committed", width: 16 }, { header: "Saldo", key: "balance", width: 16 },
      ]);
      const works = await prisma.work.findMany({ include: { responsibleUser: true, contributions: { where: { importBatch: { createdAt: { gte: from, lte: to } } } }, payments: { where: { currentDueDate: { gte: from, lte: to }, status: { notIn: [PaymentStatus.REPROVADO, PaymentStatus.CANCELADO, PaymentStatus.TRANSFERIDO] } } } }, orderBy: { name: "asc" } });
      worksheet.addRows(works.map((work) => { const contributions = work.contributions.reduce((sum, item) => sum + Number(item.amount), 0); const committed = work.payments.reduce((sum, item) => sum + Number(item.amount), 0); return { work: work.name, responsible: work.responsibleUser?.name ?? "Não definido", contributions, committed, balance: contributions - committed }; }));
    } else if (query.type === "advances") {
      configureWorksheet(worksheet, [
        { header: "Colaborador", key: "collaborator", width: 28 }, { header: "Descrição", key: "description", width: 40 }, { header: "Conta", key: "work", width: 28 },
        { header: "Concedido", key: "amount", width: 15 }, { header: "Comprovado", key: "spent", width: 15 }, { header: "Devolvido", key: "returned", width: 15 },
        { header: "Saldo", key: "balance", width: 15 }, { header: "Prazo", key: "due", width: 14 }, { header: "Status", key: "status", width: 16 },
      ]);
      const rows = await prisma.advance.findMany({ where: { dueDate: { gte: from, lte: to } }, include: { work: true }, orderBy: { dueDate: "asc" } });
      worksheet.addRows(rows.map((row) => ({ collaborator: row.collaboratorName, description: row.description, work: row.work?.name ?? "Sem conta", amount: Number(row.amount), spent: Number(row.spentAmount), returned: Number(row.returnedAmount), balance: Number(row.amount) - Number(row.spentAmount) - Number(row.returnedAmount), due: row.dueDate, status: row.status })));
    } else if (query.type === "requests") {
      configureWorksheet(worksheet, [
        { header: "Data", key: "created", width: 18 }, { header: "Fornecedor", key: "supplier", width: 30 }, { header: "Descrição", key: "description", width: 42 },
        { header: "Conta", key: "work", width: 28 }, { header: "Solicitante", key: "requester", width: 26 }, { header: "Responsável", key: "reviewer", width: 26 },
        { header: "Valor", key: "amount", width: 15 }, { header: "Vencimento", key: "due", width: 14 }, { header: "Status", key: "status", width: 16 },
      ]);
      const rows = await prisma.paymentRequest.findMany({ where: { createdAt: { gte: from, lte: to } }, include: { work: true, requestedBy: true, reviewedBy: true }, orderBy: { createdAt: "desc" } });
      worksheet.addRows(rows.map((row) => ({ created: row.createdAt, supplier: row.supplierName, description: row.description, work: row.work.name, requester: row.requestedBy.name, reviewer: row.reviewedBy?.name ?? "Pendente", amount: Number(row.amount), due: row.dueDate, status: row.status })));
    } else if (query.type === "documents") {
      configureWorksheet(worksheet, [
        { header: "Tipo", key: "type", width: 20 }, { header: "Pessoa/Fornecedor", key: "subject", width: 30 }, { header: "Descrição", key: "description", width: 42 },
        { header: "Conta", key: "work", width: 28 }, { header: "Valor", key: "amount", width: 15 }, { header: "Prazo", key: "due", width: 14 }, { header: "Pendência", key: "pending", width: 24 },
      ]);
      const [payments, advances] = await Promise.all([
        prisma.payment.findMany({ where: { currentDueDate: { gte: from, lte: to }, hasReceipt: false, status: { notIn: [PaymentStatus.REPROVADO, PaymentStatus.CANCELADO] } }, include: { work: true } }),
        prisma.advance.findMany({ where: { dueDate: { gte: from, lte: to }, documents: "" }, include: { work: true } }),
      ]);
      worksheet.addRows([
        ...payments.map((row) => ({ type: "Pagamento", subject: row.supplierName, description: row.description, work: row.work.name, amount: Number(row.amount), due: row.currentDueDate, pending: "Comprovante de pagamento" })),
        ...advances.map((row) => ({ type: "Adiantamento", subject: row.collaboratorName, description: row.description, work: row.work?.name ?? "Sem conta", amount: Number(row.amount), due: row.dueDate, pending: "Prestação de contas" })),
      ]);
    } else {
      configureWorksheet(worksheet, [
        { header: "Data", key: "created", width: 20 }, { header: "Usuário", key: "actor", width: 28 }, { header: "Evento", key: "event", width: 34 },
        { header: "Entidade", key: "entity", width: 22 }, { header: "Identificador", key: "entityId", width: 28 }, { header: "Detalhes", key: "metadata", width: 60 },
      ]);
      const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: from, lte: to } }, include: { actor: true }, orderBy: { createdAt: "desc" } });
      worksheet.addRows(rows.map((row) => ({ created: row.createdAt, actor: row.actor?.name ?? "Sistema", event: row.event, entity: row.entity, entityId: row.entityId ?? "", metadata: row.metadata })));
    }

    worksheet.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: "top", wrapText: true };
    });
    const moneyColumns: Record<string, true> = {
      amount: true,
      contributions: true,
      committed: true,
      balance: true,
      spent: true,
      returned: true,
    };
    worksheet.columns.forEach((column) => {
      if (column.key && moneyColumns[String(column.key)]) {
        column.numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
      }
    });
    const buffer = await workbook.xlsx.writeBuffer();
    await auditLog({ actorId: actor.id, event: "EXPORTACAO_EXCEL", entity: "OperationalExport", metadata: { tipo: query.type, de: query.from, ate: query.to, linhas: worksheet.rowCount - 1 } });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${query.type}-${query.from}-${query.to}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
