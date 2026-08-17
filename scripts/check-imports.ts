/**
 * Regressao das quatro falhas que faziam compras sumirem na importacao. Monta
 * a planilha em memoria (exceljs, ja e dependencia) para nao depender de
 * fixture no repo — check-converter.ts exige um arquivo bruto real que o
 * repositorio nao versiona, entao ele nao serve de porta de CI.
 *
 * Uso: npm run check:imports
 */

import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { WorkMatcher } from "../src/lib/cost-center";
import { UNDEFINED_MARKER } from "../src/lib/missing-info";
import { parsePaymentFile } from "../src/lib/import-parser";
import { confirmSchema, importableRowSchema } from "../src/lib/import-worker";

/** Espelha o seed, sem tocar no banco. */
const works: WorkMatcher[] = [
  { id: "w-ediser", name: "EDISER", slug: "ediser", costCenterAliases: JSON.stringify(["EDISER"]) },
  { id: "w-recap", name: "RECAP", slug: "recap", costCenterAliases: JSON.stringify(["RECAP"]) },
];

const HEADERS = ["Fornecedor", "Data", "Descricao", "Valor", "Categoria", "Centro de custo"];
type Cell = string | number;

async function sheetBuffer(rows: Cell[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Fluxo");
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

const completa = (fornecedor: string, valor: number): Cell[] => [
  fornecedor,
  "10/08/2026",
  `Compra ${fornecedor}`,
  valor,
  "MATERIAL",
  "EDISER",
];

/**
 * BUG B: uma linha em branco no meio da planilha encerrava a tabela e tudo
 * abaixo dela desaparecia — sem virar linha invalida e sem entrar em contagem
 * nenhuma. O rodape (SUBTOTAL / TOTAL / APORTES) precisa continuar encerrando.
 */
async function truncamento() {
  const preview = await parsePaymentFile(
    "fluxo.xlsx",
    await sheetBuffer([
      completa("ALFA", 100),
      [],
      completa("BETA", 200),
      completa("GAMA", 300),
      ["TOTAL", "", "", 600, "", ""],
      ["ALFA DEPOIS DO TOTAL", "10/08/2026", "nao e compra", 999, "", "EDISER"],
    ]),
    works,
  );

  const fornecedores = preview.rows.map((row) => row.supplierName);
  assert.deepEqual(fornecedores, ["ALFA", "BETA", "GAMA"], `resgatadas: ${fornecedores.join(", ")}`);
  assert.equal(preview.totalRows, 3);
  assert.equal(preview.validRows, 3);
  console.log("OK BUG B: linha em branco nao trunca; TOTAL ainda encerra a tabela.");
}

/**
 * O pedido do usuario: informacao faltante entra com marcador em vez de sumir.
 * So fornecedor e valor bloqueiam.
 */
async function incompletas() {
  const preview = await parsePaymentFile(
    "fluxo.xlsx",
    await sheetBuffer([
      completa("ALFA", 100),
      ["BETA", "10/08/2026", "sem centro de custo", 200, "MATERIAL", ""],
      ["GAMA", "10/08/2026", "", 300, "MATERIAL", "EDISER"],
      ["DELTA", "", "sem data", 400, "MATERIAL", "EDISER"],
      ["", "10/08/2026", "sem fornecedor", 500, "MATERIAL", "EDISER"],
      ["EPSILON", "10/08/2026", "sem valor", "", "MATERIAL", "EDISER"],
    ]),
    works,
  );

  const por = (nome: string) => preview.rows.find((row) => row.supplierName === nome);

  assert.equal(por("BETA")?.costCenter, UNDEFINED_MARKER);
  assert.deepEqual(por("BETA")?.undefinedFields, ["costCenter"]);
  assert.equal(por("BETA")?.errors.length, 0, "centro de custo faltando nao pode bloquear");

  assert.equal(por("GAMA")?.description, UNDEFINED_MARKER);
  assert.deepEqual(por("GAMA")?.undefinedFields, ["description"]);

  assert.ok(por("DELTA")?.currentDueDate, "sem data deve receber a data da importacao");
  assert.ok(por("DELTA")?.undefinedFields.includes("currentDueDate"));

  // Os dois unicos bloqueantes.
  assert.ok((por("EPSILON")?.errors.length ?? 0) > 0, "sem valor tem que bloquear");
  const semFornecedor = preview.rows.find((row) => !row.supplierName);
  assert.ok((semFornecedor?.errors.length ?? 0) > 0, "sem fornecedor tem que bloquear");

  assert.equal(preview.validRows, 4, `validRows=${preview.validRows}`);
  assert.equal(preview.incompleteRows, 3, `incompleteRows=${preview.incompleteRows}`);
  assert.ok(!preview.newAccounts.includes(UNDEFINED_MARKER), "sentinela nao e conta nova");
  console.log("OK incompletas: so fornecedor e valor bloqueiam; o resto entra marcado.");
}

/**
 * BUG C: duas incompletas equivalentes nao podem ser confundidas entre si, e
 * reprocessar o mesmo arquivo tem que devolver as mesmas chaves (idempotencia).
 */
async function chaves() {
  const linhas: Cell[][] = [
    ["ALFA", "10/08/2026", "", 100, "", ""],
    ["ALFA", "10/08/2026", "", 100, "", ""],
  ];

  const preview = await parsePaymentFile("fluxo.xlsx", await sheetBuffer(linhas), works);
  const [a, b] = preview.rows;
  assert.notEqual(a.uniqueKey, b.uniqueKey, "incompletas equivalentes nao sao duplicata");
  assert.equal(preview.validRows, 2, "as duas tem que entrar");
  assert.equal(preview.duplicateRows, 0);

  const repetido = await parsePaymentFile("fluxo.xlsx", await sheetBuffer(linhas), works);
  assert.deepEqual(
    repetido.rows.map((row) => row.uniqueKey),
    preview.rows.map((row) => row.uniqueKey),
    "mesmo arquivo tem que gerar as mesmas chaves",
  );

  const outroArquivo = await parsePaymentFile("outro.xlsx", await sheetBuffer(linhas), works);
  assert.notEqual(
    outroArquivo.rows[0].uniqueKey,
    preview.rows[0].uniqueKey,
    "planilhas diferentes nao podem colidir",
  );
  console.log("OK BUG C: sem falso duplicado, sem colisao entre planilhas, idempotente.");
}

/**
 * BUG A: o confirm validava com o schema estrito ANTES de filtrar, e o cliente
 * manda todas as linhas. Uma unica linha bloqueada derrubava a importacao
 * inteira com 400, enquanto o botao dizia "Importar N linha(s)". O schema de
 * fio tem que aceitar a linha bloqueada; o estrito so roda no que vai gravar.
 */
async function confirmToleraBloqueada() {
  const preview = await parsePaymentFile(
    "fluxo.xlsx",
    await sheetBuffer([
      completa("ALFA", 100),
      ["", "10/08/2026", "sem fornecedor", 500, "MATERIAL", "EDISER"],
    ]),
    works,
  );

  const body = confirmSchema.parse({
    fileName: preview.fileName,
    importName: "lote de teste",
    totalRows: preview.totalRows,
    rows: preview.rows,
    contributions: preview.contributions,
  });

  const importaveis = body.rows.filter((row) => row.errors.length === 0 && !row.duplicate);
  assert.equal(importaveis.length, 1, "a linha boa tem que sobreviver ao filtro");
  z.array(importableRowSchema).parse(importaveis);
  console.log("OK BUG A: linha bloqueada nao derruba o lote; a boa passa no schema estrito.");
}

async function main() {
  await truncamento();
  await incompletas();
  await chaves();
  await confirmToleraBloqueada();
  console.log("check:imports OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
