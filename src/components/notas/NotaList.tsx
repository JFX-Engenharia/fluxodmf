"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo } from "react";
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

export function NotaList({ records, onRetry, onDelete }: NotaListProps) {
  const urls = useMemo(
    () => new Map(
      records
        .filter((record): record is NotaRecord => !isServerRecord(record))
        .map((record) => [record.id, URL.createObjectURL(record.thumb)]),
    ),
    [records],
  );

  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  if (records.length === 0) {
    return <p className="notas-empty">As fotos que você tirar aparecerão aqui.</p>;
  }

  return (
    <section className="notas-list" aria-labelledby="notas-list-title">
      <h2 id="notas-list-title">Suas fotos</h2>
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
    </section>
  );
}
