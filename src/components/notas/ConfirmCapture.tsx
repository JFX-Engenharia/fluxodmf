"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

type ConfirmCaptureProps = {
  files: File[];
  busy?: boolean;
  progress?: { done: number; total: number } | null;
  onConfirm: (files: File[], description: string) => void;
  onRemove: (index: number) => void;
  onCancel: () => void;
};

export function ConfirmCapture({
  files,
  busy = false,
  progress = null,
  onConfirm,
  onRemove,
  onCancel,
}: ConfirmCaptureProps) {
  const [description, setDescription] = useState("");
  const previewUrls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);

  const single = files.length === 1;
  const confirmLabel = busy
    ? progress
      ? `Guardando ${progress.done} de ${progress.total}...`
      : "Guardando..."
    : single
      ? "Enviar"
      : `Enviar ${files.length} fotos`;

  return (
    <section className="notas-confirm panel pad" aria-labelledby="confirm-capture-title">
      <h2 id="confirm-capture-title">{single ? "Confira a foto" : `Confira as ${files.length} fotos`}</h2>
      {single ? (
        <img className="notas-preview" src={previewUrls[0]} alt="Prévia da nota capturada" />
      ) : (
        <ul className="notas-preview-grid">
          {previewUrls.map((url, index) => (
            <li className="notas-preview-item" key={url}>
              <img className="notas-preview-thumb" src={url} alt={`Prévia da foto ${index + 1}`} />
              <button
                className="notas-preview-remove"
                type="button"
                disabled={busy}
                onClick={() => onRemove(index)}
                aria-label={`Tirar a foto ${index + 1} do envio`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="field" htmlFor="nota-description">
        <span>{single ? "Descrição (opcional)" : "Descrição destas fotos (opcional)"}</span>
        <textarea
          className="textarea"
          id="nota-description"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex.: almoço, combustível..."
        />
      </label>
      <div className="button-row notas-confirm-actions">
        <button className="button" type="button" disabled={busy} onClick={() => onConfirm(files, description.trim())}>
          {confirmLabel}
        </button>
        <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>
          {single ? "Tirar outra" : "Escolher outras"}
        </button>
      </div>
    </section>
  );
}
