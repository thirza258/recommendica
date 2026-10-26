/**
 * Image intake for figures. Large photos are scaled down before they are
 * stored: documents live in browser storage and are re-saved as you type,
 * so a 12-megapixel upload would make every save slow for no visible gain.
 */

const MAX_SIDE = 2000;
const KEEP_AS_IS_BYTES = 600_000;
export const MAX_IMAGE_BYTES = 15_000_000;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function decode(blob: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height, draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h), close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(image, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
}

export interface StoredImage {
  dataUrl: string;
  type: string;
  size: number;
}

export async function readImageFile(file: Blob): Promise<StoredImage> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPEG, GIF, WebP or SVG).");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be smaller than 15 MB.");
  if (file.type === "image/svg+xml") {
    return { dataUrl: await readAsDataUrl(file), type: file.type, size: file.size };
  }
  const image = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES && (file.type === "image/png" || file.type === "image/jpeg")) {
      return { dataUrl: await readAsDataUrl(file), type: file.type, size: file.size };
    }
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The image could not be processed.");
    image.draw(ctx, width, height);
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(type, 0.9);
    return { dataUrl, type, size: Math.round((dataUrl.length * 3) / 4) };
  } finally {
    image.close();
  }
}

/** pdfLaTeX reads PNG and JPEG only; other formats are redrawn as PNG for export. */
export async function toLatexImage(dataUrl: string): Promise<string> {
  if (/^data:image\/(png|jpe?g);/i.test(dataUrl)) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const image = await decode(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width || 800;
    canvas.height = image.height || 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    image.draw(ctx, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    image.close();
  }
}
