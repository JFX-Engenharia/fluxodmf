import { ApiError } from "@/lib/api";
import { MEGABYTE } from "@/lib/body-size";
import {
  assertSpreadsheetContent,
  SPREADSHEET_EXTENSIONS,
  type SpreadsheetKind,
} from "@/lib/file-signature";

/**
 * O Conta Azul entrega o export com extensao .xls mesmo sendo um xlsx, entao a
 * conversao aceita as tres extensoes — ao contrario da importacao do fluxo, que
 * so recebe o modelo ja refinado.
 */
const MAX_FILE_SIZE = 10 * MEGABYTE;

export async function readConvertUpload(formData: FormData): Promise<{
  file: File;
  data: ArrayBuffer;
  kind: SpreadsheetKind;
}> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new ApiError(400, "Envie a planilha bruta em CSV, XLS ou XLSX.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !(SPREADSHEET_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ApiError(400, "Formato invalido. Use CSV, XLS ou XLSX.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError(400, `O arquivo "${file.name}" excede o limite de 10 MB.`);
  }

  const data = await file.arrayBuffer();
  const kind = assertSpreadsheetContent(new Uint8Array(data), file.name);

  return { file, data, kind };
}
