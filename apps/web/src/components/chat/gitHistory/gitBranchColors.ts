// FILE: gitBranchColors.ts
// Purpose: The one lane colour palette, shared by the graph, the branch chips, and the
//          per-row strips. Colour is a property of a branch, not of a column, so a
//          branch keeps one hue wherever it appears.
// Layer: Git history UI helper
// Exports: GIT_GRAPH_LANE_COLOR_COUNT, GIT_GRAPH_LANE_COLORS, gitGraphLaneColor,
//          assignGitBranchColors

/**
 * Saturated, mid-lightness hues so lanes stay legible on both the light and dark
 * surfaces. Defined in the `@theme` block of index.css: the generic chart tokens
 * there are grayscale and made the graph vanish on the dark background.
 */
export const GIT_GRAPH_LANE_COLOR_COUNT = 10;

export const GIT_GRAPH_LANE_COLORS = [
  "var(--color-git-lane-1)",
  "var(--color-git-lane-2)",
  "var(--color-git-lane-3)",
  "var(--color-git-lane-4)",
  "var(--color-git-lane-5)",
  "var(--color-git-lane-6)",
  "var(--color-git-lane-7)",
  "var(--color-git-lane-8)",
  "var(--color-git-lane-9)",
  "var(--color-git-lane-10)",
] as const;

/** Palette colour for a zero-based index, wrapping in both directions. */
export function gitGraphLaneColor(colorIndex: number): string {
  return GIT_GRAPH_LANE_COLORS[
    ((colorIndex % GIT_GRAPH_LANE_COLOR_COUNT) + GIT_GRAPH_LANE_COLOR_COUNT) %
      GIT_GRAPH_LANE_COLOR_COUNT
  ]!;
}

/**
 * One colour per branch, distinct across the selected branches.
 *
 * A branch is anchored at its position in `candidates` (the canonical candidate order),
 * so an unselected chip previews the colour it will keep once it is turned on. When two
 * selected branches land on the same palette slot, the later one probes forward to the
 * next free colour, which is why the selected set stays distinct even when its branches
 * are more than ten candidates apart. The budget (8) is below the palette size (10), so
 * the probe finds a free slot whenever the selection is valid.
 */
export function assignGitBranchColors(
  selected: readonly string[],
  candidates: readonly string[],
): ReadonlyMap<string, string> {
  const selectedSet = new Set(selected);
  const usedSlots = new Set<number>();
  const colorByBranch = new Map<string, string>();

  candidates.forEach((branch, index) => {
    if (!selectedSet.has(branch)) {
      colorByBranch.set(branch, gitGraphLaneColor(index));
      return;
    }
    let slot = index % GIT_GRAPH_LANE_COLOR_COUNT;
    let probes = 0;
    while (usedSlots.has(slot) && probes < GIT_GRAPH_LANE_COLOR_COUNT) {
      slot = (slot + 1) % GIT_GRAPH_LANE_COLOR_COUNT;
      probes += 1;
    }
    usedSlots.add(slot);
    colorByBranch.set(branch, gitGraphLaneColor(slot));
  });

  return colorByBranch;
}
