/**
 * Routes of the paper editor: `#write` (documents) and `#write/<id>`
 * (one document). The path forms (`/write`, `/write/<id>`) are accepted for
 * direct links; nginx already serves index.html for them.
 */

export const WRITE_HOME_HREF = "#write";

export function isWriteRoute(route: string): boolean {
  const path = route.trim().split("?")[0];
  return /^[#/]write(\/[^/]*)?\/?$/.test(path);
}

export function documentIdFromRoute(route: string): string | null {
  const path = route.trim().split("?")[0];
  const match = /^[#/]write\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  return match ? match[1] : null;
}

export function documentHref(id: string): string {
  return `#write/${id}`;
}
