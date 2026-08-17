"use client";

import Image from "next/image";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { FormEvent, useCallback, useRef, useState } from "react";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime, userStatusLabels } from "@/lib/format";

type Collaborator = {
  id: string;
  name: string;
  username: string;
  status: string;
  createdAt: string;
  totalNotes: number;
  lastNoteAt: string | null;
};

type ReceiptNote = {
  id: string;
  description: string;
  fileName: string;
  mimeType: string;
  size: number;
  capturedAt: string;
  status: string;
  createdAt: string;
  photoUrl: string;
};

type CollaboratorHistory = {
  id: string;
  name: string;
  username: string;
  status: string;
};

type CollaboratorsResponse = { collaborators: Collaborator[] };
type HistoryResponse = {
  collaborator: CollaboratorHistory;
  notes: ReceiptNote[];
  nextCursor: string | null;
};

type HistoryFilters = { from: string; to: string };

function collaboratorStatusLabel(status: string) {
  return userStatusLabels[status as keyof typeof userStatusLabels] ?? status;
}

function collaboratorStatusClass(status: string) {
  if (status === "ATIVO") return "APROVADO";
  if (status === "INATIVO") return "CANCELADO";
  if (status === "RECUSADO") return "REPROVADO";
  return "PENDENTE";
}

function noteStatusLabel(status: string) {
  return status === "CONFERIDA" ? "Conferida" : "Enviada";
}

function noteStatusClass(status: string) {
  return status === "CONFERIDA" ? "APROVADO" : "PENDENTE";
}

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function NotasColaboradoresTab() {
  const { data, error, loading, reload } = useFetchData<CollaboratorsResponse>(
    "/api/notas/colaboradores",
  );
  const [selected, setSelected] = useState<Collaborator | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [draftHistoryFilters, setDraftHistoryFilters] = useState<HistoryFilters>({ from: "", to: "" });
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({ from: "", to: "" });
  const historyRequest = useRef(0);
  const collaborators = data?.collaborators ?? [];

  const loadHistory = useCallback(async (
    id: string,
    cursor: string | null,
    append: boolean,
    filters: HistoryFilters,
  ) => {
    const requestId = ++historyRequest.current;
    if (append) setLoadingMore(true);
    else {
      setHistory(null);
      setHistoryError("");
      setHistoryLoading(true);
    }

    const search = new URLSearchParams({ take: "30" });
    if (cursor) search.set("cursor", cursor);
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);

    try {
      const response = await fetch(`/api/notas/colaboradores/${encodeURIComponent(id)}?${search}`);
      const body = (await response.json()) as HistoryResponse & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Não foi possível carregar as notas deste colaborador.");
      }
      if (requestId !== historyRequest.current) return;

      setHistory((previous) =>
        append && previous
          ? { ...body, notes: [...previous.notes, ...body.notes] }
          : body,
      );
    } catch (caught) {
      if (requestId !== historyRequest.current) return;
      setHistoryError(
        caught instanceof Error && caught.message !== "Failed to fetch"
          ? caught.message
          : "Falha de conexão ao carregar as notas.",
      );
    } finally {
      if (requestId === historyRequest.current) {
        setHistoryLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  function openHistory(collaborator: Collaborator) {
    setSelected(collaborator);
    void loadHistory(collaborator.id, null, false, historyFilters);
  }

  function applyHistoryFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHistoryFilters(draftHistoryFilters);
    void loadHistory(selected!.id, null, false, draftHistoryFilters);
  }

  function clearHistoryFilters() {
    const emptyFilters = { from: "", to: "" };
    setDraftHistoryFilters(emptyFilters);
    setHistoryFilters(emptyFilters);
    void loadHistory(selected!.id, null, false, emptyFilters);
  }

  function closeHistory() {
    historyRequest.current += 1;
    setSelected(null);
    setHistory(null);
    setHistoryError("");
    setHistoryLoading(false);
    setLoadingMore(false);
  }

  if (selected) {
    const collaborator = history?.collaborator ?? selected;

    return (
      <section className="section" aria-labelledby="collaborator-notes-title">
        <div className="section-heading">
          <div>
            <h2 id="collaborator-notes-title">Notas de {collaborator.name}</h2>
            <p>
              @{collaborator.username} · {collaboratorStatusLabel(collaborator.status)}
            </p>
          </div>
          <button className="button secondary" type="button" onClick={closeHistory}>
            <ArrowLeft size={16} /> Voltar à lista
          </button>
        </div>

        <form className="panel pad toolbar" onSubmit={applyHistoryFilters}>
          <div className="field">
            <label htmlFor="collaborator-notes-from">De</label>
            <input
              className="input"
              id="collaborator-notes-from"
              type="date"
              value={draftHistoryFilters.from}
              onChange={(event) => setDraftHistoryFilters({
                ...draftHistoryFilters,
                from: event.target.value,
              })}
            />
          </div>
          <div className="field">
            <label htmlFor="collaborator-notes-to">Até</label>
            <input
              className="input"
              id="collaborator-notes-to"
              type="date"
              value={draftHistoryFilters.to}
              onChange={(event) => setDraftHistoryFilters({
                ...draftHistoryFilters,
                to: event.target.value,
              })}
            />
          </div>
          <div className="form-actions">
            <button className="button" type="submit">Aplicar</button>
            <button className="button ghost" type="button" onClick={clearHistoryFilters}>
              Limpar
            </button>
          </div>
        </form>

        {historyError ? <div className="alert error" role="alert">{historyError}</div> : null}
        {historyLoading ? <div className="panel pad" role="status">Carregando notas...</div> : null}
        {!historyLoading && !historyError && history?.notes.length === 0 ? (
          <div className="panel pad">Este colaborador ainda não enviou notas.</div>
        ) : null}
        {!historyLoading && history?.notes.length ? (
          <>
            <div
              aria-busy={loadingMore}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                gap: "16px",
              }}
            >
              {history.notes.map((note) => (
                <article className="panel pad" key={note.id}>
                  <a
                    href={note.photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Abrir foto ${note.fileName} em uma nova aba`}
                  >
                    <Image
                      src={note.photoUrl}
                      alt={`Foto da nota ${note.fileName}`}
                      width={480}
                      height={360}
                      unoptimized
                      style={{
                        width: "100%",
                        height: "150px",
                        objectFit: "cover",
                        borderRadius: "8px",
                      }}
                    />
                  </a>
                  <div className="button-row" style={{ justifyContent: "space-between", marginTop: "12px" }}>
                    <span className={`status ${noteStatusClass(note.status)}`}>
                      {noteStatusLabel(note.status)}
                    </span>
                    <small className="muted">{fileSize(note.size)}</small>
                  </div>
                  <p><strong>Capturada:</strong> {dateTime(note.capturedAt)}</p>
                  <p><strong>Recebida:</strong> {dateTime(note.createdAt)}</p>
                  <p>{note.description || <span className="muted">Sem descrição.</span>}</p>
                  <small className="muted">{note.fileName} · {note.mimeType}</small>
                </article>
              ))}
            </div>
            {history.nextCursor ? (
              <div className="button-row">
                <button
                  className="button secondary"
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadHistory(selected.id, history.nextCursor, true, historyFilters)}
                >
                  {loadingMore ? "Carregando..." : "Carregar mais notas"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    );
  }

  const totalNotes = collaborators.reduce((total, collaborator) => total + collaborator.totalNotes, 0);
  const collaboratorsWithNotes = collaborators.filter((collaborator) => collaborator.totalNotes > 0).length;

  return (
    <section className="section" aria-labelledby="collaborators-title">
      <div className="section-heading">
        <div>
          <h2 id="collaborators-title">Notas dos colaboradores</h2>
          <p>Acompanhe as notas enviadas pelos colaboradores do cartão CAJU.</p>
        </div>
        <button className="button secondary" type="button" onClick={reload} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {error ? <div className="alert error" role="alert">{error}</div> : null}

      <section className="stats-grid" aria-label="Resumo das notas dos colaboradores">
        <div className="stat"><span>Colaboradores</span><strong>{collaborators.length}</strong><small>cadastrados para envio</small></div>
        <div className="stat"><span>Notas recebidas</span><strong>{totalNotes}</strong><small>em todo o histórico</small></div>
        <div className="stat"><span>Com notas</span><strong>{collaboratorsWithNotes}</strong><small>colaboradores com envio</small></div>
      </section>

      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Status</th>
                <th className="amount">Notas</th>
                <th>Última nota</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="daily-flow-empty" colSpan={5}>Carregando colaboradores...</td></tr>
              ) : null}
              {!loading && !data ? (
                <tr><td className="daily-flow-empty" colSpan={5}>Não foi possível carregar os colaboradores.</td></tr>
              ) : null}
              {!loading && data && collaborators.length === 0 ? (
                <tr><td className="daily-flow-empty" colSpan={5}>Nenhum colaborador cadastrado.</td></tr>
              ) : null}
              {collaborators.map((collaborator) => (
                <tr key={collaborator.id}>
                  <td>
                    <strong>{collaborator.name}</strong>
                    <small className="muted">@{collaborator.username}</small>
                  </td>
                  <td>
                    <span className={`status ${collaboratorStatusClass(collaborator.status)}`}>
                      {collaboratorStatusLabel(collaborator.status)}
                    </span>
                  </td>
                  <td className="amount">{collaborator.totalNotes}</td>
                  <td>{collaborator.lastNoteAt ? dateTime(collaborator.lastNoteAt) : <span className="muted">Nenhuma nota</span>}</td>
                  <td>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => openHistory(collaborator)}
                      aria-label={`Ver histórico de notas de ${collaborator.name}`}
                    >
                      Ver histórico
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
