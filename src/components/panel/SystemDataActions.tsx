"use client";

import { Download, FileUp, RotateCcw } from "lucide-react";
import { ChangeEvent, useRef, useState } from "react";

type SystemDataActionsProps = {
  onReset: () => void;
};

export function SystemDataActions({ onReset }: SystemDataActionsProps) {
  const [backupBusy, setBackupBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
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

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !confirm("Restaurar este backup substituirá todos os dados operacionais atuais. Continuar?")) return;
    setRestoreBusy(true);
    setMessage("");
    setError("");
    try {
      const content = await file.text();
      JSON.parse(content);
      const response = await fetch("/api/admin/system/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: content,
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const detail =
          value && typeof value === "object" && "error" in value && typeof value.error === "string"
            ? value.error
            : "Não foi possível restaurar o backup.";
        throw new Error(detail);
      }
      setMessage("Backup restaurado com sucesso.");
      onReset();
    } catch (caught) {
      setError(caught instanceof SyntaxError ? "O arquivo não contém um backup JSON válido." : caught instanceof Error ? caught.message : "Falha ao restaurar o backup.");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function resetOperationalData() {
    const confirmation = window.prompt(
      "Esta ação apaga permanentemente os dados operacionais e as contas financeiras. Usuários serão mantidos. Digite RESETAR para confirmar.",
    );
    if (confirmation !== "RESETAR") return;

    setResetBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
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
      const deletedWorks =
        body &&
        typeof body === "object" &&
        "result" in body &&
        body.result &&
        typeof body.result === "object" &&
        "works" in body.result &&
        typeof body.result.works === "number"
          ? body.result.works
          : null;
      setMessage(
        deletedWorks === null
          ? "Dados operacionais resetados. Os indicadores voltaram a zero."
          : `Dados operacionais resetados. ${deletedWorks} conta(s) financeira(s) removida(s).`,
      );
      onReset();
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
            adiantamentos, contas financeiras e seus históricos. Usuários e regras são preservados.
          </span>
        </div>
      </div>
      <div className="panel pad form-grid">
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        {message ? <div className="alert success" role="status">{message}</div> : null}
        <div className="button-row">
          <button className="button secondary" type="button" disabled={backupBusy || resetBusy || restoreBusy} onClick={downloadBackup}>
            <Download size={16} />
            {backupBusy ? "Gerando backup..." : "Criar backup"}
          </button>
          <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={restoreBackup} />
          <button className="button secondary" type="button" disabled={backupBusy || resetBusy || restoreBusy} onClick={() => restoreInput.current?.click()}>
            <FileUp size={16} />
            {restoreBusy ? "Restaurando..." : "Restaurar backup"}
          </button>
          <button className="button danger" type="button" disabled={backupBusy || resetBusy || restoreBusy} onClick={resetOperationalData}>
            <RotateCcw size={16} />
            {resetBusy ? "Resetando dados..." : "Resetar valores para zero"}
          </button>
        </div>
      </div>
    </section>
  );
}
