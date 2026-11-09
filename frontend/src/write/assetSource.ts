/**
 * What a figure's `src` may be.
 *
 * New uploads are stored by the API and referenced with a same-origin
 * `/api/v1/assets/...` URL. Documents created before that keep their inline
 * data URL, and pasted web images are still allowed as https links. This
 * module is deliberately DOM-free so the schema, storage and renderer can all
 * share one definition.
 */

export const ASSET_URL_PREFIX = "/api/v1/assets/";

export function isDataImageSource(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(value);
}

export function isAssetUrl(value: unknown): value is string {
  return typeof value === "string" && /^\/api\/v1\/assets\/[^\s"'<>]+$/.test(value);
}

export function isHttpsImageSource(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/[^\s"'<>]+$/i.test(value);
}

/** Anything the editor may keep as a figure source. */
export function isImageSource(value: unknown): value is string {
  return isDataImageSource(value) || isAssetUrl(value) || isHttpsImageSource(value);
}

/** Sources that belong to the paper and can be packed into an export. */
export function isEmbeddableImageSource(value: unknown): value is string {
  return isDataImageSource(value) || isAssetUrl(value);
}

/**
 * Files a LaTeX project keeps besides pictures: PDF and EPS figures, which
 * the preview cannot show but the exported project needs.
 */
export function isProjectFigureSource(value: unknown): value is string {
  return typeof value === "string" && /^data:application\/(?:pdf|postscript);base64,/i.test(value);
}

/** Best-effort MIME type from a data URL or a file extension. */
export function mimeForImageSource(source: string): string {
  const data = /^data:(image\/[a-z0-9.+-]+);/i.exec(source);
  if (data) return data[1].toLowerCase();
  const path = source.split(/[?#]/, 1)[0];
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}
