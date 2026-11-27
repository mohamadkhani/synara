// FILE: GitHistoryToolbar.tsx
// Purpose: The history pane's controls: worktree selector, commit search, fetch and
//          refresh, plus the branch chip bar whose selected refs the graph walks.
// Layer: Git history UI

import type { GitBranch } from "@synara/contracts";
import { useCallback, type MouseEvent as ReactMouseEvent } from "react";

import { DownloadIcon, GitBranchIcon, RefreshCwIcon, WorktreeIcon } from "~/lib/icons";
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

      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex w-max items-center gap-1 pr-1">
            {props.candidateBranches.map((branch) => {
              const selected = selectedSet.has(branch.name);
              const label = branchChipLabel(branch);
              return (
                <Toggle
                  key={`${branch.isRemote === true ? "r" : "l"}:${branch.name}`}
                  size="xs"
                  variant="outline"
                  pressed={selected}
                  onPressedChange={() => props.onToggleBranch(branch.name)}
                  onContextMenu={(event) => void showBranchContextMenu(branch, event)}
                  aria-label={branch.name}
                  title={branch.name}
                  className={cn(
                    "h-6 gap-1.5 rounded-full py-0 pr-2 pl-1.5 text-ui-xs",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: props.branchColors.get(branch.name) }}
                  />
                  <span className="max-w-[9rem] truncate">{label}</span>
                  {props.droppedBranch === branch.name ? (
                    <span className="shrink-0 text-ui-2xs text-muted-foreground">
                      {t("git:historyBranchDroppedChip", { value0: props.branchBudget })}
                    </span>
                  ) : null}
                </Toggle>
              );
            })}
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-ui-xs text-muted-foreground">
          {t("git:historyBranchSelectionCount", {
            value0: props.selectedBranches.length,
            value1: props.branchBudget,
          })}
          {" · "}
          {t("git:historyBranchesNotShown", { value0: props.hiddenBranchCount })}
        </span>
        <Toggle
          size="xs"
          variant="outline"
          pressed={props.showRemoteBranches}
          onPressedChange={(pressed) => props.onShowRemoteBranchesChange(pressed)}
          aria-label={t("git:historyShowRemoteBranches")}
          title={t("git:historyShowRemoteBranches")}
          className="shrink-0 gap-1.5 rounded-full px-2 text-ui-xs"
        >
          <GitBranchIcon className="size-3.5" />
          <span>{t("git:historyRemoteChip")}</span>
        </Toggle>
      </div>
    </div>
  );
}
