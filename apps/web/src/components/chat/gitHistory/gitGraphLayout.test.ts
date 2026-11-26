import { describe, expect, it } from "vitest";

import {
  GIT_GRAPH_LANE_WIDTH,
  GIT_GRAPH_MAX_LANE_CAP,
  GIT_GRAPH_MIN_LANE_CAP,
  layoutGitGraph,
  resolveGitGraphGutter,
  resolveGitGraphLaneCap,
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

describe("row column count", () => {
  it("keeps every lane in one column instead of redrawing live lanes mid-history", () => {
    // Ten branches open, then eight end. The survivors keep their own columns, so no
    // line is redrawn as a diagonal; the row only reserves what it draws.
    const commits = [
      commit("a1", ["x"]),
      ...Array.from({ length: 8 }, (_value, index) => commit(`b${index}`, [`y${index}`])),
      commit("z", ["w"]),
      ...Array.from({ length: 8 }, (_value, index) => commit(`y${index}`)),
      commit("x"),
      commit("w"),
    ];
    const layout = layoutGitGraph(commits);
    const xRow = layout.rows.find((row) => row.sha === "x");
    const zRow = layout.rows.find((row) => row.sha === "z");

    // Nine tips are alive at the widest row, and no row draws more than that.
    expect(layout.laneCount).toBe(10);
    expect(zRow?.topColumns).toBe(10);
    // After the eight `y` roots end, the surviving lanes keep their columns: `x` stays
    // in lane 0 and `w` in lane 9, so the row reserves both.
    expect(xRow?.lane).toBe(0);
    expect(xRow?.topColumns).toBe(10);
    expect(xRow?.bottomColumns).toBe(10);
  });

  it("narrows each row to the lanes it actually draws", () => {
    const layout = layoutGitGraph([commit("a", ["b"]), commit("b", ["c"]), commit("c")]);

    expect(layout.rows.map((row) => row.topColumns)).toEqual([1, 1, 1]);
    expect(layout.laneCount).toBe(1);
  });

  it("drops a released lane's column once nothing draws it", () => {
    const layout = layoutGitGraph([commit("a", ["b"]), commit("b")]);

    // The root row releases its lane: nothing is drawn below it.
    expect(layout.rows[1]?.bottomColumns).toBe(0);
    expect(layout.laneCount).toBe(1);
  });
});

describe("lane gutter sizing", () => {
  it("grows the lane cap with the pane width, within bounds", () => {
    expect(resolveGitGraphLaneCap(0)).toBe(GIT_GRAPH_MIN_LANE_CAP);
    expect(resolveGitGraphLaneCap(Number.NaN)).toBe(GIT_GRAPH_MIN_LANE_CAP);
    // A narrow pane keeps the small cap so the message column survives.
    expect(resolveGitGraphLaneCap(120)).toBe(GIT_GRAPH_MIN_LANE_CAP);
    // 600px * 0.35 / 12px = 17 columns.
    expect(resolveGitGraphLaneCap(600)).toBe(17);
    // A very wide pane stops at the ceiling.
    expect(resolveGitGraphLaneCap(4000)).toBe(GIT_GRAPH_MAX_LANE_CAP);
  });

  it("draws every lane when the history fits the cap", () => {
    expect(resolveGitGraphGutter(0, 10)).toEqual({ lanes: 1, collapsed: false });
    expect(resolveGitGraphGutter(3, 10)).toEqual({ lanes: 3, collapsed: false });
    expect(resolveGitGraphGutter(10, 10)).toEqual({ lanes: 10, collapsed: false });
  });

  it("collapses to one rail instead of flattening deeper lanes", () => {
    // Flattening 400 lanes onto the last column would draw merges that do not exist.
    expect(resolveGitGraphGutter(11, 10)).toEqual({ lanes: 1, collapsed: true });
    expect(resolveGitGraphGutter(400, 10)).toEqual({ lanes: 1, collapsed: true });
    // A degenerate cap still renders one rail rather than zero columns.
    expect(resolveGitGraphGutter(4, 0)).toEqual({ lanes: 1, collapsed: true });
  });

  it("keeps the gutter proportional to the drawn columns", () => {
    expect(GIT_GRAPH_LANE_WIDTH).toBeGreaterThan(0);
  });
});
