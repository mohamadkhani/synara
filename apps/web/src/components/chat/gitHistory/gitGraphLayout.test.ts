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

  it("ends the lane when the parent is not in the loaded window", () => {
    // A page boundary: the parent exists in the repository but was not loaded, so no
    // line can be drawn to it. Holding its lane open is what turned a walk over hundreds
    // of branch tips into hundreds of parallel lanes, so the branch ends as a stub and
    // reappears joined once the reader loads the page that holds the parent.
    const layout = layoutGitGraph([commit("child", ["not-loaded"]), commit("other", [])]);

    expect(layout.rows[0]?.parentLanes).toEqual([]);
    expect(layout.rows[0]?.releasedLanes).toEqual([0]);
    expect(layout.rows[0]?.continuesBelow).toBe(true);
    expect(layout.laneCount).toBe(1);
  });

  it("starts a lane at its own dot when its column sat empty above", () => {
    // `z` ends lane 2 while lanes 0 and 1 stay alive for two more rows, and the later tip
    // lands in that empty column. A line from the row top would join nothing.
    const layout = layoutGitGraph([
      commit("root", ["x", "y", "z"]),
      commit("z", []),
      commit("x", ["x2"]),
      commit("y", ["y2"]),
      commit("tip", []),
      commit("x2", []),
      commit("y2", []),
    ]);
    const tipRow = layout.rows.find((row) => row.sha === "tip");

    expect(tipRow?.lane).toBe(2);
    expect(tipRow?.continuesFromAbove).toBe(false);
    // The branch is a root: it ends at its dot and draws no stub, so the column is free
    // for the next branch without two lines touching.
    expect(tipRow?.releasedLanes).toEqual([]);
  });

  it("connects to the marked stub when a lane is reused on the very next row", () => {
    // `a` cannot reach its parent, so it ends with the marked stub; the tip that follows
    // lands in that column because no idle column is left.
    const layout = layoutGitGraph([
      commit("root", ["x", "a"]),
      commit("a", ["not-loaded"]),
      commit("tip", []),
      commit("x", []),
    ]);
    const stubRow = layout.rows.find((row) => row.sha === "a");
    const tipRow = layout.rows.find((row) => row.sha === "tip");

    expect(stubRow?.continuesBelow).toBe(true);
    expect(stubRow?.releasedLanes).toEqual([1]);
    expect(tipRow?.lane).toBe(1);
    expect(tipRow?.continuesFromAbove).toBe(true);
  });

  it("does not flag a real root as continuing below", () => {
    const layout = layoutGitGraph([commit("a", ["b"]), commit("b", [])]);

    expect(layout.rows[0]?.continuesBelow).toBe(false);
    expect(layout.rows[1]?.continuesBelow).toBe(false);
  });

  it("reuses a released lane instead of growing the gutter forever", () => {
    const layout = layoutGitGraph([commit("m", ["a", "b"]), commit("b", []), commit("a", [])]);

    expect(layout.laneCount).toBe(2);
    expect(layout.rows[2]?.lane).toBe(0);
  });

  it("keeps a marked stub and the lane that reuses it as one line", () => {
    // `b` cannot reach its parent, so it ends with the marked stub that reaches the row
    // bottom; `x` reuses that column and draws from the row top, so the two read as the
    // one line the stub promised.
    const layout = layoutGitGraph([
      commit("m", ["a", "b"]),
      commit("b", ["not-loaded"]),
      commit("x", []),
      commit("a", []),
    ]);

    expect(layout.rows[1]?.sha).toBe("b");
    expect(layout.rows[1]?.continuesBelow).toBe(true);
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

describe("lane colours", () => {
  it("keeps a lane's colour while it stays open", () => {
    const layout = layoutGitGraph([commit("a", ["b"]), commit("b", ["c"]), commit("c")]);

    const colours = layout.rows.map((row) => row.topLaneColors[0]);
    expect(colours[0]).toBe(colours[1]);
    expect(colours[1]).toBe(colours[2]);
  });

  it("gives a reused column a fresh colour instead of continuing the old line", () => {
    // `a` opens lane 0 and `b` ends it. `c` then takes the freed column: the two
    // branches share a column but must not look like one broken line.
    const layout = layoutGitGraph([commit("a", ["b"]), commit("b", []), commit("c", [])]);
    const colourOf = (sha: string) => {
      const row = layout.rows.find((entry) => entry.sha === sha);
      return row?.topLaneColors[row.lane] ?? null;
    };

    expect(layout.rows[0]?.lane).toBe(0);
    expect(layout.rows[2]?.lane).toBe(0);
    expect(colourOf("a")).not.toBeNull();
    expect(colourOf("c")).not.toBeNull();
    expect(colourOf("a")).not.toBe(colourOf("c"));
  });

  it("never repeats the column's previous colour, even when the palette is busy", () => {
    // Ten lanes fill the palette, one is released, and a later branch takes its column.
    // The only free colour is the one that column just had, which must not come back.
    const commits = [
      commit(
        "tip",
        Array.from({ length: 10 }, (_value, index) => `p${index}`),
      ),
      ...Array.from({ length: 10 }, (_value, index) => commit(`p${index}`, [])),
      commit("later", []),
    ];
    const layout = layoutGitGraph(commits);
    const releasedRow = layout.rows.find((row) => row.sha === "p0");
    const releasedColour = releasedRow?.topLaneColors[releasedRow.lane];
    const laterRow = layout.rows.find((row) => row.sha === "later");
    const laterColour = laterRow?.topLaneColors[laterRow.lane ?? 0];

    expect(releasedColour).not.toBeNull();
    expect(laterRow?.lane).toBe(releasedRow?.lane);
    expect(laterColour).not.toBe(releasedColour);
  });

  it("keeps concurrent lanes on different colours", () => {
    const layout = layoutGitGraph([
      commit("m", ["a", "b", "c"]),
      commit("a", []),
      commit("b", []),
      commit("c", []),
    ]);
    const firstRowColours = layout.rows[0]?.bottomLaneColors.filter((color) => color !== null);

    expect(new Set(firstRowColours).size).toBe(firstRowColours?.length);
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
    expect(resolveGitGraphLaneCap(120)).toBe(GIT_GRAPH_MIN_LANE_CAP);
    // 600px * 0.45 / 12px = 22 columns.
    expect(resolveGitGraphLaneCap(600)).toBe(22);
    expect(resolveGitGraphLaneCap(4000)).toBe(GIT_GRAPH_MAX_LANE_CAP);
  });

  it("draws every lane when the row fits the cap", () => {
    expect(resolveGitGraphGutter(0, 10)).toEqual({ lanes: 1, clipped: false });
    expect(resolveGitGraphGutter(3, 10)).toEqual({ lanes: 3, clipped: false });
    expect(resolveGitGraphGutter(10, 10)).toEqual({ lanes: 10, clipped: false });
  });

  it("clips the lanes a narrow pane cannot draw instead of flattening them", () => {
    // Flattening 400 lanes onto the last column would draw merges that do not exist.
    expect(resolveGitGraphGutter(11, 10)).toEqual({ lanes: 10, clipped: true });
    expect(resolveGitGraphGutter(400, 10)).toEqual({ lanes: 10, clipped: true });
    expect(resolveGitGraphGutter(4, 0)).toEqual({ lanes: 1, clipped: true });
  });

  it("keeps the gutter proportional to the drawn columns", () => {
    expect(GIT_GRAPH_LANE_WIDTH).toBeGreaterThan(0);
  });
});
