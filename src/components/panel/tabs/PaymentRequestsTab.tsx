"use client";

import { Check, FilePlus2, Paperclip, Send, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Money } from "@/components/Money";
import { usePanel } from "@/components/panel/PanelContext";
import { useFetchData } from "@/components/panel/useFetchData";
import { Role } from "@/lib/permissions";

type RequestStatus = "PENDENTE" | "APROVADO" | "REPROVADO" | "CANCELADO";
type PaymentRequest = {
  id: string;
  supplierName: string;
  description: string;
  amount: number;
  dueDate: string;
  category: string;
  status: RequestStatus;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  work: { id: string; name: string; responsible: { id: string; name: string } | null };
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number; url: string }>;
};
type RequestsResponse = { requests: PaymentRequest[] };
type WorksResponse = { works: Array<{ id: string; name: string; active: boolean }> };

const statusLabels: Record<RequestStatus, string> = {
  PENDENTE: "Aguardando aprovação",
  APROVADO: "Aprovada",
  REPROVADO: "Reprovada",
  CANCELADO: "Cancelada",
};

export function PaymentRequestsTab() {
  const { user } = usePanel();
  const { data, error, loading, reload, setError } = useFetchData<RequestsResponse>("/api/payment-requests");
  const { data: worksData } = useFetchData<WorksResponse>("/api/admin/works");
  const [form, setForm] = useState({ supplierName: "", description: "", amount: "", dueDate: "", category: "", workId: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const works = useMemo(
    () =>
      (worksData?.works ?? []).filter(
        (work) => work.active && (user.role === Role.ADMINISTRADOR || user.works.some((assignedWork) => assignedWork.id === work.id)),
      ),
    [user.role, user.works, worksData?.works],
  );
  const pendingReview = (data?.requests ?? []).filter(
    (paymentRequest) =>
      paymentRequest.status === "PENDENTE" &&
      (user.role === Role.ADMINISTRADOR || paymentRequest.work.responsible?.id === user.id),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.set(key, value));
    files.forEach((file) => payload.append("attachments", file));
    try {
      const response = await fetch("/api/payment-requests", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: payload,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível enviar a solicitação.");
        return;
      }
      setForm({ supplierName: "", description: "", amount: "", dueDate: "", category: "", workId: "" });
      setFiles([]);
      setMessage("Solicitação enviada ao responsável pela obra.");
      reload();
    } catch {
      setError("Falha de conexão ao enviar a solicitação.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: "approve" | "reject" | "cancel") {
    const reason = action === "reject" ? window.prompt("Informe o motivo da reprovação:") : undefined;
    if (action === "reject" && !reason?.trim()) return;
    if (action === "cancel" && !window.confirm("Cancelar esta solicitação?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/payment-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível atualizar a solicitação.");
        return;
      }
      setMessage(
        action === "approve" ? "Solicitação aprovada." : action === "reject" ? "Solicitação reprovada." : "Solicitação cancelada.",
      );
      reload();
    } catch {
      setError("Falha de conexão ao atualizar a solicitação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <section className="panel pad">
        <div className="section-header"><div><h2><FilePlus2 size={20} /> Nova solicitação</h2><span className="muted">O responsável da obra recebe a solicitação antes de ela entrar no fluxo de pagamentos.</span></div></div>
        <form className="form-grid two" onSubmit={submit}>
          <div className="field"><label htmlFor="request-work">Obra</label><select className="select" id="request-work" value={form.workId} onChange={(event) => setForm({ ...form, workId: event.target.value })} required><option value="">Selecione</option>{works.map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}</select></div>
          <div className="field"><label htmlFor="request-supplier">Fornecedor</label><input className="input" id="request-supplier" value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} required /></div>
          <div className="field"><label htmlFor="request-value">Valor</label><input className="input" id="request-value" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></div>
          <div className="field"><label htmlFor="request-due-date">Vencimento</label><input className="input" id="request-due-date" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} required /></div>
          <div className="field span-2"><label htmlFor="request-description">Descrição</label><textarea className="textarea" id="request-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></div>
          <div className="field"><label htmlFor="request-category">Categoria</label><input className="input" id="request-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></div>
          <div className="field"><label htmlFor="request-attachments">Anexos</label><input className="input" id="request-attachments" type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} required /><small className="muted">Obrigatório: PDF, JPG ou PNG; até 5 arquivos de 5 MB.</small>{files.length ? <small className="muted">{files.map((file) => file.name).join(", ")}</small> : null}</div>
          <div className="form-actions span-2"><button className="button primary" disabled={busy}><Send size={16} /> Enviar para aprovação</button></div>
        </form>
      </section>

      {pendingReview.length ? <section className="section"><div className="section-header"><div><h2>Para sua aprovação</h2><span className="muted">Solicitações das obras sob sua responsabilidade.</span></div></div><RequestTable requests={pendingReview} userId={user.id} busy={busy} onDecide={decide} /></section> : null}
      <section className="section"><div className="section-header"><h2>Minhas solicitações e acompanhamentos</h2></div><RequestTable requests={data?.requests ?? []} userId={user.id} busy={busy} loading={loading} onDecide={decide} /></section>
    </>
  );
}

function RequestTable({ requests, userId, busy, loading, onDecide }: { requests: PaymentRequest[]; userId: string; busy: boolean; loading?: boolean; onDecide: (id: string, action: "approve" | "reject" | "cancel") => Promise<void> }) {
  return <div className="panel"><div className="table-wrap"><table className="table"><thead><tr><th>Solicitação</th><th>Obra</th><th>Vencimento</th><th>Status</th><th>Responsável</th><th /></tr></thead><tbody>
    {loading ? <tr><td className="daily-flow-empty" colSpan={6}>Carregando...</td></tr> : null}
    {requests.map((paymentRequest) => { const canReview = paymentRequest.status === "PENDENTE" && paymentRequest.work.responsible?.id === userId; const canCancel = paymentRequest.status === "PENDENTE" && paymentRequest.requestedBy.id === userId; return <tr key={paymentRequest.id}><td><strong>{paymentRequest.supplierName}</strong><small className="muted">{paymentRequest.description}</small><Money value={paymentRequest.amount} /><div className="tag-list">{paymentRequest.attachments.map((attachment) => <a className="tag" href={attachment.url} key={attachment.id}><Paperclip size={13} /> {attachment.fileName}</a>)}</div>{paymentRequest.reviewReason ? <small className="muted">Motivo: {paymentRequest.reviewReason}</small> : null}</td><td>{paymentRequest.work.name}</td><td>{new Date(paymentRequest.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td><span className={`status status-${paymentRequest.status.toLowerCase()}`}>{statusLabels[paymentRequest.status]}</span></td><td>{paymentRequest.work.responsible?.name ?? "Não definido"}{paymentRequest.reviewedBy ? <small className="muted">Decisão: {paymentRequest.reviewedBy.name}</small> : null}</td><td><div className="toolbar">{canReview ? <><button className="button small primary" disabled={busy} onClick={() => void onDecide(paymentRequest.id, "approve")}><Check size={14} /> Aprovar</button><button className="button small danger" disabled={busy} onClick={() => void onDecide(paymentRequest.id, "reject")}><X size={14} /> Reprovar</button></> : null}{canCancel ? <button className="button small ghost" disabled={busy} onClick={() => void onDecide(paymentRequest.id, "cancel")}>Cancelar</button> : null}</div></td></tr>; })}
    {!loading && !requests.length ? <tr><td className="daily-flow-empty" colSpan={6}>Nenhuma solicitação para exibir.</td></tr> : null}
  </tbody></table></div></div>;
}
