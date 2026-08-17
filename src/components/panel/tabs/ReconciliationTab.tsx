"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileDown,
  FileSpreadsheet,
  Scale,
} from "lucide-react";
import { ChangeEvent, useRef, useState } from "react";
import { Money } from "@/components/Money";
import { money, shortDate } from "@/lib/format";
import type { ReconciliationResult } from "@/lib/reconciliation";

type FileSlot = {
  label: string;
  hint: string;
  file: File | null;
  set: (file: File | null) => void;
  inputId: string;
  ref: React.RefObject<HTMLInputElement | null>;
};

export function ReconciliationTab() {
  const [internalFile, setInternalFile] = useState<File | null>(null);
  const [cajuFile, setCajuFile] = useState<File | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  /**
   * Linhas que o conferente tirou da vista, por rowNumber — a unica chave
   * estavel de uma linha do extrato (a conciliacao nao envolve Payment, entao
   * nao ha id de banco). Vive so nesta conferencia: o proprio resultado da
   * conciliacao ja e efemero e some ao recarregar, entao persistir o que foi
   * ocultado guardaria uma escolha sobre linhas que nao existem mais.
   */
  const [hiddenRows, setHiddenRows] = useState<Set<number>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const internalRef = useRef<HTMLInputElement>(null);
  const cajuRef = useRef<HTMLInputElement>(null);

  const slots: FileSlot[] = [
    {
      label: "Extrato do sistema interno",
      hint: "Gastos do colaborador exportados do Conta Azul",
      file: internalFile,
      set: setInternalFile,
      inputId: "recon-internal",
      ref: internalRef,
    },
    {
      label: "Extrato do cartão CAJU",
      hint: "Extrato geral de despesas do colaborador",
      file: cajuFile,
      set: setCajuFile,
      inputId: "recon-caju",
      ref: cajuRef,
    },
  ];

  /**
   * Os rowNumber sao posicoes no arquivo que acabou de sair de cena: mantidos,
   * passariam a ocultar linhas diferentes das escolhidas.
   */
  function clearHidden() {
    setHiddenRows(new Set());
    setShowHidden(false);
  }

  function toggleHidden(rowNumber: number) {
    setHiddenRows((current) => {
      const next = new Set(current);
      if (!next.delete(rowNumber)) next.add(rowNumber);
      return next;
    });
  }

  function onPick(slot: FileSlot) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      slot.set(event.target.files?.[0] ?? null);
      setResult(null);
      setError("");
      clearHidden();
    };
  }

  async function run() {
    if (!internalFile || !cajuFile) return;

    setBusy(true);
    setError("");
    setResult(null);
    clearHidden();

    try {
      const formData = new FormData();
      formData.append("fileA", internalFile);
      formData.append("fileB", cajuFile);
      if (fromDate) formData.append("fromDate", fromDate);

      const response = await fetch("/api/reconciliation", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível conciliar os extratos.");
        return;
      }

      setResult(data as ReconciliationResult);
    } catch {
      setError("Falha de conexão ao enviar os extratos.");
    } finally {
      setBusy(false);
    }
  }

  async function exportMissingNotes() {
    if (!result || visiblePending.length === 0) return;
    setExporting(true);
    setError("");

    try {
      const response = await fetch("/api/reconciliation/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collaborators: result.collaborators,
          // O PDF imprime exatamente o que recebe, entao mandar so as visiveis
          // e o que faz o "ocultar" valer na exportacao.
          rows: visiblePending,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível gerar o PDF das notas faltantes.");
        return;
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = encodedName
        ? decodeURIComponent(encodedName)
        : "Auditoria - notas faltantes.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Falha de conexão ao gerar o PDF das notas faltantes.");
    } finally {
      setExporting(false);
    }
  }

  const visiblePending = result
    ? result.pending.filter((row) => !hiddenRows.has(row.rowNumber))
    : [];
  const hiddenCount = result ? result.pending.length - visiblePending.length : 0;
  // As linhas mostradas na tabela: com "Mostrar ocultas" ligado, todas.
  const listedPending = showHidden ? (result?.pending ?? []) : visiblePending;
  const visibleAmount = visiblePending.reduce((sum, row) => sum + row.amount, 0);

  const ready = Boolean(internalFile && cajuFile);

  return (
    <>
      <section className="section">
        <div className="section-header">
          <h2>Extratos a cruzar</h2>
        </div>

        <div className="panel pad form-grid">
          <span className="muted">
            Compara as compras do cartão CAJU com os lançamentos do colaborador no sistema
            interno. O que está no cartão e não foi lançado é despesa com{" "}
            <strong>nota fiscal pendente</strong>. Depósitos, estornos e resgates ficam de fora:
            não geram nota.
          </span>

          <div className="split-grid">
            {slots.map((slot, index) => (
              <div className="file-box" key={slot.inputId}>
                <span className="file-step" aria-hidden="true">{index + 1}</span>
                <strong>
                  <FileSpreadsheet size={16} /> {slot.label}
                </strong>
                <span className="muted">{slot.hint}</span>
                {slot.file ? (
                  <span className="muted import-file-name">{slot.file.name}</span>
                ) : null}
                <input
                  ref={slot.ref}
                  className="visually-hidden"
                  id={slot.inputId}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  aria-label={slot.label}
                  onChange={onPick(slot)}
                />
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => slot.ref.current?.click()}
                    disabled={busy}
                  >
                    {slot.file ? "Trocar" : "Selecionar"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="toolbar reconciliation-toolbar">
            <div className="field">
              <label htmlFor="recon-from">Considerar a partir de</label>
              <input
                className="input"
                id="recon-from"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                disabled={busy}
              />
            </div>
            <button
              className="button"
              type="button"
              onClick={() => void run()}
              disabled={!ready || busy}
              title={ready ? "Cruzar os dois extratos" : "Selecione os dois extratos"}
            >
              <Scale size={16} />
              {busy ? "Conciliando..." : "Conciliar"}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="alert error" role="alert">{error}</div> : null}

      {result ? (
        <>
          {result.collaborators.length > 1 ? (
            <div className="alert">
              <strong>
                <AlertTriangle size={14} /> O extrato CAJU tem mais de um colaborador:
              </strong>{" "}
              {result.collaborators.join(", ")}. Confira se é isso mesmo — o normal é um extrato
              por colaborador.
            </div>
          ) : null}

          {result.totals.unmatchedInternal > 0 ? (
            <div className="alert error" role="alert">
              {result.totals.unmatchedInternal} lançamento(s) no sistema interno sem compra
              correspondente no cartão CAJU, somando{" "}
              {money(result.totals.unmatchedInternalAmount)}. Confira a tabela
              &quot;Lançados sem compra no cartão&quot;.
            </div>
          ) : null}

          <section className="approval-stats">
            <div className="approval-stat approval-stat-danger">
              <span>Notas pendentes</span>
              <strong>{visiblePending.length}</strong>
              <small>
                {money(visibleAmount)} a cobrar
                {hiddenCount > 0 ? ` · ${hiddenCount} oculta(s)` : ""}
              </small>
            </div>
            <div className="approval-stat approval-stat-success">
              <span>Conciliadas</span>
              <strong>
                {result.totals.matched} / {result.totals.cajuPurchases}
              </strong>
              <small>compras no cartão</small>
            </div>
            <div className="approval-stat approval-stat-warning">
              <span>Sem compra no cartão</span>
              <strong>{result.totals.unmatchedInternal}</strong>
              <small>{money(result.totals.unmatchedInternalAmount)} lançados a mais</small>
            </div>
          </section>

          <div className="panel pad">
            <div className="detail-list">
              <div className="detail-item">
                <span>Colaborador</span>
                <strong>{result.collaborators.join(", ") || "-"}</strong>
                <small className="muted">{result.bankAccounts.join(", ") || "-"}</small>
              </div>
              <div className="detail-item">
                <span>Extratos</span>
                <strong>{result.cajuFileName}</strong>
                <small className="muted">{result.internalFileName}</small>
              </div>
              <div className="detail-item">
                <span>Período</span>
                <strong>
                  {result.fromDate ? `A partir de ${shortDate(result.fromDate)}` : "Tudo"}
                </strong>
                {result.outOfRange.caju || result.outOfRange.internal ? (
                  <small className="muted">
                    Fora do período: {result.outOfRange.caju} no cartão,{" "}
                    {result.outOfRange.internal} no interno
                  </small>
                ) : null}
              </div>
              <div className="detail-item">
                <span>Ignorados</span>
                <strong>
                  {result.ignored.reduce((sum, group) => sum + group.count, 0)} lançamento(s)
                </strong>
                <small className="muted">
                  {result.ignored.length
                    ? result.ignored.map((g) => `${g.type} (${g.count})`).join(", ")
                    : "nenhum"}
                </small>
              </div>
            </div>
          </div>

          <section className="section">
            <div className="section-header">
              <h2>Notas pendentes ({visiblePending.length})</h2>
              <div className="toolbar">
                {hiddenCount > 0 ? (
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => setShowHidden((current) => !current)}
                    aria-pressed={showHidden}
                  >
                    <Eye size={16} />
                    {showHidden ? "Esconder ocultas" : `Mostrar ocultas (${hiddenCount})`}
                  </button>
                ) : null}
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void exportMissingNotes()}
                  disabled={visiblePending.length === 0 || exporting}
                >
                  <FileDown size={16} />
                  {exporting ? "Gerando PDF..." : "Exportar Notas Faltantes"}
                </button>
              </div>
            </div>

            {result.totals.pending === 0 ? (
              <div className="panel pad">
                <span className="status APROVADO">
                  <CheckCircle2 size={14} /> Tudo conciliado
                </span>{" "}
                <span className="muted">
                  Todas as {result.totals.cajuPurchases} compras do cartão têm lançamento
                  correspondente no sistema interno.
                </span>
              </div>
            ) : listedPending.length === 0 ? (
              <div className="panel pad">
                <span className="muted">
                  Todas as {hiddenCount} nota(s) pendentes estão ocultas. Use &quot;Mostrar
                  ocultas&quot; para revê-las.
                </span>
              </div>
            ) : (
              <div className="panel">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Estabelecimento</th>
                        <th>Adiantamento</th>
                        <th>Categoria</th>
                        <th>Mesmo valor no interno</th>
                        <th>Comprovante</th>
                        <th className="amount">Valor</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listedPending.map((row) => (
                        <tr key={`${row.rowNumber}-${row.amount}`}>
                          <td>{row.date ? shortDate(row.date) : "-"}</td>
                          <td>{row.merchant || "-"}</td>
                          <td>{row.advance || "-"}</td>
                          <td>
                            <small className="muted">{row.category || "-"}</small>
                          </td>
                          <td>
                            {row.sameAmountMatchedDates.length > 0 ? (
                              <small className="muted">
                                Lançado em{" "}
                                {row.sameAmountMatchedDates.map(shortDate).join(", ")} — já
                                conciliado(s) com outras compras
                              </small>
                            ) : (
                              <small className="muted">Nenhum no período</small>
                            )}
                          </td>
                          <td>
                            <span className="status REPROVADO">{row.hasReceipt || "Não"}</span>
                          </td>
                          <td className="amount">
                            <Money value={row.amount} />
                          </td>
                          <td>
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => toggleHidden(row.rowNumber)}
                              aria-pressed={hiddenRows.has(row.rowNumber)}
                            >
                              {hiddenRows.has(row.rowNumber) ? (
                                <>
                                  <Eye size={14} /> Reexibir
                                </>
                              ) : (
                                <>
                                  <EyeOff size={14} /> Ocultar
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {result.totals.unmatchedInternal > 0 ? (
            <section className="section">
              <div className="section-header">
                <h2>Lançados sem compra no cartão ({result.totals.unmatchedInternal})</h2>
              </div>
              <div className="panel">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Centro de custo</th>
                        <th>Situação</th>
                        <th className="amount">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatchedInternal.map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{row.date ? shortDate(row.date) : "-"}</td>
                          <td>{row.description || "-"}</td>
                          <td>{row.costCenter || "-"}</td>
                          <td>
                            <span className="status REPROVADO">Sem registro no cartão</span>
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
              <span className="muted">
                Estão no sistema interno mas não têm compra correspondente no cartão no período.
                Pode ser lançamento em duplicidade, valor digitado errado ou gasto de outro meio
                de pagamento.
              </span>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
