"use client";

import { useState } from "react";
import { Money } from "@/components/Money";
import { dateTime, shortDate } from "@/lib/format";
import { ResponseForm } from "./ResponseForm";
import { statusLabels, type Decision, type PaymentRequest, type RequestEvent } from "./types";

const eventLabels: Record<RequestEvent["type"], string> = {
  CRIADA: "Solicitação criada", INFO_SOLICITADA: "Informação solicitada", INFO_RESPONDIDA: "Informação respondida",
  APROVADA: "Aprovação registrada", REPROVADA: "Solicitação reprovada", CANCELADA: "Solicitação cancelada",
};

export function RequestCard({ request, highlighted, onDecide, onResponded }: { request: PaymentRequest; highlighted: boolean; onDecide: (request: PaymentRequest, action: Decision) => void; onResponded: () => void }) {
  const [now] = useState(() => Date.now());
  const days = Math.max(0, Math.floor((now - new Date(request.createdAt).getTime()) / 86400000));
  const open = request.status === "PENDENTE" || request.status === "INFO_SOLICITADA";
  return <article id={`request-${request.id}`} tabIndex={-1} className={`panel pad request-card${highlighted ? " request-highlight" : ""}`} aria-label={`Solicitação de ${request.supplierName}`}>
    <header className="request-card-header"><div><span className="muted">{request.work.name}</span><h3>{request.supplierName}</h3></div><strong className="request-amount"><Money value={request.amount} /></strong></header>
    <div className="request-badges"><span className={`status ${request.status} status-${request.status.toLowerCase()}`}>{statusLabels[request.status]}</span>{request.requiresOwnerApproval && <span className="status request-high-value">Alto valor</span>}</div>
    <p className="request-description">{request.description}</p>
    <dl className="request-facts"><div><dt>Vencimento</dt><dd>{shortDate(request.dueDate)}</dd></div><div><dt>{open ? "Em espera" : "Enviada em"}</dt><dd>{open ? days === 0 ? "Desde hoje" : `Há ${days} ${days === 1 ? "dia" : "dias"}` : shortDate(request.createdAt)}</dd></div><div><dt>Solicitante</dt><dd>{request.requestedBy.name}</dd></div></dl>
    <p className="muted">{request.requiresOwnerApproval ? "Uma decisão de: " : "Responsáveis: "}{request.approvals.map(a => `${a.approver.name}${a.approvedAt ? " (aprovou)" : ""}`).join(", ") || "Nenhum responsável ativo"}</p>
    {request.reviewedBy && <p className="muted">Decisão final: {request.reviewedBy.name}{request.reviewReason ? ` — ${request.reviewReason}` : ""}</p>}
    <ul className="request-attachments" aria-label="Anexos">{request.attachments.map(file => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.fileName}</a></li>)}</ul>
    <details className="request-history" open={highlighted || request.status === "INFO_SOLICITADA" || undefined}><summary>Histórico ({request.events.length})</summary><ol className="request-timeline">{request.events.map(event => <li key={event.id}><strong>{eventLabels[event.type]}</strong><span>{event.actor.name} · {dateTime(event.createdAt)}</span>{event.note && <p>{event.note}</p>}</li>)}</ol></details>
    {request.actions.respond && <ResponseForm id={request.id} attachmentCount={request.attachments.length} onResponded={onResponded} />}
    <footer className="request-card-actions">
      {request.actions.approve && <button type="button" className="button primary" onClick={() => onDecide(request, "approve")}>Aprovar</button>}
      {request.actions.request_info && <button type="button" className="button secondary" onClick={() => onDecide(request, "request_info")}>Pedir informação</button>}
      {request.actions.reject && <button type="button" className="button danger" onClick={() => onDecide(request, "reject")}>Reprovar</button>}
      {request.actions.cancel && <button type="button" className="button ghost" onClick={() => onDecide(request, "cancel")}>Cancelar solicitação</button>}
    </footer>
  </article>;
}
