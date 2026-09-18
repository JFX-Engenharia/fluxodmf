export type RequestStatus = "PENDENTE" | "INFO_SOLICITADA" | "APROVADO" | "REPROVADO" | "CANCELADO";
export type Decision = "approve" | "reject" | "request_info" | "cancel";
export type RequestEvent = { id: string; type: "CRIADA" | "INFO_SOLICITADA" | "INFO_RESPONDIDA" | "APROVADA" | "REPROVADA" | "CANCELADA"; note: string | null; createdAt: string; actor: { id: string; name: string } };
export type PaymentRequest = {
  id: string; supplierName: string; description: string; amount: number; dueDate: string; category: string;
  status: RequestStatus; requiresOwnerApproval: boolean; reviewReason: string | null; createdAt: string;
  work: { id: string; name: string }; requestedBy: { id: string; name: string }; reviewedBy: { id: string; name: string } | null;
  attachments: Array<{ id: string; fileName: string; url: string }>;
  approvals: Array<{ approver: { id: string; name: string }; approvedAt: string | null }>;
  events: RequestEvent[];
  actions: Record<Decision | "respond", boolean>;
};
export type RequestSettings = { threshold: number | null; approvers: Array<{ id: string; name: string }> };
export type RequestsResponse = { requests: PaymentRequest[]; settings: RequestSettings };
export const statusLabels: Record<RequestStatus, string> = {
  PENDENTE: "Aguardando aprovação", INFO_SOLICITADA: "Informação solicitada", APROVADO: "Aprovada", REPROVADO: "Reprovada", CANCELADO: "Cancelada",
};

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

export function requestsChanged() {
  window.dispatchEvent(new Event("payment-requests-changed"));
}
