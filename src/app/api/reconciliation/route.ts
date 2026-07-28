import { ApiError, handleApiError, ok } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireTab } from "@/lib/auth";
import {
  parseCajuRows,
  parseInternalRows,
  readStatement,
  reconcile,
} from "@/lib/reconciliation";

const ACCEPTED_EXTENSIONS = ["csv", "xlsx", "xls"];

function readUpload(formData: FormData, field: string, label: string) {
  const file = formData.get(field);

  if (!(file instanceof File)) {
    throw new ApiError(400, `Envie ${label}.`);
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new ApiError(400, `Formato invalido em "${file.name}". Use CSV, XLS ou XLSX.`);
  }

  return file;
}

/** Aceita "2025-12-25" do input[type=date]. Vazio significa sem filtro. */
function readFromDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApiError(400, "Data inicial invalida.");
  }
  return text;
}

/**
 * Cruza o extrato do cartao CAJU com o extrato do colaborador no sistema
 * interno e devolve as compras que ainda nao viraram lancamento — as notas
 * pendentes de cobranca.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireTab("conciliacao");

    const formData = await request.formData();
    const first = readUpload(formData, "fileA", "o extrato do sistema interno");
    const second = readUpload(formData, "fileB", "o extrato do cartao CAJU");
    const fromDate = readFromDate(formData.get("fromDate"));

    let a, b;
    try {
      [a, b] = await Promise.all([
        readStatement(first.name, await first.arrayBuffer()),
        readStatement(second.name, await second.arrayBuffer()),
      ]);
    } catch {
      throw new ApiError(
        400,
        "Nao foi possivel ler as planilhas. Se algum arquivo for um .xls antigo, reexporte como .xlsx.",
      );
    }

    // A ordem do upload nao importa: cada arquivo e reconhecido pelas colunas.
    const files = [
      { file: first, statement: a },
      { file: second, statement: b },
    ];
    const cajuSide = files.find((item) => item.statement.kind === "caju");
    const internalSide = files.find((item) => item.statement.kind === "internal");

    if (!cajuSide || !internalSide) {
      const seen = files.map((item) => `${item.file.name} (${item.statement.kind})`).join(", ");
      throw new ApiError(
        400,
        !cajuSide && !internalSide
          ? `Nenhum dos arquivos foi reconhecido. Envie o extrato da CAJU e o extrato do sistema interno. Recebido: ${seen}.`
          : !cajuSide
            ? `Falta o extrato do cartao CAJU (coluna "Tipo de Transacao"). Recebido: ${seen}.`
            : `Falta o extrato do sistema interno (coluna "Valor original da parcela"). Recebido: ${seen}.`,
      );
    }

    const caju = parseCajuRows(cajuSide.statement.grid, cajuSide.statement.headers);
    const internal = parseInternalRows(
      internalSide.statement.grid,
      internalSide.statement.headers,
    );

    const missingColumns = [...caju.missingColumns, ...internal.missingColumns];
    if (missingColumns.length > 0) {
      throw new ApiError(400, `Colunas obrigatorias nao encontradas: ${missingColumns.join(", ")}.`);
    }

    const result = reconcile({
      cajuFileName: cajuSide.file.name,
      internalFileName: internalSide.file.name,
      caju: caju.rows,
      internal: internal.rows,
      fromDate,
    });

    await auditLog({
      actorId: actor.id,
      event: "CONCILIACAO_EXECUTADA",
      entity: "Reconciliation",
      metadata: {
        extratoCaju: result.cajuFileName,
        extratoInterno: result.internalFileName,
        aPartirDe: result.fromDate ?? "-",
        colaboradores: result.collaborators.join(", "),
        compras: result.totals.cajuPurchases,
        conciliadas: result.totals.matched,
        pendentes: result.totals.pending,
        valorPendente: result.totals.pendingAmount,
        semCompraNoCartao: result.totals.unmatchedInternal,
        valorSemCompraNoCartao: result.totals.unmatchedInternalAmount,
      },
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
