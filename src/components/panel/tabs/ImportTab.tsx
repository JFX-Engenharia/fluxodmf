"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  Wand2,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { Money } from "@/components/Money";
import { money, shortDate } from "@/lib/format";
import type { FlowConversion } from "@/lib/flow-converter";
import { missingInfoLabels, missingInfoSentence, UNDEFINED_MARKER } from "@/lib/missing-info";
import type { ImportPreview } from "@/types";

import { usePanel } from "@/components/panel/PanelContext";

type ImportStep = "convert" | "import" | "flow";

type ConfirmResponse = {
  taskId?: string;
  status?: "PENDENTE";
  error?: string;
};

type ImportTask = {
  id: string;
  status: "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "FALHOU";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
  importedRows: number;
  importedContributions: number;
  createdAccounts: string[];
  attempts: number;
  error: string;
  sourceFileName: string;
  flowName: string;
  flowId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type CreatedFlow = {
  id: string;
  name: string;
  importedRows: number;
  importedContributions: number;
  status: "RASCUNHO" | "EM_APROVACAO";
};

export function ImportTab() {
  const { goToTab } = usePanel();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [flowName, setFlowName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmKeyRef = useRef("");

  // Conversor do export bruto do Conta Azul.
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [conversion, setConversion] = useState<FlowConversion | null>(null);
  const [aportes, setAportes] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const rawInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("convert");
  const [createdFlow, setCreatedFlow] = useState<CreatedFlow | null>(null);
  const [sendingFlow, setSendingFlow] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [importTask, setImportTask] = useState<ImportTask | null>(null);

  useEffect(() => {
    const resume = window.setTimeout(() => {
      const storedTaskId = localStorage.getItem("fluxo-import-task");
      if (storedTaskId) {
        setTaskId(storedTaskId);
        setStep("flow");
      }
    }, 0);
    return () => window.clearTimeout(resume);
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    async function refreshTask() {
      try {
        const response = await fetch("/api/imports/tasks", { cache: "no-store" });
        const data = (await response.json()) as { tasks?: ImportTask[]; error?: string };
        if (!response.ok) {
          if (!cancelled) setError(data.error ?? "Não foi possível acompanhar a importação.");
          return;
        }
        const task = data.tasks?.find(({ id }) => id === taskId);
        if (!task || cancelled) return;
        setImportTask(task);
        if (task.status === "CONFIRMADO") {
          if (!task.flowId) {
            setError("A importação foi concluída, mas o fluxo não pôde ser aberto.");
            return;
          }
          setCreatedFlow({
            id: task.flowId,
            name: task.flowName,
            importedRows: task.importedRows,
            importedContributions: task.importedContributions,
            status: "RASCUNHO",
          });
          if (localStorage.getItem("fluxo-import-task") === task.id) {
            localStorage.removeItem("fluxo-import-task");
          }
          setTaskId("");
        }
      } catch {
        if (!cancelled) setError("Falha de conexão ao acompanhar a importação.");
      }
    }

    void refreshTask();
    const interval = window.setInterval(() => void refreshTask(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [taskId]);

  function reset() {
    setPreview(null);
    setMessage("");
    setError("");
  }

  function selectRefinedFile(file: File | null) {
    setFile(file);
    reset();
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectRefinedFile(event.target.files?.[0] ?? null);
  }

  function onRefinedFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectRefinedFile(event.dataTransfer.files[0] ?? null);
  }

  async function previewFile() {
    if (!file) return;

    setLoading(true);
    reset();

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/imports/preview", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível ler a planilha.");
        return;
      }

      confirmKeyRef.current = crypto.randomUUID();
      setPreview(data as ImportPreview);
    } catch {
      setError("Falha de conexão ao enviar o arquivo.");
    } finally {
      setLoading(false);
    }
  }

  function selectRawFile(file: File | null) {
    setRawFile(file);
    setConversion(null);
    setAportes({});
    setError("");
    setMessage("");
  }

  function onRawFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectRawFile(event.target.files?.[0] ?? null);
  }

  function onRawFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectRawFile(event.dataTransfer.files[0] ?? null);
  }

  /** Le a planilha bruta e mostra o que sairia, sem gerar o arquivo ainda: os
   *  aportes so podem ser informados depois que sabemos quais contas existem. */
  async function convertPreview() {
    if (!rawFile) return;

    setConverting(true);
    setError("");
    setMessage("");
    setConversion(null);

    try {
      const formData = new FormData();
      formData.append("file", rawFile);

      const response = await fetch("/api/imports/convert/preview", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível ler a planilha bruta.");
        return;
      }

      setConversion(data as FlowConversion);
      setFlowName((current) =>
        current.trim()
          ? current
          : (data as FlowConversion).suggestedFileName.replace(/\.xlsx$/i, ""),
      );
    } catch {
      setError("Falha de conexão ao enviar a planilha bruta.");
    } finally {
      setConverting(false);
    }
  }

  async function downloadFlow() {
    if (!rawFile || !conversion) return;

    setDownloading(true);
    setError("");
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", rawFile);
      formData.append(
        "aportes",
        JSON.stringify(
          conversion.accounts.map((account) => ({
            accountLabel: account.accountLabel,
            amount: Number(aportes[account.accountLabel]?.replace(",", ".") ?? 0) || 0,
          })),
        ),
      );

      const response = await fetch("/api/imports/convert", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível gerar a planilha de fluxo.");
        return;
      }

      const downloadName = flowName.trim()
        ? `${flowName.trim()}.xlsx`
        : conversion.suggestedFileName;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(url);

      setStep("import");
      setMessage(`${downloadName} gerado. Importe a planilha refinada a seguir.`);
    } catch {
      setError("Falha de conexão ao gerar a planilha de fluxo.");
    } finally {
      setDownloading(false);
    }
  }

  async function sendCreatedFlow() {
    if (!createdFlow) return;

    setSendingFlow(true);
    setError("");

    try {
      const response = await fetch("/api/daily-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId: createdFlow.id, action: "start_approval" }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível enviar o fluxo para aprovação.");
        return;
      }

      setCreatedFlow({ ...createdFlow, status: "EM_APROVACAO" });
      setMessage("Fluxo enviado para aprovação.");
    } catch {
      setError("Falha de conexão ao enviar o fluxo para aprovação.");
    } finally {
      setSendingFlow(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;

    setConfirming(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/imports/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": confirmKeyRef.current,
        },
        body: JSON.stringify({
          fileName: preview.fileName,
          importName: (flowName.trim() || preview.fileName.replace(/\.(csv|xlsx)$/i, "")).slice(
            0,
            120,
          ),
          totalRows: preview.totalRows,
          rows: preview.rows,
          contributions: preview.contributions,
        }),
      });

      const data = (await response.json()) as ConfirmResponse;

      if (!response.ok) {
        setError(data.error ?? "Não foi possível confirmar o lote.");
        return;
      }
      if (!data.taskId) {
        setError("A tarefa de importação não pôde ser iniciada.");
        return;
      }

      setPreview(null);
      setFile(null);
      setFlowName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setImportTask(null);
      setCreatedFlow(null);
      setTaskId(data.taskId);
      localStorage.setItem("fluxo-import-task", data.taskId);
      window.dispatchEvent(new Event("fluxo-import-task"));
      setStep("flow");
    } catch {
      setError("Falha de conexão ao confirmar o lote.");
    } finally {
      setConfirming(false);
    }
  }

  async function retryImport() {
    if (!importTask) return;
    setConfirming(true);
    setError("");
    try {
      const response = await fetch(`/api/imports/tasks/${importTask.id}/retry`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Não foi possível reprocessar a importação.");
        return;
      }
      setImportTask({ ...importTask, status: "PENDENTE", error: "" });
    } catch {
      setError("Falha de conexão ao reprocessar a importação.");
    } finally {
      setConfirming(false);
    }
  }

  const divergences = preview?.summaryChecks.filter(
    (check) => check.difference !== null && Math.abs(check.difference) >= 0.01,
  );

  return (
    <>
      <section className="import-center" aria-label="Importar arquivo de pagamentos">
        <div className="import-workspace">
          <ol className="process-steps" aria-label="Etapas da importação">
            <li className={step === "convert" ? "active" : ""}><span>1</span><strong>Converter</strong><small>Arquivo bruto</small></li>
            <li className={step === "import" ? "active" : ""}><span>2</span><strong>Importar</strong><small>Planilha refinada</small></li>
            <li className={step === "flow" ? "active" : ""}><span>3</span><strong>Pré-visualizar</strong><small>Enviar fluxo</small></li>
          </ol>

          {step === "convert" ? (
            <div className="import-box import-conversion">
              <span className="import-icon" aria-hidden="true"><Wand2 size={34} /></span>
              <div className="import-copy">
                <span className="eyebrow">ETAPA 1 DE 3</span>
                <strong>Conversão do arquivo bruto</strong>
                <span className="muted">Converta o export Visão Contas a Pagar do Conta Azul para o modelo de fluxo.</span>
              </div>
              <input
                ref={rawInputRef}
                className="visually-hidden"
                id="raw-file"
                type="file"
                accept=".csv,.xls,.xlsx"
                aria-label="Planilha bruta do Conta Azul para converter"
                onChange={onRawFileChange}
              />
              <div
                className="import-drop-zone"
                role="button"
                tabIndex={0}
                onClick={() => rawInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    rawInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onRawFileDrop}
              >
                <Upload size={20} aria-hidden="true" />
                <strong>{rawFile ? rawFile.name : "Arraste a planilha bruta e solte aqui"}</strong>
                <small>ou selecione o arquivo abaixo · CSV, XLS ou XLSX</small>
              </div>
              <div className="field">
                <label htmlFor="flow-name">Nome do fluxo</label>
                <input
                  className="input"
                  id="flow-name"
                  value={flowName}
                  maxLength={120}
                  onChange={(event) => setFlowName(event.target.value)}
                  placeholder="Ex.: FLUXO DE PAGAMENTOS JFX DIA 29.07.2026"
                />
              </div>
              <div className="button-row import-actions import-conversion-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => (rawFile ? void convertPreview() : rawInputRef.current?.click())}
                  disabled={converting}
                >
                  <Wand2 size={16} />
                  {converting ? "Lendo..." : rawFile ? "Ler arquivo bruto" : "Selecionar arquivo bruto"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setError("");
                    setMessage("");
                    setStep("import");
                  }}
                >
                  Já tenho a planilha refinada
                </button>
              </div>
            </div>
          ) : null}

          {step === "import" ? (
            <div className="import-box import-conversion import-refined">
              <span className="import-icon" aria-hidden="true"><FileSpreadsheet size={34} /></span>
              <div className="import-copy">
                <span className="eyebrow">ETAPA 2 DE 3</span>
                <strong>Importação da planilha refinada</strong>
                <span className="muted">Envie o arquivo com fornecedor, data, descrição, valor e centro de custo.</span>
              </div>
              <input
                ref={fileInputRef}
                className="visually-hidden"
                id="file"
                type="file"
                accept=".csv,.xlsx"
                aria-label="Planilha refinada para importar"
                onChange={onFileChange}
              />
              <div
                className="import-drop-zone"
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onRefinedFileDrop}
              >
                <Upload size={20} aria-hidden="true" />
                <strong>{file ? file.name : "Arraste a planilha refinada e solte aqui"}</strong>
                <small>ou selecione o arquivo abaixo · CSV ou XLSX</small>
              </div>
              <div className="button-row import-actions import-conversion-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => (file ? void previewFile() : fileInputRef.current?.click())}
                  disabled={loading}
                >
                  <Upload size={16} />
                  {loading ? "Lendo..." : file ? "Gerar prévia" : "Selecionar planilha refinada"}
                </button>
                <button className="button secondary" type="button" onClick={() => setStep("convert")} disabled={loading}>
                  Voltar para conversão
                </button>
              </div>
            </div>
          ) : null}

          {step === "flow" &&
          importTask &&
          (importTask.status === "PENDENTE" || importTask.status === "PROCESSANDO") ? (
            <div className="import-box">
              <span className="import-icon" aria-hidden="true"><Upload size={30} /></span>
              <div className="import-copy">
                <span className="eyebrow">ETAPA 3 DE 3</span>
                <strong>
                  Importando {importTask.processedRows} de {importTask.validRows} pagamento(s)...
                </strong>
                <span className="metric-track">
                  <i
                    style={{
                      width: `${Math.min(
                        100,
                        (importTask.processedRows / Math.max(importTask.validRows, 1)) * 100,
                      )}%`,
                    }}
                  />
                </span>
                <span className="muted">
                  Você pode trocar de aba; avisaremos quando a importação terminar.
                </span>
              </div>
              <span className="status PENDENTE">
                {importTask.status === "PENDENTE" ? "Na fila" : "Processando"}
              </span>
            </div>
          ) : null}

          {step === "flow" && importTask?.status === "FALHOU" ? (
            <div className="import-box">
              <span className="import-icon" aria-hidden="true"><AlertTriangle size={30} /></span>
              <div className="import-copy">
                <span className="eyebrow">IMPORTAÇÃO INTERROMPIDA</span>
                <div className="alert error" role="alert">
                  {importTask.error || "A importação falhou."}
                </div>
              </div>
              <div className="button-row import-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => void retryImport()}
                  disabled={confirming}
                >
                  {confirming ? "Reprocessando..." : "Tentar novamente"}
                </button>
              </div>
            </div>
          ) : null}

          {step === "flow" && createdFlow ? (
            <div className="import-box">
              <span className="import-icon" aria-hidden="true"><CheckCircle2 size={30} /></span>
              <div className="import-copy">
                <span className="eyebrow">ETAPA 3 DE 3</span>
                <strong>{createdFlow.name}</strong>
                <span className="muted">{createdFlow.importedRows} pagamento(s) e {createdFlow.importedContributions} aporte(s) importados.</span>
              </div>
              <span className={`status ${createdFlow.status === "RASCUNHO" ? "PENDENTE" : "APROVADO"}`}>
                {createdFlow.status === "RASCUNHO" ? "Rascunho" : "Em aprovação"}
              </span>
              <div className="button-row import-actions">
                {createdFlow.status === "RASCUNHO" ? (
                  <button className="button" type="button" onClick={() => void sendCreatedFlow()} disabled={sendingFlow}>
                    {sendingFlow ? "Enviando..." : "Enviar para aprovação"}
                  </button>
                ) : null}
                <button className="button secondary" type="button" onClick={() => goToTab("pagamentos")}>
                  Ver fluxo
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>


      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      {step === "convert" && conversion?.missingColumns.length ? (
        <div className="alert error" role="alert">
          Colunas obrigatórias não encontradas na planilha bruta:{" "}
          {conversion.missingColumns.join(", ")}.
        </div>
      ) : null}

      {step === "convert" && conversion && !conversion.missingColumns.length ? (
        <section className="section">
          <div className="section-header">
            <h2>Fluxo a gerar</h2>
            <button
              className="button success"
              type="button"
              onClick={() => void downloadFlow()}
              disabled={conversion.validRows === 0 || downloading}
            >
              <Download size={16} />
              {downloading ? "Gerando..." : "Gerar e baixar"}
            </button>
          </div>

          <section className="stats-grid">
            <div className="stat">
              <span>Linhas</span>
              <strong>{conversion.validRows}</strong>
              <small>de {conversion.totalRows} lidas</small>
            </div>
            <div className="stat">
              <span>Total</span>
              <strong>{money(conversion.totalAmount)}</strong>
              <small>soma das linhas</small>
            </div>
            <div className="stat">
              <span>Ignoradas</span>
              <strong>{conversion.invalidRows}</strong>
              <small>fora do arquivo gerado</small>
            </div>
            <div className="stat">
              <span>Arquivo</span>
              <strong>
                {conversion.flowDate ? shortDate(conversion.flowDate) : "-"}
              </strong>
              <small>{conversion.suggestedFileName}</small>
            </div>
          </section>

          <div className="panel">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th>Situação</th>
                    <th className="amount">Comprometido</th>
                    <th className="amount">Valor do aporte</th>
                  </tr>
                </thead>
                <tbody>
                  {conversion.accounts.map((account) => (
                    <tr key={account.accountLabel}>
                      <td>{account.accountLabel}</td>
                      <td>
                        {account.isNewWork ? (
                          <span className="status TRANSFERIDO">Conta nova</span>
                        ) : (
                          <span className="status APROVADO">Cadastrada</span>
                        )}
                      </td>
                      <td className="amount">
                        <Money value={account.computedAmount} />
                      </td>
                      <td className="amount">
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0,00"
                          aria-label={`Valor do aporte para ${account.accountLabel}`}
                          value={aportes[account.accountLabel] ?? ""}
                          onChange={(event) =>
                            setAportes({
                              ...aportes,
                              [account.accountLabel]: event.target.value,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <span className="muted">
            O aporte informado vai para o bloco APORTES da planilha gerada. Conta sem valor não
            entra no bloco.
          </span>
        </section>
      ) : null}

      {step === "import" && preview?.missingColumns.length ? (
        <div className="alert error" role="alert">
          Colunas obrigatórias não encontradas: {preview.missingColumns.join(", ")}.
        </div>
      ) : null}

      {step === "import" && preview?.newAccounts.length ? (
        <div className="alert">
          <strong>
            {preview.newAccounts.length} centro(s) de custo novo(s) — a conta será criada na
            importação:
          </strong>{" "}
          {preview.newAccounts.join(", ")}.
        </div>
      ) : null}

      {step === "import" && preview ? (
        <>
          <section className="stats-grid">
            <div className="stat">
              <span>Linhas</span>
              <strong>{preview.totalRows}</strong>
              <small>lidas do arquivo</small>
            </div>
            <div className="stat">
              <span>Válidas</span>
              <strong>{preview.validRows}</strong>
              <small>{money(preview.totalAmount)}</small>
            </div>
            <div className="stat">
              <span>Incompletas</span>
              <strong>{preview.incompleteRows}</strong>
              <small>entram com INDEFINIDO</small>
            </div>
            <div className="stat">
              <span>Bloqueadas</span>
              <strong>{preview.invalidRows}</strong>
              <small>sem fornecedor ou sem valor</small>
            </div>
            <div className="stat">
              <span>Duplicadas</span>
              <strong>{preview.duplicateRows}</strong>
              <small>bloqueadas</small>
            </div>
            <div className="stat">
              <span>Aportes</span>
              <strong>{preview.contributions.length}</strong>
              <small>
                {money(preview.contributions.reduce((sum, row) => sum + row.amount, 0))}
              </small>
            </div>
          </section>

          {divergences?.length ? (
            <div className="alert error" role="alert">
              <strong>
                <AlertTriangle size={14} /> Resumo da planilha não bate com a soma das linhas
              </strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {divergences.map((check) => (
                  <li key={check.accountLabel}>
                    {check.accountLabel}: planilha diz {money(check.sheetAmount ?? 0)}, soma das
                    linhas dá {money(check.computedAmount)} (diferença de{" "}
                    {money(check.difference ?? 0)}). O sistema vai usar a soma das linhas.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.contributions.length ? (
            <section className="section">
              <div className="section-header">
                <h2>Aportes do arquivo</h2>
              </div>
              <div className="panel">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Conta</th>
                        <th>Reconhecida como</th>
                        <th>Situação</th>
                        <th className="amount">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.contributions.map((row) => (
                        <tr key={`${row.rowNumber}-${row.accountLabel}`}>
                          <td>{row.accountLabel}</td>
                          <td>{row.workName ?? "-"}</td>
                          <td>
                            {row.errors.length > 0 ? (
                              <span className="status REPROVADO">{row.errors.join("; ")}</span>
                            ) : row.isNewWork ? (
                              <span className="status TRANSFERIDO">Conta nova</span>
                            ) : (
                              <span className="status APROVADO">Será importado</span>
                            )}
                          </td>
                          <td className="amount">
                            <Money value={row.amount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          <section className="section">
            {preview.incompleteRows > 0 ? (
              <div className="alert">
                {preview.incompleteRows} compra(s) com informação faltante aparecem no painel de
                Pagamentos com a explicação. Use o rateio para colocar cada compra na conta certa.
              </div>
            ) : null}
            <div className="section-header">
              <h2>Prévia do fluxo importado</h2>
              <div className="button-row">
                <button
                  className="button success"
                  type="button"
                  onClick={confirmImport}
                  disabled={preview.validRows === 0 || confirming}
                >
                  <CheckCircle2 size={16} />
                  {confirming ? "Importando..." : `Importar ${preview.validRows} linha(s)`}
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Fornecedor</th>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th>Conta</th>
                      <th>Data</th>
                      <th>Situação</th>
                      <th className="amount">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const accountLabel = row.workName ?? row.costCenter ?? "-";
                      const isIncomplete = row.undefinedFields.length > 0;

                      return (
                        <tr key={`${row.rowNumber}-${row.uniqueKey}`}>
                          <td>{row.rowNumber}</td>
                          <td>{row.supplierName || "-"}</td>
                          <td>
                            {row.description === UNDEFINED_MARKER ? (
                              <strong>{UNDEFINED_MARKER}</strong>
                            ) : (
                              row.description || "-"
                            )}
                          </td>
                          <td>
                            {row.category === UNDEFINED_MARKER ? (
                              <strong>{UNDEFINED_MARKER}</strong>
                            ) : (
                              <small className="muted">{row.category || "-"}</small>
                            )}
                          </td>
                          <td>
                            {accountLabel === UNDEFINED_MARKER ? (
                              <strong>{UNDEFINED_MARKER}</strong>
                            ) : (
                              accountLabel
                            )}
                            {row.isNewWork ? (
                              <>
                                <br />
                                <small style={{ color: "var(--info)" }}>conta nova</small>
                              </>
                            ) : null}
                          </td>
                          <td>
                            {row.currentDueDate ? shortDate(row.currentDueDate) : "-"}
                            {row.undefinedFields.includes("currentDueDate") ? (
                              <>
                                <br />
                                <small className="muted">data da importação</small>
                              </>
                            ) : null}
                          </td>
                          <td>
                            {row.errors.length > 0 ? (
                              <span className="status REPROVADO">{row.errors.join("; ")}</span>
                            ) : isIncomplete ? (
                              <span
                                className="status TRANSFERIDO"
                                title={missingInfoSentence(row.undefinedFields)}
                              >
                                Faltou: {missingInfoLabels(row.undefinedFields)}
                              </span>
                            ) : (
                              <span className="status APROVADO">Válida</span>
                            )}
                          </td>
                          <td className="amount">
                            <Money value={row.amount} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
