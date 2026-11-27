import { describe, expect, it } from "vitest";

import {
  GIT_GRAPH_LANE_COLOR_COUNT,
  GIT_GRAPH_LANE_COLORS,
  assignGitBranchColors,
  gitGraphLaneColor,
} from "./gitBranchColors";

describe("gitBranchColors", () => {
  it("wraps the palette in both directions", () => {
    expect(GIT_GRAPH_LANE_COLORS).toHaveLength(GIT_GRAPH_LANE_COLOR_COUNT);
    expect(new Set(GIT_GRAPH_LANE_COLORS).size).toBe(GIT_GRAPH_LANE_COLOR_COUNT);
    expect(gitGraphLaneColor(0)).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(gitGraphLaneColor(GIT_GRAPH_LANE_COLOR_COUNT)).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(gitGraphLaneColor(-1)).toBe(GIT_GRAPH_LANE_COLORS[GIT_GRAPH_LANE_COLOR_COUNT - 1]);
  });

  it("anchors an unselected branch at its candidate position", () => {
    const colors = assignGitBranchColors(["b"], ["a", "b", "c"]);
    expect(colors.get("a")).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(colors.get("b")).toBe(GIT_GRAPH_LANE_COLORS[1]);
    expect(colors.get("c")).toBe(GIT_GRAPH_LANE_COLORS[2]);
  });

  it("keeps selected branches distinct when their candidate positions collide", () => {
    const candidates = Array.from({ length: 20 }, (_value, index) => `branch-${index}`);
    // Positions 0 and 10 share a palette slot; the later selected branch probes forward.
    const selected = [candidates[0]!, candidates[10]!];
    const colors = assignGitBranchColors(selected, candidates);

    expect(colors.get(candidates[0]!)).toBe(GIT_GRAPH_LANE_COLORS[0]);
    expect(colors.get(candidates[10]!)).toBe(GIT_GRAPH_LANE_COLORS[1]);
    expect(colors.get(candidates[0]!)).not.toBe(colors.get(candidates[10]!));
  });

  it("gives every selected branch its own colour within the budget", () => {
    const candidates = Array.from({ length: 8 }, (_value, index) => `b${index}`);
    const colors = assignGitBranchColors(candidates, candidates);
    const used = candidates.map((branch) => colors.get(branch));
    expect(new Set(used).size).toBe(candidates.length);
  });
});
