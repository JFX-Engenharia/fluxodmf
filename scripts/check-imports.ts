/**
 * Regressao das quatro falhas que faziam compras sumirem na importacao. Monta
 * a planilha em memoria (exceljs, ja e dependencia) para nao depender de
 * fixture no repo.
 *
 * Uso: npm run check:imports
 */

import assert from "node:assert/strict";
import Module from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import ExcelJS from "exceljs";
import { z } from "zod";
import { ImportStatus, Role, UserStatus } from "../generated/prisma/enums";
import type { WorkMatcher } from "../src/lib/cost-center";
import { UNDEFINED_MARKER } from "../src/lib/missing-info";
import { importDayIso, parsePaymentFile } from "../src/lib/import-parser";
import { canonicalRow, confirmSchema, importableRowSchema, processImportTask } from "../src/lib/import-worker";

// Mesmo adaptador de cookies de check:notas: as rotas, sessoes e banco sao reais.
let sessionToken: string | null = null;
const loader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;
loader._load = function (request, parent, isMain) {
  if (request !== "next/headers") return originalLoad.call(this, request, parent, isMain);
  return {
    cookies: async () => ({
      get: (name: string) => name === "fluxo_session" && sessionToken
        ? { name, value: sessionToken }
        : undefined,
    }),
  };
};

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
 * So valor bloqueia.
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

  // O unico bloqueante.
  assert.ok((por("EPSILON")?.errors.length ?? 0) > 0, "sem valor tem que bloquear");
  const semFornecedor = por(UNDEFINED_MARKER);
  assert.equal(semFornecedor?.errors.length, 0, "sem fornecedor nao pode bloquear");
  assert.ok(semFornecedor?.undefinedFields.includes("supplier"));
  assert.equal(semFornecedor?.supplierName, UNDEFINED_MARKER);

  assert.equal(preview.validRows, 5, `validRows=${preview.validRows}`);
  assert.equal(preview.incompleteRows, 4, `incompleteRows=${preview.incompleteRows}`);
  assert.ok(!preview.newAccounts.includes(UNDEFINED_MARKER), "sentinela nao e conta nova");
  console.log("OK incompletas: so valor bloqueia; o resto entra marcado.");
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
 * fio tem que aceitar linhas incompletas; o estrito roda no que vai gravar.
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
  assert.equal(importaveis.length, 2, "as duas linhas tem que sobreviver ao filtro");
  z.array(importableRowSchema).parse(importaveis);
  console.log("OK BUG A: linha sem fornecedor entra marcada e ambas passam no schema estrito.");
}

async function identidadeCanonica() {
  const preview = await parsePaymentFile("fluxo.xlsx", await sheetBuffer([
    completa("ALFA", 100),
    ["ALFA", "10/08/2026", "", 200, "", ""],
    ["BETA", "", "sem data", 300, "MATERIAL", "EDISER"],
  ]), works);
  for (const row of preview.rows) {
    assert.equal(canonicalRow(importableRowSchema.parse(row), preview.fileName).uniqueKey, row.uniqueKey);
  }
  const complete = importableRowSchema.parse(preview.rows[0]);
  const forged = canonicalRow({
    ...complete,
    uniqueKey: "adulterada",
    undefinedFields: ["supplier", "description", "costCenter", "category", "currentDueDate"],
  }, preview.fileName, "2026-08-11");
  assert.deepEqual(forged.undefinedFields, []);
  assert.equal(forged.uniqueKey, complete.uniqueKey);

  const incomplete = importableRowSchema.parse(preview.rows[1]);
  assert.deepEqual(canonicalRow({ ...incomplete, supplierName: UNDEFINED_MARKER, undefinedFields: [] }, preview.fileName).undefinedFields,
    ["supplier", "description", "costCenter", "category"]);
  const missingDate = importableRowSchema.parse(preview.rows[2]);
  assert.ok(canonicalRow(missingDate, preview.fileName, importDayIso()).undefinedFields.includes("currentDueDate"));
  assert.ok(!canonicalRow(missingDate, preview.fileName, "2000-01-01").undefinedFields.includes("currentDueDate"));
  console.log("OK: identidade canonica preserva o parser e reconstrui campos ausentes.");
}

async function confirmNoServidor() {
  const { prisma } = await import("../src/lib/db");
  const { createSessionToken } = await import("../src/lib/auth");
  const { POST } = await import("../src/app/api/imports/confirm/route");
  const suffix = `check-imports-${Date.now()}`;
  const user = await prisma.user.create({ data: {
    name: suffix, username: suffix, email: `${suffix}@local.test`,
    passwordHash: "teste", role: Role.OPERADOR, status: UserStatus.ATIVO,
  } });
  let workId: string | undefined;
  try {
    const work = await prisma.work.create({ data: { name: suffix, slug: suffix } });
    workId = work.id;
    sessionToken = await createSessionToken({ ...user, provider: "local" },
      { ipAddress: "127.0.0.1", userAgent: "check-imports", device: "script" });
    const preview = await parsePaymentFile("confirm.xlsx", await sheetBuffer([
      [suffix, "01/01/2000", "Compra teste", 123.45, "MATERIAL", work.name],
    ]), [work]);
    const row = preview.rows[0];
    const payload = { fileName: preview.fileName, totalRows: 1, rows: [row], contributions: [] };
    let requestNumber = 0;
    const confirm = (body: unknown) => POST(new Request("https://fluxo.local/api/imports/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${suffix}-${++requestNumber}` },
      body: JSON.stringify(body),
    }));

    async function waitForBatch(id: string) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id } });
        assert.notEqual(batch.status, ImportStatus.FALHOU, batch.error);
        if (batch.status === ImportStatus.CONFIRMADO && await prisma.auditLog.count({
          where: { actorId: user.id, entityId: id, event: "IMPORT_CONFIRM" },
        })) return batch;
        await delay(50);
      }
      throw new Error(`Importacao ${id} nao terminou dentro do prazo.`);
    }

    const tampered = { ...row, uniqueKey: "adulterada", undefinedFields: [
      "supplier", "description", "costCenter", "category", "currentDueDate",
    ] };
    const first = await confirm({ ...payload, totalRows: 2, rows: [
      tampered, { ...tampered, rowNumber: row.rowNumber + 1, uniqueKey: "outra-chave" },
    ] });
    assert.equal(first.status, 202, JSON.stringify(await first.clone().json()));
    const batch = await waitForBatch((await first.json()).taskId);
    assert.equal(batch.validRows, 1, "duplicatas do payload devem ser removidas no servidor");
    assert.equal(batch.invalidRows, 1);
    const payments = await prisma.payment.findMany({ where: { importBatchId: batch.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].uniqueKey, row.uniqueKey, "chave completa nao leva sal forjado");
    assert.equal(payments[0].missingInfo, "[]", "campos completos nao podem ser marcados como ausentes");

    const repeated = await confirm({ ...payload, rows: [{ ...tampered, uniqueKey: "mais-uma-chave" }] });
    assert.equal(repeated.status, 409);
    assert.match((await repeated.json()).error, /já foram importadas/);
    assert.equal(await prisma.payment.count({ where: { createdById: user.id } }), 1);

    // Um lote anterior ao deploy continua processavel sem numero de linha.
    const legacyRow: Partial<typeof row> = { ...row, uniqueKey: `${suffix}-legacy` };
    delete legacyRow.rowNumber;
    const legacyBatch = await prisma.importBatch.create({ data: {
      status: ImportStatus.PENDENTE, fileName: suffix, sourceFileName: preview.fileName,
      flowName: suffix, totalRows: 1, validRows: 1, invalidRows: 0, importedById: user.id,
      payload: JSON.stringify({ rows: [legacyRow], contributions: [] }),
    } });
    await processImportTask(legacyBatch.id);
    assert.equal((await waitForBatch(legacyBatch.id)).importedRows, 1);
    console.log("OK: confirm recusa chave adulterada, deduplica o payload e aceita lotes antigos.");
  } finally {
    sessionToken = null;
    await prisma.payment.deleteMany({ where: { createdById: user.id } });
    await prisma.importBatch.deleteMany({ where: { importedById: user.id } });
    await prisma.idempotencyKey.deleteMany({ where: { actorId: user.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    if (workId) await prisma.work.delete({ where: { id: workId } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    loader._load = originalLoad;
  }
}

async function main() {
  await truncamento();
  await incompletas();
  await chaves();
  await confirmToleraBloqueada();
  await identidadeCanonica();
  await confirmNoServidor();
  console.log("check:imports OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
