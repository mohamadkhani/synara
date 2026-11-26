// FILE: contextMenuPosition.ts
// Purpose: Converts renderer context-menu click coordinates (CSS pixels) into the window
//          DIP coordinates Electron's Menu.popup positions against.
// Layer: desktop main utility
// Exports: resolveContextMenuPopupPosition, ContextMenuPopupPosition

export interface ContextMenuPopupPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Renderer `clientX`/`clientY` are CSS pixels; one CSS pixel spans `zoomFactor` window
 * DIPs, and `Menu.popup` positions the menu in window DIPs. Without this conversion the
 * menu drifts away from the pointer as the page zoom changes.
 *
 * Returns null for a missing or unusable position, which tells the caller to let Electron
 * place the menu at the current pointer position instead.
 */
export function resolveContextMenuPopupPosition(
  position: unknown,
  zoomFactor: number,
): ContextMenuPopupPosition | null {
  if (typeof position !== "object" || position === null) return null;
  const { x, y } = position as { x?: unknown; y?: unknown };
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0
  ) {
    return null;
  }
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: Math.floor(x * zoom),
    y: Math.floor(y * zoom),
  };
}
