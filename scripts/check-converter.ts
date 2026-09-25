/**
 * Exercita o conversor contra uma planilha sintetica ou um arquivo informado e confere que o arquivo
 * gerado volta pelo importador: converter e importar tem que concordar, senao
 * o usuario baixa um fluxo que o proprio sistema recusa.
 *
 * Uso: npm run check:converter -- [planilha-bruta] [saida.xlsx]
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildFlowWorkbook, convertRawFile } from "../src/lib/flow-converter";
import { parsePaymentFile } from "../src/lib/import-parser";
import type { WorkMatcher } from "../src/lib/cost-center";

/** Espelha as contas do seed, sem depender do banco. */
const works: WorkMatcher[] = [
  { id: "w-ediser", name: "EDISER", slug: "ediser", costCenterAliases: JSON.stringify(["EDISER"]) },
  { id: "w-recap", name: "RECAP", slug: "recap", costCenterAliases: JSON.stringify(["RECAP"]) },
  {
    id: "w-jeronimo",
    name: "JERONIMO",
    slug: "jeronimo",
    costCenterAliases: JSON.stringify([
      "JERONIMO",
      "Despesa Pessoal Jeronimo",
      "Despesa Pessoal Jeronimo DJ",
      "Jeronimo DJ",
    ]),
  },
];

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

async function main() {
  const [source, output] = process.argv.slice(2);
  const buffer = source ? await readFile(source) : Buffer.from([
    "Nome do fornecedor;Data de vencimento;Descricao;Valor original da parcela (R$);Categoria 1;Centro de Custo 1",
    "Fornecedor Alfa;10/08/2026;Material de teste;123,45;MATERIAL;EDISER",
    "Fornecedor Beta;11/08/2026;Servico de teste;200,10;SERVICO;RECAP",
    "Fornecedor Gama;12/08/2026;Despesa de teste;50,25;DESPESA;Despesa Pessoal Jeronimo",
  ].join("\n"));
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  const conversion = await convertRawFile(source?.split(/[/\\]/).pop() ?? "amostra.csv", arrayBuffer, works);
  if (!source) {
    assert.equal(conversion.validRows, 3);
    assert.equal(conversion.totalAmount, 373.8);
    assert.equal(conversion.accounts.length, 3);
  }

  console.log("=== CONVERSAO ===");
  console.log("arquivo sugerido :", conversion.suggestedFileName);
  console.log("dia do fluxo     :", conversion.flowDate);
  console.log("colunas faltando :", conversion.missingColumns);
  console.log(
    `linhas           : ${conversion.totalRows} lidas / ${conversion.validRows} validas / ${conversion.invalidRows} invalidas`,
  );
  console.log("total            :", brl(conversion.totalAmount));
  console.log("contas           :");
  for (const account of conversion.accounts) {
    console.log(
      `  - ${account.accountLabel.padEnd(24)} ${brl(account.computedAmount).padStart(14)}${account.isNewWork ? "  (conta nova)" : ""}`,
    );
  }

  const invalid = conversion.rows.filter((row) => row.errors.length > 0);
  if (invalid.length) {
    console.log("linhas invalidas :");
    for (const row of invalid.slice(0, 10)) {
      console.log(`  - L${row.rowNumber}: ${row.errors.join("; ")}`);
    }
  }

  // Um aporte por conta, so para exercitar o bloco APORTES.
  const aportes = conversion.accounts.map((account, index) => ({
    accountLabel: account.accountLabel,
    amount: index === 0 ? 50000 : 30000,
  }));

  const workbook = await buildFlowWorkbook(conversion, aportes);
  const target = output ?? (source ? conversion.suggestedFileName : undefined);
  if (target) writeFileSync(target, workbook);
  console.log("\ngerado           :", target ?? "em memoria", `(${workbook.byteLength} bytes)`);

  // A prova real: o arquivo gerado tem que passar pelo importador do fluxo.
  const arrayBufferOut = workbook.buffer.slice(
    workbook.byteOffset,
    workbook.byteOffset + workbook.byteLength,
  ) as ArrayBuffer;
  const preview = await parsePaymentFile(conversion.suggestedFileName, arrayBufferOut, works);

  console.log("\n=== REIMPORTACAO DO ARQUIVO GERADO ===");
  console.log("colunas faltando :", preview.missingColumns);
  console.log(
    `linhas           : ${preview.totalRows} lidas / ${preview.validRows} validas / ${preview.invalidRows} invalidas / ${preview.duplicateRows} duplicadas`,
  );
  console.log("total            :", brl(preview.totalAmount));
  console.log("aportes lidos    :");
  for (const contribution of preview.contributions) {
    console.log(
      `  - ${contribution.accountLabel.padEnd(24)} ${brl(contribution.amount).padStart(14)} -> ${contribution.workName}`,
    );
  }
  console.log("resumo conferido :");
  for (const check of preview.summaryChecks) {
    const diff = check.difference ?? 0;
    console.log(
      `  - ${check.accountLabel.padEnd(24)} planilha ${brl(check.sheetAmount ?? 0).padStart(14)} | linhas ${brl(check.computedAmount).padStart(14)} | dif ${brl(diff)}`,
    );
  }

  const badRows = preview.rows.filter((row) => row.errors.length > 0);
  if (badRows.length) {
    console.log("\nLINHAS RECUSADAS NA REIMPORTACAO:");
    for (const row of badRows.slice(0, 10)) {
      console.log(`  - L${row.rowNumber} ${row.supplierName}: ${row.errors.join("; ")}`);
    }
  }

  const ok =
    preview.missingColumns.length === 0 &&
    preview.validRows === conversion.validRows &&
    preview.invalidRows === 0 &&
    Math.abs(preview.totalAmount - conversion.totalAmount) < 0.01 &&
    preview.contributions.length === aportes.length &&
    preview.summaryChecks.every((check) => Math.abs(check.difference ?? 0) < 0.01);

  console.log(`\n${ok ? "OK: round-trip integro." : "FALHOU: round-trip divergiu."}`);
  if (!ok) process.exitCode = 1;
}

void main();
