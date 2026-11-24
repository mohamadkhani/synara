import { describe, expect, it } from "vitest";

import {
  GIT_GRAPH_MAX_VISIBLE_LANES,
  clampGitGraphLane,
  layoutGitGraph,
  visibleGitGraphLaneCount,
} from "./gitGraphLayout";

const commit = (sha: string, parents: string[] = []) => ({ sha, parents });

describe("layoutGitGraph", () => {
  it("keeps a linear history in one lane", () => {
    const layout = layoutGitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.rows[0]?.parentLanes).toEqual([0]);
    expect(layout.rows[2]?.parentLanes).toEqual([]);
    expect(layout.rows.every((row) => row.throughLanes.length === 0)).toBe(true);
    // Every row after the first continues the same lane from the row above.
    expect(layout.rows.map((row) => row.continuesFromAbove)).toEqual([false, true, true]);
  });

  it("opens a second lane for a side branch and merges it back", () => {
    //   m  merge of b into a
    //  / \
    // a   b
    //  \ /
    //   r
    const layout = layoutGitGraph([
      commit("m", ["a", "b"]),
      commit("b", ["r"]),
      commit("a", ["r"]),
      commit("r", []),
    ]);

    const mergeRow = layout.rows[0];
    expect(mergeRow?.lane).toBe(0);
    // Second parent gets its own lane at the bottom of the merge row.
    expect(mergeRow?.parentLanes).toEqual([0, 1]);

    const sideRow = layout.rows[1];
    expect(sideRow?.lane).toBe(1);
    // The main lane continues past the side-branch commit.
    expect(sideRow?.throughLanes).toEqual([0]);

    // Both branches converge on the shared root.
    const rootRow = layout.rows[3];
    expect(rootRow?.lane).toBe(0);
    expect(rootRow?.incomingLanes).toEqual([1]);
  });

  it("marks a commit that two lanes were waiting for as an incoming merge", () => {
    const layout = layoutGitGraph([
      commit("head", ["left", "right"]),
      commit("right", ["base"]),
      commit("left", ["base"]),
      commit("base", ["root"]),
      commit("root", []),
    ]);

    expect(layout.rows[3]?.incomingLanes).toEqual([1]);
    expect(layout.rows[3]?.throughLanes).toEqual([]);
    expect(layout.rows[4]?.lane).toBe(0);
  });

  it("keeps unresolved parents from a truncated page off the commit lane", () => {
    // A page boundary: the parent exists but was not loaded yet.
    const layout = layoutGitGraph([commit("child", ["not-loaded"]), commit("other", [])]);

    expect(layout.rows[0]?.parentLanes).toEqual([0]);
    expect(layout.rows[0]?.lane).toBe(0);
  });

  it("reuses a released lane instead of growing the gutter forever", () => {
    const layout = layoutGitGraph([commit("m", ["a", "b"]), commit("b", []), commit("a", [])]);

    expect(layout.laneCount).toBe(2);
    expect(layout.rows[2]?.lane).toBe(0);
  });

  it("keeps a reused lane continuous instead of leaving a half-row gap", () => {
    // b is a root at lane 1; x reuses that released lane. The root records the
    // released lane (so its stub reaches the row bottom) and the reused commit draws
    // from the top, so the two rows read as one line.
    const layout = layoutGitGraph([
      commit("m", ["a", "b"]),
      commit("b", []),
      commit("x", []),
      commit("a", []),
    ]);

    expect(layout.rows[1]?.sha).toBe("b");
    expect(layout.rows[1]?.releasedLanes).toEqual([1]);
    expect(layout.rows[2]?.sha).toBe("x");
    expect(layout.rows[2]?.lane).toBe(1);
    expect(layout.rows[2]?.continuesFromAbove).toBe(true);
  });

  it("does not continue a lane that only passed through without being released", () => {
    // The lane-1 branch merges back into base; nothing released lane 1, so the commit
    // that later opens there starts a fresh line.
    const layout = layoutGitGraph([
      commit("head", ["left", "right"]),
      commit("right", ["base"]),
      commit("left", ["base"]),
      commit("base", ["root"]),
      commit("root", []),
    ]);

    expect(layout.rows[3]?.incomingLanes).toEqual([1]);
    expect(layout.rows[3]?.releasedLanes).toEqual([]);
  });

  it("returns an empty layout for no commits", () => {
    expect(layoutGitGraph([])).toEqual({ rows: [], laneCount: 0 });
  });
});

describe("lane gutter clamping", () => {
  it("keeps lanes inside the drawn columns", () => {
    expect(clampGitGraphLane(0)).toBe(0);
    expect(clampGitGraphLane(GIT_GRAPH_MAX_VISIBLE_LANES - 1)).toBe(
      GIT_GRAPH_MAX_VISIBLE_LANES - 1,
    );
    expect(clampGitGraphLane(GIT_GRAPH_MAX_VISIBLE_LANES + 5)).toBe(
      GIT_GRAPH_MAX_VISIBLE_LANES - 1,
    );
    expect(clampGitGraphLane(-3)).toBe(0);
  });

  it("reserves at least one column and caps the gutter", () => {
    expect(visibleGitGraphLaneCount(0)).toBe(1);
    expect(visibleGitGraphLaneCount(3)).toBe(3);
    expect(visibleGitGraphLaneCount(GIT_GRAPH_MAX_VISIBLE_LANES + 40)).toBe(
      GIT_GRAPH_MAX_VISIBLE_LANES,
    );
  });
});
