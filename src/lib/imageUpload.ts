const MAX_PHOTO_DATA_URL_LENGTH = 115000;

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen seleccionada.'));
    };
    img.src = objectUrl;
  });
}

function renderCompressedDataUrl(
  img: HTMLImageElement,
  maxDimension: number,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): string {
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo procesar la imagen en este navegador.');
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Compresses an uploaded nominee photo in-browser so it fits comfortably inside
 * Firestore document size limits (< 115 KB per nominee) with crisp portrait quality.
 */
export async function compressNomineeImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecciona un archivo de imagen válido (JPG, PNG o WebP).');
  }

  const img = await loadImageElement(file);
  const attempts: Array<{ dim: number; mime: 'image/webp' | 'image/jpeg'; q: number }> = [
    { dim: 420, mime: 'image/webp', q: 0.82 },
    { dim: 360, mime: 'image/webp', q: 0.72 },
    { dim: 360, mime: 'image/jpeg', q: 0.75 },
    { dim: 280, mime: 'image/jpeg', q: 0.65 },
    { dim: 220, mime: 'image/jpeg', q: 0.55 },
  ];

  for (const attempt of attempts) {
    const dataUrl = renderCompressedDataUrl(img, attempt.dim, attempt.mime, attempt.q);
    if (dataUrl.length <= MAX_PHOTO_DATA_URL_LENGTH && dataUrl.startsWith('data:image/')) {
      return dataUrl;
    }
  }

  throw new Error('La imagen es demasiado pesada incluso después de comprimirla. Intenta con otra foto.');
}
