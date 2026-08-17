/**
 * Resolucao de centro de custo por nome, compartilhada entre o parser da
 * planilha e a confirmacao do lote. As duas pontas precisam decidir igual: se
 * a previa diz que a conta e nova, a importacao tem que criar essa mesma conta.
 */

export type WorkMatcher = {
  id: string;
  name: string;
  slug: string;
  costCenterAliases: string;
};

/**
 * Conta-sentinela das compras que chegaram sem centro de custo. Nasce INATIVA
 * de proposito: assim nao vira card no Dashboard nem linha no indicador de
 * cobertura — uma conta que nunca recebe aporte apareceria com saldo negativo e
 * distorceria a metrica. A compra continua visivel em Pagamentos, e o rateio e
 * o caminho de correcao: assim que alguem rateia 100% na obra certa, o valor
 * migra sozinho, porque o dashboard prefere as alocacoes ao workId.
 */
export const UNDEFINED_WORK_SLUG = "indefinido";
export const UNDEFINED_WORK_NAME = "INDEFINIDO";

/** Compara ignorando acentos, caixa e pontuacao: "Ediser" = "EDISER" = "ediser". */
export function normalizeName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Contas distintas por cidade que a diretoria trata como uma só na memória de cálculo. */
const ACCOUNT_MERGES: Array<{ prefix: string; canonical: string }> = [
  { prefix: "REISOLAMENTO", canonical: "REISOLAMENTO" },
];

export function canonicalAccountLabel(label: string): string {
  const normalized = normalizeName(label);
  const merge = ACCOUNT_MERGES.find((rule) =>
    normalized.startsWith(normalizeName(rule.prefix)),
  );
  return merge ? merge.canonical : label;
}

function parseAliases(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Nome, slug e apelidos pelos quais a conta pode aparecer na planilha. */
export function workAliases(work: WorkMatcher) {
  return [work.name, work.slug, ...parseAliases(work.costCenterAliases)].map(normalizeName);
}

export function matchWork(costCenter: string, works: WorkMatcher[]) {
  const value = normalizeName(costCenter);
  if (!value) return undefined;
  return works.find((work) => workAliases(work).includes(value));
}

/** Slug a partir do nome: "Despesa Pessoal Jeronimo" -> "despesa-pessoal-jeronimo". */
export function slugifyName(value: string) {
  return normalizeName(value).replace(/\s+/g, "-").slice(0, 60) || "conta";
}

/**
 * Garante um slug livre. Colisao acontece quando dois nomes normalizam igual
 * (ex.: "Obra A" e "obra-a"), entao o sufixo evita quebrar a unicidade.
 */
export function uniqueSlug(name: string, taken: Set<string>) {
  const base = slugifyName(name);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
