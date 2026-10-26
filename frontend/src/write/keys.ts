/** Platform-aware shortcut text: ⌘ on Apple devices, Ctrl elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function shortcut(keys: string): string {
  return IS_MAC ? keys.replace(/Mod\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥") : keys.replace(/Mod\+/g, "Ctrl+");
}
