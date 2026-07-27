"use client";

import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminSessions } from "@/components/panel/AdminSessions";
import { SystemDataActions } from "@/components/panel/SystemDataActions";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime } from "@/lib/format";

type AuditLog = {
  id: string;
  event: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string; username: string } | null;
  createdAt: string;
};

type AuditResponse = {
  logs: AuditLog[];
  events: { event: string; count: number }[];
  actors: { id: string; name: string; username: string }[];
  error?: string;
};

/** Traducao dos eventos gravados pelo backend. */
const eventLabels: Record<string, string> = {
  LOGIN: "Entrou no sistema",
  SOLICITACAO_ACESSO: "Solicitou acesso",
  ACESSO_APROVADO: "Aprovou acesso",
  ACESSO_RECUSADO: "Recusou acesso",
  USUARIO_CRIADO: "Criou usuário",
  USUARIO_ATUALIZADO: "Atualizou usuário",
  USUARIO_DESATIVADO: "Desativou usuário",
  USUARIO_EXCLUIDO: "Excluiu usuário",
  IMPORT_CONFIRM: "Importou planilha",
  FLUXO_CONVERTIDO: "Converteu planilha bruta",
  CONCILIACAO_EXECUTADA: "Conciliou despesas do cartão",
  NOTAS_FALTANTES_EXPORTADAS: "Exportou notas faltantes",
  FLUXO_ENVIADO_APROVACAO: "Enviou fluxo para aprovação",
  FLUXO_FECHADO: "Fechou fluxo diário",
  FLUXO_REABERTO: "Reabriu fluxo diário",
  RELATORIO_FLUXO_GERADO: "Gerou relatório final do fluxo",
  PAGAMENTO_ACAO: "Ação em pagamento",
  CONTA_CRIADA: "Criou conta",
  CONTA_ATUALIZADA: "Atualizou conta",
  BACKUP_LOG_GERADO: "Gerou backup dos logs",
  AUDITORIA_LIMPA: "Limpou os logs",
};

const eventClass: Record<string, string> = {
  LOGIN: "TRANSFERIDO",
  SOLICITACAO_ACESSO: "PENDENTE",
  ACESSO_APROVADO: "APROVADO",
  ACESSO_RECUSADO: "REPROVADO",
  USUARIO_EXCLUIDO: "REPROVADO",
  USUARIO_DESATIVADO: "CANCELADO",
  IMPORT_CONFIRM: "APROVADO",
  AUDITORIA_LIMPA: "CANCELADO",
  BACKUP_LOG_GERADO: "TRANSFERIDO",
};

/**
 * Achata o metadata em texto legível. As alterações de usuário vêm como
 * { campo: { de, para } }, que vira "perfil: OPERADOR -> APROVADOR".
 */
function describeMetadata(metadata: Record<string, unknown>): string[] {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === "") continue;

    if (key === "changes" && typeof value === "object") {
      for (const [field, change] of Object.entries(value as Record<string, unknown>)) {
        const detail = change as { de?: unknown; para?: unknown };
        parts.push(`${field}: ${String(detail.de)} → ${String(detail.para)}`);
      }
      continue;
    }

    if (typeof value === "object") {
      parts.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }

    parts.push(`${key}: ${String(value)}`);
  }

  return parts;
}

export function LogsTab() {
  const [event, setEvent] = useState("");
  const [actorId, setActorId] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");

  // Mudar um filtro muda a url e o hook refaz a busca sozinho.
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (event) params.set("event", event);
    if (actorId) params.set("actorId", actorId);
    return `/api/admin/audit?${params.toString()}`;
  }, [event, actorId]);

  const { data, error, loading, reload } = useFetchData<AuditResponse>(url);

  async function backupLogs() {
    setBackupBusy(true);
    setActionError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/audit?download=true", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível criar o backup dos logs.");
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? "logs.json";
      const target = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = target;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(target);
      setMessage("Backup dos logs baixado com sucesso.");
      reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Falha ao criar o backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function clearLogs() {
    const confirmation = window.prompt(
      "Esta ação apaga todo o histórico de auditoria. Digite LIMPAR LOGS para confirmar.",
    );
    if (confirmation !== "LIMPAR LOGS") return;
    setClearBusy(true);
    setActionError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/audit", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ confirmation }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const detail =
          value && typeof value === "object" && "error" in value && typeof value.error === "string"
            ? value.error
            : "Não foi possível limpar os logs.";
        throw new Error(detail);
      }
      const deleted =
        value && typeof value === "object" && "deleted" in value && typeof value.deleted === "number"
          ? value.deleted
          : 0;
      setEvent("");
      setActorId("");
      setMessage(`${deleted} registro(s) removido(s). A limpeza foi registrada.`);
      reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Falha ao limpar os logs.");
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {actionError ? <div className="alert error" role="alert">{actionError}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <section className="toolbar">
        <select
          className="select"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          aria-label="Filtrar por evento"
        >
          <option value="">Todos os eventos</option>
          {data?.events.map((item) => (
            <option key={item.event} value={item.event}>
              {eventLabels[item.event] ?? item.event} ({item.count})
            </option>
          ))}
        </select>

        <select
          className="select"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          aria-label="Filtrar por usuário"
        >
          <option value="">Todos os usuários</option>
          {data?.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>

        <button className="button secondary" type="button" onClick={reload}>
          <RefreshCw size={16} />
          Atualizar
        </button>
        <button className="button secondary" type="button" onClick={backupLogs} disabled={backupBusy || clearBusy}>
          <Download size={16} />
          {backupBusy ? "Criando backup..." : "Backup dos logs"}
        </button>
        <button className="button danger" type="button" onClick={clearLogs} disabled={backupBusy || clearBusy}>
          <Trash2 size={16} />
          {clearBusy ? "Limpando..." : "Limpar logs"}
        </button>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Registro de ações ({data?.logs.length ?? 0})</h2>
        </div>

        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O quê</th>
                  <th>Onde</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={5}>
                      Carregando...
                    </td>
                  </tr>
                ) : null}
                {data?.logs.map((log) => {
                  const details = describeMetadata(log.metadata);
                  return (
                    <tr key={log.id}>
                      <td>{dateTime(log.createdAt)}</td>
                      <td>
                        {log.actor ? (
                          <>
                            {log.actor.name}
                            <br />
                            <small className="muted">{log.actor.username}</small>
                          </>
                        ) : (
                          <span className="muted">Sistema</span>
                        )}
                      </td>
                      <td>
                        <span className={`status ${eventClass[log.event] ?? "TRANSFERIDO"}`}>
                          {eventLabels[log.event] ?? log.event}
                        </span>
                      </td>
                      <td>
                        <small className="muted">{log.entity}</small>
                      </td>
                      <td>
                        {details.length ? (
                          <small className="muted">{details.join(" · ")}</small>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && data?.logs.length === 0 ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={5}>
                      Nenhuma ação registrada com esse filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <AdminSessions />
      <SystemDataActions onReset={reload} />
    </>
  );
}
