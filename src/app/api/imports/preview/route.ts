import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { assertBodySize, MEGABYTE } from "@/lib/body-size";
import { prisma } from "@/lib/db";
import { assertSpreadsheetContent } from "@/lib/file-signature";
import { parsePaymentFile } from "@/lib/import-parser";

const MAX_BODY_SIZE = 25 * MEGABYTE;
const MAX_FILE_SIZE = 10 * MEGABYTE;

export async function POST(request: Request) {
  try {
    await requireTab("importar");

    assertBodySize(request, MAX_BODY_SIZE);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "Envie um arquivo CSV ou XLSX.");
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["csv", "xlsx"].includes(extension)) {
      throw new ApiError(400, "Formato invalido. Use CSV ou XLSX.");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new ApiError(400, `O arquivo "${file.name}" excede o limite de 10 MB.`);
    }

    const data = await file.arrayBuffer();
    assertSpreadsheetContent(new Uint8Array(data), file.name);

    const works = await prisma.work.findMany({ where: { active: true } });
    const preview = await parsePaymentFile(file.name, data, works);

    // Duplicidade contra o que ja esta no banco: a planilha do dia seguinte
    // repete as linhas que ainda nao foram pagas.
    const keys = preview.rows
      .filter((row) => row.errors.length === 0)
      .map((row) => row.uniqueKey);

    const existing = await prisma.payment.findMany({
      where: { uniqueKey: { in: keys } },
      select: { uniqueKey: true },
    });
    const existingKeys = new Set(existing.map((row) => row.uniqueKey));

    const rows = preview.rows.map((row) => {
      if (!existingKeys.has(row.uniqueKey)) return row;
      return {
        ...row,
        duplicate: true,
        errors: [...row.errors, "Já importado anteriormente"],
      };
    });

    const validRows = rows.filter((row) => row.errors.length === 0);

    return ok({
      ...preview,
      rows,
      validRows: validRows.length,
      invalidRows: rows.filter((row) => row.errors.length > 0).length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      totalAmount: Number(validRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
