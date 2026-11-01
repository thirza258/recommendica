/**
 * Uploads figure images to the paper asset store.
 *
 * The browser never talks to MinIO: the API receives the file, stores it in
 * the recommendica-assets bucket, and returns a same-origin URL. If the API or
 * MinIO is unavailable the caller keeps the inline data URL instead, so the
 * editor still works offline.
 */

import { ASSET_URL_PREFIX } from "./assetSource.ts";
import type { StoredImage } from "./images.ts";

const MAX_BYTES = 15_000_000;

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",", 2);
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  if (!meta.includes(";base64")) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function extensionFor(type: string): string {
  switch (type.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

export interface StoredImageSource {
  src: string;
  uploaded: boolean;
  error?: string;
}

export async function uploadImage(image: StoredImage, filename: string): Promise<string> {
  const blob = dataUrlToBlob(image.dataUrl);
  if (blob.size > MAX_BYTES) throw new Error("Images must be smaller than 15 MB.");

  const stem = filename.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "-") || "figure";
  const body = new FormData();
  body.append("file", blob, `${stem}.${extensionFor(image.type)}`);

  const response = await fetch(ASSET_URL_PREFIX, { method: "POST", body });
  if (!response.ok) {
    let message = "The image could not be stored.";
    try {
      const data = await response.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // Non-JSON error body; keep the default message.
    }
    throw new Error(message);
  }

  const data = await response.json().catch(() => null);
  if (typeof data?.url !== "string" || !data.url.startsWith(ASSET_URL_PREFIX)) {
    throw new Error("The image store returned an invalid address.");
  }
  return data.url;
}

/** Upload when possible, otherwise hand back the inline image with a reason. */
export async function storeImage(image: StoredImage, filename: string): Promise<StoredImageSource> {
  try {
    return { src: await uploadImage(image, filename), uploaded: true };
  } catch (error) {
    return {
      src: image.dataUrl,
      uploaded: false,
      error: error instanceof Error ? error.message : "The image store is unavailable.",
    };
  }
}
