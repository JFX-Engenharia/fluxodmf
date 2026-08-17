import { z } from "zod";
import { ApiError, handleApiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireTab } from "@/lib/auth";
import { assertBodySize, MEGABYTE } from "@/lib/body-size";
import { UNDEFINED_WORK_SLUG } from "@/lib/cost-center";
import { prisma } from "@/lib/db";
import { buildFlowWorkbook, convertRawFile } from "@/lib/flow-converter";
import { readConvertUpload } from "./upload";

const aportesSchema = z.array(
  z.object({
    accountLabel: z.string().trim().min(1),
    amount: z.number().nonnegative("O aporte nao pode ser negativo."),
  }),
);

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BODY_SIZE = 25 * MEGABYTE;

/** JSON quebrado e erro do cliente: sem isto, o SyntaxError viraria um 500. */
function parseAportes(value: FormDataEntryValue | null) {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    throw new ApiError(400, "Lista de aportes invalida.");
  }
}

/**
 * Content-Disposition so aceita ASCII no `filename`. O nome real vai no
 * `filename*`, que os navegadores atuais preferem; o ASCII fica de reserva.
 */
function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Converte o export bruto e devolve a planilha de fluxo pronta para download. */
export async function POST(request: Request) {
  try {
    const actor = await requireTab("importar");

    assertBodySize(request, MAX_BODY_SIZE);
    const formData = await request.formData();
    const { file, data } = await readConvertUpload(formData);
    const aportes = aportesSchema.parse(parseAportes(formData.get("aportes")));
    const works = await prisma.work.findMany({
      where: { OR: [{ active: true }, { slug: UNDEFINED_WORK_SLUG }] },
    });

    let conversion;
    try {
      conversion = await convertRawFile(file.name, data, works);
    } catch {
      throw new ApiError(
        400,
        "Nao foi possivel ler a planilha. Se o arquivo for um .xls antigo, reexporte como .xlsx.",
      );
    }

    if (conversion.missingColumns.length > 0) {
      throw new ApiError(
        400,
        `Colunas obrigatorias nao encontradas: ${conversion.missingColumns.join(", ")}.`,
      );
    }

    if (conversion.validRows === 0) {
      throw new ApiError(400, "Nenhuma linha valida para converter.");
    }

    const workbook = await buildFlowWorkbook(conversion, aportes);

    await auditLog({
      actorId: actor.id,
      event: "FLUXO_CONVERTIDO",
      entity: "Flow",
      metadata: {
        origem: conversion.fileName,
        gerado: conversion.suggestedFileName,
        linhas: conversion.validRows,
        ignoradas: conversion.invalidRows,
        total: conversion.totalAmount,
        aportes: aportes.filter((aporte) => aporte.amount > 0).length,
      },
    });

    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": contentDisposition(conversion.suggestedFileName),
        "Content-Length": String(workbook.byteLength),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
