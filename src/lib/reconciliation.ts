/**
 * Conciliacao entre o extrato do cartao CAJU e o extrato do colaborador no
 * sistema financeiro interno (export "Visao Contas a Pagar" do Conta Azul).
 *
 * A pergunta que isto responde: quais compras do cartao ainda NAO viraram
 * lancamento no sistema interno? Essas sao as que estao com nota fiscal
 * pendente, e sao as que precisam ser cobradas do colaborador.
 *
 * Por que cruzar em vez de ler a coluna "Comprovante Anexado" do CAJU: no
 * extrato real ela vem "Nao" em todas as compras, porque o colaborador nao
 * anexa a foto no proprio CAJU — ele manda por fora e alguem lanca no sistema
 * interno. Quem sabe se a nota chegou e o sistema interno, nao o CAJU.
 */

import { normalizeName } from "@/lib/cost-center";
import { findColumn, isoDate, parseDate, parseMoney, readRawGrid } from "@/lib/spreadsheet";

/** Colunas do extrato CAJU ("Extrato geral de despesas"). */
const cajuColumns = {
  advance: ["nome do adiantamento", "adiantamento"],
  collaborator: ["nome do colaborador", "colaborador"],
  type: ["tipo de transacao", "tipo de transação", "tipo"],
  merchant: ["nome do estabelecimento", "estabelecimento"],
  amount: ["valor (r$)", "valor"],
  date: ["data", "data da transacao"],
  transactionStatus: ["status da transacao", "status da transação"],
  reviewStatus: ["status de analise", "status de análise"],
  receipt: ["comprovante anexado", "comprovante"],
  category: ["categoria do estabelecimento", "categoria"],
  description: ["descricao", "descrição"],
};

/** Colunas do extrato interno (mesmo export do Conta Azul). */
const internalColumns = {
  supplierName: ["nome do fornecedor", "fornecedor"],
  competenceDate: ["data de competencia", "data de competência"],
  dueDate: ["data de vencimento", "vencimento"],
  description: ["descricao", "descrição", "historico"],
  amount: ["valor original da parcela (r$)", "valor original da parcela", "valor"],
  costCenter: ["centro de custo 1", "centro de custo"],
  bankAccount: ["conta bancaria", "conta bancária"],
};

/**
 * So "Compra" e despesa. Deposito e a empresa colocando dinheiro no cartao,
 * estorno e devolucao e resgate e a empresa puxando o saldo de volta — nenhum
 * deles gera nota fiscal para cobrar. A regra e lista branca: um tipo novo que
 * a CAJU invente fica de fora e aparece no relatorio de ignorados.
 */
const PURCHASE_TYPE = "compra";

/**
 * Status de transacao da CAJU em que a compra NAO virou despesa: foi estornada,
 * cancelada, negada ou recusada, entao o valor voltou e nao existe nota fiscal
 * a cobrar. Ate aqui a conciliacao olhava so o tipo ("Compra") e ignorava o
 * status, contando cada estorno como uma compra — nos dados reais isso jogava
 * dezenas de estornos na lista de pendentes e mandava cobrar nota de gasto que
 * nunca se concretizou. Assim como os tipos que nao sao compra, esses lancamentos
 * nao somem: vao para o relatorio de ignorados, agrupados pelo status.
 */
const NON_EXPENSE_STATUSES = new Set([
  "estornada",
  "estornado",
  "cancelada",
  "cancelado",
  "negada",
  "negado",
  "recusada",
  "recusado",
  "reprovada",
  "reprovado",
]);

/**
 * Janela para casar uma compra com o lancamento interno. O lancamento e feito
 * a mao dias depois (nos dados reais houve diferenca de ate uma semana), entao
 * a data sozinha nao identifica nada — quem identifica e o valor exato, em
 * centavos. A janela existe so para nao casar coincidencias distantes.
 */
const MATCH_WINDOW_DAYS = 60;

const DAY_MS = 86_400_000;

export type CajuTransaction = {
  rowNumber: number;
  advance: string;
  collaborator: string;
  type: string;
  merchant: string;
  amount: number;
  date: string;
  transactionStatus: string;
  reviewStatus: string;
  hasReceipt: string;
  category: string;
  description: string;
};

export type InternalEntry = {
  rowNumber: number;
  supplierName: string;
  description: string;
  amount: number;
  date: string;
  costCenter: string;
  bankAccount: string;
};

export type MatchedPair = {
  caju: CajuTransaction;
  internal: InternalEntry;
  /** Dias entre a compra e o lancamento. Gap alto merece um olhar humano. */
  dayGap: number;
};

export type IgnoredGroup = { type: string; count: number; amount: number };

export type ReconciliationResult = {
  cajuFileName: string;
  internalFileName: string;
  fromDate: string | null;
  /** Para o usuario conferir que pareou os arquivos do mesmo colaborador. */
  collaborators: string[];
  bankAccounts: string[];
  ignored: IgnoredGroup[];
  outOfRange: { caju: number; internal: number };
  totals: {
    cajuPurchases: number;
    internalEntries: number;
    matched: number;
    pending: number;
    pendingAmount: number;
    unmatchedInternal: number;
    unmatchedInternalAmount: number;
  };
  pending: CajuTransaction[];
  matched: MatchedPair[];
  unmatchedInternal: InternalEntry[];
};

/** "23-12-2025 16:48:56" -> Date. parseDate sozinho nao aceita a hora junto. */
function parseDateTime(value: unknown) {
  if (value instanceof Date) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  return parseDate(text.split(/[\sT]/)[0]) ?? parseDate(text);
}

/** Nomes de coluna como o usuario os ve na planilha, para as mensagens de erro. */
const columnLabels: Record<string, string> = {
  type: "Tipo de Transação",
  collaborator: "Nome do Colaborador",
  amount: "Valor",
  date: "Data",
  supplierName: "Nome do fornecedor",
  competenceDate: "Data de competência (ou Data de vencimento)",
};

function missing(headers: string[], columns: Record<string, string[]>, required: string[]) {
  return required
    .filter((key) => !findColumn(headers, columns[key]))
    .map((key) => columnLabels[key] ?? key);
}

/** A data do lancamento interno pode vir como competencia ou como vencimento. */
function hasInternalDate(headers: string[]) {
  return Boolean(
    findColumn(headers, internalColumns.competenceDate) ||
      findColumn(headers, internalColumns.dueDate),
  );
}

/**
 * Identifica o arquivo pelos cabecalhos, para a ordem do upload nao importar.
 *
 * A data entra na identificacao do interno de proposito: sem ela o cruzamento
 * nao tem como funcionar, e "Fornecedor + Valor" sozinhos sao genericos demais
 * — a propria planilha de FLUXO DE PAGAMENTOS tem as duas colunas e seria
 * confundida com um extrato do Conta Azul.
 */
export function identifyStatement(headers: string[]): "caju" | "internal" | "unknown" {
  if (findColumn(headers, cajuColumns.type) && findColumn(headers, cajuColumns.collaborator)) {
    return "caju";
  }
  if (
    findColumn(headers, internalColumns.amount) &&
    findColumn(headers, internalColumns.supplierName) &&
    hasInternalDate(headers)
  ) {
    return "internal";
  }
  return "unknown";
}

export async function readStatement(fileName: string, arrayBuffer: ArrayBuffer) {
  const grid = await readRawGrid(fileName, arrayBuffer);
  const headers = grid.headers.filter(Boolean);
  return { grid, headers, kind: identifyStatement(headers) };
}

export function parseCajuRows(
  grid: Awaited<ReturnType<typeof readRawGrid>>,
  headers: string[],
): { rows: CajuTransaction[]; missingColumns: string[] } {
  const missingColumns = missing(headers, cajuColumns, ["type", "amount", "date"]);
  if (missingColumns.length) return { rows: [], missingColumns };

  const pick = (key: keyof typeof cajuColumns) => findColumn(headers, cajuColumns[key]) ?? "";
  const columns = {
    advance: pick("advance"),
    collaborator: pick("collaborator"),
    type: pick("type"),
    merchant: pick("merchant"),
    amount: pick("amount"),
    date: pick("date"),
    transactionStatus: pick("transactionStatus"),
    reviewStatus: pick("reviewStatus"),
    receipt: pick("receipt"),
    category: pick("category"),
    description: pick("description"),
  };

  const rows = grid.rows.map(({ raw, rowNumber }) => {
    const date = parseDateTime(raw[columns.date]);
    const amount = parseMoney(raw[columns.amount]);

    return {
      rowNumber,
      advance: String(raw[columns.advance] ?? "").trim(),
      collaborator: String(raw[columns.collaborator] ?? "").trim(),
      type: String(raw[columns.type] ?? "").trim(),
      merchant: String(raw[columns.merchant] ?? "").trim(),
      amount: Number.isNaN(amount) ? 0 : Number(Math.abs(amount).toFixed(2)),
      date: date ? isoDate(date) : "",
      transactionStatus: String(raw[columns.transactionStatus] ?? "").trim(),
      reviewStatus: String(raw[columns.reviewStatus] ?? "").trim(),
      hasReceipt: String(raw[columns.receipt] ?? "").trim(),
      category: String(raw[columns.category] ?? "").trim(),
      description: String(raw[columns.description] ?? "").trim(),
    };
  });

  return { rows, missingColumns: [] };
}

export function parseInternalRows(
  grid: Awaited<ReturnType<typeof readRawGrid>>,
  headers: string[],
): { rows: InternalEntry[]; missingColumns: string[] } {
  const missingColumns = missing(headers, internalColumns, ["amount"]);
  /**
   * Sem data nao ha conciliacao possivel. Isto precisa ser erro, e nao um
   * arquivo lido com todas as datas vazias: nesse caso nenhum par cairia na
   * janela e TODAS as compras sairiam como pendentes — cobranca em cima de
   * colaborador inocente, sem nada na tela indicando que faltou uma coluna.
   */
  if (!hasInternalDate(headers)) {
    missingColumns.push(columnLabels.competenceDate);
  }
  if (missingColumns.length) return { rows: [], missingColumns };

  const pick = (key: keyof typeof internalColumns) =>
    findColumn(headers, internalColumns[key]) ?? "";
  const columns = {
    supplierName: pick("supplierName"),
    competenceDate: pick("competenceDate"),
    dueDate: pick("dueDate"),
    description: pick("description"),
    amount: pick("amount"),
    costCenter: pick("costCenter"),
    bankAccount: pick("bankAccount"),
  };

  const rows = grid.rows.map(({ raw, rowNumber }) => {
    // Competencia e o dia em que a despesa aconteceu, que e o que corresponde a
    // data da compra no cartao. Vencimento e quando a fatura cai.
    const date =
      parseDateTime(raw[columns.competenceDate]) ?? parseDateTime(raw[columns.dueDate]);
    const amount = parseMoney(raw[columns.amount]);

    return {
      rowNumber,
      supplierName: String(raw[columns.supplierName] ?? "").trim(),
      description: String(raw[columns.description] ?? "").trim(),
      amount: Number.isNaN(amount) ? 0 : Number(Math.abs(amount).toFixed(2)),
      date: date ? isoDate(date) : "",
      costCenter: String(raw[columns.costCenter] ?? "").trim(),
      bankAccount: String(raw[columns.bankAccount] ?? "").trim(),
    };
  });

  return { rows, missingColumns: [] };
}

function dayGap(a: string, b: string) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = new Date(`${a}T00:00:00.000Z`).getTime();
  const right = new Date(`${b}T00:00:00.000Z`).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(left - right) / DAY_MS);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * Casamento MAXIMO entre compras e lancamentos de um mesmo valor.
 *
 * O caminho obvio — montar todos os pares, ordenar pelo gap e ir consumindo —
 * parece razoavel e esta errado: um par de gap baixo pode consumir o unico
 * lancamento que estava dentro da janela de OUTRA compra, e essa compra vira
 * pendente sem ser. Esse e o pior erro possivel aqui, porque manda cobrar do
 * colaborador uma nota que ele ja entregou (e ainda acusa o lancamento dele de
 * sobrando). Casos reais aparecem quando uma nota atrasada e lancada bem perto
 * de uma compra recorrente de mesmo valor: combustivel, pedagio, refeicao.
 *
 * Como so compras de valor identico competem entre si, cada grupo e minusculo
 * e da para fazer o casamento maximo de verdade, por caminhos aumentantes.
 */
function matchSameAmount(
  purchases: CajuTransaction[],
  entries: InternalEntry[],
): MatchedPair[] {
  const adjacency = purchases.map((purchase) =>
    entries
      .map((entry, index) => ({ index, gap: dayGap(purchase.date, entry.date) }))
      .filter((candidate) => candidate.gap <= MATCH_WINDOW_DAYS)
      // Gap crescente: entre os casamentos maximos possiveis, tende a escolher
      // o par mais proximo no tempo. A cardinalidade e que e garantida.
      .sort((a, b) => a.gap - b.gap || a.index - b.index)
      .map((candidate) => candidate.index),
  );

  const entryOwner = new Array<number>(entries.length).fill(-1);

  const augment = (purchaseIndex: number, visited: boolean[]): boolean => {
    for (const entryIndex of adjacency[purchaseIndex]) {
      if (visited[entryIndex]) continue;
      visited[entryIndex] = true;
      // Se o lancamento esta livre, ou se quem o tinha acha outro, fica com ele.
      if (entryOwner[entryIndex] === -1 || augment(entryOwner[entryIndex], visited)) {
        entryOwner[entryIndex] = purchaseIndex;
        return true;
      }
    }
    return false;
  };

  for (let index = 0; index < purchases.length; index++) {
    augment(index, new Array<boolean>(entries.length).fill(false));
  }

  const pairs: MatchedPair[] = [];
  entryOwner.forEach((purchaseIndex, entryIndex) => {
    if (purchaseIndex === -1) return;
    const caju = purchases[purchaseIndex];
    const internal = entries[entryIndex];
    pairs.push({ caju, internal, dayGap: dayGap(caju.date, internal.date) });
  });

  return pairs;
}

/** Chave de competicao: so o mesmo valor, ao centavo, disputa o mesmo lancamento. */
function amountKey(amount: number) {
  return amount.toFixed(2);
}

function groupByAmount<T extends { amount: number }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = amountKey(row.amount);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function reconcile(input: {
  cajuFileName: string;
  internalFileName: string;
  caju: CajuTransaction[];
  internal: InternalEntry[];
  fromDate: string | null;
}): ReconciliationResult {
  const inRange = (date: string) =>
    !input.fromDate || (Boolean(date) && date >= input.fromDate);

  // Tudo que nao e compra sai aqui, agrupado, para nada ser descartado em
  // silencio: o usuario ve o que ficou de fora e por que.
  const ignoredMap = new Map<string, IgnoredGroup>();
  const addIgnored = (label: string, amount: number) => {
    const current = ignoredMap.get(label) ?? { type: label, count: 0, amount: 0 };
    current.count += 1;
    current.amount = Number((current.amount + amount).toFixed(2));
    ignoredMap.set(label, current);
  };

  const purchases: CajuTransaction[] = [];
  let cajuOutOfRange = 0;

  for (const row of input.caju) {
    if (normalizeName(row.type) !== PURCHASE_TYPE) {
      addIgnored(row.type || "(sem tipo)", row.amount);
      continue;
    }
    // Compra estornada/cancelada/negada: o valor voltou ao cartao, entao nao ha
    // nota a cobrar. Sem esta trava, cada estorno virava uma nota pendente
    // fantasma (foi o que inflou o resultado de 2 para 38).
    if (NON_EXPENSE_STATUSES.has(normalizeName(row.transactionStatus))) {
      addIgnored(`Compra ${row.transactionStatus || "sem status"}`, row.amount);
      continue;
    }
    if (!inRange(row.date)) {
      cajuOutOfRange += 1;
      continue;
    }
    purchases.push(row);
  }

  const entries: InternalEntry[] = [];
  let internalOutOfRange = 0;

  for (const row of input.internal) {
    if (row.amount <= 0) continue;
    if (!inRange(row.date)) {
      internalOutOfRange += 1;
      continue;
    }
    entries.push(row);
  }

  // Casamento 1:1 por valor exato, grupo de valor a grupo de valor. Os dois
  // parsers ja arredondam para centavos, entao a igualdade e exata.
  const purchaseGroups = groupByAmount(purchases);
  const entryGroups = groupByAmount(entries);
  const matched: MatchedPair[] = [];

  for (const [key, groupPurchases] of purchaseGroups) {
    const groupEntries = entryGroups.get(key);
    if (!groupEntries?.length) continue;
    matched.push(...matchSameAmount(groupPurchases, groupEntries));
  }

  const takenCaju = new Set(matched.map((pair) => pair.caju.rowNumber));
  const takenInternal = new Set(matched.map((pair) => pair.internal.rowNumber));

  const pending = purchases.filter((row) => !takenCaju.has(row.rowNumber));
  const unmatchedInternal = entries.filter((row) => !takenInternal.has(row.rowNumber));

  const sum = (rows: { amount: number }[]) =>
    Number(rows.reduce((total, row) => total + row.amount, 0).toFixed(2));

  return {
    cajuFileName: input.cajuFileName,
    internalFileName: input.internalFileName,
    fromDate: input.fromDate,
    collaborators: unique(input.caju.map((row) => row.collaborator)),
    bankAccounts: unique(input.internal.map((row) => row.bankAccount)),
    ignored: [...ignoredMap.values()].sort((a, b) => b.count - a.count),
    outOfRange: { caju: cajuOutOfRange, internal: internalOutOfRange },
    totals: {
      cajuPurchases: purchases.length,
      internalEntries: entries.length,
      matched: matched.length,
      pending: pending.length,
      pendingAmount: sum(pending),
      unmatchedInternal: unmatchedInternal.length,
      unmatchedInternalAmount: sum(unmatchedInternal),
    },
    pending: pending.sort((a, b) => a.date.localeCompare(b.date)),
    matched: matched.sort((a, b) => a.caju.date.localeCompare(b.caju.date)),
    unmatchedInternal: unmatchedInternal.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
