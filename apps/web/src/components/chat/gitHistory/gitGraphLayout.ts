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
export const GIT_GRAPH_MAX_LANE_CAP = 32;
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
   * True when the row draws more lanes than the gutter has room for. Those lanes are
   * left out (deep lines are clipped, not flattened onto the last column, which would
   * draw merges that do not exist) and the hint above the list says so.
   */
  readonly clipped: boolean;
}

/** Columns the gutter draws for a row, and whether deeper lanes had to be left out. */
export function resolveGitGraphGutter(laneCount: number, laneCap: number): GitGraphGutter {
  const cap = Math.max(1, Math.floor(laneCap));
  return laneCount > cap
    ? { lanes: cap, clipped: true }
    : { lanes: Math.max(1, laneCount), clipped: false };
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
   * True when the commit's parent is not in the loaded commits, so its lane ends at this
   * row only because the reader has not opened the page that holds the parent. The
   * renderer marks the stub as continuing rather than finished.
   */
  readonly continuesBelow: boolean;
  /**
   * Columns this row draws at its top edge, i.e. the highest lane it still shows plus
   * one. A lane keeps its column for its whole life, so lines stay vertical; a row that
   * survives on lane 8 still reserves the columns of the lanes it outlived until a new
   * branch reuses them, which the layout prefers to redrawing live lanes mid-history.
   */
  readonly topColumns: number;
  /** Columns this row draws at its bottom edge, after parents and releases. */
  readonly bottomColumns: number;
  /**
   * Colour index of each logical lane at the row's top edge, or null when the lane is
   * not drawn. A lane keeps its colour for as long as it is open, and a column that a
   * later branch reuses gets a fresh colour, so the two branches in one column never
   * look like a single broken line.
   */
  readonly topLaneColors: ReadonlyArray<number | null>;
  /** The same at the row's bottom edge, after parents and releases. */
  readonly bottomLaneColors: ReadonlyArray<number | null>;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRow>;
  /**
   * Widest number of drawn columns across rows, so every row reserves the same gutter.
   * This is the compacted width, not the highest lane index.
   */
  readonly laneCount: number;
}

/** Palette size the renderer draws from; the layout only hands out indices. */
const LANE_COLOR_COUNT = 10;

/** Columns a lane array draws: the highest live lane plus one, or zero when empty. */
function drawnColumnCount(lanes: ReadonlyArray<string | null>): number {
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    if (lanes[index] !== null) return index + 1;
  }
  return 0;
}

function firstFreeLane(lanes: Array<string | null>): number {
  const index = lanes.indexOf(null);
  return index >= 0 ? index : lanes.length;
}

/**
 * Free lane closest to `target`, preferring lower indices on a tie. Opening a branch
 * beside the lane it forks from keeps its edge short; the leftmost free lane instead
 * parks it next to an unrelated branch, and the edge then sweeps across the whole graph.
 */
function nearestFreeLane(lanes: Array<string | null>, target: number): number {
  if (!lanes.includes(null)) return lanes.length;
  for (let distance = 0; distance <= lanes.length; distance += 1) {
    const left = target - distance;
    if (left >= 0 && lanes[left] === null) return left;
    const right = target + distance;
    if (distance > 0 && right < lanes.length && lanes[right] === null) return right;
  }
  return lanes.length;
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
  // A lane is a line to a parent. When the parent is not among the loaded commits (an
  // older page the reader has not opened, or a ref the walk excludes) the line has
  // nowhere to go, so the branch ends as a stub instead of holding a column open for
  // hundreds of rows. This is what keeps a walk over hundreds of branch tips readable:
  // only connections inside the loaded window need a lane.
  const loaded = new Set(commits.map((commit) => commit.sha));
  const lanes: Array<string | null> = [];
  // Colour of each lane slot, kept in step with `lanes` so a column that a later branch
  // reuses does not continue the previous occupant's colour.
  const laneColors: Array<number | null> = [];
  let nextColorIndex = 0;
  const takeLaneColor = (): number => {
    const inUse = new Set(laneColors.filter((color): color is number => color !== null));
    for (let offset = 0; offset < LANE_COLOR_COUNT; offset += 1) {
      const candidate = (nextColorIndex + offset) % LANE_COLOR_COUNT;
      if (!inUse.has(candidate)) {
        nextColorIndex = (candidate + 1) % LANE_COLOR_COUNT;
        return candidate;
      }
    }
    const fallback = nextColorIndex;
    nextColorIndex = (nextColorIndex + 1) % LANE_COLOR_COUNT;
    return fallback;
  };
  const releaseLane = (index: number) => {
    lanes[index] = null;
    laneColors[index] = null;
  };
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
      // A tip that continues a branch already tracked opens beside that lane, so the
      // two lines connect over one column instead of sweeping across the history.
      const trackedParentLane =
        commit.parents[0] === undefined ? -1 : lanes.indexOf(commit.parents[0]);
      lane =
        trackedParentLane >= 0 ? nearestFreeLane(lanes, trackedParentLane) : firstFreeLane(lanes);
      if (releasedLaneIndices.has(lane)) {
        continuesFromAbove = true;
        releasedLaneIndices.delete(lane);
      }
      lanes[lane] = commit.sha;
      laneColors[lane] = takeLaneColor();
    }
    const before = lanes.slice();
    // Colours as they stand at the row's top edge: a lane's colour only changes when the
    // lane is released and a later branch takes the column.
    const topLaneColorsSnapshot = laneColors.slice(0, before.length);

    const incomingLanes: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (index !== lane && before[index] === commit.sha) {
        incomingLanes.push(index);
      }
    }
    // Collapsed lanes stop expecting the commit; their rows curve into the dot.
    for (const index of incomingLanes) {
      releaseLane(index);
      // A collapsed lane is not a released lane: its line curved into the dot, so a
      // later commit reusing the index starts a new line rather than continuing it.
      releasedLaneIndices.delete(index);
    }

    const after = lanes;
    const firstParent = commit.parents[0] ?? null;
    if (firstParent !== null && loaded.has(firstParent)) {
      after[lane] = firstParent;
    } else {
      releaseLane(lane);
    }

    const targetForParent = (parentSha: string): number | null => {
      // A parent outside the loaded window gets no lane: see `loaded` above.
      if (!loaded.has(parentSha)) return null;
      if (after[lane] === parentSha) return lane;
      const existing = after.indexOf(parentSha);
      if (existing >= 0) return existing;
      const free = nearestFreeLane(after, lane);
      after[free] = parentSha;
      laneColors[free] = takeLaneColor();
      releasedLaneIndices.delete(free);
      return free;
    };

    const parentLanes = [
      ...new Set(
        commit.parents
          .map((parent) => targetForParent(parent))
          .filter((parentLane): parentLane is number => parentLane !== null),
      ),
    ];

    const throughLanes: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (index === lane) continue;
      if (incomingLanes.includes(index)) continue;
      const value = before[index];
      if (value !== null && after[index] === value) {
        throughLanes.push(index);
      }
    }

    // A root, or a parent the reader has not loaded, ends the lane at this row.
    const releasedLanes = after[lane] === null && before[lane] !== null ? [lane] : [];
    if (firstParent === null) releasedLaneIndices.add(lane);

    const continuesBelow = firstParent !== null && !loaded.has(firstParent);
    const topColumns = drawnColumnCount(before);
    const bottomColumns = drawnColumnCount(after);
    const bottomLaneColors = laneColors.slice(0, after.length);
    laneCount = Math.max(laneCount, topColumns, bottomColumns);

    rows.push({
      sha: commit.sha,
      lane,
      incomingLanes,
      throughLanes,
      parentLanes,
      continuesFromAbove,
      releasedLanes,
      continuesBelow,
      topColumns,
      bottomColumns,
      topLaneColors: topLaneColorsSnapshot,
      bottomLaneColors,
    });

    // Releasing trailing lanes keeps the gutter narrow without shifting any index
    // that earlier rows already drew at.
    while (after.length > 0 && after[after.length - 1] === null) {
      after.pop();
      laneColors.pop();
    }
  }

  return { rows, laneCount };
}
