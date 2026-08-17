/**
 * Informacao que a planilha nao trouxe, compartilhada entre o parser, o
 * conversor, o worker e as telas. A planilha do dia chega incompleta com
 * frequencia — pagamento sem centro de custo e rotina, nao excecao — e ate aqui
 * essas compras eram descartadas na importacao e sumiam sem aviso.
 *
 * Agora elas entram com marcador e a lista de campos omitidos viaja junto, da
 * previa ate o painel. Este modulo e puro de proposito (sem prisma, sem
 * node:crypto): componentes client importam daqui, igual a src/lib/format.ts.
 */

/** Campos que a planilha pode omitir sem impedir a importacao. */
export type MissingField = "description" | "currentDueDate" | "costCenter" | "category";

/** Valor gravado no lugar do que faltou. Tambem e o nome da conta-sentinela. */
export const UNDEFINED_MARKER = "INDEFINIDO";

/**
 * Rotulo curto para chip e coluna; explicacao para o detalhe do pagamento.
 * Guardamos o CODIGO do campo no banco, nunca a frase: a redacao e apresentacao
 * e muda, o codigo nao. E a mesma funcao renderiza previa e painel, entao o
 * texto que o operador le antes de importar e identico ao de depois.
 */
export const missingFieldInfo: Record<MissingField, { label: string; explanation: string }> = {
  description: {
    label: "Descrição",
    explanation: "Descrição não veio na planilha; gravada como INDEFINIDO.",
  },
  currentDueDate: {
    label: "Data",
    explanation: "Data de vencimento não veio na planilha; usada a data da importação.",
  },
  costCenter: {
    label: "Centro de custo",
    explanation: "Centro de custo não veio na planilha; a compra entrou na conta INDEFINIDO.",
  },
  category: {
    // Categoria e sinalizada mas NAO recebe o marcador: ela ja era opcional
    // (Payment.category @default("")) e o painel ja mostra "(sem categoria)".
    // Gravar INDEFINIDO criaria um balde novo ao lado do historico.
    label: "Categoria",
    explanation: "Categoria não veio na planilha.",
  },
};

export const MISSING_FIELDS = Object.keys(missingFieldInfo) as MissingField[];

function isMissingField(value: unknown): value is MissingField {
  return typeof value === "string" && (MISSING_FIELDS as string[]).includes(value);
}

/** Tolerante como parseAliases (cost-center.ts:37): coluna corrompida vira lista vazia. */
export function parseMissingInfo(raw: string): MissingField[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMissingField) : [];
  } catch {
    return [];
  }
}

export function serializeMissingInfo(fields: MissingField[]): string {
  return JSON.stringify(fields.filter(isMissingField));
}

/** "Descrição, Centro de custo" — para chip e badge. */
export function missingInfoLabels(fields: MissingField[]): string {
  return fields.map((field) => missingFieldInfo[field].label).join(", ");
}

/** Explicacoes unidas — para o detalhe do pagamento e o title do chip. */
export function missingInfoSentence(fields: MissingField[]): string {
  return fields.map((field) => missingFieldInfo[field].explanation).join(" ");
}
