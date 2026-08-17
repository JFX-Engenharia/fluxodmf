"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { NotaRecord, NotaStatus } from "@/lib/notas-db";

export type ServerNotaRecord = {
  source: "server";
  id: string;
  clientKey: string | null;
  description: string;
  capturedAt: string;
  createdAt: string;
  sentAt: string;
  status: "sent";
  photoUrl: string;
};

export type NotaListRecord = NotaRecord | ServerNotaRecord;

type NotaListProps = {
  records: NotaListRecord[];
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClearFilters: () => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
};

const statusText: Record<NotaStatus, { label: string; icon: string; className: string }> = {
  pending: { label: "Aguardando sinal", icon: "⏳", className: "NOTA-PENDENTE" },
  sending: { label: "Enviando...", icon: "↗", className: "NOTA-ENVIANDO" },
  sent: { label: "Enviada ✓", icon: "✓", className: "NOTA-ENVIADA" },
  error: { label: "Erro ao enviar", icon: "!", className: "NOTA-ERRO" },
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data não disponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function isServerRecord(record: NotaListRecord): record is ServerNotaRecord {
  return "source" in record && record.source === "server";
}

export function NotaList({
  records,
  from,
  to,
  onFromChange,
  onToChange,
  onClearFilters,
  onRetry,
  onDelete,
}: NotaListProps) {
  /**
   * Mesmo cuidado do ConfirmCapture: as URLs nascem dentro do efeito. Com
   * useMemo, o cleanup do StrictMode revoga o que o segundo setup nao recria, e
   * a miniatura quebra. Aqui isso ainda nao acontecia por acidente — a lista
   * monta com records vazio, logo nao ha URL para revogar na remontagem — mas
   * bastaria ela passar a montar ja com registros para os thumbs das fotos nao
   * enviadas quebrarem do mesmo jeito.
   */
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const created = new Map(
      records
        .filter((record): record is NotaRecord => !isServerRecord(record))
        .map((record) => [record.id, URL.createObjectURL(record.thumb)]),
    );
    /* Mesma razao do ConfirmCapture: a URL precisa nascer no setup para
       sobreviver ao ciclo setup -> cleanup -> setup da remontagem. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(created);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [records]);

  return (
    <section className="notas-list" aria-labelledby="notas-list-title">
      <h2 id="notas-list-title">Suas fotos</h2>
      <div className="panel pad toolbar">
        <div className="field">
          <label htmlFor="notas-from">De</label>
          <input
            className="input"
            id="notas-from"
            type="date"
            value={from}
            onChange={(event) => onFromChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="notas-to">Até</label>
          <input
            className="input"
            id="notas-to"
            type="date"
            value={to}
            onChange={(event) => onToChange(event.target.value)}
          />
        </div>
        <div className="form-actions">
          <button className="button ghost" type="button" onClick={onClearFilters}>
            Limpar
          </button>
        </div>
      </div>
      {records.length === 0 ? (
        <p className="notas-empty">
          {from || to ? "Nenhuma foto neste período." : "As fotos que você tirar aparecerão aqui."}
        </p>
      ) : (
        <div className="notas-cards">
          {records.map((record) => {
          const serverRecord = isServerRecord(record);
          const status = statusText[record.status];
          return (
            <article className="nota-card" key={record.id}>
              <img
                className="nota-thumb"
                src={serverRecord ? record.photoUrl : urls.get(record.id)}
                alt="Miniatura da nota"
                width={64}
                height={64}
                loading={serverRecord ? "lazy" : undefined}
              />
              <div className="nota-card-body">
                <span className={`status ${status.className}`}>
                  <span aria-hidden="true">{status.icon}</span> {status.label}
                </span>
                <time dateTime={record.capturedAt}>Foto: {formatDate(record.capturedAt)}</time>
                {record.sentAt ? <time dateTime={record.sentAt}>Recebida: {formatDate(record.sentAt)}</time> : null}
                {record.description ? <p>{record.description}</p> : null}
                {!serverRecord && record.lastError ? <p className="nota-error-text">{record.lastError}</p> : null}
                {!serverRecord && record.status === "error" ? (
                  <div className="button-row nota-card-actions">
                    <button className="button secondary" type="button" onClick={() => onRetry(record.id)}>
                      Tentar de novo
                    </button>
                    <button className="button ghost" type="button" onClick={() => onDelete(record.id)}>
                      Apagar
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
          })}
        </div>
      )}
    </section>
  );
}
