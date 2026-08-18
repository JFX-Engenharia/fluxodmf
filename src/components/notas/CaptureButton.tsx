"use client";

type CaptureButtonProps = {
  disabled?: boolean;
  compact?: boolean;
  onCapture: (files: File[]) => void;
};

export function CaptureButton({ disabled = false, compact = false, onCapture }: CaptureButtonProps) {
  const cameraId = compact ? "nota-capture-another" : "nota-capture-camera";

  const selectFiles = (files: FileList | null, input: HTMLInputElement) => {
    // A FileList esvazia quando o value e limpo: materializar antes.
    const selected = Array.from(files ?? []);
    input.value = "";
    if (selected.length > 0) onCapture(selected);
  };

  if (compact) {
    return (
      <label className="button secondary" htmlFor={cameraId} aria-disabled={disabled}>
        Tirar outra
        <input
          className="notas-file-input"
          id={cameraId}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={(event) => selectFiles(event.target.files, event.currentTarget)}
        />
      </label>
    );
  }

  return (
    <div className="notas-capture-wrap">
      <label className="notas-capture-button" htmlFor={cameraId} aria-disabled={disabled}>
        <span className="notas-capture-icon" aria-hidden="true">📷</span>
        <strong>Tirar foto da nota</strong>
        <small>{disabled ? "Aguarde um instante..." : "A câmera abre direto"}</small>
        {/*
          A câmera voltou a ser o caminho principal: `capture="environment"`
          abre o app de câmera do sistema e devolve uma foto por vez. Como esse
          atributo anula o `multiple`, a galeria usa um segundo input, sem
          `capture`, para manter a seleção de várias fotos de uma só vez.
        */}
        <input
          className="notas-file-input"
          id={cameraId}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={(event) => selectFiles(event.target.files, event.currentTarget)}
        />
      </label>
      <label className="notas-gallery-link" htmlFor="nota-capture-gallery" aria-disabled={disabled}>
        <small>Escolher da galeria</small>
        <input
          className="notas-file-input"
          id="nota-capture-gallery"
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          onChange={(event) => selectFiles(event.target.files, event.currentTarget)}
        />
      </label>
    </div>
  );
}
