// FILE: GitHistoryToolbar.tsx
// Purpose: The history pane's controls: worktree selector, commit search, fetch and
//          refresh, plus the branch chip bar whose selected refs the graph walks.
// Layer: Git history UI

import type { GitBranch } from "@synara/contracts";
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import {
  DownloadIcon,
  FilterIcon,
  GitBranchIcon,
  GlobeIcon,
  RefreshCwIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";
import { readNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { Spinner } from "../../ui/spinner";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";
import { SearchInput } from "../../ui/search-input";
import { Toggle } from "../../ui/toggle";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";

export interface GitWorktreeOption {
  path: string;
  /** Short label: the folder name, or the primary checkout's project title. */
  label: string;
  /** Branch checked out in that worktree, when git reports one. */
  branch: string | null;
  /** The thread's own worktree: the checkout this task is actually running in. */
  active: boolean;
  /** Owned only by archived threads, or by no thread at all. */
  archived: boolean;
}

/** The remote branch's short name: the part after its remote, e.g. `origin/x` -> `x`. */
function branchChipLabel(branch: GitBranch): string {
  const remoteName = branch.remoteName;
  if (branch.isRemote === true && remoteName && branch.name.startsWith(`${remoteName}/`)) {
    return branch.name.slice(remoteName.length + 1);
  }
  return branch.name;
}

export function GitHistoryToolbar(props: {
  worktrees: ReadonlyArray<GitWorktreeOption>;
  worktreePath: string;
  onWorktreeChange: (path: string) => void;
  /** Archived/unused worktrees are hidden unless the reader asks for them. */
  showAllWorktrees: boolean;
  onShowAllWorktreesChange: (value: boolean) => void;
  hiddenWorktreeCount: number;
  /** Local branches, plus remote branches while "Show remote branches" is on. */
  candidateBranches: ReadonlyArray<GitBranch>;
  /** The ref names the graph walks; every chip not in this set is off. */
  selectedBranches: readonly string[];
  /** Chip swatch colour per branch, distinct across the selected branches. */
  branchColors: ReadonlyMap<string, string>;
  /** Branch the last toggle dropped for the budget; its chip explains the drop. */
  droppedBranch: string | null;
  branchBudget: number;
  /** Candidate branches not currently walked; shown in the count line. */
  hiddenBranchCount: number;
  onToggleBranch: (branch: string) => void;
  onShowOnlyBranch: (branch: string) => void;
  onHideRestBranches: (branch: string) => void;
  onShowAllBranches: () => void;
  /**
   * Branches whose tip is inside the graph's current viewport, most useful first. They are
   * shown at the head of the chip bar so the branches a reader is looking at stay reachable.
   */
  visibleBranches: readonly string[];
  /** False while the selection already equals the smart default, so Reset stays inert. */
  canResetBranches: boolean;
  onResetBranches: () => void;
  /** The "Show remote branches" switch: remote refs leave the chip bar when off. */
  showRemoteBranches: boolean;
  onShowRemoteBranchesChange: (value: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  fetching: boolean;
  onFetch: () => void;
}) {
  const { t } = useTranslation();
  const selectedSet = new Set(props.selectedBranches);

  // The chip bar keeps the branches the reader is looking at at its head. The promoted set is
  // only reordered, never re-walked: the graph keeps its width and nothing refetches.
  const orderedBranches = useMemo(() => {
    if (props.visibleBranches.length === 0) return props.candidateBranches;
    const promoted = new Set(props.visibleBranches);
    // A stable sort, so the promoted group and the rest each keep the candidate order.
    return [...props.candidateBranches].toSorted(
      (left, right) => Number(promoted.has(right.name)) - Number(promoted.has(left.name)),
    );
  }, [props.candidateBranches, props.visibleBranches]);

  // The chip bar is a single row that never scrolls sideways. Whatever does not fit is
  // reached from the filter menu, which lists every branch with the same ring.
  const chipRenderedRows = useMemo(() => [orderedBranches], [orderedBranches]);

  const showBranchContextMenu = useCallback(
    async (branch: GitBranch, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api) return;
      const action = await api.contextMenu.show(
        [
          { id: "branch-show-only" as const, label: t("git:historyBranchShowOnly") },
          { id: "branch-hide-rest" as const, label: t("git:historyBranchHideRest") },
          { id: "branch-show-all" as const, label: t("git:historyBranchShowAll") },
        ],
        { x: event.clientX, y: event.clientY },
      );
      if (action === "branch-show-only") props.onShowOnlyBranch(branch.name);
      else if (action === "branch-hide-rest") props.onHideRestBranches(branch.name);
      else if (action === "branch-show-all") props.onShowAllBranches();
    },
    [props, t],
  );

  const selectedWorktree = props.worktrees.find((entry) => entry.path === props.worktreePath);
  const viewingOtherWorktree = selectedWorktree !== undefined && !selectedWorktree.active;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-1.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {props.worktrees.length > 1 ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="max-w-[11rem] min-w-0 shrink-0 justify-start gap-1.5 px-2"
                  aria-label={t("git:historyWorktree")}
                  title={t("git:historyWorktree")}
                >
                  <WorktreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {selectedWorktree?.label ?? t("git:historyWorktree")}
                  </span>
                  {viewingOtherWorktree ? (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-[var(--color-status-neutral)]"
                    />
                  ) : null}
                </Button>
              }
            />
            <ComposerPickerMenuPopup align="start" side="bottom" className="w-72 min-w-72">
              <MenuGroup>
                <MenuGroupLabel>{t("git:historyWorktree")}</MenuGroupLabel>
                <MenuRadioGroup
                  value={props.worktreePath}
                  onValueChange={(value) => props.onWorktreeChange(value as string)}
                >
                  {props.worktrees.map((entry) => (
                    <MenuRadioItem key={entry.path} value={entry.path}>
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{entry.label}</span>
                          {entry.active ? (
                            <span className="shrink-0 rounded-full border border-[var(--color-status-success)]/40 bg-[var(--color-status-success)]/10 px-1.5 text-ui-xs font-medium text-[var(--color-status-success)]">
                              {t("git:historyWorktreeActive")}
                            </span>
                          ) : null}
                          {entry.archived ? (
                            <span className="shrink-0 rounded-full border border-border bg-muted/50 px-1.5 text-ui-xs font-medium text-muted-foreground">
                              {t("git:historyWorktreeArchived")}
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate text-ui-xs text-muted-foreground">
                          {entry.branch ?? entry.path}
                        </span>
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
              {props.hiddenWorktreeCount > 0 || props.showAllWorktrees ? (
                <>
                  <MenuSeparator />
                  <MenuCheckboxItem
                    checked={props.showAllWorktrees}
                    onCheckedChange={(checked) => props.onShowAllWorktreesChange(checked === true)}
                  >
                    {props.showAllWorktrees
                      ? t("git:historyWorktreeHideArchived")
                      : t("git:historyWorktreeShowArchived", { value0: props.hiddenWorktreeCount })}
                  </MenuCheckboxItem>
                </>
              ) : null}
            </ComposerPickerMenuPopup>
          </Menu>
        ) : null}
        <div className="min-w-0 flex-1">
          <SearchInput
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder={t("git:historySearchPlaceholder")}
            aria-label={t("git:historySearchPlaceholder")}
          />
        </div>
        <IconButton
          size="icon-xs"
          variant="ghost"
          label={t("git:historyFetch")}
          tooltip={t("git:historyFetch")}
          disabled={props.fetching}
          onClick={props.onFetch}
        >
          {props.fetching ? (
            <Spinner aria-hidden className="size-3.5" />
          ) : (
            <DownloadIcon className="size-3.5" />
          )}
        </IconButton>
        <IconButton
          size="icon-xs"
          variant="ghost"
          label={t("git:historyRefresh")}
          tooltip={t("git:historyRefresh")}
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          <RefreshCwIcon className={cn("size-3.5", props.refreshing && "animate-spin")} />
        </IconButton>
      </div>

      <div className="flex min-w-0 items-start gap-1.5">
        {/* One clipping row: chips that do not fit are cut at the edge instead of scrolling
            sideways, and the filter menu lists the rest. */}
        <div className="flex h-6 min-w-0 flex-1 items-center overflow-hidden [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)]">
          <div className="flex min-w-0 flex-col gap-1">
            {chipRenderedRows.map((row) => (
              <div
                key={`chip-row-${row[0]?.name ?? "empty"}`}
                data-chip-row=""
                className="flex min-w-0 items-center gap-1"
              >
                {row.map((branch) => {
                  const selected = selectedSet.has(branch.name);
                  const label = branchChipLabel(branch);
                  const color = props.branchColors.get(branch.name);
                  return (
                    <span
                      key={`${branch.isRemote === true ? "r" : "l"}:${branch.name}`}
                      data-branch-chip={branch.name}
                      data-testid={`branch-chip-${branch.name}`}
                      onContextMenu={(event) => void showBranchContextMenu(branch, event)}
                      className={cn(
                        "flex h-6 shrink-0 items-center gap-1.5 rounded-full border py-0 pr-2 pl-1 text-ui-xs",
                        selected
                          ? "border-border bg-muted/40 text-foreground"
                          : "border-transparent text-muted-foreground",
                      )}
                    >
                      {/* The ring toggles this branch; the dot painted inside it is the on
                          state. The dot is a background gradient, so it stays concentric with
                          the ring at every zoom instead of a nested box that can round off
                          centre. */}
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={t("git:historyBranchToggle", { value0: branch.name })}
                        title={t("git:historyBranchToggle", { value0: branch.name })}
                        onClick={() => props.onToggleBranch(branch.name)}
                        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        {/* A square checkbox, so the same control reads as a checkbox in the
                            filter list and as a chip here. */}
                        <span
                          aria-hidden="true"
                          data-branch-ring=""
                          className={cn(
                            "size-3.5 shrink-0 rounded-[.2rem] border-2",
                            selected ? "" : "border-border",
                          )}
                          style={
                            selected
                              ? {
                                  borderColor: color ?? "currentColor",
                                  backgroundImage: `radial-gradient(closest-side, ${color ?? "currentColor"} 0 50%, transparent 51%)`,
                                }
                              : undefined
                          }
                        />
                      </button>
                      {/* The body narrows the graph to this branch alone. */}
                      <button
                        type="button"
                        onClick={() => props.onShowOnlyBranch(branch.name)}
                        title={t("git:historyBranchShowOnly")}
                        className="flex max-w-[9rem] cursor-pointer items-center gap-1 truncate focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        {branch.isRemote === true ? (
                          <GlobeIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
                        ) : null}
                        <span className="truncate">{label}</span>
                      </button>
                      {props.droppedBranch === branch.name ? (
                        <span className="shrink-0 text-ui-2xs text-muted-foreground">
                          {t("git:historyBranchDroppedChip", { value0: props.branchBudget })}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <Toggle
          size="xs"
          variant="outline"
          pressed={props.showRemoteBranches}
          onPressedChange={(pressed) => props.onShowRemoteBranchesChange(pressed)}
          aria-label={t("git:historyShowRemoteBranches")}
          title={t("git:historyShowRemoteBranches")}
          className={cn(
            "shrink-0 gap-1.5 rounded-full px-2 text-ui-xs",
            props.showRemoteBranches
              ? "border-border bg-muted/40 text-foreground"
              : "border-transparent text-muted-foreground",
          )}
        >
          <GitBranchIcon className="size-3.5" />
          <span>{t("git:historyRemoteChip")}</span>
        </Toggle>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0 gap-1.5 px-2 text-ui-xs"
                aria-label={t("git:historyBranchFilter")}
                title={t("git:historyBranchFilter")}
              >
                <FilterIcon className="size-3.5" />
                <span className="tabular-nums">
                  {t("git:historyBranchFilterCountShort", {
                    value0: props.selectedBranches.length,
                  })}
                </span>
              </Button>
            }
          />
          {/* Opaque: the shared popup surface paints its fill from unlayered CSS
              (`.app-popup-surface`), which outranks a plain utility, so the fill needs `!`.
              Otherwise the commit rows show through the checklist. */}
          <PopoverPopup
            align="end"
            side="bottom"
            className="w-72 min-w-72 border border-border ![background:var(--popover)] p-0 [&_[data-slot=popover-viewport]]:py-0 [&_[data-slot=popover-viewport]]:[--viewport-inline-padding:0px]"
          >
            <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-2.5 py-1.5 whitespace-nowrap">
              <span className="shrink-0 text-ui-xs font-medium text-foreground">
                {t("git:historyBranchFilter")}
              </span>
              <span className="ml-auto shrink-0 text-ui-2xs text-muted-foreground tabular-nums">
                {t("git:historyBranchSelectionCount", {
                  value0: props.selectedBranches.length,
                  value1: props.branchBudget,
                })}
              </span>
            </div>
            {/* A vertical checklist with its own scroll: the chip row above never scrolls. */}
            <div
              role="group"
              aria-label={t("git:historyBranchFilter")}
              className="max-h-72 overflow-y-auto overscroll-contain p-1"
            >
              {orderedBranches.map((branch) => {
                const selected = selectedSet.has(branch.name);
                const color = props.branchColors.get(branch.name);
                return (
                  <div
                    key={`${branch.isRemote === true ? "r" : "l"}:${branch.name}`}
                    data-branch-checklist-item={branch.name}
                    className="flex items-center gap-1 rounded-sm pr-1 hover:bg-[var(--color-background-button-secondary-hover)]"
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={t("git:historyBranchToggle", { value0: branch.name })}
                      onClick={() => props.onToggleBranch(branch.name)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left text-ui-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        data-branch-ring=""
                        className={cn(
                          "grid size-3.5 shrink-0 place-items-center rounded-[.2rem] border-2",
                          selected ? "" : "border-border",
                        )}
                        style={
                          selected
                            ? {
                                borderColor: color ?? "currentColor",
                                backgroundImage: `radial-gradient(closest-square, ${color ?? "currentColor"} 0 50%, transparent 51%)`,
                              }
                            : undefined
                        }
                      />
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          selected ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {branchChipLabel(branch)}
                      </span>
                      {branch.isRemote === true ? (
                        <GlobeIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
                      ) : null}
                      {props.droppedBranch === branch.name ? (
                        <span className="shrink-0 text-ui-2xs text-muted-foreground">
                          {t("git:historyBranchDroppedChip", { value0: props.branchBudget })}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onShowOnlyBranch(branch.name)}
                      title={t("git:historyBranchShowOnly")}
                      aria-label={t("git:historyBranchShowOnly")}
                      className="shrink-0 cursor-pointer rounded-sm px-1 text-ui-2xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      {t("git:historyBranchOnly")}
                    </button>
                  </div>
                );
              })}
            </div>
          </PopoverPopup>
        </Popover>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <span className="min-w-0 truncate text-ui-2xs text-muted-foreground">
          {t("git:historyBranchSelectionCount", {
            value0: props.selectedBranches.length,
            value1: props.branchBudget,
          })}
          {" · "}
          {t("git:historyBranchesNotShown", { value0: props.hiddenBranchCount })}
        </span>
        <Button
          type="button"
          variant="link"
          size="chip"
          disabled={!props.canResetBranches}
          onClick={props.onResetBranches}
          title={t("git:historyBranchResetHint")}
          className="shrink-0 text-ui-2xs text-muted-foreground"
        >
          {t("git:historyBranchReset")}
        </Button>
      </div>
    </div>
  );
}
