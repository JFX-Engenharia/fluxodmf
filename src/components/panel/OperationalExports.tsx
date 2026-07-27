"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";

const exportTypes = [
  ["payments", "Pagamentos por período"],
  ["accounts", "Contas e saldos"],
  ["advances", "Prestações de contas"],
  ["requests", "Solicitações"],
  ["documents", "Pendências de documentos"],
  ["audit", "Logs de auditoria"],
] as const;

const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
const today = now.toISOString().slice(0, 10);

export function OperationalExports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function download(type: string) {
    setBusy(type);
    setError("");
    try {
      const response = await fetch(`/api/exports?type=${type}&from=${from}&to=${to}`);
      if (!response.ok) {
        const value: unknown = await response.json();
        const detail =
          value && typeof value === "object" && "error" in value && typeof value.error === "string"
            ? value.error
            : "Não foi possível gerar a planilha.";
        throw new Error(detail);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? `${type}.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de conexão.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="section">
      <div className="section-header"><div><h2>Exportações operacionais</h2><span className="muted">Baixe planilhas Excel filtradas pelo período informado.</span></div></div>
      <div className="panel pad form-grid">
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        <div className="toolbar">
          <label className="field"><span>De</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>Até</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        <div className="button-row">
          {exportTypes.map(([type, label]) => (
            <button className="button secondary" type="button" key={type} disabled={!!busy || !from || !to} onClick={() => download(type)}>
              <FileSpreadsheet size={16} /> {busy === type ? "Gerando..." : label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
