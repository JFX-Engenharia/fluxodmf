/**
 * Conversor do export bruto "Visao Contas a Pagar" do Conta Azul para o modelo
 * refinado "FLUXO DE PAGAMENTOS JFX".
 *
 * O arquivo bruto NAO passa pelo importador como esta: os cabecalhos vem com
 * sufixos ("Categoria 1", "Centro de Custo 1", "Valor original da parcela
 * (R$)") que nao batem com nenhum alias, entao Fornecedor, Valor e Centro de
 * custo aparecem como colunas faltando e toda linha vira invalida. Converter
 * primeiro resolve isso, e o arquivo gerado volta pelo fluxo normal de
 * previa -> confirmacao.
 */

import ExcelJS from "exceljs";
import { canonicalAccountLabel, matchWork, normalizeName, type WorkMatcher } from "@/lib/cost-center";
import { buildUniqueKey, importDayIso } from "@/lib/import-parser";
import { UNDEFINED_MARKER, type MissingField } from "@/lib/missing-info";
import { brDate, findColumn, isoDate, parseDate, parseMoney, readRawGrid } from "@/lib/spreadsheet";

/** Colunas do export bruto. O primeiro alias e o nome que o Conta Azul usa. */
const sourceColumns = {
  supplierName: ["nome do fornecedor", "fornecedor", "nome fornecedor", "cliente fornecedor"],
  dueDate: ["data de vencimento", "vencimento", "data vencimento", "data"],
  description: ["descricao", "historico", "observacao"],
  amount: [
    "valor original da parcela (r$)",
    "valor original da parcela",
    "valor",
    "valor liquido",
  ],
  category: ["categoria 1", "categoria", "plano de contas"],
  costCenter: ["centro de custo 1", "centro de custo", "centro custo", "conta"],
};

/** Cabecalhos do modelo refinado, na ordem em que a planilha os espera. */
const OUTPUT_HEADERS = [
  "FORNECEDOR",
  "DATA",
  "DESCRIÇÃO",
  "VALOR",
  "CATEGORIA",
  "CENTRO DE CUSTO",
];

const MONEY_FORMAT = '_-"R$" * #,##0.00_-;-"R$" * #,##0.00_-;_-"R$" * "-"??_-;_-@_-';


export type ConvertedRow = {
  rowNumber: number;
  supplierName: string;
  /** ISO (aaaa-mm-dd); data da conversao quando a planilha nao trouxe data. */
  dueDate: string;
  description: string;
  amount: number;
  category: string;
  costCenter: string;
  /** Conta do resumo: o nome cadastrado quando reconhecida, senao o proprio rotulo. */
  accountLabel: string;
  isNewWork: boolean;
  /** SO o que impede virar compra: fornecedor, valor e duplicidade. */
  errors: string[];
  /** Campos que a planilha omitiu; espelha o parser, campo a campo. */
  undefinedFields: MissingField[];
};

export type ConvertedAccount = {
  accountLabel: string;
  computedAmount: number;
  isNewWork: boolean;
};

export type FlowConversion = {
  fileName: string;
  suggestedFileName: string;
  missingColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  totalAmount: number;
  /** Dia do fluxo (ISO): o maior vencimento entre as linhas validas. */
  flowDate: string | null;
  rows: ConvertedRow[];
  accounts: ConvertedAccount[];
};

export type AporteInput = { accountLabel: string; amount: number };

function suggestFileName(flowDate: Date | null) {
  if (!flowDate) return "FLUXO DE PAGAMENTOS JFX.xlsx";
  const day = String(flowDate.getUTCDate()).padStart(2, "0");
  const month = String(flowDate.getUTCMonth() + 1).padStart(2, "0");
  return `FLUXO DE PAGAMENTOS JFX DIA ${day}.${month}.${flowDate.getUTCFullYear()}.xlsx`;
}

export async function convertRawFile(
  fileName: string,
  arrayBuffer: ArrayBuffer,
  works: WorkMatcher[],
): Promise<FlowConversion> {
  const grid = await readRawGrid(fileName, arrayBuffer);
  const headers = grid.headers.filter(Boolean);

  const columns = {
    supplierName: findColumn(headers, sourceColumns.supplierName),
    dueDate: findColumn(headers, sourceColumns.dueDate),
    description: findColumn(headers, sourceColumns.description),
    amount: findColumn(headers, sourceColumns.amount),
    category: findColumn(headers, sourceColumns.category),
    costCenter: findColumn(headers, sourceColumns.costCenter),
  };

  const missingColumns = (
    [
      ["Fornecedor", columns.supplierName],
      ["Data de vencimento", columns.dueDate],
      ["Descricao", columns.description],
      ["Valor", columns.amount],
      ["Centro de custo", columns.costCenter],
    ] as const
  )
    .filter(([, found]) => !found)
    .map(([label]) => label);

  const seen = new Set<string>();
  // Mesma regra do parser, e pelo mesmo motivo: uma vez por arquivo, para o
  // lote inteiro receber o mesmo dia.
  const importDay = importDayIso();

  const rows: ConvertedRow[] = grid.rows.map(({ raw, rowNumber }) => {
    const errors: string[] = [];
    const undefinedFields: MissingField[] = [];
    const supplierName = String(raw[columns.supplierName ?? ""] ?? "").trim();
    const description = String(raw[columns.description ?? ""] ?? "").trim();
    const costCenter = String(raw[columns.costCenter ?? ""] ?? "").trim();
    const category = String(raw[columns.category ?? ""] ?? "").trim();
    const parsed = parseMoney(raw[columns.amount ?? ""]);
    const dueDate = parseDate(raw[columns.dueDate ?? ""]);

    // Arredonda uma vez, aqui: a celula da planilha, o resumo por conta e o
    // total tem que sair do mesmo numero, senao o resumo diverge da soma das
    // celulas ao lado dele.
    const amount = Number.isNaN(parsed) ? NaN : Number(parsed.toFixed(2));

    // Converter e importar tem que recusar exatamente as mesmas linhas — e o
    // contrato declarado no topo deste arquivo. Se so o parser afrouxasse, o
    // conversor viraria o novo ponto onde a compra some.
    if (!supplierName) errors.push("Fornecedor obrigatorio");
    // O importador recusa valor <= 0, entao converter uma linha assim so
    // empurraria o erro para a etapa seguinte.
    if (Number.isNaN(amount) || amount <= 0) errors.push("Valor invalido");

    if (!description) undefinedFields.push("description");
    if (!costCenter) undefinedFields.push("costCenter");
    if (!category) undefinedFields.push("category");
    if (!dueDate) undefinedFields.push("currentDueDate");

    const filledDescription = description || UNDEFINED_MARKER;
    const filledCostCenter = costCenter || UNDEFINED_MARKER;
    const currentDueDate = dueDate ? isoDate(dueDate) : importDay;
    const work = matchWork(filledCostCenter, works);

    /**
     * Mesma regra de duplicata da importacao, e pela mesma chave. O export
     * bruto repete lancamentos (parcelas identicas em linhas diferentes), e o
     * importador recusa a segunda; sem recusar aqui tambem, o arquivo gerado
     * sairia com uma linha que a importacao descarta e um resumo somando essa
     * linha — o sistema acusaria divergencia num arquivo que ele mesmo gerou.
     *
     * O sal das incompletas segue a MESMA formula do parser (arquivo + linha).
     * O hash absoluto difere entre as duas pontas, porque o nome do arquivo
     * muda do bruto para o gerado — o que precisa coincidir e a DECISAO: duas
     * incompletas parecidas tem linhas distintas nos dois arquivos, entao as
     * duas sobrevivem aqui e as duas sobrevivem la.
     */
    if (errors.length === 0) {
      const key = buildUniqueKey({
        supplierName,
        description: filledDescription,
        amount,
        currentDueDate,
        costCenter: filledCostCenter,
        incompleteSalt: undefinedFields.length
          ? `${normalizeName(fileName)}#${rowNumber}`
          : undefined,
      });
      if (seen.has(key)) errors.push("Duplicado dentro da planilha");
      seen.add(key);
    }

    return {
      rowNumber,
      supplierName,
      dueDate: currentDueDate,
      description: filledDescription,
      amount: Number.isNaN(amount) ? 0 : amount,
      category,
      costCenter: filledCostCenter,
      accountLabel: canonicalAccountLabel(work?.name ?? filledCostCenter),
      // Centro de custo CRU: a sentinela INDEFINIDO ja existe e nunca e
      // anunciada como conta nova.
      isNewWork: Boolean(costCenter) && !work,
      errors,
      undefinedFields,
    };
  });

  const validRows = rows.filter((row) => row.errors.length === 0);

  // Agrupa pelo rótulo canônico: contas por cidade podem formar uma única
  // linha na memória de cálculo sem deixar de ser obras distintas no cadastro.
  const grouped = new Map<string, ConvertedAccount>();
  for (const row of validRows) {
    const work = matchWork(row.costCenter, works);
    const accountLabel = canonicalAccountLabel(work?.name ?? row.costCenter);
    const key = normalizeName(accountLabel);
    const current = grouped.get(key);
    if (current) {
      current.computedAmount += row.amount;
    } else {
      grouped.set(key, {
        accountLabel,
        computedAmount: row.amount,
        isNewWork: row.isNewWork,
      });
    }
  }

  const accounts = [...grouped.values()].map((account) => ({
    ...account,
    computedAmount: Number(account.computedAmount.toFixed(2)),
  }));

  // So linhas com data REAL entram no nome do arquivo. Se as preenchidas com a
  // data da conversao contassem, uma planilha de vencimentos antigos com uma
  // linha sem data sairia batizada com o dia de hoje.
  const flowDate = validRows
    .filter((row) => !row.undefinedFields.includes("currentDueDate"))
    .reduce<Date | null>((latest, row) => {
      const date = new Date(`${row.dueDate}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) return latest;
      return !latest || date > latest ? date : latest;
    }, null);

  return {
    fileName,
    suggestedFileName: suggestFileName(flowDate),
    missingColumns,
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: rows.length - validRows.length,
    totalAmount: Number(validRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
    flowDate: flowDate ? isoDate(flowDate) : null,
    rows,
    accounts,
  };
}

function moneyCell(row: ExcelJS.Row, column: number, value: number) {
  const cell = row.getCell(column);
  // Ja vem arredondado da conversao; arredondar de novo aqui faria a celula
  // divergir do resumo, que soma os mesmos valores.
  cell.value = value;
  cell.numFmt = MONEY_FORMAT;
  return cell;
}

function subtotalCell(sheet: ExcelJS.Worksheet, rowNumber: number, from: number, to: number) {
  const cell = sheet.getRow(rowNumber).getCell(4);
  // Formula viva para quem abrir no Excel, com o resultado em cache para quem
  // ler o arquivo por fora (o proprio importador le o cache, nao recalcula).
  let total = 0;
  for (let current = from; current <= to; current++) {
    total += Number(sheet.getRow(current).getCell(4).value ?? 0);
  }
  cell.value = {
    formula: `SUBTOTAL(109,D${from}:D${to})`,
    result: Number(total.toFixed(2)),
    date1904: false,
  };
  cell.numFmt = MONEY_FORMAT;
}

/**
 * Monta o xlsx no layout do modelo refinado: linhas de pagamento, subtotal,
 * resumo por conta e o bloco APORTES. A ordem e os marcadores importam — e
 * exatamente assim que o importador sabe onde a tabela de pagamentos termina.
 */
export async function buildFlowWorkbook(conversion: FlowConversion, aportes: AporteInput[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Visão Contas a Pagar");

  sheet.columns = [
    { width: 44 },
    { width: 12 },
    { width: 62 },
    { width: 16 },
    { width: 40 },
    { width: 26 },
  ];

  const headerRow = sheet.getRow(1);
  OUTPUT_HEADERS.forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { bold: true };
  });
  headerRow.getCell(4).numFmt = MONEY_FORMAT;

  const validRows = conversion.rows.filter((row) => row.errors.length === 0);

  validRows.forEach((row, index) => {
    const sheetRow = sheet.getRow(index + 2);
    sheetRow.getCell(1).value = row.supplierName;
    sheetRow.getCell(2).value = row.dueDate ? brDate(new Date(`${row.dueDate}T00:00:00.000Z`)) : "";
    sheetRow.getCell(3).value = row.description;
    moneyCell(sheetRow, 4, row.amount);
    sheetRow.getCell(5).value = row.category;
    // O centro de custo sai como veio; quem normaliza para o nome da conta e o
    // resumo abaixo, igual ao modelo de referencia.
    sheetRow.getCell(6).value = row.costCenter;
  });

  const firstDataRow = 2;
  const lastDataRow = validRows.length + 1;
  const paymentsSubtotalRow = lastDataRow + 1;
  // Sem linhas, o intervalo sairia invertido (D2:D1) e o Excel o normalizaria
  // para D1:D2 — que inclui a propria celula do subtotal, virando referencia
  // circular. A rota ja barra a conversao vazia; isto e o cinto de seguranca.
  if (validRows.length > 0) {
    subtotalCell(sheet, paymentsSubtotalRow, firstDataRow, lastDataRow);
  }

  // Linha em branco separa os blocos: e ela que fecha a tabela de pagamentos.
  const summaryHeaderRow = paymentsSubtotalRow + 2;
  sheet.getRow(summaryHeaderRow).getCell(3).value = "CONTA";
  sheet.getRow(summaryHeaderRow).getCell(4).value = "VALOR";
  sheet.getRow(summaryHeaderRow).getCell(4).numFmt = MONEY_FORMAT;

  conversion.accounts.forEach((account, index) => {
    const sheetRow = sheet.getRow(summaryHeaderRow + 1 + index);
    sheetRow.getCell(3).value = account.accountLabel;
    moneyCell(sheetRow, 4, account.computedAmount);
  });

  const summarySubtotalRow = summaryHeaderRow + conversion.accounts.length + 1;
  if (conversion.accounts.length > 0) {
    subtotalCell(
      sheet,
      summarySubtotalRow,
      summaryHeaderRow + 1,
      summaryHeaderRow + conversion.accounts.length,
    );
  }

  // Aporte zerado nao vira linha: no modelo de referencia so as contas que
  // receberam dinheiro aparecem no bloco.
  const filledAportes = aportes.filter((aporte) => aporte.amount > 0);
  if (filledAportes.length > 0) {
    const aportesLabelRow = summarySubtotalRow + 2;
    sheet.getRow(aportesLabelRow).getCell(3).value = "APORTES";

    filledAportes.forEach((aporte, index) => {
      const sheetRow = sheet.getRow(aportesLabelRow + 1 + index);
      sheetRow.getCell(3).value = aporte.accountLabel;
      moneyCell(sheetRow, 4, aporte.amount);
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
