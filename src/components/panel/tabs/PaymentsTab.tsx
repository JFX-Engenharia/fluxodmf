"use client";

import {
  CalendarDays,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Split,
  Tags,
  XCircle,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Money } from "@/components/Money";
import { StatusBadge } from "@/components/StatusBadge";
import { usePanel } from "@/components/panel/PanelContext";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime, money, shortDate, statusLabels } from "@/lib/format";
import { canAdminister, Role } from "@/lib/permissions";

type StatusKey = keyof typeof statusLabels;

type Payment = {
  id: string;
  supplierName: string;
  description: string;
  amount: number;
  category: string;
  originalDueDate: string;
  currentDueDate: string;
  costCenter: string;
  status: StatusKey;
  work: { id: string; name: string };
  hasReceipt: boolean;
  receiptReceivedAt?: string | null;
  requiredApprovals: number;
  requiredApprovalRole: "GESTOR" | "APROVADOR" | "ADMINISTRADOR";
  approvals?: Array<{ id: string; createdAt: string; actor: { id: string; name: string; role: string } }>;
  tags?: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
  allocations?: Array<{ workId: string; percentage: number; amount: number; work: { id: string; name: string } }>;
  appliedApprovalRule?: { id: string; name: string } | null;
  actions?: {
    id: string;
    type: string;
    reason?: string | null;
    note?: string | null;
    createdAt: string;
    actor?: { name: string };
  }[];
};

type PaymentsResponse = {
  payments: Payment[];
  summary: { total: number; approved: number; alteredDate: number; rejected: number };
};

type DailyFlowStatus = "RASCUNHO" | "EM_APROVACAO" | "FECHADO";

type FlowSummary = {
  total: { count: number; amount: number };
  approved: { count: number; amount: number };
  rejected: { count: number; amount: number };
  transferred: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  pending: { count: number; amount: number };
  informationRequested: { count: number; amount: number };
  corrected: { count: number; amount: number };
  undecidedCount: number;
};

type DailyFlow = {
  id: string;
  status: DailyFlowStatus;
  name: string;
  startedAt: string | null;
  closedAt: string | null;
  startedBy: { id: string; name: string } | null;
  closedBy: { id: string; name: string } | null;
  createdAt: string;
  summary: FlowSummary;
  events: Array<{
    id: string;
    type: string;
    reason: string | null;
    actor: { id: string; name: string };
    createdAt: string;
  }>;
};

type DailyFlowsResponse = { flows: DailyFlow[] };

type PaymentOptions = {
  tags: Array<{ id: string; name: string; color: string }>;
  reasons: Array<{ id: string; action: string; label: string }>;
  works: Array<{ id: string; name: string }>;
};

const flowStatusLabels: Record<DailyFlowStatus, string> = {
  RASCUNHO: "Rascunho",
  EM_APROVACAO: "Em aprovação",
  FECHADO: "Fechado",
};

const flowStatusClasses: Record<DailyFlowStatus, string> = {
  RASCUNHO: "PENDENTE",
  EM_APROVACAO: "TRANSFERIDO",
  FECHADO: "APROVADO",
};

const statusOptions: { value: "" | StatusKey; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "PENDENTE", label: "Pendente" },
  { value: "CORRIGIDO", label: "Corrigido" },
  { value: "INFO_SOLICITADA", label: "Info solicitada" },
  { value: "TRANSFERIDO", label: "Transferido" },
  { value: "APROVADO", label: "Aprovado" },
  { value: "REPROVADO", label: "Reprovado" },
  { value: "CANCELADO", label: "Cancelado" },
];

/** Acoes que exigem justificativa antes de disparar. */
type Mode = "reject" | "transfer" | "cancel" | "reopen";

const modeLabels: Record<Mode, string> = {
  reject: "Reprovar pagamento",
  transfer: "Alterar data de vencimento",
  cancel: "Cancelar pagamento",
  reopen: "Voltar pagamento para em aberto",
};

/** Acoes oferecidas no lote. Tudo menos aprovar pede motivo. */
type BatchAction = "approve" | "reject" | "transfer" | "reopen";

const batchActionLabels: Record<BatchAction, string> = {
  approve: "Aprovar",
  reject: "Reprovar",
  transfer: "Alterar data",
  reopen: "Voltar para em aberto",
};

type BatchResult = { done: number; failed: { supplier: string; error: string }[] };

export function PaymentsTab() {
  const { user, goToTab } = usePanel();
  const isCoordinator = canAdminister(user.role);
  const canConcludeFlow =
    user.role === Role.APROVADOR || user.role === Role.ADMINISTRADOR;

  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"" | StatusKey>("PENDENTE");
  const [workId, setWorkId] = useState("");
  const [search, setSearch] = useState("");
  // `search` so entra na url quando o usuario clica em Buscar, para nao
  // refazer a consulta a cada tecla digitada.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [standardReasonId, setStandardReasonId] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  // Selecao em lote: ids marcados por clique na lista.
  const [batch, setBatch] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<BatchAction>("approve");
  const [batchReason, setBatchReason] = useState("");
  const [batchStandardReasonId, setBatchStandardReasonId] = useState("");
  const [batchDueDate, setBatchDueDate] = useState("");
  const [batchProgress, setBatchProgress] = useState(0);
  const [flowId, setFlowId] = useState("");
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowReopenOpen, setFlowReopenOpen] = useState(false);
  const [flowReason, setFlowReason] = useState("");
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataTags, setMetadataTags] = useState<string[]>([]);
  const [metadataAllocations, setMetadataAllocations] = useState<Record<string, string>>({});
  const [metadataReceipt, setMetadataReceipt] = useState(false);
  const [metadataReceiptDate, setMetadataReceiptDate] = useState("");

  const {
    data: flowData,
    error: flowError,
    loading: flowsLoading,
    reload: reloadFlows,
  } = useFetchData<DailyFlowsResponse>("/api/daily-flows");
  const { data: options } = useFetchData<PaymentOptions>("/api/payments/options");
  const selectedFlow =
    flowData?.flows.find((flow) => flow.id === flowId) ?? flowData?.flows[0] ?? null;
  const effectiveFlowId = selectedFlow?.id ?? "";
  const flowLocked = selectedFlow?.status === "FECHADO";

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (workId) params.set("workId", workId);
    if (appliedSearch) params.set("search", appliedSearch);
    if (effectiveFlowId) params.set("flowId", effectiveFlowId);
    return `/api/payments?${params.toString()}`;
  }, [status, workId, appliedSearch, effectiveFlowId]);

  const { data, error, loading, reload, setError } = useFetchData<PaymentsResponse>(url);

  const payments = data?.payments ?? [];
  const summary = data?.summary ?? { total: 0, approved: 0, alteredDate: 0, rejected: 0 };

  // A selecao e derivada, nao sincronizada por efeito: se o item escolhido sai
  // da lista (mudou o filtro, mudou o status), cai no primeiro sozinho.
  const selected = payments.find((payment) => payment.id === selectedId) ?? payments[0] ?? null;

  /**
   * O lote so considera o que esta na lista atual. Trocar o filtro ou aprovar
   * um item deixa ids orfaos no estado; cruzar com `payments` evita agir sobre
   * pagamento que o usuario nao esta mais vendo.
   */
  const batchPayments = payments.filter((payment) => batch.includes(payment.id));
  const batchTotal = batchPayments.reduce((sum, payment) => sum + payment.amount, 0);

  async function changeFlow(action: "start_approval" | "close" | "reopen", reason?: string) {
    if (!selectedFlow) return;
    setFlowBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/daily-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId: selectedFlow.id, action, reason }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Não foi possível atualizar o fluxo diário.");
        return;
      }

      setFlowReopenOpen(false);
      setFlowReason("");
      setBatch([]);
      setMessage(
        action === "start_approval"
          ? "Fluxo enviado para aprovação."
          : action === "close"
            ? "Fluxo diário fechado."
            : "Fluxo diário reaberto.",
      );
      reloadFlows();
      reload();
    } catch {
      setError("Falha de conexão ao atualizar o fluxo diário.");
    } finally {
      setFlowBusy(false);
    }
  }

  function toggleBatch(id: string) {
    // Clicar marca/desmarca no lote e sempre leva os detalhes para o clicado.
    setSelectedId(id);
    setBatch((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/payments/${selected.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Não foi possível concluir a ação.");
        return;
      }

      setMode(null);
      setReason("");
      setStandardReasonId("");
      setNewDueDate("");
      setMessage(
        result.approval && !result.approval.completed
          ? `Aprovação ${result.approval.count} de ${result.approval.required} registrada. Ainda falta aprovação.`
          : "Ação registrada.",
      );
      reload();
    } catch {
      setError("Falha de conexão ao executar a ação.");
    } finally {
      setBusy(false);
    }
  }

  function openMetadata() {
    if (!selected) return;
    setMetadataTags(selected.tags?.map((item) => item.tagId) ?? []);
    setMetadataAllocations(
      Object.fromEntries(selected.allocations?.map((item) => [item.workId, String(item.percentage)]) ?? []),
    );
    setMetadataReceipt(selected.hasReceipt);
    setMetadataReceiptDate(selected.receiptReceivedAt?.slice(0, 10) ?? "");
    setMetadataOpen(true);
  }

  async function saveMetadata(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    const allocations = Object.entries(metadataAllocations)
      .filter(([, percentage]) => Number(percentage) > 0)
      .map(([targetWorkId, percentage]) => ({ workId: targetWorkId, percentage: Number(percentage) }));
    try {
      const response = await fetch(`/api/payments/${selected.id}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tagIds: metadataTags,
          allocations,
          hasReceipt: metadataReceipt,
          receiptReceivedAt: metadataReceipt && metadataReceiptDate ? metadataReceiptDate : null,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Não foi possível salvar a classificação.");
        return;
      }
      setMetadataOpen(false);
      setMessage("Tags, comprovante e rateio atualizados.");
      reload();
    } catch {
      setError("Falha de conexão ao salvar a classificação.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Aplica a acao a cada pagamento do lote. Vai um a um de proposito: reusa a
   * rota individual (com o RBAC e as regras de status que ela ja aplica) e
   * deixa cada pagamento com seu proprio registro na auditoria. Um erro em um
   * item nao aborta o resto; no fim o usuario ve o que falhou e por que.
   */
  async function runBatch(event: FormEvent) {
    event.preventDefault();
    if (batchPayments.length === 0) return;

    setBusy(true);
    setError("");
    setMessage("");
    setBatchProgress(0);

    const payload: Record<string, unknown> =
      batchAction === "approve"
        ? {}
        : batchAction === "transfer"
          ? { reason: batchReason, standardReasonId: batchStandardReasonId || undefined, newDueDate: batchDueDate }
          : { reason: batchReason, standardReasonId: batchStandardReasonId || undefined };

    const result: BatchResult = { done: 0, failed: [] };

    for (const payment of batchPayments) {
      try {
        const response = await fetch(`/api/payments/${payment.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: batchAction, ...payload }),
        });

        if (response.ok) {
          result.done += 1;
        } else {
          const data = await response.json();
          result.failed.push({
            supplier: payment.supplierName,
            error: data.error ?? "erro desconhecido",
          });
        }
      } catch {
        result.failed.push({ supplier: payment.supplierName, error: "falha de conexão" });
      }

      setBatchProgress((value) => value + 1);
    }

    setBusy(false);
    setBatchOpen(false);
    setBatch([]);
    setBatchReason("");
    setBatchStandardReasonId("");
    setBatchDueDate("");
    setBatchProgress(0);

    const verb = batchActionLabels[batchAction].toLowerCase();
    if (result.failed.length === 0) {
      setMessage(`${result.done} pagamento(s) processado(s) com sucesso (${verb}).`);
    } else {
      setMessage(result.done > 0 ? `${result.done} pagamento(s) processado(s).` : "");
      setError(
        `${result.failed.length} falhou(ram): ` +
          result.failed
            .slice(0, 3)
            .map((item) => `${item.supplier} (${item.error})`)
            .join("; ") +
          (result.failed.length > 3 ? ` e mais ${result.failed.length - 3}.` : ""),
      );
    }

    reload();
  }

  function onSubmitModal(event: FormEvent) {
    event.preventDefault();
    if (!mode) return;

    if (mode === "transfer") {
      void runAction("transfer", {
        reason,
        standardReasonId: standardReasonId || undefined,
        newDueDate,
      });
      return;
    }

    void runAction(mode, { reason, standardReasonId: standardReasonId || undefined });
  }

  if (!flowsLoading && flowData && flowData.flows.length === 0) {
    return (
      <section className="empty-state panel" aria-labelledby="payments-empty-title">
        <span className="empty-state-icon" aria-hidden="true">
          <FileSpreadsheet size={24} />
        </span>
        <span className="eyebrow">NENHUM FLUXO CRIADO</span>
        <h2 id="payments-empty-title">Os pagamentos começam pela importação</h2>
        <p>
          Envie a planilha do dia para validar os lançamentos e criar a sessão de aprovação.
          Depois disso, as decisões individuais e em lote aparecerão aqui.
        </p>
        <button className="button" type="button" onClick={() => goToTab("importar")}>
          Ir para importação
        </button>
      </section>
    );
  }

  return (
    <>
      {selectedFlow ? (
        <section className="panel pad form-grid">
          <div className="section-header">
            <div>
              <h2>{selectedFlow.name}</h2>
              <span className={`status ${flowStatusClasses[selectedFlow.status]}`}>
                {flowStatusLabels[selectedFlow.status]}
              </span>
              {selectedFlow.status === "FECHADO" ? (
                <small className="muted flow-closed-info">
                  Fechado em {selectedFlow.closedAt ? dateTime(selectedFlow.closedAt) : "-"}
                  {selectedFlow.closedBy ? ` por ${selectedFlow.closedBy.name}` : ""}.
                </small>
              ) : null}
            </div>
            <div className="button-row">
              {selectedFlow.status === "RASCUNHO" ? (
                <button
                  className="button"
                  type="button"
                  onClick={() => void changeFlow("start_approval")}
                  disabled={flowBusy}
                >
                  <Play size={16} />
                  Enviar para aprovação
                </button>
              ) : null}
              {selectedFlow.status === "EM_APROVACAO" && canConcludeFlow ? (
                <button
                  className="button success"
                  type="button"
                  onClick={() => void changeFlow("close")}
                  disabled={flowBusy || selectedFlow.summary.undecidedCount > 0}
                  title={
                    selectedFlow.summary.undecidedCount > 0
                      ? `Ainda existem ${selectedFlow.summary.undecidedCount} pagamento(s) aguardando decisão`
                      : "Aprovar e bloquear o fluxo diário"
                  }
                >
                  <LockKeyhole size={16} />
                  Aprovar e fechar fluxo
                </button>
              ) : null}
              {selectedFlow.status === "FECHADO" ? (
                <>
                  <a
                    className="button secondary"
                    href={`/api/daily-flows/${selectedFlow.id}/report`}
                  >
                    <FileDown size={16} />
                    Relatório final
                  </a>
                  {isCoordinator ? (
                    <button
                      className="button warning"
                      type="button"
                      onClick={() => setFlowReopenOpen(true)}
                      disabled={flowBusy}
                    >
                      <RotateCcw size={16} />
                      Reabrir fechamento
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="toolbar">
            <div className="field">
              <label htmlFor="daily-flow">Fluxo diário</label>
              <select
                className="select"
                id="daily-flow"
                value={effectiveFlowId}
                onChange={(event) => {
                  setFlowId(event.target.value);
                  setBatch([]);
                }}
                disabled={flowsLoading || flowBusy}
              >
                {flowData?.flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name} - {flowStatusLabels[flow.status]}
                  </option>
                ))}
              </select>
            </div>
            {selectedFlow.status !== "FECHADO" ? (
              <span className="muted">
                {selectedFlow.status === "RASCUNHO"
                  ? "Ajustes e conferências estão liberados."
                  : `${selectedFlow.summary.undecidedCount} pagamento(s) aguardando decisão.`}
              </span>
            ) : null}
          </div>

          {selectedFlow.status === "FECHADO" ? (
            <section className="approval-stats">
              <div className="approval-stat approval-stat-success">
                <span>Aprovados</span>
                <strong>{selectedFlow.summary.approved.count}</strong>
                <small>{money(selectedFlow.summary.approved.amount)}</small>
              </div>
              <div className="approval-stat approval-stat-danger">
                <span>Reprovados</span>
                <strong>{selectedFlow.summary.rejected.count}</strong>
                <small>{money(selectedFlow.summary.rejected.amount)}</small>
              </div>
              <div className="approval-stat approval-stat-warning">
                <span>Remarcados</span>
                <strong>{selectedFlow.summary.transferred.count}</strong>
                <small>{money(selectedFlow.summary.transferred.amount)}</small>
              </div>
            </section>
          ) : null}
        </section>
      ) : flowsLoading ? (
        <div className="panel pad">Carregando fluxos diários...</div>
      ) : (
        <div className="alert">Importe uma planilha para criar o primeiro fluxo diário.</div>
      )}

      <section className="approval-stats">
        <div className="approval-stat approval-stat-success">
          <span>Aprovados</span>
          <strong>
            {summary.approved} / {summary.total}
          </strong>
          <small>no filtro atual</small>
        </div>
        <div className="approval-stat approval-stat-warning">
          <span>Data alterada</span>
          <strong>{summary.alteredDate}</strong>
          <small>remarcados</small>
        </div>
        <div className="approval-stat approval-stat-danger">
          <span>Reprovados</span>
          <strong>{summary.rejected}</strong>
          <small>com justificativa</small>
        </div>
      </section>

      <section className="toolbar">
        <select
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value as "" | StatusKey)}
          aria-label="Filtrar por status"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
          aria-label="Filtrar por conta"
        >
          <option value="">Todas as contas</option>
          {user.works.map((work) => (
            <option key={work.id} value={work.id}>
              {work.name}
            </option>
          ))}
        </select>

        <input
          className="input"
          placeholder="Buscar fornecedor, descrição ou categoria"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar"
        />

        <button
          className="button secondary"
          type="button"
          onClick={() => setAppliedSearch(search.trim())}
        >
          <Search size={16} />
          Buscar
        </button>

        {/* So habilita depois que ha pelo menos um pagamento marcado na lista. */}
        <button
          className="button"
          type="button"
          disabled={batchPayments.length === 0 || busy || flowLocked}
          onClick={() => setBatchOpen(true)}
          title={
            batchPayments.length === 0
              ? "Clique nos pagamentos da lista para selecioná-los"
              : `Aplicar uma ação aos ${batchPayments.length} pagamentos selecionados`
          }
        >
          <ListChecks size={16} />
          Ações em lote{batchPayments.length > 0 ? ` (${batchPayments.length})` : ""}
        </button>

        {batchPayments.length > 0 ? (
          <button className="button ghost" type="button" onClick={() => setBatch([])}>
            Limpar seleção
          </button>
        ) : null}
      </section>

      {flowError ? <div className="alert error" role="alert">{flowError}</div> : null}
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <section className="split-grid">
        <div className="section">
          <div className="section-header">
            <h2>Pagamentos ({payments.length})</h2>
            <button className="button ghost" type="button" onClick={reload} disabled={loading}>
              <RefreshCw size={16} />
              Atualizar
            </button>
          </div>

          <div className="approval-list">
            {loading ? <div className="panel pad">Carregando...</div> : null}
            {!loading && payments.length === 0 ? (
              <div className="empty">Nenhum pagamento encontrado com esse filtro.</div>
            ) : null}
            {payments.map((payment) => (
              <button
                key={payment.id}
                type="button"
                className={`payment-row ${batch.includes(payment.id) ? "active" : ""}`}
                onClick={() => toggleBatch(payment.id)}
                aria-pressed={batch.includes(payment.id)}
              >
                <div>
                  <strong>{payment.supplierName}</strong>
                  <small>{payment.description}</small>
                  <br />
                  <small className="muted">
                    {payment.work.name} · {shortDate(payment.currentDueDate)}
                  </small>
                </div>
                <div style={{ textAlign: "right", display: "grid", gap: 6 }}>
                  <Money value={payment.amount} />
                  <StatusBadge status={payment.status} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-header">
            <h2>Detalhes</h2>
          </div>
          <div className="panel pad">
            {!selected ? (
              <p className="muted">Selecione um pagamento para ver os detalhes.</p>
            ) : (
              <>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>Fornecedor</span>
                    <strong>{selected.supplierName}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Descrição</span>
                    <strong>{selected.description}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Categoria</span>
                    <strong>{selected.category || "-"}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Conta / centro de custo</span>
                    <strong>
                      {selected.work.name} ({selected.costCenter})
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span>Vencimento</span>
                    <strong>{shortDate(selected.currentDueDate)}</strong>
                    {selected.originalDueDate !== selected.currentDueDate ? (
                      <small className="muted">
                        Original: {shortDate(selected.originalDueDate)}
                      </small>
                    ) : null}
                  </div>
                  <div className="detail-item">
                    <span>Valor</span>
                    <strong>
                      <Money value={selected.amount} />
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span>Status</span>
                    <StatusBadge status={selected.status} />
                  </div>
                  <div className="detail-item">
                    <span>Alçada</span>
                    <strong>
                      {selected.approvals?.length ?? 0} / {selected.requiredApprovals} aprovação(ões)
                    </strong>
                    <small className="muted">
                      {selected.appliedApprovalRule?.name ?? `Perfil mínimo: ${selected.requiredApprovalRole}`}
                    </small>
                  </div>
                  <div className="detail-item">
                    <span>Nota / comprovante</span>
                    <strong>{selected.hasReceipt ? "Recebido" : "Pendente"}</strong>
                    {selected.receiptReceivedAt ? <small>{shortDate(selected.receiptReceivedAt)}</small> : null}
                  </div>
                </div>

                {selected.tags?.length ? (
                  <div className="tag-list" style={{ marginTop: 12 }}>
                    {selected.tags.map(({ tag }) => (
                      <span className="tag-chip" style={{ borderColor: tag.color }} key={tag.id}>
                        <i style={{ background: tag.color }} /> {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}

                {selected.allocations?.length ? (
                  <div className="alert" style={{ marginTop: 12 }}>
                    <strong>Rateio:</strong>{" "}
                    {selected.allocations.map((item) => `${item.work.name} ${item.percentage}%`).join(" · ")}
                  </div>
                ) : null}

                <div className="button-row" style={{ marginTop: 14 }}>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || flowLocked}
                    onClick={openMetadata}
                  >
                    <Tags size={16} /> Classificar e ratear
                  </button>
                  <button
                    className="button success"
                    type="button"
                    disabled={busy || flowLocked || selected.status === "APROVADO"}
                    onClick={() => void runAction("approve")}
                  >
                    <CheckCircle2 size={16} />
                    Aprovar
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={busy || flowLocked || selected.status === "APROVADO"}
                    onClick={() => setMode("reject")}
                  >
                    <XCircle size={16} />
                    Reprovar
                  </button>
                  <button
                    className="button warning"
                    type="button"
                    disabled={busy || flowLocked || selected.status === "APROVADO"}
                    onClick={() => {
                      setNewDueDate(selected.currentDueDate.slice(0, 10));
                      setMode("transfer");
                    }}
                  >
                    <CalendarDays size={16} />
                    Alterar data
                  </button>
                  {isCoordinator ? (
                    <>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busy || flowLocked || selected.status === "CANCELADO"}
                        onClick={() => setMode("cancel")}
                      >
                        <XCircle size={16} />
                        Cancelar
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={busy || flowLocked}
                        onClick={() => setMode("reopen")}
                      >
                        <RotateCcw size={16} />
                        Voltar para em aberto
                      </button>
                    </>
                  ) : null}
                </div>

                {selected.actions?.length ? (
                  <div style={{ marginTop: 16 }}>
                    <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Histórico</h3>
                    <div className="detail-list">
                      {selected.actions.map((action) => (
                        <div className="detail-item" key={action.id}>
                          <span>
                            {action.type} · {dateTime(action.createdAt)}
                          </span>
                          <strong>{action.actor?.name ?? "Sistema"}</strong>
                          {action.reason ? (
                            <small className="muted">{action.reason}</small>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>

      {mode ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-action-title"
        >
          <form className="modal" onSubmit={onSubmitModal}>
            <h2 id="payment-action-title">{modeLabels[mode]}</h2>
            <p>{selected?.supplierName}</p>

            {mode === "transfer" ? (
              <div className="field">
                <label htmlFor="new-due-date">Nova data</label>
                <input
                  className="input"
                  id="new-due-date"
                  type="date"
                  value={newDueDate}
                  onChange={(event) => setNewDueDate(event.target.value)}
                  required
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="standard-reason">Motivo padronizado</label>
              <select
                className="select"
                id="standard-reason"
                value={standardReasonId}
                onChange={(event) => setStandardReasonId(event.target.value)}
              >
                <option value="">Outro motivo</option>
                {options?.reasons
                  .filter((item) => item.action === ({ reject: "REPROVAR", transfer: "TRANSFERIR", cancel: "CANCELAR", reopen: "REABRIR" } as const)[mode])
                  .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="reason">{standardReasonId ? "Complemento (opcional)" : "Motivo"}</label>
              <textarea
                className="textarea"
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required={!standardReasonId}
                minLength={3}
              />
            </div>

            <div className="button-row">
              <button className="button" type="submit" disabled={busy}>
                {busy ? "Enviando..." : "Confirmar"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setMode(null);
                  setReason("");
                  setStandardReasonId("");
                }}
                disabled={busy}
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {metadataOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal modal-wide" onSubmit={saveMetadata}>
            <h2><Split size={20} /> Classificação e rateio</h2>
            <p>{selected?.supplierName} · {selected ? money(selected.amount) : ""}</p>
            <div className="field">
              <label>Tags</label>
              <div className="tag-list">
                {options?.tags.map((tag) => (
                  <label className="tag-chip" style={{ borderColor: tag.color }} key={tag.id}>
                    <input
                      type="checkbox"
                      checked={metadataTags.includes(tag.id)}
                      onChange={() => setMetadataTags((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                    />
                    <i style={{ background: tag.color }} /> {tag.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-grid two">
              <label className="check-row span-2">
                <input type="checkbox" checked={metadataReceipt} onChange={(event) => setMetadataReceipt(event.target.checked)} />
                Nota fiscal ou comprovante recebido
              </label>
              {metadataReceipt ? <div className="field"><label>Data do recebimento</label><input className="input" type="date" value={metadataReceiptDate} onChange={(event) => setMetadataReceiptDate(event.target.value)} /></div> : null}
              <div className="field span-2"><label>Rateio manual (deixe todos vazios para usar somente a obra principal)</label></div>
              {options?.works.map((work) => (
                <div className="field" key={work.id}>
                  <label>{work.name}</label>
                  <div className="input-suffix"><input className="input" type="number" min="0" max="100" step="0.01" value={metadataAllocations[work.id] ?? ""} onChange={(event) => setMetadataAllocations({ ...metadataAllocations, [work.id]: event.target.value })} /><span>%</span></div>
                </div>
              ))}
            </div>
            <div className="button-row"><button className="button" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setMetadataOpen(false)}>Voltar</button></div>
          </form>
        </div>
      ) : null}

      {batchOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-action-title"
        >
          <form className="modal" onSubmit={runBatch}>
            <h2 id="batch-action-title">Ações em lote</h2>
            <p>
              {batchPayments.length} pagamento(s) selecionado(s) · {money(batchTotal)}
            </p>

            <div className="field">
              <label htmlFor="batch-action">Ação</label>
              <select
                className="select"
                id="batch-action"
                value={batchAction}
                onChange={(event) => setBatchAction(event.target.value as BatchAction)}
                disabled={busy}
              >
                <option value="approve">Aprovar os {batchPayments.length}</option>
                <option value="reject">Reprovar os {batchPayments.length}</option>
                <option value="transfer">Alterar a data dos {batchPayments.length}</option>
                {/* Voltar para em aberto é crítico: a rota só aceita do administrador. */}
                {isCoordinator ? (
                  <option value="reopen">Voltar os {batchPayments.length} para em aberto</option>
                ) : null}
              </select>
            </div>

            {batchAction === "transfer" ? (
              <div className="field">
                <label htmlFor="batch-date">Nova data (para todos)</label>
                <input
                  className="input"
                  id="batch-date"
                  type="date"
                  value={batchDueDate}
                  onChange={(event) => setBatchDueDate(event.target.value)}
                  required
                  disabled={busy}
                />
              </div>
            ) : null}

            {batchAction !== "approve" ? (
              <>
                <div className="field">
                  <label htmlFor="batch-standard-reason">Motivo padronizado</label>
                  <select className="select" id="batch-standard-reason" value={batchStandardReasonId} onChange={(event) => setBatchStandardReasonId(event.target.value)} disabled={busy}>
                    <option value="">Outro motivo</option>
                    {options?.reasons
                      .filter((item) => item.action === ({ reject: "REPROVAR", transfer: "TRANSFERIR", reopen: "REABRIR", approve: "" } as const)[batchAction])
                      .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="batch-reason">{batchStandardReasonId ? "Complemento (opcional)" : "Motivo (aplicado a todos)"}</label>
                  <textarea
                    className="textarea"
                    id="batch-reason"
                    value={batchReason}
                    onChange={(event) => setBatchReason(event.target.value)}
                    required={!batchStandardReasonId}
                    minLength={batchStandardReasonId ? undefined : 3}
                    disabled={busy}
                  />
                </div>
              </>
            ) : null}

            <div className="panel pad" style={{ maxHeight: 140, overflowY: "auto" }}>
              {batchPayments.map((payment) => (
                <div key={payment.id} style={{ fontSize: 12 }}>
                  <span className="muted">{payment.work.name}</span> {payment.supplierName} ·{" "}
                  <Money value={payment.amount} />
                </div>
              ))}
            </div>

            {busy ? (
              <p className="muted">
                Processando {batchProgress} de {batchPayments.length}...
              </p>
            ) : null}

            <div className="button-row">
              <button className="button" type="submit" disabled={busy}>
                {busy ? "Processando..." : `Confirmar ${batchActionLabels[batchAction]}`}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setBatchOpen(false)}
                disabled={busy}
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {flowReopenOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-flow-title"
        >
          <form
            className="modal"
            onSubmit={(event) => {
              event.preventDefault();
              void changeFlow("reopen", flowReason);
            }}
          >
            <h2 id="reopen-flow-title">Reabrir fechamento</h2>
            <p>{selectedFlow?.name}</p>
            <div className="field">
              <label htmlFor="flow-reopen-reason">Motivo da reabertura</label>
              <textarea
                className="textarea"
                id="flow-reopen-reason"
                value={flowReason}
                onChange={(event) => setFlowReason(event.target.value)}
                required
                minLength={3}
              />
            </div>
            <div className="button-row">
              <button className="button warning" type="submit" disabled={flowBusy}>
                {flowBusy ? "Reabrindo..." : "Confirmar reabertura"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setFlowReopenOpen(false);
                  setFlowReason("");
                }}
                disabled={flowBusy}
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
