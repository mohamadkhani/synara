// FILE: GitGraphRow.tsx
// Purpose: One commit row in the history view: the lane/dot SVG drawn from the
//          layout plus the shared subject/author/sha summary.
// Layer: Git history UI

import type { GitHistoryCommit } from "@synara/contracts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { memo } from "react";

import { ChangesIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { DiffStat } from "../DiffStatLabel";
import { GitCommitRefBadges } from "./GitCommitRefBadges";
import {
  GIT_GRAPH_LANE_WIDTH,
  GIT_GRAPH_ROW_HEIGHT,
  clampGitGraphLane,
  visibleGitGraphLaneCount,
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
  "@container flex w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md py-0 pl-1 pr-2 text-left";

/** Subject plus the author/time/short-sha column shared by graph and flat rows. */
function CommitRowSummary(props: {
  commit: GitHistoryCommit;
  authorLabel: string;
  timeLabel: string;
  /** Full date and time for the row's hover title. */
  dateTimeLabel: string;
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
  selected: boolean;
  onSelect: (sha: string) => void;
  authorLabel: string;
  timeLabel: string;
  dateTimeLabel: string;
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
  const width = visibleGitGraphLaneCount(props.laneCount) * laneWidth;
  const mid = height / 2;
  const commitX = laneCenter(clampGitGraphLane(row.lane), laneWidth);
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
        {row.continuesFromAbove ? (
          <path
            d={`M ${commitX} 0 L ${commitX} ${mid}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        ) : null}
        {row.throughLanes.map((lane) => (
          <path
            key={`through-${lane}`}
            d={`M ${laneCenter(clampGitGraphLane(lane), laneWidth)} 0 L ${laneCenter(clampGitGraphLane(lane), laneWidth)} ${height}`}
            stroke={gitGraphLaneColor(lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.incomingLanes.map((lane) => (
          <path
            key={`incoming-${lane}`}
            d={buildCurve(clampGitGraphLane(lane), clampGitGraphLane(row.lane), 0, mid, laneWidth)}
            stroke={gitGraphLaneColor(lane)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {row.parentLanes.map((lane) => (
          <path
            key={`parent-${lane}`}
            d={buildCurve(
              clampGitGraphLane(row.lane),
              clampGitGraphLane(lane),
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
        {row.releasedLanes.map((lane) => (
          <path
            key={`released-${lane}`}
            d={`M ${laneCenter(clampGitGraphLane(lane), laneWidth)} ${mid} L ${laneCenter(clampGitGraphLane(lane), laneWidth)} ${height}`}
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
        {...(props.onRefContextMenu ? { onRefContextMenu: props.onRefContextMenu } : {})}
      />
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
}) {
  const gutterWidth = visibleGitGraphLaneCount(props.laneCount) * GIT_GRAPH_LANE_WIDTH;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-pressed={props.selected}
      title={props.label}
      style={{ height: GIT_GRAPH_ROW_HEIGHT }}
      className={cn(
        COMMIT_ROW_CLASS_NAME,
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
