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

function gitGraphLaneColor(lane: number): string {
  return GIT_GRAPH_LANE_COLORS[lane % GIT_GRAPH_LANE_COLORS.length]!;
}

function laneCenter(lane: number, laneWidth: number): number {
  return lane * laneWidth + laneWidth / 2;
}

/**
 * Drawn column of a logical lane in this row's compacted order. Rows draw the lanes
 * they keep alive side by side, so a row that keeps lanes 0 and 9 places them in
 * columns 0 and 1 instead of leaving eight empty columns between them.
 */
function drawnColumnIndex(order: ReadonlyArray<number>, lane: number): number {
  const index = order.indexOf(lane);
  return index >= 0 ? index : 0;
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
  laneCount: number;
  /** Lanes this pane can draw; a deeper history collapses to one rail. */
  laneCap: number;
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
  const gutter = resolveGitGraphGutter(props.laneCount, props.laneCap);
  const width = gutter.lanes * laneWidth;
  const mid = height / 2;
  const commitColumn = gutter.collapsed ? 0 : drawnColumnIndex(row.topLanes, row.lane);
  const commitX = laneCenter(commitColumn, laneWidth);
  const color = gitGraphLaneColor(row.lane);
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
        {gutter.collapsed ? (
          // Too many parallel branches to draw truthfully. A single muted rail keeps
          // every commit anchored without inventing merges onto a flattened last lane.
          <path
            d={`M ${commitX} 0 L ${commitX} ${height}`}
            stroke="var(--color-border)"
            strokeWidth={1}
            fill="none"
          />
        ) : null}
        {!gutter.collapsed && row.continuesFromAbove ? (
          <path
            d={`M ${commitX} 0 L ${commitX} ${mid}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        ) : null}
        {gutter.collapsed
          ? null
          : row.throughLanes.map((lane) => (
              // A lane that slides into a freed column draws the slide as a diagonal.
              <path
                key={`through-${lane}`}
                d={`M ${laneCenter(drawnColumnIndex(row.topLanes, lane), laneWidth)} 0 L ${laneCenter(drawnColumnIndex(row.bottomLanes, lane), laneWidth)} ${height}`}
                stroke={gitGraphLaneColor(lane)}
                strokeWidth={2}
                fill="none"
              />
            ))}
        {gutter.collapsed
          ? null
          : row.incomingLanes.map((lane) => (
              <path
                key={`incoming-${lane}`}
                d={buildCurve(
                  drawnColumnIndex(row.topLanes, lane),
                  commitColumn,
                  0,
                  mid,
                  laneWidth,
                )}
                stroke={gitGraphLaneColor(lane)}
                strokeWidth={2}
                fill="none"
              />
            ))}
        {gutter.collapsed
          ? null
          : row.parentLanes.map((lane) => (
              <path
                key={`parent-${lane}`}
                d={buildCurve(
                  commitColumn,
                  drawnColumnIndex(row.bottomLanes, lane),
                  mid,
                  height,
                  laneWidth,
                )}
                // The edge into a merged branch carries that branch's lane color, so a
                // merge does not paint the incoming side with the target branch's hue.
                stroke={gitGraphLaneColor(lane)}
                strokeWidth={2}
                fill="none"
              />
            ))}
        {gutter.collapsed
          ? null
          : row.releasedLanes.map((lane) => (
              // The released lane has no column at the bottom edge; its stub stays
              // where the dot is while the lanes to its right slide into the gap.
              <path
                key={`released-${lane}`}
                d={`M ${commitX} ${mid} L ${commitX} ${height}`}
                stroke={gitGraphLaneColor(lane)}
                strokeWidth={2}
                fill="none"
              />
            ))}
        <circle
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
  laneCount: number;
  /** Lanes this pane can draw; deeper histories collapse to one rail. */
  laneCap: number;
  selected?: boolean;
  onSelect?: (stash: GitStashEntry) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  const gutterWidth =
    resolveGitGraphGutter(props.laneCount, props.laneCap).lanes * GIT_GRAPH_LANE_WIDTH;
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
  laneCount: number;
  /** Lanes this pane can draw; deeper histories collapse to one rail. */
  laneCap: number;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  const gutterWidth =
    resolveGitGraphGutter(props.laneCount, props.laneCap).lanes * GIT_GRAPH_LANE_WIDTH;
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
