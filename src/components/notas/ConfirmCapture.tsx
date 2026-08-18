"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { CaptureButton } from "@/components/notas/CaptureButton";

type ConfirmCaptureProps = {
  files: File[];
  busy?: boolean;
  progress?: { done: number; total: number } | null;
  onConfirm: (files: File[], description: string) => void;
  onRemove: (index: number) => void;
  onAddFiles: (files: File[]) => void;
  onCancel: () => void;
};

export function ConfirmCapture({
  files,
  busy = false,
  progress = null,
  onConfirm,
  onRemove,
  onAddFiles,
  onCancel,
}: ConfirmCaptureProps) {
  const [description, setDescription] = useState("");

  /**
   * As URLs nascem DENTRO do efeito, e nao num useMemo lido pelo cleanup.
   * Com useMemo a previa aparecia quebrada: o StrictMode remonta o componente
   * (setup -> cleanup -> setup), o cleanup revogava as URLs e o segundo setup
   * nao recriava nada, porque o memo nao roda de novo numa remontagem
   * simulada — o src no DOM ficava apontando para um blob ja revogado. Criando
   * aqui, cada setup gera URLs novas e revoga exatamente as suas.
   */
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    /* Criar o object URL fora do efeito e o que causava a previa quebrada:
       qualquer revogacao no cleanup exige que o setup seguinte recrie a URL,
       senao a remontagem do StrictMode deixa o src apontando para um blob ja
       revogado. E a orientacao do proprio React para object URL. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

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
      {/* No primeiro render as URLs ainda nao existem (nascem no efeito); sem a
          guarda, seria um <img> sem src piscando o icone de imagem quebrada. */}
      {previewUrls.length === 0 ? null : single ? (
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
        <CaptureButton compact disabled={busy} onCapture={onAddFiles} />
        <button className="button ghost" type="button" disabled={busy} onClick={onCancel}>
          Descartar
        </button>
      </div>
    </section>
  );
}
