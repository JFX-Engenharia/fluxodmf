import type { Role, UserStatus } from "@prisma-generated/enums";

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
  errors: string[];
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
  duplicateRows: number;
  totalAmount: number;
  rows: PaymentImportRow[];
  contributions: ImportContributionRow[];
  summaryChecks: ImportSummaryCheck[];
};
