// Mirrors the ten cases of microsoft/vscode `scmHistory.test.ts` for the carried-swimlane
// model, with our field names (`id`/`color` lanes, `inputLanes`/`outputLanes`) and without
// the branch colour map and incoming/outgoing pseudo-nodes, which this step does not model.

import { describe, expect, it } from "vitest";

import { layoutGitGraph, type GitGraphLane } from "./gitGraphLayout";

const commit = (sha: string, parents: string[] = []) => ({ sha, parents });
const lane = (id: string, color: number): GitGraphLane => ({ id, color });

describe("layoutGitGraph", () => {
  it("empty graph", () => {
    expect(layoutGitGraph([])).toEqual({ rows: [], laneCount: 0 });
  });

  /**
   *  * a
   */
  it("single commit", () => {
    const layout = layoutGitGraph([commit("a", [])]);
    const row = layout.rows[0]!;

    expect(layout.rows).toHaveLength(1);
    expect(row.inputLanes).toEqual([]);
    expect(row.outputLanes).toEqual([]);
  });

  /**
   *  * a(b)
   *  * b(c)
   *  * c(d)
   *  * d(e)
   *  * e
   */
  it("linear graph", () => {
    const layout = layoutGitGraph([
      commit("a", ["b"]),
      commit("b", ["c"]),
      commit("c", ["d"]),
      commit("d", ["e"]),
      commit("e", []),
    ]);

    expect(layout.rows).toHaveLength(5);
    expect(layout.rows[0]!.inputLanes).toEqual([]);
    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("c", 0)]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("c", 0)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("d", 0)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("d", 0)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[4]!.outputLanes).toEqual([]);
    expect(layout.rows.every((row) => row.lane === 0)).toBe(true);
    expect(layout.laneCount).toBe(1);
  });

  /**
   *  * a(b)
   *  *   b(c,d)
   *  |\
   *  | * d(c)
   *  |/
   *  * c(e)
   *  * e(f)
   */
  it("merge commit (single commit in topic branch)", () => {
    const layout = layoutGitGraph([
      commit("a", ["b"]),
      commit("b", ["c", "d"]),
      commit("d", ["c"]),
      commit("c", ["e"]),
      commit("e", ["f"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("c", 0), lane("d", 1)]);
    // The second parent opens its own lane, drawn as a curve out of the dot.
    expect(layout.rows[1]!.parentLanes).toEqual([1]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("c", 0), lane("d", 1)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("c", 0), lane("c", 1)]);
    expect(layout.rows[2]!.lane).toBe(1);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("c", 0), lane("c", 1)]);
    expect(layout.rows[3]!.convergingLanes).toEqual([1]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("f", 0)]);
  });

  /**
   *  * a(b,c)
   *  |\
   *  | * c(d)
   *  * | b(e)
   *  * | e(f)
   *  * | f(d)
   *  |/
   *  * d(g)
   */
  it("merge commit (multiple commits in topic branch)", () => {
    const layout = layoutGitGraph([
      commit("a", ["b", "c"]),
      commit("c", ["d"]),
      commit("b", ["e"]),
      commit("e", ["f"]),
      commit("f", ["d"]),
      commit("d", ["g"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("b", 0), lane("d", 1)]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("b", 0), lane("d", 1)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("f", 0), lane("d", 1)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("f", 0), lane("d", 1)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("d", 0), lane("d", 1)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("d", 0), lane("d", 1)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("g", 0)]);
  });

  /**
   *  * a(b,c)
   *  |\
   *  | * c(b)
   *  |/
   *  * b(d,e)
   *  |\
   *  | * e(f)
   *  | * f(g)
   *  * | d(h)
   */
  it("create branch from merge commit", () => {
    const layout = layoutGitGraph([
      commit("a", ["b", "c"]),
      commit("c", ["b"]),
      commit("b", ["d", "e"]),
      commit("e", ["f"]),
      commit("f", ["g"]),
      commit("d", ["h"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("b", 0), lane("b", 1)]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("b", 0), lane("b", 1)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("d", 0), lane("e", 2)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("d", 0), lane("e", 2)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("d", 0), lane("f", 2)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("d", 0), lane("f", 2)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("d", 0), lane("g", 2)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("d", 0), lane("g", 2)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("h", 0), lane("g", 2)]);
  });

  /**
   *  * a(b,c)
   *  |\
   *  | * c(d)
   *  * | b(e,f)
   *  |\|
   *  | |\
   *  | | * f(g)
   *  * | | e(g)
   *  | * | d(g)
   *  |/ /
   *  | /
   *  |/
   *  * g(h)
   */
  it("create multiple branches from a commit", () => {
    const layout = layoutGitGraph([
      commit("a", ["b", "c"]),
      commit("c", ["d"]),
      commit("b", ["e", "f"]),
      commit("f", ["g"]),
      commit("e", ["g"]),
      commit("d", ["g"]),
      commit("g", ["h"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0), lane("c", 1)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("b", 0), lane("d", 1)]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("b", 0), lane("d", 1)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("e", 0), lane("d", 1), lane("f", 2)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("e", 0), lane("d", 1), lane("f", 2)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0), lane("d", 1), lane("g", 2)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("e", 0), lane("d", 1), lane("g", 2)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("g", 0), lane("d", 1), lane("g", 2)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("g", 0), lane("d", 1), lane("g", 2)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("g", 0), lane("g", 1), lane("g", 2)]);
    expect(layout.rows[6]!.inputLanes).toEqual([lane("g", 0), lane("g", 1), lane("g", 2)]);
    expect(layout.rows[6]!.convergingLanes).toEqual([1, 2]);
    expect(layout.rows[6]!.outputLanes).toEqual([lane("h", 0)]);
  });

  /**
   *  * a(b)
   *  * b(c)
   *  * c(d)
   *  * d(e)
   *  * e(f,g)
   *  |\
   *  | * g(h)
   *
   * Adapted from the VS Code colour-map case: this step has no branch colour map, so the
   * lane colours are the default palette rotation.
   */
  it("graph with branching walk", () => {
    const layout = layoutGitGraph([
      commit("a", ["b"]),
      commit("b", ["c"]),
      commit("c", ["d"]),
      commit("d", ["e"]),
      commit("e", ["f", "g"]),
      commit("g", ["h"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("c", 0)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("d", 0)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("f", 0), lane("g", 1)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("f", 0), lane("g", 1)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("f", 0), lane("h", 1)]);
  });

  /**
   *  * a(b)
   *  * b(e)
   *  | * c(d)
   *  | * d(e)
   *  |/
   *  * e(f)
   *  * f(g)
   *
   * Adapted from the incoming/outgoing case: the pseudo-nodes are not modelled here, so
   * this is the underlying commit walk.
   */
  it("walk with an unloaded interleaved tip", () => {
    const layout = layoutGitGraph([
      commit("a", ["b"]),
      commit("b", ["e"]),
      commit("c", ["d"]),
      commit("d", ["e"]),
      commit("e", ["f"]),
      commit("f", ["g"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("e", 0)]);
    // `c` matches no lane, so it keeps every input lane and appends its parent in a fresh column.
    expect(layout.rows[2]!.inputLanes).toEqual([lane("e", 0)]);
    expect(layout.rows[2]!.lane).toBe(1);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0), lane("e", 1)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("e", 0), lane("e", 1)]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("f", 0)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("f", 0)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("g", 0)]);
  });

  /**
   *  * a(b)
   *  * b(c,d)
   *  |\
   *  | * c(e)
   *  * | d(e)
   *  |/
   *  * e(f)
   *  * f(g)
   *
   * Adapted from the merged incoming-changes case: no pseudo-nodes.
   */
  it("merge that shares a parent between two lanes", () => {
    const layout = layoutGitGraph([
      commit("a", ["b"]),
      commit("b", ["c", "d"]),
      commit("c", ["e"]),
      commit("d", ["e"]),
      commit("e", ["f"]),
      commit("f", ["g"]),
    ]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.inputLanes).toEqual([lane("b", 0)]);
    expect(layout.rows[1]!.outputLanes).toEqual([lane("c", 0), lane("d", 1)]);
    expect(layout.rows[2]!.inputLanes).toEqual([lane("c", 0), lane("d", 1)]);
    expect(layout.rows[2]!.outputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.inputLanes).toEqual([lane("e", 0), lane("d", 1)]);
    expect(layout.rows[3]!.outputLanes).toEqual([lane("e", 0), lane("e", 1)]);
    expect(layout.rows[4]!.inputLanes).toEqual([lane("e", 0), lane("e", 1)]);
    expect(layout.rows[4]!.convergingLanes).toEqual([1]);
    expect(layout.rows[4]!.outputLanes).toEqual([lane("f", 0)]);
    expect(layout.rows[5]!.inputLanes).toEqual([lane("f", 0)]);
    expect(layout.rows[5]!.outputLanes).toEqual([lane("g", 0)]);
  });
});

describe("layoutGitGraph deviation", () => {
  it("keeps a lane for a parent outside the loaded commits so the continuation row can draw it", () => {
    const layout = layoutGitGraph([commit("child", ["not-loaded"]), commit("other", [])]);
    const child = layout.rows[0]!;

    expect(child.outputLanes).toEqual([lane("not-loaded", 0)]);
    expect(child.continuesBelow).toBe(true);
    expect(child.parentLanes).toEqual([]);
  });

  it("gives no lane to a parent that already appeared higher in the walk", () => {
    const layout = layoutGitGraph([commit("parent", ["child"]), commit("child", ["parent"])]);

    // `parent` sits above `child`, so a lane cannot run up to it.
    expect(layout.rows[1]!.outputLanes).toEqual([]);
    expect(layout.rows[1]!.parentLanes).toEqual([]);
  });

  it("frees every lane at a commit with no parents", () => {
    // A root clears the lane array; that is the only way it shrinks.
    const layout = layoutGitGraph([commit("m", ["a", "b"]), commit("b", []), commit("a", [])]);

    expect(layout.rows[0]!.outputLanes).toEqual([lane("a", 0), lane("b", 1)]);
    expect(layout.rows[1]!.outputLanes).toEqual([]);
    expect(layout.rows[2]!.inputLanes).toEqual([]);
    expect(layout.rows[2]!.lane).toBe(0);
  });
});
