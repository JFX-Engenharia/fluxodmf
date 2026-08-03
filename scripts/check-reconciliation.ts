import assert from "node:assert/strict";
import {
  parseCajuRows,
  parseInternalRows,
  reconcile,
} from "../src/lib/reconciliation";

const cajuHeaders = [
  "Tipo de Transação",
  "Nome do Colaborador",
  "Nome do Estabelecimento",
  "Valor (R$)",
  "Data",
  "Status da Transação",
];
const internalHeaders = [
  "Nome do fornecedor",
  "Valor original da parcela (R$)",
  "Data de competência",
];

const caju = parseCajuRows(
  {
    headers: cajuHeaders,
    rows: [
      {
        rowNumber: 2,
        raw: {
          "Tipo de Transação": "Compra",
          "Nome do Colaborador": "Arthur",
          "Nome do Estabelecimento": "Fornecedor lançado",
          "Valor (R$)": "-125,50",
          Data: "01/07/2026",
          "Status da Transação": "Aprovada",
        },
      },
      {
        rowNumber: 3,
        raw: {
          "Tipo de Transação": "Compra",
          "Nome do Colaborador": "Arthur",
          "Nome do Estabelecimento": "Fornecedor pendente",
          "Valor (R$)": "-80,00",
          Data: "03/07/2026",
          "Status da Transação": "Aprovada",
        },
      },
    ],
  },
  cajuHeaders,
);
const internal = parseInternalRows(
  {
    headers: internalHeaders,
    rows: [
      {
        rowNumber: 2,
        raw: {
          "Nome do fornecedor": "Fornecedor lançado",
          "Valor original da parcela (R$)": "125,50",
          "Data de competência": "02/07/2026",
        },
      },
    ],
  },
  internalHeaders,
);

assert.deepEqual(
  caju.rows.map(({ amount }) => amount),
  [125.5, 80],
  "compras da CAJU devem usar valores absolutos como os lançamentos internos",
);

const result = reconcile({
  cajuFileName: "caju.csv",
  internalFileName: "interno.csv",
  caju: caju.rows,
  internal: internal.rows,
  fromDate: null,
});

assert.equal(result.totals.matched, 1, "a nota já lançada deve ser conciliada");
assert.equal(result.totals.pending, 1, "somente a compra sem lançamento deve ficar pendente");
assert.equal(result.totals.pendingAmount, 80);
assert.equal(result.pending[0]?.merchant, "Fornecedor pendente");
assert.equal(result.totals.unmatchedInternal, 0);

console.log("Conciliação de notas validada.");
