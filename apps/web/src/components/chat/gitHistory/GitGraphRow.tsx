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
import { gitGraphLaneColor } from "./gitBranchColors";
import {
  GIT_GRAPH_LANE_WIDTH,
  GIT_GRAPH_ROW_HEIGHT,
  type GitGraphLane,
  type GitGraphRow,
} from "./gitGraphLayout";

/** Slack a row keeps to the right of its own lanes, so a lane can never touch the edge. */
const GIT_GRAPH_LANE_INSET = 8;

/**
 * Free space a row lets the scrollbar cover: the graph column is a fixed, capped width, so
 * nothing meaningful sits under it and a scrollbar appearing mid-session cannot chop a lane.
 */
export const GIT_GRAPH_SCROLLBAR_GUTTER = 16;

/**
 * Columns shown by default. The commit graph is laid out to a *fixed* column width rather
 * than to the pane: a pane-sized graph repaints (and re-measures) the whole list every time
 * the vertical scrollbar appears, which reset the scroll position, and it squeezed the commit
 * text on a branch-heavy walk. Beyond this many lanes the graph scrolls sideways on its own.
 */
export const GIT_GRAPH_COLUMN_LANE_LIMIT = 24;

/** Width of the graph SVG for a row that draws `laneCount` columns. */
export function gitGraphSvgWidth(laneCount: number): number {
  return Math.max(1, laneCount) * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_LANE_INSET;
}

/** Width of the graph column for a whole layout: the widest row, up to the column cap. */
export function gitGraphColumnWidth(layout: { readonly laneCount: number }): number {
  return (
    Math.min(Math.max(1, layout.laneCount), GIT_GRAPH_COLUMN_LANE_LIMIT) * GIT_GRAPH_LANE_WIDTH +
    GIT_GRAPH_LANE_INSET
  );
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

/**
 * A row spans the list unless the graph is wider than the column it reserved. An inline
 * `width` always beats the `w-full` class, so writing it unconditionally shrank every row
 * to its graph and left no room for the subject.
 */
function rowStyle(columnWidth: number | undefined, graphWidth: number) {
  const width = Math.max(columnWidth ?? 0, graphWidth);
  return columnWidth === undefined || width <= columnWidth
    ? { height: GIT_GRAPH_ROW_HEIGHT }
    : { height: GIT_GRAPH_ROW_HEIGHT, width, minWidth: width };
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
  selected: boolean;
  onSelect: (sha: string) => void;
  /** Width of the graph column shared by every row (see `gitGraphColumnWidth`). */
  columnWidth?: number;
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
  // The row draws every lane it carries. Its width comes from the graph column — the same
  // width for every row — so a scrollbar appearing mid-session never re-measures the list;
  // with fewer lanes than the column the SVG still fills it, with more it is wider and the
  // list scrolls sideways.
  const width = Math.max(props.columnWidth ?? 0, gitGraphSvgWidth(row.laneCount));
  const mid = height / 2;
  const commitX = laneCenter(row.lane, laneWidth);
  const color = gitGraphLaneColor(row.color);
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
      style={rowStyle(props.columnWidth, width)}
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
        {row.passthrough.map((edge) => (
          <path
            key={`through-${edge.input}`}
            d={
              edge.input === edge.output
                ? `M ${laneCenter(edge.input, laneWidth)} 0 L ${laneCenter(edge.input, laneWidth)} ${height}`
                : buildCurve(edge.input, edge.output, 0, height, laneWidth)
            }
            stroke={gitGraphLaneColor(row.inputLanes[edge.input]?.color ?? edge.input)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.convergingLanes.map((lane) => (
          <path
            key={`incoming-${lane}`}
            d={buildCurve(lane, row.lane, 0, mid, laneWidth)}
            stroke={gitGraphLaneColor(row.inputLanes[lane]?.color ?? lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.parentLanes.map((lane) => (
          <path
            key={`parent-${lane}`}
            d={buildCurve(row.lane, lane, mid, height, laneWidth)}
            // The edge into a merged branch carries that branch's colour, so a merge does
            // not paint the outgoing side with the first parent's hue.
            stroke={gitGraphLaneColor(row.outputLanes[lane]?.color ?? lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.continuesFromAbove ? (
          <path
            d={`M ${commitX} 0 L ${commitX} ${mid}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        ) : null}
        {row.continuesBelow ? (
          <path
            d={`M ${commitX} ${mid} L ${commitX} ${height}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        ) : null}
        <circle
          data-git-graph-dot={commit.sha}
          cx={commitX}
          cy={mid}
          r={isCheckedOut ? 4.6 : 3.4}
          fill={isCheckedOut ? "var(--color-background)" : color}
          stroke={isCheckedOut ? color : "none"}
          strokeWidth={isCheckedOut ? 2 : 0}
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

/**
 * Placeholder drawn after the last commit while more history can be loaded: one straight
 * vertical line per lane still open at the bottom of the walk, so a branch that has not
 * finished loading reads as continuing below the last row. The lines are drawn at full
 * strength and simply end with the list: fading them out made every lane look like a
 * detached fragment at the boundary, which is the same broken read as a dashed stub.
 * VS Code draws the same row at its page boundary.
 */
export const GitGraphContinuationRow = memo(function GitGraphContinuationRow(props: {
  lanes: ReadonlyArray<GitGraphLane>;
  /** Same graph column as the commit rows, so the lanes line up. */
  columnWidth?: number;
}) {
  const height = GIT_GRAPH_ROW_HEIGHT;
  const laneWidth = GIT_GRAPH_LANE_WIDTH;
  const width = Math.max(props.columnWidth ?? 0, gitGraphSvgWidth(props.lanes.length));
  return (
    <div
      aria-hidden="true"
      data-git-graph-continuation=""
      className="shrink-0"
      style={{ height, width }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {props.lanes.map((lane, index) => (
          <path
            key={`${lane.id}-${index}`}
            d={`M ${laneCenter(index, laneWidth)} 0 L ${laneCenter(index, laneWidth)} ${height}`}
            stroke={gitGraphLaneColor(lane.color)}
            strokeWidth={2}
            fill="none"
          />
        ))}
      </svg>
    </div>
  );
});

/** Flat fallback row used while a text filter hides the graph. */
export const GitCommitFlatRow = memo(function GitCommitFlatRow(props: {
  commit: GitHistoryCommit;
  selected: boolean;
  /** Kept so the text filter keeps the same left edge as the graph rows. */
  columnWidth?: number;
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
  /** Graph column width, so the text of every row starts at the same place. */
  columnWidth?: number;
}) {
  const gutterWidth = props.columnWidth ?? GIT_GRAPH_LANE_WIDTH;
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onSelect?.(props.stash)}
      onContextMenu={props.onContextMenu}
      title={`${props.stash.stashRef}: ${props.stash.message}`}
      style={rowStyle(props.columnWidth, props.columnWidth ?? GIT_GRAPH_LANE_WIDTH)}
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
  /** Graph column width, so the text of every row starts at the same place. */
  columnWidth?: number;
}) {
  // The working-tree row has no lanes of its own; its icon sits in the first lane
  // column and the label follows immediately, like a one-lane commit row.
  const gutterWidth = props.columnWidth ?? GIT_GRAPH_LANE_WIDTH;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      onContextMenu={props.onContextMenu}
      aria-pressed={props.selected}
      title={props.label}
      style={rowStyle(props.columnWidth, props.columnWidth ?? GIT_GRAPH_LANE_WIDTH)}
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
