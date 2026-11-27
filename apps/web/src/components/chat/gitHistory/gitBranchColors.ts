// FILE: gitBranchColors.ts
// Purpose: The one lane colour palette, shared by the graph and the branch chips.
//          A chip's colour is read from the lane its commit actually draws, so a chip and
//          its line in the graph can never disagree.
// Layer: Git history UI helper
// Exports: GIT_GRAPH_LANE_COLOR_COUNT, GIT_GRAPH_LANE_COLORS, gitGraphLaneColor,
//          branchColorsFromLayout

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

export interface ColoredRefCommit {
  readonly sha: string;
  readonly refs: ReadonlyArray<{ readonly name: string; readonly kind: string }>;
}

/**
 * One colour per ref, taken from the lane its commit occupies in the laid-out graph.
 *
 * A ref is decorated onto exactly one commit (its tip), and the layout colours that commit's
 * lane; reusing it means the chip and the line in the graph always agree. Only branch and
 * remote decorations count: `head` names the pseudo-ref "HEAD" and a tag is not a branch.
 * The first commit that carries a ref wins, so a stale duplicate cannot repaint it.
 */
export function branchColorsFromLayout(
  commits: ReadonlyArray<ColoredRefCommit>,
  colorBySha: ReadonlyMap<string, number>,
): ReadonlyMap<string, string> {
  const colorByRef = new Map<string, string>();
  for (const commit of commits) {
    const colorIndex = colorBySha.get(commit.sha);
    if (colorIndex === undefined) continue;
    for (const ref of commit.refs) {
      if (ref.kind !== "branch" && ref.kind !== "remote") continue;
      if (colorByRef.has(ref.name)) continue;
      colorByRef.set(ref.name, gitGraphLaneColor(colorIndex));
    }
  }
  return colorByRef;
}
