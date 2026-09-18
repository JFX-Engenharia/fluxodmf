"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePanel } from "@/components/panel/PanelContext";
import { useFetchData } from "@/components/panel/useFetchData";
import { DecisionDialog } from "./payment-requests/DecisionDialog";
import { RequestCard } from "./payment-requests/RequestCard";
import { RequestForm } from "./payment-requests/RequestForm";
import { PushControls } from "./payment-requests/PushControls";
import { requestsChanged, statusLabels, type Decision, type PaymentRequest, type RequestsResponse, type RequestStatus } from "./payment-requests/types";

export function PaymentRequestsTab() {
  const { user } = usePanel();
  const searchParams = useSearchParams();
  const targetId = searchParams.get("request");
  const focusedRequest = useRef<string | null>(null);
  const { data, error, loading, reload } = useFetchData<RequestsResponse>("/api/payment-requests");
  const { data: worksData, error: worksError } = useFetchData<{ works: { id: string; name: string; active: boolean }[] }>("/api/admin/works");
  const [status, setStatus] = useState<RequestStatus | "">("");
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<{ request: PaymentRequest; action: Decision } | null>(null);
  const works = (worksData?.works ?? []).filter(w => w.active && (user.role === "ADMINISTRADOR" || user.works.some(assigned => assigned.id === w.id)));
  const requests = data?.requests ?? [];
  const queue = requests.filter(r => r.actions.approve);
  const following = requests.filter(r => !r.actions.approve && (!status || r.status === status || r.id === targetId));
  function changed(message: string) { setMessage(message); setDecision(null); reload(); requestsChanged(); }
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [reload]);
  useEffect(() => {
    if (!targetId || !data || focusedRequest.current === targetId) return;
    const card = document.getElementById(`request-${targetId}`);
    if (card) focusedRequest.current = targetId;
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.focus({ preventScroll: true });
  }, [targetId, data]);
  const card = (request: PaymentRequest) => <RequestCard key={request.id} request={request} highlighted={request.id === targetId} onDecide={(request, action) => setDecision({ request, action })} onResponded={() => changed("Resposta enviada para nova decisão.")} />;
  return <>
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="alert success" role="status">{message}</div>}
    {targetId && data && !requests.some(r => r.id === targetId) && <div className="alert warning" role="status">Esta solicitação não está disponível para sua conta. Atualize a lista ou entre com a conta que recebeu o aviso.</div>}
    <section className="section"><div className="section-header"><div><h2>Aguardando sua decisão ({queue.length})</h2><span className="muted">Vencimentos mais próximos primeiro.</span></div><button type="button" className="button secondary" onClick={reload} disabled={loading}>Atualizar</button></div>
      <div className="request-grid">{queue.map(card)}</div>{!queue.length && <div className="panel pad muted">{loading ? "Carregando solicitações..." : "Nenhuma solicitação aguarda sua decisão."}</div>}
    </section>
    {worksError && <div className="alert error" role="alert">{worksError}</div>}
    <PushControls />
    {data && works.length > 0 && <RequestForm works={works} settings={data.settings} onCreated={changed} />}
    <section className="section"><div className="section-header"><h2>Minhas solicitações e acompanhamentos</h2><div className="field"><label htmlFor="requests-status">Filtrar por status</label><select className="select" id="requests-status" value={status} onChange={e => setStatus(e.target.value as RequestStatus | "")}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      <div className="request-grid">{following.map(card)}</div>{!following.length && !loading && <div className="panel pad muted">Nenhuma solicitação neste filtro. As que aguardam sua decisão aparecem na fila acima.</div>}
    </section>
    {decision && <DecisionDialog request={decision.request} action={decision.action} onClose={() => setDecision(null)} onSaved={changed} />}
  </>;
}
