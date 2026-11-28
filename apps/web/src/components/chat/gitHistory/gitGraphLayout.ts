// FILE: gitGraphLayout.ts
// Purpose: Pure lane layout for the commit-history graph, using VS Code's carried
//          swimlane model (microsoft/vscode `scmHistory.ts`). One array of lanes is
//          carried down the walk: each row clones the previous row's output as its
//          input, reuses the commit's own lane in place for its first parent, copies
//          every other lane through, and appends a new lane for each further parent.
//          A commit that matches no lane keeps every input lane and appends its
//          parents at the end. A lane is freed only by a commit with no parents;
//          lanes are never reassigned to another branch and there is no deduplication.
// Layer: Git history UI helpers
//
// Documented deviation from the model: a parent that already appeared higher in the walk
// (a rebase or clock skew orders commits that way) gets no lane, because a lane can only
// run downward and nothing can draw a line up to a row that has already passed. VS Code
// would append a lane that never resolves. A parent that is merely not loaded yet keeps its
// lane in the model; the list simply ends and the next page continues it.

import { GIT_GRAPH_LANE_COLOR_COUNT } from "./gitBranchColors";

/** Lane geometry shared by the layout and the renderer. */
export const GIT_GRAPH_ROW_HEIGHT = 32;
export const GIT_GRAPH_LANE_WIDTH = 12;

export interface GitGraphCommitInput {
  readonly sha: string;
  readonly parents: ReadonlyArray<string>;
}

/** One swimlane: the commit id it is waiting for and its palette colour index. */
export interface GitGraphLane {
  readonly id: string;
  readonly color: number;
}

/** A lane that crosses the row from one input column to an output column. */
export interface GitGraphPassthrough {
  readonly input: number;
  readonly output: number;
}

export interface GitGraphRow {
  readonly sha: string;
  /** Column the commit dot occupies: its own lane, or a fresh column past the input lanes. */
  readonly lane: number;
  /** Colour index of the dot. */
  readonly color: number;
  /** Lanes entering the row, a clone of the previous row's output. */
  readonly inputLanes: ReadonlyArray<GitGraphLane>;
  /** Lanes leaving the row. */
  readonly outputLanes: ReadonlyArray<GitGraphLane>;
  /** True when an input lane was already waiting for this commit (draw a line above the dot). */
  readonly continuesFromAbove: boolean;
  /** True when a lane leaves the dot downward, i.e. the commit has a parent with a lane. */
  readonly continuesBelow: boolean;
  /** Other input lanes waiting for this commit; each curves into the dot. */
  readonly convergingLanes: ReadonlyArray<number>;
  /** Input-to-output lane connections drawn across the row; a straight vertical when equal. */
  readonly passthrough: ReadonlyArray<GitGraphPassthrough>;
  /** Output lanes opened for the commit's further parents; each curves out of the dot. */
  readonly parentLanes: ReadonlyArray<number>;
  /** Columns the row draws. */
  readonly laneCount: number;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRow>;
  /** Widest row, in columns; the list reserves this gutter for every row. */
  readonly laneCount: number;
}

/** Fresh colour for an appended parent, rotating through the shared lane palette. */
function makeColorAllocator(): () => number {
  let colorIndex = -1;
  return () => {
    colorIndex = (colorIndex + 1) % GIT_GRAPH_LANE_COLOR_COUNT;
    return colorIndex;
  };
}

/**
 * Lay out a commit graph in topological order (every parent appears after its children,
 * as `git log --topo-order` guarantees). The lane array is carried row to row; it only
 * grows when a commit opens a new lane for a parent and only empties at a commit with
 * no parents.
 */
export function layoutGitGraph(commits: ReadonlyArray<GitGraphCommitInput>): GitGraphLayout {
  const positionBySha = new Map(commits.map((commit, position) => [commit.sha, position]));
  const nextColor = makeColorAllocator();
  let lanes: ReadonlyArray<GitGraphLane> = [];
  const rows: GitGraphRow[] = [];
  let laneCount = 0;

  /**
   * A lane can only run downward, so a parent that already appeared higher in the walk
   * gets none. A parent that is not loaded yet keeps its lane: it sits in a page the reader
   * has not opened, and loading that page continues the lane where it stops.
   */
  const hasLane = (parentSha: string, position: number): boolean => {
    const parentPosition = positionBySha.get(parentSha);
    return parentPosition === undefined || parentPosition > position;
  };

  commits.forEach((commit, position) => {
    const inputLanes = lanes.map((lane) => ({ id: lane.id, color: lane.color }));
    const match = inputLanes.findIndex((lane) => lane.id === commit.sha);
    const lane = match >= 0 ? match : inputLanes.length;

    const outputLanes: GitGraphLane[] = [];
    const convergingLanes: number[] = [];
    const passthrough: GitGraphPassthrough[] = [];
    const parentLanes: number[] = [];
    let continuesBelow = false;
    let firstParentAdded = false;

    // Lanes waiting for this commit beyond the dot lane still curve into the dot, even at a
    // root, so this runs whatever the commit's parents are.
    inputLanes.forEach((node, index) => {
      if (node.id === commit.sha && index !== lane) convergingLanes.push(index);
    });

    if (commit.parents.length > 0) {
      inputLanes.forEach((node, index) => {
        if (node.id === commit.sha) {
          // The commit's own lane is reused in place for its first parent, keeping its colour.
          if (!firstParentAdded) {
            const firstParent = commit.parents[0]!;
            if (hasLane(firstParent, position)) {
              outputLanes.push({ id: firstParent, color: node.color });
              if (outputLanes.length - 1 === lane) continuesBelow = true;
              firstParentAdded = true;
            }
          }
          return;
        }
        const output = outputLanes.length;
        outputLanes.push({ id: node.id, color: node.color });
        passthrough.push({ input: index, output });
      });

      // Further parents open new lanes at the end. When the commit matched no lane (a tip)
      // this loop starts at 0, so the first parent fills the tip's own fresh column.
      //
      // Appending was measured against inserting beside the dot, which shortens each merge
      // edge but shifts every existing lane one column right on every merge. On a 150-commit
      // walk of this repository appending crossed 23 lane widths and inserting 9, so appending
      // wins by not moving the lanes that are already drawn.
      for (let index = firstParentAdded ? 1 : 0; index < commit.parents.length; index += 1) {
        const parent = commit.parents[index]!;
        if (!hasLane(parent, position)) continue;
        const output = outputLanes.length;
        outputLanes.push({ id: parent, color: nextColor() });
        if (output === lane) continuesBelow = true;
        else parentLanes.push(output);
      }
    }

    const color = inputLanes[lane]?.color ?? outputLanes[lane]?.color ?? 0;
    const rowColumns = Math.max(inputLanes.length, outputLanes.length, lane + 1, 1);
    laneCount = Math.max(laneCount, rowColumns);

    rows.push({
      sha: commit.sha,
      lane,
      color,
      inputLanes,
      outputLanes,
      continuesFromAbove: match >= 0,
      continuesBelow,
      convergingLanes,
      passthrough,
      parentLanes,
      laneCount: rowColumns,
    });

    lanes = outputLanes;
  });

  return { rows, laneCount };
}
