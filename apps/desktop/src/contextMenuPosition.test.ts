import { describe, expect, it } from "vitest";

import { resolveContextMenuPopupPosition } from "./contextMenuPosition";

describe("resolveContextMenuPopupPosition", () => {
  it("keeps the click position unchanged at normal zoom", () => {
    expect(resolveContextMenuPopupPosition({ x: 640, y: 480 }, 1)).toEqual({ x: 640, y: 480 });
  });

  it("scales CSS pixels up into window DIPs at zoom above 1", () => {
    // 1 CSS pixel spans more than one DIP when the page is zoomed in.
    expect(resolveContextMenuPopupPosition({ x: 640, y: 480 }, 1.25)).toEqual({ x: 800, y: 600 });
  });

  it("scales CSS pixels down into window DIPs at zoom below 1", () => {
    expect(resolveContextMenuPopupPosition({ x: 640, y: 480 }, 0.8)).toEqual({ x: 512, y: 384 });
  });

  it("floors fractional DIPs so the menu never lands between pixels", () => {
    expect(resolveContextMenuPopupPosition({ x: 101, y: 99 }, 1.1)).toEqual({ x: 111, y: 108 });
  });

  it("falls back to unscaled coordinates when the zoom factor is unusable", () => {
    for (const zoomFactor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveContextMenuPopupPosition({ x: 10, y: 20 }, zoomFactor)).toEqual({
        x: 10,
        y: 20,
      });
    }
  });

  it("returns null for a missing, negative, or non-numeric position", () => {
    expect(resolveContextMenuPopupPosition(undefined, 1)).toBeNull();
    expect(resolveContextMenuPopupPosition(null, 1)).toBeNull();
    expect(resolveContextMenuPopupPosition({ x: -1, y: 5 }, 1)).toBeNull();
    expect(resolveContextMenuPopupPosition({ x: Number.NaN, y: 5 }, 1)).toBeNull();
    expect(resolveContextMenuPopupPosition({ x: "5", y: 5 }, 1)).toBeNull();
    expect(resolveContextMenuPopupPosition([5, 5], 1)).toBeNull();
  });
});
