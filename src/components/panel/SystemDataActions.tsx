"use client";

import { Download, RotateCcw } from "lucide-react";
import { useState } from "react";

export function SystemDataActions() {
  const [backupBusy, setBackupBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function downloadBackup() {
    setBackupBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/system", { cache: "no-store" });
      if (!response.ok) {
        const body: unknown = await response.json();
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Não foi possível gerar o backup.";
        throw new Error(message);
      }

      const file = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = contentDisposition.match(/filename="?([^";]+)"?/)?.[1] ?? "fluxo-backup.json";
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Backup baixado com sucesso.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao gerar o backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function resetOperationalData() {
    const confirmation = window.prompt(
      "Esta ação apaga permanentemente os dados operacionais. Digite RESETAR para confirmar.",
    );
    if (confirmation !== "RESETAR") return;

    setResetBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", confirmation }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Não foi possível resetar os dados.";
        throw new Error(message);
      }
      setMessage("Dados operacionais resetados. Os indicadores voltaram a zero.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao resetar os dados.");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Dados do sistema</h2>
          <span className="muted">
            Gere um backup antes de resetar. O reset remove pagamentos, importações, solicitações,
            adiantamentos e seus históricos; usuários, obras e configurações são preservados.
          </span>
        </div>
      </div>
      <div className="panel pad form-grid">
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        {message ? <div className="alert success" role="status">{message}</div> : null}
        <div className="button-row">
          <button className="button secondary" type="button" disabled={backupBusy || resetBusy} onClick={downloadBackup}>
            <Download size={16} />
            {backupBusy ? "Gerando backup..." : "Criar backup"}
          </button>
          <button className="button danger" type="button" disabled={backupBusy || resetBusy} onClick={resetOperationalData}>
            <RotateCcw size={16} />
            {resetBusy ? "Resetando dados..." : "Resetar valores para zero"}
          </button>
        </div>
      </div>
    </section>
  );
}
