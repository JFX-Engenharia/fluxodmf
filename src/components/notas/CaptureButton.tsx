"use client";

type CaptureButtonProps = {
  disabled?: boolean;
  onCapture: (files: File[]) => void;
};

export function CaptureButton({ disabled = false, onCapture }: CaptureButtonProps) {
  return (
    <div className="notas-capture-wrap">
      <label className="notas-capture-button" htmlFor="nota-capture">
        <span className="notas-capture-icon" aria-hidden="true">📷</span>
        <strong>Tirar ou escolher fotos</strong>
        <small>{disabled ? "Aguarde um instante..." : "Toque para fotografar ou pegar da galeria"}</small>
        {/*
          Sem `capture`: o atributo abre a camera direto e faz o celular devolver
          sempre um arquivo so, anulando o `multiple`. Sem ele o seletor do
          sistema oferece Camera E galeria, e a galeria aceita varias de uma vez.
        */}
        <input
          className="notas-file-input"
          id="nota-capture"
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          onChange={(event) => {
            // A FileList esvazia quando o value e limpo: materializar antes.
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = "";
            if (files.length > 0) onCapture(files);
          }}
        />
      </label>
    </div>
  );
}
