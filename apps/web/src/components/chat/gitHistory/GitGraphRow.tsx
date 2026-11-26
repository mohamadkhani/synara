// FILE: GitGraphRow.tsx
// Purpose: One commit row in the history view: the lane/dot SVG drawn from the
//          layout plus the shared subject/author/sha summary.
// Layer: Git history UI

import type { GitHistoryCommit, GitStashEntry } from "@synara/contracts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { memo } from "react";

import { ArchiveIcon, ChangesIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { DiffStat } from "../DiffStatLabel";
import { GitCommitRefBadges } from "./GitCommitRefBadges";
import {
  GIT_GRAPH_LANE_WIDTH,
  GIT_GRAPH_ROW_HEIGHT,
  resolveGitGraphGutter,
  type GitGraphRow,
} from "./gitGraphLayout";

/**
 * Saturated, mid-lightness hues so lanes stay legible on both the light and dark
 * surfaces. Defined in the `@theme` block of index.css: the generic chart tokens
 * there are grayscale and made the graph vanish on the dark background.
 */
const GIT_GRAPH_LANE_COLOR_COUNT = 10;

const GIT_GRAPH_LANE_COLORS = [
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

function gitGraphLaneColor(colorIndex: number): string {
  return GIT_GRAPH_LANE_COLORS[
    ((colorIndex % GIT_GRAPH_LANE_COLOR_COUNT) + GIT_GRAPH_LANE_COLOR_COUNT) %
      GIT_GRAPH_LANE_COLOR_COUNT
  ]!;
}

function laneCenter(lane: number, laneWidth: number): number {
  return lane * laneWidth + laneWidth / 2;
}

function buildCurve(
  fromLane: number,
  toLane: number,
  fromY: number,
  toY: number,
  laneWidth: number,
): string {
  const fromX = laneCenter(fromLane, laneWidth);
  const toX = laneCenter(toLane, laneWidth);
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const controlY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`;
}

const COMMIT_ROW_CLASS_NAME =
  "@container flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md py-0 pl-1 pr-2 text-left";

/** Subject plus the author/time/short-sha column shared by graph and flat rows. */
function CommitRowSummary(props: {
  commit: GitHistoryCommit;
  authorLabel: string;
  timeLabel: string;
  /** Full date and time for the row's hover title. */
  dateTimeLabel: string;
  remoteNames?: readonly string[];
  onRefContextMenu?: (
    commit: GitHistoryCommit,
    ref: GitHistoryCommit["refs"][number],
    event: ReactMouseEvent,
  ) => void;
}) {
  const { commit, onRefContextMenu } = props;
  return (
    <>
      <GitCommitRefBadges
        commit={commit}
        maxVisible={2}
        {...(props.remoteNames ? { remoteNames: props.remoteNames } : {})}
        {...(onRefContextMenu ? { onRefContextMenu } : {})}
      />
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">{commit.subject}</span>
      <span className="hidden shrink-0 items-center gap-2 text-ui-xs text-muted-foreground @min-[22rem]:flex">
        <span className="hidden max-w-[8rem] truncate @min-[34rem]:inline">
          {props.authorLabel}
        </span>
        <span className="tabular-nums" title={props.dateTimeLabel}>
          {props.timeLabel}
        </span>
        <span className="font-mono">{commit.shortSha}</span>
      </span>
    </>
  );
}

export const GitGraphCommitRow = memo(function GitGraphCommitRow(props: {
  commit: GitHistoryCommit;
  row: GitGraphRow;
  /** Lanes this pane can draw; deeper lanes of this row are left out. */
  laneCap: number;
  /** Tooltip for a lane that only stops because its parent is not loaded yet. */
  pendingParentTitle?: string;
  selected: boolean;
  onSelect: (sha: string) => void;
  authorLabel: string;
  timeLabel: string;
  dateTimeLabel: string;
  remoteNames?: readonly string[];
  onRefContextMenu?: (
    commit: GitHistoryCommit,
    ref: GitHistoryCommit["refs"][number],
    event: ReactMouseEvent,
  ) => void;
  onContextMenu?: (commit: GitHistoryCommit, event: ReactMouseEvent) => void;
}) {
  const { commit, row } = props;
  const height = GIT_GRAPH_ROW_HEIGHT;
  const laneWidth = GIT_GRAPH_LANE_WIDTH;
  // No separate graph column: the row draws only the columns it actually uses, and its
  // content starts right after them. Lanes keep their column for life, so every line
  // stays vertical. A row deeper than the pane can draw leaves the extra lanes out.
  const rowColumns = Math.max(row.topColumns, row.bottomColumns, 1);
  const gutter = resolveGitGraphGutter(rowColumns, props.laneCap);
  const width = gutter.lanes * laneWidth;
  const mid = height / 2;
  const laneOutside = row.lane >= gutter.lanes;
  const commitColumn = laneOutside ? gutter.lanes - 1 : row.lane;
  const commitX = laneCenter(commitColumn, laneWidth);
  const laneFits = (lane: number) => lane < gutter.lanes;
  /**
   * Colour of a lane as the layout recorded it: a lane keeps its colour while it is open,
   * and a column a later branch reuses gets a fresh one, so two branches in one column
   * never read as a single broken line.
   */
  const colorOf = (lane: number, edge: "top" | "bottom" = "top") => {
    const colors = edge === "bottom" ? row.bottomLaneColors : row.topLaneColors;
    return gitGraphLaneColor(colors[lane] ?? lane);
  };
  const color = colorOf(row.lane);
  const isCheckedOut = commit.refs.some((ref) => ref.kind === "head");

  return (
    <button
      type="button"
      onClick={() => props.onSelect(commit.sha)}
      onContextMenu={
        props.onContextMenu ? (event) => props.onContextMenu?.(commit, event) : undefined
      }
      aria-pressed={props.selected}
      title={commit.subject}
      style={{ height }}
      className={cn(
        COMMIT_ROW_CLASS_NAME,
        props.selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        aria-hidden="true"
      >
        {row.continuesBelow && props.pendingParentTitle ? (
          <title>{props.pendingParentTitle}</title>
        ) : null}
        {row.continuesFromAbove && !laneOutside ? (
          <path
            d={`M ${commitX} 0 L ${commitX} ${mid}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        ) : null}
        {row.throughLanes.filter(laneFits).map((lane) => (
          <path
            key={`through-${lane}`}
            d={`M ${laneCenter(lane, laneWidth)} 0 L ${laneCenter(lane, laneWidth)} ${height}`}
            stroke={colorOf(lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.incomingLanes.filter(laneFits).map((lane) => (
          <path
            key={`incoming-${lane}`}
            d={buildCurve(lane, commitColumn, 0, mid, laneWidth)}
            stroke={colorOf(lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.parentLanes.filter(laneFits).map((lane) => (
          <path
            key={`parent-${lane}`}
            d={buildCurve(commitColumn, lane, mid, height, laneWidth)}
            // The edge into a merged branch carries that branch's color, so a merge does
            // not paint the incoming side with the target branch's hue.
            stroke={colorOf(lane, "bottom")}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.releasedLanes.filter(laneFits).map((lane) => (
          <path
            key={`released-${lane}`}
            d={`M ${commitX} ${mid} L ${commitX} ${height}`}
            stroke={colorOf(lane)}
            strokeWidth={2}
            fill="none"
            // A lane that stops only because its parent sits in a page the reader has
            // not opened keeps a dashed tail, so the end reads as "continues below"
            // rather than as a broken line.
            {...(row.continuesBelow ? { strokeDasharray: "3 3" } : {})}
          />
        ))}
        <circle
          cx={commitX}
          cy={mid}
          r={laneOutside ? 3 : isCheckedOut ? 4.6 : 3.4}
          // A commit whose lane is outside the drawn window has no real column here, so
          // its marker is a hollow outline: a filled dot in a lane color would read as a
          // lane this commit does not belong to.
          fill={laneOutside ? "none" : isCheckedOut ? "var(--color-background)" : color}
          stroke={laneOutside ? "var(--color-muted-foreground)" : isCheckedOut ? color : "none"}
          strokeWidth={laneOutside ? 1.5 : isCheckedOut ? 2 : 0}
        />
      </svg>
      <CommitRowSummary
        commit={commit}
        authorLabel={props.authorLabel}
        timeLabel={props.timeLabel}
        dateTimeLabel={props.dateTimeLabel}
        {...(props.remoteNames ? { remoteNames: props.remoteNames } : {})}
        {...(props.onRefContextMenu ? { onRefContextMenu: props.onRefContextMenu } : {})}
      />
    </button>
  );
});

/** Flat fallback row used while a text filter hides the graph. */
export const GitCommitFlatRow = memo(function GitCommitFlatRow(props: {
  commit: GitHistoryCommit;
  selected: boolean;
  onSelect: (sha: string) => void;
  authorLabel: string;
  timeLabel: string;
  /** Full date and time for the row's hover title. */
  dateTimeLabel: string;
  remoteNames?: readonly string[];
  onRefContextMenu?: (
    commit: GitHistoryCommit,
    ref: GitHistoryCommit["refs"][number],
    event: ReactMouseEvent,
  ) => void;
  onContextMenu?: (commit: GitHistoryCommit, event: ReactMouseEvent) => void;
}) {
  const { commit } = props;
  return (
    <button
      type="button"
      onClick={() => props.onSelect(commit.sha)}
      onContextMenu={
        props.onContextMenu ? (event) => props.onContextMenu?.(commit, event) : undefined
      }
      aria-pressed={props.selected}
      title={commit.subject}
      style={{ height: GIT_GRAPH_ROW_HEIGHT }}
      className={cn(
        COMMIT_ROW_CLASS_NAME,
        props.selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <CommitRowSummary
        commit={commit}
        authorLabel={props.authorLabel}
        timeLabel={props.timeLabel}
        dateTimeLabel={props.dateTimeLabel}
        {...(props.remoteNames ? { remoteNames: props.remoteNames } : {})}
        {...(props.onRefContextMenu ? { onRefContextMenu: props.onRefContextMenu } : {})}
      />
    </button>
  );
});

/**
 * One stash entry above the history: same shape as a working-tree row, with the
 * message as the label and the `stash@{n}` handle on the right. Actions live in the
 * row's context menu, so the row itself is not clickable.
 */
export const GitStashRow = memo(function GitStashRow(props: {
  stash: GitStashEntry;
  selected?: boolean;
  onSelect?: (stash: GitStashEntry) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  const gutterWidth = GIT_GRAPH_LANE_WIDTH;
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onSelect?.(props.stash)}
      onContextMenu={props.onContextMenu}
      title={`${props.stash.stashRef}: ${props.stash.message}`}
      style={{ height: GIT_GRAPH_ROW_HEIGHT }}
      className={cn(
        COMMIT_ROW_CLASS_NAME,
        "cursor-pointer select-none",
        props.selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <span
        style={{ width: gutterWidth }}
        className="flex shrink-0 items-center justify-center text-muted-foreground"
      >
        <ArchiveIcon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">{props.stash.message}</span>
      <span className="hidden shrink-0 items-center gap-2 text-ui-xs text-muted-foreground @min-[22rem]:flex">
        <span className="font-mono">{props.stash.stashRef}</span>
      </span>
    </button>
  );
});

/**
 * Pseudo-commit row for the working tree: same shape as a commit row so it sits at
 * the top of the list, but with a change icon instead of a graph dot and no author,
 * date, or sha.
 */
export const GitWorkingTreeRow = memo(function GitWorkingTreeRow(props: {
  label: string;
  fileCount: number;
  additions: number;
  deletions: number;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  // The working-tree row has no lanes of its own; its icon sits in the first lane
  // column and the label follows immediately, like a one-lane commit row.
  const gutterWidth = GIT_GRAPH_LANE_WIDTH;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      onContextMenu={props.onContextMenu}
      aria-pressed={props.selected}
      title={props.label}
      style={{ height: GIT_GRAPH_ROW_HEIGHT }}
      className={cn(
        COMMIT_ROW_CLASS_NAME,
        // The working-tree rows are few and act like buttons; commit rows are a long
        // list, where a pointer cursor on every row reads as noise.
        "cursor-pointer",
        props.selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <span
        style={{ width: gutterWidth }}
        className="flex shrink-0 items-center justify-center text-muted-foreground"
      >
        <ChangesIcon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
        {props.label}
      </span>
      <span className="hidden shrink-0 items-center gap-2 text-ui-xs text-muted-foreground @min-[22rem]:flex">
        <span className="tabular-nums">{props.fileCount}</span>
        <DiffStat additions={props.additions} deletions={props.deletions} />
      </span>
    </button>
  );
});
