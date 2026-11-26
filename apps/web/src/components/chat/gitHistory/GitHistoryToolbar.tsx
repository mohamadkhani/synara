// FILE: GitHistoryToolbar.tsx
// Purpose: The history pane's first row: branch filter, commit search, and refresh.
// Layer: Git history UI

import type { GitBranch } from "@synara/contracts";
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { DownloadIcon, GitBranchIcon, RefreshCwIcon, WorktreeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { Spinner } from "../../ui/spinner";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "../../ui/menu";
import { SearchInput } from "../../ui/search-input";
import { ComposerPickerMenuPopup, ComposerPickerMenuSubPopup } from "../ComposerPickerMenuPopup";
import {
  BRANCH_FILTER_RESULT_LIMIT,
  groupRemoteBranchesByNamespace,
} from "./gitBranchFilterGroups";

export const ALL_BRANCHES_VALUE = "__all__";
export const CURRENT_BRANCH_VALUE = "__current__";

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

export function GitHistoryToolbar(props: {
  worktrees: ReadonlyArray<GitWorktreeOption>;
  worktreePath: string;
  onWorktreeChange: (path: string) => void;
  /** Archived/unused worktrees are hidden unless the reader asks for them. */
  showAllWorktrees: boolean;
  onShowAllWorktreesChange: (value: boolean) => void;
  hiddenWorktreeCount: number;
  branchFilter: string;
  /** The value label shown on the trigger; already resolved by the caller. */
  branchFilterLabel: string;
  currentBranch: string | null;
  localBranches: ReadonlyArray<GitBranch>;
  remoteBranches: ReadonlyArray<GitBranch>;
  /** The "Show remote branches" switch: remote refs leave the graph when off. */
  showRemoteBranches: boolean;
  onBranchFilterChange: (value: string) => void;
  onShowRemoteBranchesChange: (value: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  fetching: boolean;
  onFetch: () => void;
}) {
  const { t } = useTranslation();
  const [branchQuery, setBranchQuery] = useState("");
  const selectBranch = (value: string) => props.onBranchFilterChange(value);
  // The current branch is already offered as "checked out"; repeating it by name in
  // the branch list made two entries with the same label behave differently.
  const otherLocalBranches = props.localBranches.filter(
    (branch) => branch.name !== props.currentBranch,
  );
  // Hundreds of remote branches cannot live on one menu level: group them by the
  // namespace after the remote (`origin/synara/x` -> `synara`) and filter by name.
  const remoteGroups = useMemo(
    () => groupRemoteBranchesByNamespace(props.remoteBranches),
    [props.remoteBranches],
  );
  const branchQueryNormalized = branchQuery.trim().toLowerCase();
  const matchingBranches = useMemo(() => {
    if (branchQueryNormalized.length === 0) return [];
    const matches: GitBranch[] = [];
    for (const branch of [...props.localBranches, ...props.remoteBranches]) {
      if (branch.name.toLowerCase().includes(branchQueryNormalized)) matches.push(branch);
      if (matches.length >= BRANCH_FILTER_RESULT_LIMIT) break;
    }
    return matches;
  }, [branchQueryNormalized, props.localBranches, props.remoteBranches]);
  // A search field inside a menu must not leak keystrokes into the menu's typeahead,
  // or typing would move the highlight instead of filtering.
  const stopMenuKeyHandling = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
  };

  const selectedWorktree = props.worktrees.find((entry) => entry.path === props.worktreePath);
  const viewingOtherWorktree = selectedWorktree !== undefined && !selectedWorktree.active;

  return (
    <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1.5">
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
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="max-w-[10rem] min-w-0 shrink-0 justify-start gap-1.5 px-2"
              aria-label={t("git:historyBranchFilter")}
              title={t("git:historyBranchFilter")}
            >
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{props.branchFilterLabel}</span>
            </Button>
          }
        />
        <ComposerPickerMenuPopup align="start" side="bottom" className="w-72 min-w-72">
          <div className="p-1.5">
            <SearchInput
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              onKeyDown={stopMenuKeyHandling}
              placeholder={t("git:historyFilterBranches")}
              aria-label={t("git:historyFilterBranches")}
            />
          </div>
          {branchQueryNormalized.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>{t("git:historyBranchFilter")}</MenuGroupLabel>
              {matchingBranches.length === 0 ? (
                <MenuItem disabled>{t("git:historyNoMatchingBranches")}</MenuItem>
              ) : (
                <MenuRadioGroup value={props.branchFilter} onValueChange={selectBranch}>
                  {matchingBranches.map((branch) => (
                    <MenuRadioItem
                      key={`${branch.isRemote === true ? "r" : "l"}:${branch.name}`}
                      value={branch.name}
                    >
                      <span className="min-w-0 truncate">{branch.name}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              )}
            </MenuGroup>
          ) : (
            <>
              <MenuGroup>
                <MenuGroupLabel>{t("git:historyBranchFilter")}</MenuGroupLabel>
                <MenuRadioGroup value={props.branchFilter} onValueChange={selectBranch}>
                  <MenuRadioItem value={ALL_BRANCHES_VALUE}>
                    {t("git:historyAllBranches")}
                  </MenuRadioItem>
                  {props.currentBranch ? (
                    <MenuRadioItem value={CURRENT_BRANCH_VALUE}>
                      {props.currentBranch}
                    </MenuRadioItem>
                  ) : null}
                  {otherLocalBranches.map((branch) => (
                    <MenuRadioItem key={branch.name} value={branch.name}>
                      {branch.name}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
              {props.showRemoteBranches
                ? remoteGroups.map((group) => (
                    <MenuSub key={group.namespace}>
                      <MenuSubTrigger>
                        <span className="min-w-0 flex-1 truncate">{group.namespace}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                          {group.branches.length}
                        </span>
                      </MenuSubTrigger>
                      <ComposerPickerMenuSubPopup className="max-h-80 min-w-56 overflow-y-auto">
                        <MenuRadioGroup value={props.branchFilter} onValueChange={selectBranch}>
                          {group.branches.map((branch) => (
                            <MenuRadioItem key={branch.name} value={branch.name}>
                              <span className="min-w-0 truncate">
                                {branch.name.slice(branch.name.indexOf("/") + 1)}
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </ComposerPickerMenuSubPopup>
                    </MenuSub>
                  ))
                : null}
            </>
          )}
          <MenuSeparator />
          <MenuCheckboxItem
            checked={props.showRemoteBranches}
            onCheckedChange={(checked) => props.onShowRemoteBranchesChange(checked === true)}
          >
            {t("git:historyShowRemoteBranches")}
          </MenuCheckboxItem>
        </ComposerPickerMenuPopup>
      </Menu>
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
  );
}
