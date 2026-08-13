/**
 * Primitivos de leitura de planilha, compartilhados pelo importador do fluxo e
 * pelo conversor do export bruto do Conta Azul. As duas pontas precisam ler
 * valor e data do mesmo jeito: o que o conversor escreve, o importador le.
 */

import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { normalizeName } from "@/lib/cost-center";
import { decodeSpreadsheetText } from "@/lib/file-signature";

export type RawRow = Record<string, unknown>;

/** Acha o cabecalho cujo nome normalizado bate com algum alias. */
export function findColumn(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeName);
  return headers.find((header) => normalizedAliases.includes(normalizeName(header)));
}

export function parseMoney(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/R\$/gi, "");

  if (!text) return NaN;

  if (text.includes(",")) {
    return Number(text.replace(/\./g, "").replace(",", "."));
  }

  return Number(text);
}

export function excelSerialDate(serial: number) {
  const utcDays = Math.floor(serial - 25569);
  const seconds = utcDays * 86400;
  const date = new Date(seconds * 1000);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && value > 20000) {
    return excelSerialDate(value);
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  const brMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]) - 1;
    const fullYear =
      brMatch[3].length === 2 ? Number(`20${brMatch[3]}`) : Number(brMatch[3]);
    return new Date(Date.UTC(fullYear, month, day));
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** dd/mm/aaaa, a grafia que a planilha de fluxo usa na coluna DATA. */
export function brDate(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function parseCsvRows(arrayBuffer: ArrayBuffer) {
  const text = decodeSpreadsheetText(new Uint8Array(arrayBuffer));
  if (text === null) {
    throw new Error("Nao foi possivel decodificar o CSV como texto legivel.");
  }

  return parseCsv(text, {
    bom: true,
    columns: true,
    delimiter: detectDelimiter(text),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawRow[];
}

export function cellValue(value: ExcelJS.CellValue) {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("text" in value && value.text) return value.text;
  if ("result" in value && value.result != null) return value.result;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("formula" in value) return "";
  return String(value);
}

export async function loadFirstWorksheet(arrayBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  // O tipo publico de load() pede um Buffer do ExcelJS, que nao existe em runtime.
  const loadWorkbook = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (
    buffer: Uint8Array,
  ) => Promise<ExcelJS.Workbook>;
  await loadWorkbook(Buffer.from(arrayBuffer));
  return workbook.worksheets[0];
}

export type RawGrid = {
  headers: string[];
  rows: Array<{ raw: RawRow; rowNumber: number }>;
};

/**
 * Le a planilha inteira como registros, sem nenhuma nocao de fim de tabela.
 * O importador do fluxo NAO usa isto: ele precisa parar no subtotal para nao
 * tratar o resumo como pagamento. O conversor usa, porque o export bruto do
 * Conta Azul e uma tabela unica, sem blocos no rodape.
 */
export async function readRawGrid(
  fileName: string,
  arrayBuffer: ArrayBuffer,
): Promise<RawGrid> {
  if (fileName.split(".").pop()?.toLowerCase() === "csv") {
    const rows = parseCsvRows(arrayBuffer);
    return {
      headers: Object.keys(rows[0] ?? {}),
      // `skip_empty_lines` do csv-parse nao descarta uma linha so de separadores
      // (";;;;"), que vira um registro de campos vazios. Sem filtrar aqui, ela
      // viraria uma linha fantasma no conversor.
      rows: rows
        .map((raw, index) => ({ raw, rowNumber: index + 2 }))
        .filter(({ raw }) => Object.values(raw).some((value) => String(value ?? "").trim())),
    };
  }

  const worksheet = await loadFirstWorksheet(arrayBuffer);
  if (!worksheet) return { headers: [], rows: [] };

  const columnCount = Math.max(worksheet.columnCount, 1);
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: columnCount }, (_, index) =>
    String(cellValue(headerRow.getCell(index + 1).value)).trim(),
  );

  const rows: RawGrid["rows"] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const raw: RawRow = {};
    let hasValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellValue(row.getCell(index + 1).value);
      raw[header] = value;
      if (String(value ?? "").trim()) hasValue = true;
    });

    if (hasValue) rows.push({ raw, rowNumber });
  }

  return { headers, rows };
}
