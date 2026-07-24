"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
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
};

const eventClass: Record<string, string> = {
  LOGIN: "TRANSFERIDO",
  SOLICITACAO_ACESSO: "PENDENTE",
  ACESSO_APROVADO: "APROVADO",
  ACESSO_RECUSADO: "REPROVADO",
  USUARIO_EXCLUIDO: "REPROVADO",
  USUARIO_DESATIVADO: "CANCELADO",
  IMPORT_CONFIRM: "APROVADO",
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

  // Mudar um filtro muda a url e o hook refaz a busca sozinho.
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (event) params.set("event", event);
    if (actorId) params.set("actorId", actorId);
    return `/api/admin/audit?${params.toString()}`;
  }, [event, actorId]);

  const { data, error, loading, reload } = useFetchData<AuditResponse>(url);

  return (
    <>
      {error ? <div className="alert error" role="alert">{error}</div> : null}

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
    </>
  );
}
