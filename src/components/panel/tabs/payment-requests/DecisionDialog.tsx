"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { money } from "@/lib/format";
import { requestJson, type Decision, type PaymentRequest } from "./types";

const labels: Record<Decision, string> = { approve: "Aprovar solicitação", reject: "Reprovar solicitação", request_info: "Pedir informação", cancel: "Cancelar solicitação" };

export function DecisionDialog({ request, action, onClose, onSaved }: { request: PaymentRequest; action: Decision; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const required = action === "reject" || action === "request_info";
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (required && !reason) { setError("Preencha o motivo ou a informação solicitada."); return; }
    setBusy(true); setError("");
    try {
      const body = await requestJson<{ status: string }>(`/api/payment-requests/${request.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
      onSaved(action === "approve" && body.status === "PENDENTE" ? "Aprovação registrada. Aguardando os demais responsáveis." : action === "request_info" ? "Pedido de informação enviado ao solicitante." : action === "approve" ? "Solicitação aprovada." : action === "reject" ? "Solicitação reprovada." : "Solicitação cancelada.");
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="request-dialog" aria-labelledby="request-decision-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form className="modal" onSubmit={submit}><h2 id="request-decision-title">{labels[action]}</h2><p>{request.work.name} · {request.supplierName} · {money(request.amount)}</p>
      <div className="field"><label htmlFor="request-decision-note">{required ? action === "reject" ? "Motivo da reprovação" : "O que precisa ser ajustado ou informado?" : "Observação (opcional)"}</label><textarea className="textarea" id="request-decision-note" name="reason" required={required} maxLength={2000} disabled={busy} autoFocus /></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="request-card-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Voltar</button><button className={`button ${action === "reject" || action === "cancel" ? "danger" : "primary"}`} disabled={busy}>{busy ? "Salvando..." : labels[action]}</button></div>
    </form>
  </dialog>;
}
