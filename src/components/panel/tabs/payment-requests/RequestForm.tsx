"use client";

import { useRef, useState, type FormEvent } from "react";
import { money } from "@/lib/format";
import { requestJson, type RequestSettings } from "./types";

export function RequestForm({ works, settings, onCreated }: { works: { id: string; name: string }[]; settings: RequestSettings; onCreated: (message: string) => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const high = settings.threshold !== null && Number(amount) > settings.threshold;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    const body = new FormData(form);
    setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try {
      const result = await requestJson<{ request: { requiresOwnerApproval: boolean } }>("/api/payment-requests", { method: "POST", headers: { "Idempotency-Key": key.current }, body });
      form.reset(); setAmount(""); key.current = null;
      onCreated(result.request.requiresOwnerApproval ? "Solicitação enviada aos designados de alto valor." : "Solicitação enviada aos responsáveis da obra.");
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return <section className="section panel pad">
    <div className="section-header"><div><h2>Nova solicitação</h2><span className="muted">Peça autorização para pagar após concluir a negociação.</span></div></div>
    <form onSubmit={submit} onChange={() => { key.current = null; }}>
      <fieldset className="request-fieldset form-grid two" disabled={busy}>
        <div className="field"><label htmlFor="request-work">Obra</label><select className="select" id="request-work" name="workId" required defaultValue=""><option value="">Selecione</option>{works.map(work => <option key={work.id} value={work.id}>{work.name}</option>)}</select></div>
        <div className="field"><label htmlFor="request-supplier">Fornecedor</label><input className="input" id="request-supplier" name="supplierName" minLength={2} maxLength={160} required /></div>
        <div className="field"><label htmlFor="request-value">Valor (R$)</label><input className="input" id="request-value" name="amount" type="number" min="0.01" max="10000000" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div className="field"><label htmlFor="request-due-date">Vencimento</label><input className="input" id="request-due-date" name="dueDate" type="date" required /></div>
        <div className={`alert ${high ? "warning" : "info"} span-2`} role="status">{high ? settings.approvers.length
          ? `Acima de ${money(settings.threshold!)}: vai direto para aprovação de ${settings.approvers.map(a => a.name).join(" ou ")}.`
          : "Não há designados ativos para alto valor. Peça ao Administrador para configurar a alçada."
          : "Será aprovada pelos responsáveis da obra."}</div>
        <div className="field span-2"><label htmlFor="request-description">Descrição</label><textarea className="textarea" id="request-description" name="description" minLength={5} maxLength={2000} required /></div>
        <div className="field"><label htmlFor="request-category">Categoria</label><input className="input" id="request-category" name="category" maxLength={120} /></div>
        <div className="field"><label htmlFor="request-attachments">Anexos</label><input className="input" id="request-attachments" name="attachments" type="file" accept="application/pdf,image/jpeg,image/png" multiple required /><small className="muted">PDF, JPG ou PNG; de 1 a 5 arquivos, até 5 MB cada.</small></div>
        {error && <div className="alert error span-2" role="alert">{error}</div>}
        <div className="form-actions span-2"><button className="button primary" disabled={busy || !works.length || (high && !settings.approvers.length)}>{busy ? "Enviando..." : "Enviar para aprovação"}</button></div>
      </fieldset>
    </form>
  </section>;
}
