"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime } from "@/lib/format";

type SessionRow = {
  id: string;
  provider: string;
  ipAddress: string | null;
  device: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  user: { id: string; name: string; username: string; lastLoginAt: string | null };
};

type LoginEventRow = {
  id: string;
  identifier: string;
  provider: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  device: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string } | null;
};

type SessionsResponse = {
  sessions: SessionRow[];
  loginEvents: LoginEventRow[];
  currentSessionId: string | null;
};

export function AdminSessions() {
  const { data, error, loading, reload, setError } =
    useFetchData<SessionsResponse>("/api/admin/sessions");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function revoke(session: SessionRow) {
    if (!confirm(`Encerrar a sessão de ${session.user.name}?`)) return;
    setBusyId(session.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const detail =
          value && typeof value === "object" && "error" in value && typeof value.error === "string"
            ? value.error
            : "Não foi possível encerrar a sessão.";
        throw new Error(detail);
      }
      setMessage("Sessão encerrada.");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Sessões e acessos</h2>
          <span className="muted">Acompanhe dispositivos, último acesso e encerre sessões remotamente.</span>
        </div>
        <button className="button secondary" type="button" onClick={reload} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Usuário</th><th>Dispositivo</th><th>IP</th><th>Último acesso</th><th /></tr></thead>
            <tbody>
              {(data?.sessions ?? []).map((session) => (
                <tr key={session.id}>
                  <td><strong>{session.user.name}</strong><small className="muted">{session.provider === "oidc" ? "Corporativo" : "Local"}{session.id === data?.currentSessionId ? " · sessão atual" : ""}</small></td>
                  <td>{session.device ?? "Não identificado"}</td>
                  <td>{session.ipAddress ?? "—"}</td>
                  <td>{dateTime(session.lastSeenAt)}<small className="muted">Login: {dateTime(session.createdAt)}</small></td>
                  <td><button className="button danger" type="button" disabled={busyId === session.id} onClick={() => revoke(session)}><LogOut size={15} /> Encerrar</button></td>
                </tr>
              ))}
              {!loading && !data?.sessions.length ? <tr><td colSpan={5} className="daily-flow-empty">Nenhuma sessão aberta.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Data</th><th>Identificação</th><th>Origem</th><th>Dispositivo</th><th>Resultado</th></tr></thead>
            <tbody>
              {(data?.loginEvents ?? []).map((event) => (
                <tr key={event.id}>
                  <td>{dateTime(event.createdAt)}</td>
                  <td>{event.user?.name ?? event.identifier}<small className="muted">{event.identifier}</small></td>
                  <td>{event.provider === "oidc" ? "Corporativo" : "Local"}<small className="muted">{event.ipAddress ?? "IP não identificado"}</small></td>
                  <td>{event.device ?? "Não identificado"}</td>
                  <td><span className={`badge ${event.success ? "APROVADO" : "REPROVADO"}`}>{event.success ? "Sucesso" : event.reason ?? "Falhou"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
