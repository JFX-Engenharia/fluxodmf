"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "fluxo-import-task";

type WatchedImportTask = {
  id: string;
  status: "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "FALHOU";
  importedRows: number;
  importedContributions: number;
  error: string;
};

export function ImportTaskWatcher() {
  const [taskId, setTaskId] = useState("");
  const [toast, setToast] = useState<WatchedImportTask | null>(null);

  useEffect(() => {
    function syncTask() {
      const storedTaskId = localStorage.getItem(STORAGE_KEY) ?? "";
      setTaskId(storedTaskId);
      if (storedTaskId) setToast(null);
    }
    function syncStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) syncTask();
    }

    syncTask();
    window.addEventListener("fluxo-import-task", syncTask);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("fluxo-import-task", syncTask);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timeout: number | undefined;

    async function poll() {
      try {
        const response = await fetch("/api/imports/tasks", { cache: "no-store" });
        const data = (await response.json()) as { tasks?: WatchedImportTask[] };
        const task = data.tasks?.find(({ id }) => id === taskId);
        if (cancelled || !task) return;
        if (task.status === "CONFIRMADO" || task.status === "FALHOU") {
          setToast(task);
          return;
        }
      } catch {
        // A aba de importação exibe erros detalhados; o watcher tenta novamente.
      }
      if (!cancelled) timeout = window.setTimeout(() => void poll(), 5_000);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [taskId]);

  if (!toast) return null;
  const task = toast;

  const success = task.status === "CONFIRMADO";
  function dismiss() {
    if (localStorage.getItem(STORAGE_KEY) === task.id) {
      localStorage.removeItem(STORAGE_KEY);
    }
    setTaskId("");
    setToast(null);
  }

  return (
    <div
      className={`alert ${success ? "success" : "error"} import-task-toast`}
      role={success ? "status" : "alert"}
    >
      <span>
        {success
          ? `Importação concluída: ${task.importedRows} pagamento(s) e ${task.importedContributions} aporte(s).`
          : `A importação falhou: ${task.error || "erro não informado"}. Abra a aba Importação para tentar novamente.`}
      </span>
      <button
        className="icon-button"
        type="button"
        aria-label="Fechar notificação de importação"
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
