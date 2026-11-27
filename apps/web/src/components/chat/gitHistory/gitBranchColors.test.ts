import { describe, expect, it } from "vitest";

import {
  GIT_GRAPH_LANE_COLOR_COUNT,
  GIT_GRAPH_LANE_COLORS,
  branchColorsFromLayout,
  gitGraphLaneColor,
  type ColoredRefCommit,
} from "./gitBranchColors";

describe("gitBranchColors", () => {
  it("wraps the palette in both directions", () => {
    expect(GIT_GRAPH_LANE_COLORS).toHaveLength(GIT_GRAPH_LANE_COLOR_COUNT);
    expect(new Set(GIT_GRAPH_LANE_COLORS).size).toBe(GIT_GRAPH_LANE_COLOR_COUNT);
    expect(gitGraphLaneColor(0)).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(gitGraphLaneColor(GIT_GRAPH_LANE_COLOR_COUNT)).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(gitGraphLaneColor(-1)).toBe(GIT_GRAPH_LANE_COLORS[GIT_GRAPH_LANE_COLOR_COUNT - 1]);
  });

  it("takes each ref's colour from the lane its commit draws", () => {
    const commits: ColoredRefCommit[] = [
      { sha: "a", refs: [{ name: "main", kind: "branch" }] },
      { sha: "b", refs: [{ name: "origin/main", kind: "remote" }] },
    ];
    const colors = branchColorsFromLayout(
      commits,
      new Map([
        ["a", 2],
        ["b", 5],
      ]),
    );

    expect(colors.get("main")).toBe(GIT_GRAPH_LANE_COLORS[2]);
    expect(colors.get("origin/main")).toBe(GIT_GRAPH_LANE_COLORS[5]);
  });

  it("ignores head pseudo-refs and tags, and keeps the first commit that carries a ref", () => {
    const commits: ColoredRefCommit[] = [
      { sha: "a", refs: [{ name: "HEAD", kind: "head" }] },
      { sha: "b", refs: [{ name: "v1", kind: "tag" }] },
      {
        sha: "c",
        refs: [
          { name: "main", kind: "branch" },
          { name: "origin/main", kind: "remote" },
        ],
      },
      // A duplicate decoration (an older clone of the same commit) must not repaint it.
      { sha: "d", refs: [{ name: "main", kind: "branch" }] },
    ];
    const colors = branchColorsFromLayout(
      commits,
      new Map([
        ["a", 7],
        ["b", 8],
        ["c", 3],
        ["d", 9],
      ]),
    );

    expect(colors.has("HEAD")).toBe(false);
    expect(colors.has("v1")).toBe(false);
    expect(colors.get("main")).toBe(GIT_GRAPH_LANE_COLORS[3]);
    expect(colors.get("origin/main")).toBe(GIT_GRAPH_LANE_COLORS[3]);
  });

  it("skips commits the layout did not colour", () => {
    const commits: ColoredRefCommit[] = [
      { sha: "missing", refs: [{ name: "ghost", kind: "branch" }] },
    ];
    expect(branchColorsFromLayout(commits, new Map()).size).toBe(0);
  });
});
