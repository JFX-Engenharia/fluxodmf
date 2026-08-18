"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { CaptureButton } from "@/components/notas/CaptureButton";

/** Espelha o minimo do servidor (POST /api/notas): as duas pontas recusam igual. */
const MIN_DESCRIPTION = 3;

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

  const descricao = description.trim();
  // Campo obrigatorio que aceita um caractere vira ritual: a pessoa digita "x"
  // so para passar da tela e o escritorio continua sem saber do que e a nota.
  const descricaoValida = descricao.length >= MIN_DESCRIPTION;

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
        <span>{single ? "O que você comprou?" : "O que você comprou nestas fotos?"}</span>
        <textarea
          className="textarea"
          id="nota-description"
          maxLength={500}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex.: almoço, combustível..."
        />
        {descricao.length > 0 && !descricaoValida ? (
          <small className="muted">Escreva um pouco mais para o escritório entender.</small>
        ) : null}
      </label>
      <div className="button-row notas-confirm-actions">
        <button
          className="button"
          type="button"
          /* O botao e type=button com onClick, entao o `required` do textarea
             nao barra nada sozinho: a trava real e esta. */
          disabled={busy || !descricaoValida}
          onClick={() => onConfirm(files, descricao)}
        >
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
