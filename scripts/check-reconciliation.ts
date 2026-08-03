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
      {
        rowNumber: 4,
        raw: {
          "Tipo de Transação": "Compra",
          "Nome do Colaborador": "Arthur",
          "Nome do Estabelecimento": "Fornecedor lançado no período",
          "Valor (R$)": "-60,00",
          Data: "05/07/2026",
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
          "Data de competência": "30/06/2026",
        },
      },
      {
        rowNumber: 3,
        raw: {
          "Nome do fornecedor": "Fornecedor lançado no período",
          "Valor original da parcela (R$)": "60,00",
          "Data de competência": "06/07/2026",
        },
      },
      {
        rowNumber: 4,
        raw: {
          "Nome do fornecedor": "Lançamento antigo sem compra auditada",
          "Valor original da parcela (R$)": "999,00",
          "Data de competência": "15/06/2026",
        },
      },
    ],
  },
  internalHeaders,
);

assert.deepEqual(
  caju.rows.map(({ amount }) => amount),
  [125.5, 80, 60],
  "compras da CAJU devem usar valores absolutos como os lançamentos internos",
);

const result = reconcile({
  cajuFileName: "caju.csv",
  internalFileName: "interno.csv",
  caju: caju.rows,
  internal: internal.rows,
  fromDate: "2026-07-01",
});

assert.equal(result.totals.matched, 2, "notas lançadas antes e depois do corte devem conciliar");
assert.equal(result.totals.pending, 1, "somente a compra sem lançamento deve ficar pendente");
assert.equal(result.totals.pendingAmount, 80);
assert.equal(result.pending[0]?.merchant, "Fornecedor pendente");
assert.equal(result.outOfRange.internal, 2);
assert.equal(result.totals.unmatchedInternal, 0, "lançamentos antigos não devem poluir as sobras");

const repeatedAmountResult = reconcile({
  cajuFileName: "caju.csv",
  internalFileName: "interno.csv",
  caju: [
    { ...caju.rows[0], rowNumber: 10, amount: 60, date: "2026-04-25" },
    { ...caju.rows[0], rowNumber: 11, amount: 60, date: "2026-05-27" },
  ],
  internal: [{ ...internal.rows[0], rowNumber: 10, amount: 60, date: "2026-05-27" }],
  fromDate: null,
});

assert.equal(repeatedAmountResult.totals.matched, 1);
assert.equal(
  repeatedAmountResult.matched[0]?.caju.rowNumber,
  11,
  "entre compras do mesmo valor, o lançamento deve conciliar a compra mais próxima",
);
assert.equal(repeatedAmountResult.matched[0]?.dayGap, 0);
assert.equal(repeatedAmountResult.pending[0]?.rowNumber, 10);

console.log("Conciliação de notas validada.");
