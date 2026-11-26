// FILE: gitGraphLayout.ts
// Purpose: Pure lane layout for the commit-history graph. Walks a topologically
//          ordered commit list and assigns each commit a lane plus the vertical and
//          curved segments its list row must draw. No React or DOM dependency so the
//          layout is unit-testable and cheap to recompute when a page is appended.
// Layer: Git history UI helpers

/** Lane geometry shared by the layout and the renderer. */
export const GIT_GRAPH_ROW_HEIGHT = 32;
export const GIT_GRAPH_LANE_WIDTH = 12;
/**
 * Bounds for how many lanes the gutter may draw. The cap follows the pane width, so
 * widening the sidebar reveals more of the graph, and a narrow pane keeps the commit
 * message readable.
 */
export const GIT_GRAPH_MIN_LANE_CAP = 6;
export const GIT_GRAPH_MAX_LANE_CAP = 18;
/** Share of the pane the gutter may take before the message column starves. */
const GIT_GRAPH_GUTTER_WIDTH_RATIO = 0.35;

/**
 * Lanes a pane `availableWidth` pixels wide may draw. Floored to whole columns and
 * bounded so a very narrow pane still shows a few lanes and a wide one stays readable.
 */
export function resolveGitGraphLaneCap(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return GIT_GRAPH_MIN_LANE_CAP;
  const cap = Math.floor((availableWidth * GIT_GRAPH_GUTTER_WIDTH_RATIO) / GIT_GRAPH_LANE_WIDTH);
  return Math.min(GIT_GRAPH_MAX_LANE_CAP, Math.max(GIT_GRAPH_MIN_LANE_CAP, cap));
}

export interface GitGraphGutter {
  /** Columns the gutter draws. */
  readonly lanes: number;
  /**
   * True when the history has more lanes than the gutter can draw. The renderer then
   * draws a single rail instead of flattening deep lanes onto the last column, which
   * would draw merges that do not exist.
   */
  readonly collapsed: boolean;
}

/** Columns the gutter draws for a layout, and whether that required collapsing. */
export function resolveGitGraphGutter(laneCount: number, laneCap: number): GitGraphGutter {
  const cap = Math.max(1, Math.floor(laneCap));
  if (laneCount > cap) return { lanes: 1, collapsed: true };
  return { lanes: Math.max(1, laneCount), collapsed: false };
}

export interface GitGraphCommitInput {
  readonly sha: string;
  readonly parents: ReadonlyArray<string>;
}

export interface GitGraphRow {
  readonly sha: string;
  /** Lane the commit dot sits in. */
  readonly lane: number;
  /**
   * Other lanes whose next expected commit is this same sha. They end in a curve
   * into the dot (two branches converging on one commit).
   */
  readonly incomingLanes: ReadonlyArray<number>;
  /** Lanes that pass straight through the row without touching the commit. */
  readonly throughLanes: ReadonlyArray<number>;
  /** Lanes the parent edges leave toward at the bottom of the row, deduplicated. */
  readonly parentLanes: ReadonlyArray<number>;
  /**
   * True when an already-open lane reached this commit, so the row must draw its
   * own lane from the top edge down to the dot. Without it the graph shows gaps
   * between consecutive rows of the same branch.
   */
  readonly continuesFromAbove: boolean;
  /**
   * Lanes this row released because its commit has no parent. The row draws a stub
   * from its dot down to the bottom edge for each, so a later commit that reuses the
   * lane continues one line instead of leaving a half-row gap at the boundary.
   */
  readonly releasedLanes: ReadonlyArray<number>;
  /**
   * Logical lanes in the columns this row actually draws at its top edge, left to
   * right. A row that keeps lanes 0 and 9 alive draws them in columns 0 and 1, so the
   * graph does not leave empty columns between branches that are far apart in the
   * lane numbering. Empty when nothing is drawn above the commit.
   */
  readonly topLanes: ReadonlyArray<number>;
  /** The same column order at the row's bottom edge, after parents and releases. */
  readonly bottomLanes: ReadonlyArray<number>;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRow>;
  /**
   * Widest number of drawn columns across rows, so every row reserves the same gutter.
   * This is the compacted width, not the highest lane index.
   */
  readonly laneCount: number;
}

/** Logical lanes that are alive in `lanes`, left to right: the drawn column order. */
function drawnLaneOrder(lanes: ReadonlyArray<string | null>): number[] {
  const order: number[] = [];
  for (let index = 0; index < lanes.length; index += 1) {
    if (lanes[index] !== null) order.push(index);
  }
  return order;
}

function firstFreeLane(lanes: Array<string | null>): number {
  const index = lanes.indexOf(null);
  return index >= 0 ? index : lanes.length;
}

/**
 * Lay out a commit graph in topological order (every parent appears after its
 * children, as `git log --topo-order` guarantees).
 *
 * Each commit keeps its first parent's lane; extra parents either reuse the lane
 * that already tracks them or open a new one. Lanes that stop being referenced are
 * released so long histories keep a narrow gutter.
 */
export function layoutGitGraph(commits: ReadonlyArray<GitGraphCommitInput>): GitGraphLayout {
  const lanes: Array<string | null> = [];
  const rows: GitGraphRow[] = [];
  // Lane indices released by an earlier row and not yet reused. Reusing one draws the
  // new commit's line from the row top, so the reused column stays continuous instead
  // of leaving a half-row gap at the boundary.
  const releasedLaneIndices = new Set<number>();
  let laneCount = 0;

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha);
    let continuesFromAbove = lane >= 0;
    if (lane < 0) {
      lane = firstFreeLane(lanes);
      if (releasedLaneIndices.has(lane)) {
        continuesFromAbove = true;
        releasedLaneIndices.delete(lane);
      }
      lanes[lane] = commit.sha;
    }
    const before = lanes.slice();

    const incomingLanes: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (index !== lane && before[index] === commit.sha) {
        incomingLanes.push(index);
      }
    }
    // Collapsed lanes stop expecting the commit; their rows curve into the dot.
    for (const index of incomingLanes) {
      lanes[index] = null;
      // A collapsed lane is not a released lane: its line curved into the dot, so a
      // later commit reusing the index starts a new line rather than continuing it.
      releasedLaneIndices.delete(index);
    }

    const after = lanes;
    const firstParent = commit.parents[0] ?? null;
    after[lane] = firstParent;

    const targetForParent = (parentSha: string): number => {
      if (after[lane] === parentSha) return lane;
      const existing = after.indexOf(parentSha);
      if (existing >= 0) return existing;
      const free = firstFreeLane(after);
      after[free] = parentSha;
      releasedLaneIndices.delete(free);
      return free;
    };

    const parentLanes = [...new Set(commit.parents.map((parent) => targetForParent(parent)))];

    const throughLanes: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (index === lane) continue;
      if (incomingLanes.includes(index)) continue;
      const value = before[index];
      if (value !== null && after[index] === value) {
        throughLanes.push(index);
      }
    }

    const releasedLanes = firstParent === null ? [lane] : [];
    if (firstParent === null) releasedLaneIndices.add(lane);

    const topLanes = drawnLaneOrder(before);
    const bottomLanes = drawnLaneOrder(after);
    laneCount = Math.max(laneCount, topLanes.length, bottomLanes.length);

    rows.push({
      sha: commit.sha,
      lane,
      incomingLanes,
      throughLanes,
      parentLanes,
      continuesFromAbove,
      releasedLanes,
      topLanes,
      bottomLanes,
    });

    // Releasing trailing lanes keeps the gutter narrow without shifting any index
    // that earlier rows already drew at.
    while (after.length > 0 && after[after.length - 1] === null) {
      after.pop();
    }
  }

  return { rows, laneCount };
}
