const MAX_IMAGE_SIDE = 1600;
const THUMBNAIL_SIDE = 160;
const JPEG_QUALITY = 0.8;

export type CompressedImage = {
  photo: Blob;
  thumb: Blob;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("O navegador não conseguiu comprimir a imagem."));
      }
    }, "image/jpeg", quality);
  });
}

function drawScaled(source: DecodedImage, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não conseguiu preparar a imagem.");
  context.drawImage(source.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeWithBitmap(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap não está disponível.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

async function decodeWithImage(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("O navegador não conseguiu ler a imagem."));
      element.src = url;
    });
    try {
      await image.decode();
    } catch {
      // Alguns navegadores disparam onload, mas não implementam decode().
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(file: Blob): Promise<DecodedImage> {
  try {
    return await decodeWithBitmap(file);
  } catch {
    return decodeWithImage(file);
  }
}

export async function compressImage(file: Blob): Promise<CompressedImage> {
  try {
    const decoded = await decode(file);
    try {
      const photo = await canvasBlob(drawScaled(decoded, MAX_IMAGE_SIDE), JPEG_QUALITY);
      const thumb = await canvasBlob(drawScaled(decoded, THUMBNAIL_SIDE), JPEG_QUALITY);
      return { photo, thumb };
    } finally {
      decoded.close();
    }
  } catch {
    // A foto original é preferível a perder a captura quando a compressão falha.
    return { photo: file, thumb: file };
  }
}
