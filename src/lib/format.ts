import { PaymentStatus, UserStatus } from "@prisma-generated/enums";

export { roleLabels } from "@/lib/permissions";

export const userStatusLabels: Record<UserStatus, string> = {
  PENDENTE: "Aguardando aprovação",
  ATIVO: "Ativo",
  RECUSADO: "Recusado",
  INATIVO: "Inativo",
};

export const statusLabels: Record<PaymentStatus, string> = {
  PENDENTE: "Pendente",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
  TRANSFERIDO: "Transferido",
  INFO_SOLICITADA: "Info solicitada",
  CORRIGIDO: "Corrigido",
  CANCELADO: "Cancelado",
};

export function money(value: number | string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

export function shortDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

export function dateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
