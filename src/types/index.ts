import type { Role, UserStatus } from "@prisma-generated/enums";
import type { MissingField } from "@/lib/missing-info";

export type SessionUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  sessionId: string;
  provider: string;
};

export type { Role, UserStatus };

export type PaymentImportRow = {
  rowNumber: number;
  externalReference?: string;
  supplierName: string;
  description: string;
  amount: number;
  category: string;
  originalDueDate: string;
  currentDueDate: string;
  costCenter: string;
  /** Ausente quando a conta ainda nao existe: e criada na confirmacao. */
  workId?: string;
  workName?: string;
  isNewWork: boolean;
  uniqueKey: string;
  /**
   * SO o que impede a linha de virar compra: fornecedor, valor e duplicidade.
   * Vazio significa "entra no lote" — e o que todo o pipeline ja testa.
   */
  errors: string[];
  /** Campos que a planilha omitiu e que entram preenchidos com marcador. */
  undefinedFields: MissingField[];
  duplicate: boolean;
};

/** Linha do bloco APORTES da planilha. */
export type ImportContributionRow = {
  rowNumber: number;
  accountLabel: string;
  amount: number;
  workId?: string;
  workName?: string;
  isNewWork: boolean;
  errors: string[];
};

/**
 * Confronto entre o resumo por conta escrito na planilha e a soma real das
 * linhas de pagamento. `difference` diferente de zero indica planilha defasada.
 */
export type ImportSummaryCheck = {
  accountLabel: string;
  workName?: string;
  sheetAmount: number | null;
  computedAmount: number;
  difference: number | null;
  status?: string;
};

export type ImportPreview = {
  fileName: string;
  missingColumns: string[];
  /** Centros de custo da planilha que ainda nao tem conta cadastrada. */
  newAccounts: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Subconjunto de validRows que entra com algum campo INDEFINIDO. */
  incompleteRows: number;
  duplicateRows: number;
  totalAmount: number;
  rows: PaymentImportRow[];
  contributions: ImportContributionRow[];
  summaryChecks: ImportSummaryCheck[];
};
