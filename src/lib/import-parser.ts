import crypto from "node:crypto";
import {
  canonicalAccountLabel,
  matchWork,
  normalizeName as normalize,
  UNDEFINED_WORK_NAME,
  type WorkMatcher,
} from "@/lib/cost-center";
import { UNDEFINED_MARKER, type MissingField } from "@/lib/missing-info";
import {
  cellValue,
  findColumn,
  isoDate,
  loadFirstWorksheet,
  parseCsvRows,
  parseDate,
  parseMoney,
  type RawRow,
} from "@/lib/spreadsheet";
import type {
  ImportContributionRow,
  ImportPreview,
  ImportSummaryCheck,
  PaymentImportRow,
} from "@/types";

/**
 * Colunas da planilha de fluxo: FORNECEDOR | DATA | DESCRICAO | VALOR |
 * CATEGORIA | CENTRO DE CUSTO. Os aliases mantem compatibilidade com exports
 * do Conta Azul, que nomeiam as mesmas colunas de outro jeito.
 */
const requiredColumns = {
  supplierName: ["fornecedor", "cliente fornecedor", "nome fornecedor", "supplier"],
  description: ["descricao", "historico", "observacao"],
  amount: ["valor", "valor liquido", "amount", "total"],
  dueDate: ["data", "vencimento", "data vencimento", "data de vencimento", "due date"],
  costCenter: ["centro de custo", "centro custo", "obra", "conta", "cost center"],
};

const optionalColumns = {
  category: ["categoria", "category", "plano de contas"],
  externalReference: ["referencia", "documento", "numero", "id"],
};

/** Rotulos que marcam o fim da tabela de pagamentos e o inicio dos blocos de resumo. */
const summaryHeaderLabels = ["conta", "valor", "status"];
const contributionSectionLabels = ["aportes", "aporte"];
const totalLabels = ["total", "subtotal", "total geral", "soma"];

/**
 * Identidade de um lancamento. Exportada porque o conversor precisa recusar as
 * mesmas duplicatas que a importacao recusaria: se as duas pontas discordarem,
 * o usuario baixa um fluxo que o proprio sistema rejeita.
 */
export function buildUniqueKey(input: {
  supplierName: string;
  description: string;
  amount: number;
  currentDueDate: string;
  costCenter: string;
  /**
   * So para linhas incompletas: "<arquivo>#<linha>".
   *
   * Uma linha incompleta NAO TEM identidade — foi justamente a identidade que a
   * planilha omitiu. Sem o sal, duas compras do mesmo fornecedor e valor, ambas
   * sem descricao, sem data e sem centro de custo, gerariam a mesma chave e a
   * segunda seria descartada como duplicata. Deduplicar ai e adivinhar, e o
   * custo do erro e silencioso: a compra some, que e exatamente o bug que esta
   * mudanca conserta. Duplicar e visivel e o operador resolve.
   *
   * Como o sal e o arquivo mais a linha, o MESMO arquivo reenviado (retry, F5)
   * continua produzindo as mesmas chaves e o worker segue reentrante. Risco
   * residual assumido: o mesmo conteudo com outro nome de arquivo
   * ("FLUXO (1).xlsx") duplica as incompletas — visivel na previa.
   *
   * Ausente nas linhas completas, e por isso toda chave ja gravada continua
   * valendo: o hash delas nao muda.
   */
  incompleteSalt?: string;
}) {
  const parts = [
    normalize(input.supplierName),
    normalize(input.description),
    input.amount.toFixed(2),
    input.currentDueDate,
    normalize(input.costCenter),
  ];

  if (input.incompleteSalt) parts.push("INCOMPLETO", input.incompleteSalt);

  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Dia da importacao (ISO) no fuso de Sao Paulo, que e o que o operador ve no
 * relogio. Vale como vencimento das compras que chegaram sem data.
 *
 * Exportado porque o conversor precisa do MESMO dia: as duas pontas preenchem o
 * mesmo buraco e nao podem divergir. Chamado UMA vez por arquivo, nunca por
 * linha — numa planilha grande processada na virada do dia, linhas do mesmo
 * lote ficariam com datas diferentes.
 */
export function importDayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

type SheetGrid = {
  headers: string[];
  /** Linhas da tabela de pagamentos, ja recortadas antes dos blocos de resumo. */
  paymentRows: Array<{ raw: RawRow; rowNumber: number }>;
  /** Linhas cruas do restante da planilha, para achar resumo e aportes. */
  trailing: Array<{ cells: string[]; rowNumber: number }>;
};

type PaymentColumnIndexes = {
  supplier: number;
  amount: number;
  description: number;
  costCenter: number;
};

/**
 * A planilha nao termina na ultima linha de pagamento: abaixo dela vem um
 * SUBTOTAL, um resumo por conta e o bloco APORTES. Tratar isso como pagamento
 * gera linhas invalidas, entao a leitura para no primeiro marcador de fim.
 *
 * "Duro" e a palavra que importa: so entra aqui o que de fato ENCERRA a tabela.
 * Linha em branco NAO entra — ela e um respiro no meio da planilha e antes
 * derrubava tudo abaixo dela em silencio.
 */
function isHardEndOfPayments(cells: string[], columnIndexes: PaymentColumnIndexes) {
  const supplier = normalize(cells[columnIndexes.supplier] ?? "");
  const description = normalize(cells[columnIndexes.description] ?? "");
  const costCenter = normalize(cells[columnIndexes.costCenter] ?? "");
  const amountCell = String(cells[columnIndexes.amount] ?? "").trim();
  const hasAmount = Boolean(amountCell) && !Number.isNaN(parseMoney(amountCell));

  // Rotulos escritos: TOTAL, SUBTOTAL, APORTES.
  if (totalLabels.includes(supplier)) return true;
  if (contributionSectionLabels.includes(supplier)) return true;

  // Cabecalho do resumo por conta (CONTA | VALOR | STATUS).
  const normalizedCells = cells.map(normalize).filter(Boolean);
  const looksLikeSummaryHeader =
    normalizedCells.length > 0 &&
    normalizedCells.every((cell) => summaryHeaderLabels.includes(cell));
  if (looksLikeSummaryHeader) return true;

  // SUBTOTAL do modelo que o proprio conversor gera (flow-converter.ts:296):
  // escreve so a celula de valor, com formula e sem texto nenhum, entao nenhum
  // rotulo casa com ele. Uma compra real tem ao menos fornecedor, descricao ou
  // centro de custo — e depois desta mudanca a que nao tem nada disso, mas tem
  // valor, continua sendo fim de tabela e nao compra incompleta.
  if (hasAmount && !supplier && !description && !costCenter) return true;

  return false;
}

async function parseWorkbook(arrayBuffer: ArrayBuffer): Promise<SheetGrid> {
  const worksheet = await loadFirstWorksheet(arrayBuffer);

  if (!worksheet) return { headers: [], paymentRows: [], trailing: [] };

  const columnCount = Math.max(worksheet.columnCount, 1);
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: columnCount }, (_, index) =>
    String(cellValue(headerRow.getCell(index + 1).value)).trim(),
  );

  const readCells = (rowNumber: number) =>
    Array.from({ length: columnCount }, (_, index) =>
      String(cellValue(worksheet.getRow(rowNumber).getCell(index + 1).value) ?? "").trim(),
    );

  // Posicoes do modelo refinado (FORNECEDOR | DATA | DESCRICAO | VALOR |
  // CATEGORIA | CENTRO DE CUSTO) como fallback, no mesmo espirito defensivo que
  // ja valia para fornecedor e valor: sem o cabecalho reconhecido, e melhor
  // olhar a coluna provavel do que tratar toda linha como fim de tabela.
  const supplierHeader = findColumn(headers, requiredColumns.supplierName);
  const amountHeader = findColumn(headers, requiredColumns.amount);
  const descriptionHeader = findColumn(headers, requiredColumns.description);
  const costCenterHeader = findColumn(headers, requiredColumns.costCenter);
  const columnIndexes: PaymentColumnIndexes = {
    supplier: supplierHeader ? headers.indexOf(supplierHeader) : 0,
    amount: amountHeader ? headers.indexOf(amountHeader) : 3,
    description: descriptionHeader ? headers.indexOf(descriptionHeader) : 2,
    costCenter: costCenterHeader ? headers.indexOf(costCenterHeader) : 5,
  };

  const paymentRows: SheetGrid["paymentRows"] = [];
  const trailing: SheetGrid["trailing"] = [];
  let inPayments = true;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const cells = readCells(rowNumber);

    // Linha em branco e pulada, nao encerra nada. Encerrar aqui era o que
    // apagava, sem aviso, tudo que viesse depois de um respiro no meio da
    // planilha: as compras nao viravam linha invalida nem entravam em
    // totalRows, simplesmente deixavam de existir. O bloco de resumo continua
    // sendo achado pelos marcadores duros, que e o que de fato o delimita.
    if (cells.every((cell) => !String(cell ?? "").trim())) continue;

    if (inPayments && isHardEndOfPayments(cells, columnIndexes)) {
      inPayments = false;
    }

    if (inPayments) {
      const raw: RawRow = {};
      headers.forEach((header, index) => {
        if (!header) return;
        raw[header] = cellValue(worksheet.getRow(rowNumber).getCell(index + 1).value);
      });
      paymentRows.push({ raw, rowNumber });
    } else {
      trailing.push({ cells, rowNumber });
    }
  }

  return { headers, paymentRows, trailing };
}

/**
 * Le o resumo por conta (CONTA | VALOR | STATUS) e o bloco APORTES que ficam
 * abaixo da tabela de pagamentos. O resumo nao e importado: serve so para
 * conferir contra a soma real das linhas.
 */
function parseTrailingBlocks(trailing: SheetGrid["trailing"], works: WorkMatcher[]) {
  const sheetSummary: Array<{ accountLabel: string; amount: number; status?: string }> = [];
  const contributions: ImportContributionRow[] = [];
  let section: "none" | "summary" | "contributions" = "none";

  for (const { cells, rowNumber } of trailing) {
    const filled = cells.map((cell) => String(cell ?? "").trim());
    const nonEmpty = filled.filter(Boolean);
    if (nonEmpty.length === 0) continue;

    const normalizedCells = filled.map(normalize).filter(Boolean);

    if (normalizedCells.some((cell) => contributionSectionLabels.includes(cell))) {
      section = "contributions";
      continue;
    }

    const isSummaryHeader =
      normalizedCells.length > 1 &&
      normalizedCells.every((cell) => summaryHeaderLabels.includes(cell));
    if (isSummaryHeader) {
      section = "summary";
      continue;
    }

    if (section === "none") continue;

    // Nos dois blocos o rotulo da conta e a primeira celula preenchida e o
    // valor e a primeira celula numerica depois dela.
    const labelIndex = filled.findIndex(Boolean);
    const label = filled[labelIndex] ?? "";
    if (!label) continue;
    if (totalLabels.includes(normalize(label))) continue;

    const amountCell = filled
      .slice(labelIndex + 1)
      .find((cell) => cell && !Number.isNaN(parseMoney(cell)));
    const amount = parseMoney(amountCell);
    if (!amountCell || Number.isNaN(amount)) continue;

    if (section === "summary") {
      const statusCell = filled.slice(labelIndex + 2).find(Boolean);
      sheetSummary.push({ accountLabel: label, amount, status: statusCell });
      continue;
    }

    const work = matchWork(label, works);
    contributions.push({
      rowNumber,
      accountLabel: label,
      amount,
      workId: work?.id,
      workName: work?.name ?? label,
      isNewWork: !work,
      errors: [],
    });
  }

  return { sheetSummary, contributions };
}

/**
 * Confronta o resumo escrito na planilha com a soma real das linhas de
 * pagamento. A planilha de referencia trazia o RECAP defasado em 2.032,03,
 * entao a divergencia e sinalizada em vez de silenciosamente aceita.
 */
function buildSummaryChecks(
  rows: PaymentImportRow[],
  sheetSummary: Array<{ accountLabel: string; amount: number; status?: string }>,
  works: WorkMatcher[],
): ImportSummaryCheck[] {
  /**
   * O resumo usa o mesmo rótulo canônico do conversor. Assim, contas distintas
   * por cidade podem ser conferidas como uma única linha na memória de cálculo.
   */
  const keyForLabel = (label: string) => normalize(canonicalAccountLabel(label));

  const computed = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const row of rows) {
    if (row.errors.length > 0) continue;
    if (!row.costCenter) continue;
    const label = row.workName ?? row.costCenter;
    const key = keyForLabel(label);
    computed.set(key, (computed.get(key) ?? 0) + row.amount);
    labels.set(key, canonicalAccountLabel(label));
  }

  const checks: ImportSummaryCheck[] = [];
  const seen = new Set<string>();

  for (const entry of sheetSummary) {
    const work = matchWork(entry.accountLabel, works);
    const key = keyForLabel(work?.name ?? entry.accountLabel);
    const computedAmount = computed.get(key) ?? 0;
    seen.add(key);

    checks.push({
      accountLabel: entry.accountLabel,
      workName: work?.name ?? labels.get(key),
      sheetAmount: entry.amount,
      computedAmount: Number(computedAmount.toFixed(2)),
      difference: Number((computedAmount - entry.amount).toFixed(2)),
      status: entry.status,
    });
  }

  // Contas que tem pagamentos mas nao aparecem no resumo da planilha.
  for (const [key, amount] of computed) {
    if (seen.has(key)) continue;
    checks.push({
      accountLabel: labels.get(key) ?? key,
      workName: labels.get(key),
      sheetAmount: null,
      computedAmount: Number(amount.toFixed(2)),
      difference: null,
    });
  }

  return checks;
}

async function readGrid(fileName: string, arrayBuffer: ArrayBuffer): Promise<SheetGrid> {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    const rows = parseCsvRows(arrayBuffer);
    return {
      headers: Object.keys(rows[0] ?? {}),
      paymentRows: rows.map((raw, index) => ({ raw, rowNumber: index + 2 })),
      trailing: [],
    };
  }

  return parseWorkbook(arrayBuffer);
}

export async function parsePaymentFile(
  fileName: string,
  arrayBuffer: ArrayBuffer,
  works: WorkMatcher[],
): Promise<ImportPreview> {
  const grid = await readGrid(fileName, arrayBuffer);
  const headers = grid.headers.filter(Boolean);

  const columns = {
    supplierName: findColumn(headers, requiredColumns.supplierName),
    description: findColumn(headers, requiredColumns.description),
    amount: findColumn(headers, requiredColumns.amount),
    dueDate: findColumn(headers, requiredColumns.dueDate),
    costCenter: findColumn(headers, requiredColumns.costCenter),
    category: findColumn(headers, optionalColumns.category),
    externalReference: findColumn(headers, optionalColumns.externalReference),
  };

  const missingColumns = (
    [
      ["Fornecedor", columns.supplierName],
      ["Data", columns.dueDate],
      ["Descricao", columns.description],
      ["Valor", columns.amount],
      ["Centro de custo", columns.costCenter],
    ] as const
  )
    .filter(([, found]) => !found)
    .map(([label]) => label);

  const seen = new Set<string>();
  // Uma vez por arquivo: a data de importacao tem que ser a mesma para todas as
  // linhas que chegaram sem data, e a previa precisa mostrar exatamente o dia
  // que sera gravado na confirmacao.
  const importDay = importDayIso();

  const rows: PaymentImportRow[] = grid.paymentRows.map(({ raw, rowNumber }) => {
    const errors: string[] = [];
    const undefinedFields: MissingField[] = [];
    const supplierName = String(raw[columns.supplierName ?? ""] ?? "").trim();
    const description = String(raw[columns.description ?? ""] ?? "").trim();
    const costCenter = String(raw[columns.costCenter ?? ""] ?? "").trim();
    const category = String(raw[columns.category ?? ""] ?? "").trim();
    const amount = parseMoney(raw[columns.amount ?? ""]);
    const dueDate = parseDate(raw[columns.dueDate ?? ""]);

    // So valor e fornecedor bloqueiam: sem eles nao ha compra identificavel.
    if (!supplierName) errors.push("Fornecedor obrigatorio");
    if (Number.isNaN(amount) || amount <= 0) errors.push("Valor invalido");

    // O resto entra marcado. Eram estes quatro campos que faziam a compra sumir
    // sem aviso, sendo que pagamento sem centro de custo e rotina aqui.
    if (!description) undefinedFields.push("description");
    if (!costCenter) undefinedFields.push("costCenter");
    if (!category) undefinedFields.push("category");
    if (!dueDate) undefinedFields.push("currentDueDate");

    // Os placeholders sao resolvidos AQUI, e nao no worker: a previa tem que
    // mostrar o valor exato que sera gravado, e a chave unica depende dele.
    // `category` fica sem marcador de proposito — ela ja era opcional e gravar
    // INDEFINIDO criaria um balde novo ao lado do historico do dashboard.
    const filledDescription = description || UNDEFINED_MARKER;
    const filledCostCenter = costCenter || UNDEFINED_MARKER;
    const currentDueDate = dueDate ? isoDate(dueDate) : importDay;
    const work = matchWork(filledCostCenter, works);

    const blocked = errors.length > 0;
    const key = blocked
      ? `invalid-${rowNumber}`
      : buildUniqueKey({
          supplierName,
          description: filledDescription,
          amount,
          currentDueDate,
          costCenter: filledCostCenter,
          incompleteSalt: undefinedFields.length
            ? `${normalize(fileName)}#${rowNumber}`
            : undefined,
        });

    const duplicate = seen.has(key);
    seen.add(key);

    if (duplicate) errors.push("Duplicado dentro da planilha");

    return {
      rowNumber,
      externalReference: String(raw[columns.externalReference ?? ""] ?? "").trim() || undefined,
      supplierName,
      description: filledDescription,
      amount: Number.isNaN(amount) ? 0 : amount,
      category,
      // Igual ao vencimento atual, senao o painel mostra "Original:" numa compra
      // que nunca foi remarcada.
      originalDueDate: currentDueDate,
      currentDueDate,
      costCenter: filledCostCenter,
      workId: work?.id,
      // Sem conta correspondente, o proprio nome da planilha vira a conta.
      workName: work?.name ?? filledCostCenter,
      // Compara com o centro de custo CRU: linha sem centro nenhum nunca promete
      // criar conta — ela cai na sentinela INDEFINIDO, que ja existe.
      isNewWork: Boolean(costCenter) && !work,
      uniqueKey: key,
      errors,
      undefinedFields,
      duplicate,
    };
  });

  const { sheetSummary, contributions } = parseTrailingBlocks(grid.trailing, works);
  const summaryChecks = buildSummaryChecks(rows, sheetSummary, works);
  const validRows = rows.filter((row) => row.errors.length === 0);

  /**
   * Nomes de conta que ainda nao existem, deduplicados por nome normalizado.
   * Vence a primeira grafia encontrada, que e a mesma regra da confirmacao
   * (quem cria a conta e a primeira linha daquele centro de custo). Assim a
   * previa promete o mesmo nome que sera criado de fato.
   */
  const newAccounts: string[] = [];
  const seenAccounts = new Set<string>();
  const sentinelKey = normalize(UNDEFINED_WORK_NAME);

  for (const row of [...validRows, ...contributions]) {
    if (!row.isNewWork) continue;
    const label = "costCenter" in row ? row.costCenter : row.accountLabel;
    const key = normalize(label);
    if (!key || seenAccounts.has(key)) continue;
    // A sentinela nunca e "conta nova": ela ja existe (criada na migration e
    // garantida em runtime). Sem esta guarda, o alerta da previa prometeria
    // criar a conta INDEFINIDO toda vez que a rota de origem consultasse so as
    // contas ativas e nao a enxergasse.
    if (key === sentinelKey) continue;
    seenAccounts.add(key);
    newAccounts.push(label);
  }

  return {
    fileName,
    missingColumns,
    newAccounts,
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: rows.filter((row) => row.errors.length > 0).length,
    // Subconjunto de validRows: elas SAO importaveis, so entram sinalizadas.
    incompleteRows: validRows.filter((row) => row.undefinedFields.length > 0).length,
    duplicateRows: rows.filter((row) => row.duplicate).length,
    totalAmount: Number(validRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
    rows,
    contributions,
    summaryChecks,
  };
}
