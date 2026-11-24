// FILE: GitHistoryPanel.tsx
// Purpose: Commit history for the Git pane: branch-filtered, paged commit list with a
//          lane graph on the left and the selected commit's patch underneath.
// Layer: Git history UI

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { GitCommitRef, GitHistoryCommit } from "@synara/contracts";
import { useAppSettings } from "~/appSettings";
import {
  gitBranchesQueryOptions,
  gitCommitHistoryQueryOptions,
  gitWorkingTreeDiffStatsQueryOptions,
  refreshGitQueriesForCwd,
} from "~/lib/gitReactQuery";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { basenameOfPath } from "~/file-icons";
import { serverWorktreesQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import { createWorktreePathOwnershipSelector } from "~/storeSelectors";
import { readNativeApi } from "~/nativeApi";
import { GitCommitIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  formatHistoryTimestamp,
  formatShortDateTimestamp,
  formatShortTimestamp,
} from "~/timestampFormat";
import { t, useTranslation } from "~/i18n";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { toastManager } from "../../ui/toast";
import { PanelStateMessage } from "../PanelStateMessage";
import { GitCommitDetail } from "./GitCommitDetail";
import { GitDeleteRefDialog, type GitDeleteRefKind } from "./GitDeleteRefDialog";
import { useGitCommitActions } from "./useGitCommitActions";
import { GitCommitFlatRow, GitGraphCommitRow, GitWorkingTreeRow } from "./GitGraphRow";
import { GitWorkingTreeDetail } from "./GitWorkingTreeDetail";
import {
  ALL_BRANCHES_VALUE,
  CURRENT_BRANCH_VALUE,
  GitHistoryToolbar,
  type GitWorktreeOption,
} from "./GitHistoryToolbar";
import { GIT_GRAPH_ROW_HEIGHT, layoutGitGraph } from "./gitGraphLayout";

/** A branch name, or one of the two reserved toolbar filter values. */
type BranchFilterValue = string;

type GitHistorySelection =
  | { kind: "commit"; sha: string }
  | { kind: "workingTree"; scope: "staged" | "unstaged" };

type GitHistoryEntry =
  | { kind: "workingTree"; scope: "staged" | "unstaged" }
  | { kind: "commit"; commit: GitHistoryCommit };

export function GitHistoryPanel(props: {
  /** The thread's own checkout: the worktree this task runs in. */
  activeCwd: string | null;
  /** The project's primary checkout, shown alongside the managed worktrees. */
  primaryCwd: string | null;
  theme: "light" | "dark";
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [branchFilter, setBranchFilter] = useState<BranchFilterValue>(ALL_BRANCHES_VALUE);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<GitHistorySelection | null>(null);
  // The pane can browse any worktree of the same repository. It follows the
  // thread's active worktree until the reader picks another one.
  const [viewCwd, setViewCwd] = useState<string | null>(props.activeCwd);
  const [showAllWorktrees, setShowAllWorktrees] = useState(false);
  const worktreeOwnership = useStore(useMemo(() => createWorktreePathOwnershipSelector(), []));
  // Focus mode: the selected commit's details take the pane, and the list returns
  // when the reader collapses them again.
  const [detailExpanded, setDetailExpanded] = useState(false);
  const selectedSha = selection?.kind === "commit" ? selection.sha : null;
  const [deleteRef, setDeleteRef] = useState<{ kind: GitDeleteRefKind; name: string } | null>(null);
  const queryClient = useQueryClient();
  const commitActions = useGitCommitActions({ cwd: viewCwd });
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setViewCwd(props.activeCwd);
  }, [props.activeCwd]);

  const worktreesQuery = useQuery(serverWorktreesQueryOptions());
  const branchesQuery = useQuery(gitBranchesQueryOptions(viewCwd));
  const localBranches = useMemo(
    () => (branchesQuery.data?.branches ?? []).filter((branch) => branch.isRemote !== true),
    [branchesQuery.data],
  );
  const remoteBranches = useMemo(
    () => (branchesQuery.data?.branches ?? []).filter((branch) => branch.isRemote === true),
    [branchesQuery.data],
  );
  const currentBranch = useMemo(
    () => branchesQuery.data?.branches.find((branch) => branch.current)?.name ?? null,
    [branchesQuery.data],
  );

  const worktreeEntries = useMemo(() => {
    const branchByPath = new Map<string, string>();
    for (const branch of branchesQuery.data?.branches ?? []) {
      if (branch.worktreePath) branchByPath.set(branch.worktreePath, branch.name);
    }
    const entries: Array<Omit<GitWorktreeOption, "archived"> & { archived: boolean }> = [];
    const seen = new Set<string>();
    const push = (path: string | null) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      entries.push({
        path,
        label: basenameOfPath(path),
        branch: branchByPath.get(path) ?? null,
        active: path === props.activeCwd,
        archived: !worktreeOwnership.active.has(path) && worktreeOwnership.archived.has(path),
      });
    };
    push(props.primaryCwd);
    for (const worktree of worktreesQuery.data?.worktrees ?? []) push(worktree.path);
    // The active worktree is not always in the managed list (a plain checkout or a
    // worktree created outside Synara), so make sure the thread's own is offered.
    push(props.activeCwd);
    return entries;
  }, [
    branchesQuery.data,
    props.activeCwd,
    props.primaryCwd,
    worktreeOwnership,
    worktreesQuery.data,
  ]);

  const worktreeOptions = useMemo<ReadonlyArray<GitWorktreeOption>>(
    () =>
      worktreeEntries.filter(
        (entry) =>
          showAllWorktrees ||
          entry.active ||
          entry.path === viewCwd ||
          entry.path === props.primaryCwd ||
          worktreeOwnership.active.has(entry.path),
      ),
    [props.primaryCwd, showAllWorktrees, viewCwd, worktreeEntries, worktreeOwnership],
  );
  const hiddenWorktreeCount = worktreeEntries.length - worktreeOptions.length;

  const historyRef =
    branchFilter === ALL_BRANCHES_VALUE
      ? null
      : branchFilter === CURRENT_BRANCH_VALUE
        ? currentBranch
        : branchFilter;

  const historyQuery = useInfiniteQuery(
    gitCommitHistoryQueryOptions({ cwd: viewCwd, ref: historyRef }),
  );

  // A branch can disappear while it is the active filter (deleted here or by an
  // agent), and a detached HEAD has no current branch to follow. Fall back to every
  // ref instead of leaving the pane on a revision that no longer resolves.
  useEffect(() => {
    if (!branchesQuery.data) return;
    const knownBranches = new Set([
      ...localBranches.map((branch) => branch.name),
      ...remoteBranches.map((branch) => branch.name),
    ]);
    const resolvable =
      branchFilter === ALL_BRANCHES_VALUE ||
      (branchFilter === CURRENT_BRANCH_VALUE && currentBranch !== null) ||
      knownBranches.has(branchFilter);
    if (!resolvable) setBranchFilter(ALL_BRANCHES_VALUE);
  }, [branchFilter, branchesQuery.data, currentBranch, localBranches, remoteBranches]);

  // Working-tree changes appear as pseudo-commits above the real history; the stats
  // query keeps that row's file count and +/− badge cheap while a turn is running.
  const unstagedStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({ cwd: viewCwd, scope: "unstaged" }),
  );
  const stagedStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: viewCwd,
      scope: "staged",
      // Serialize behind the unstaged read. Opening a working-tree detail adds a
      // patch read, and three expensive reads at once exceed the connection's
      // budget; two at a time always fits.
      enabled: !unstagedStatsQuery.isPending,
    }),
  );
  const unstagedStats = unstagedStatsQuery.data ?? null;
  const stagedStats = stagedStatsQuery.data ?? null;

  // Pages are offset-based, so a commit landing between two page reads shifts the
  // later pages and repeats entries; flatten by sha to keep one row per commit.
  const commits = useMemo(() => {
    const seen = new Set<string>();
    const unique: GitHistoryCommit[] = [];
    for (const page of historyQuery.data?.pages ?? []) {
      for (const commit of page.commits) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        unique.push(commit);
      }
    }
    return unique;
  }, [historyQuery.data]);

  const layout = useMemo(
    () => layoutGitGraph(commits.map((commit) => ({ sha: commit.sha, parents: commit.parents }))),
    [commits],
  );

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const isSearching = normalizedSearch.length > 0;
  const visibleCommits = useMemo(() => {
    if (!isSearching) return commits;
    return commits.filter((commit) => {
      if (commit.subject.toLowerCase().includes(normalizedSearch)) return true;
      if (commit.authorName.toLowerCase().includes(normalizedSearch)) return true;
      if (commit.sha.startsWith(normalizedSearch)) return true;
      return commit.refs.some((ref) => ref.name.toLowerCase().includes(normalizedSearch));
    });
  }, [commits, isSearching, normalizedSearch]);

  const rowBySha = useMemo(() => {
    const map = new Map<string, (typeof layout.rows)[number]>();
    for (const row of layout.rows) map.set(row.sha, row);
    return map;
  }, [layout.rows]);

  // One flat list so the virtualizer can place the pseudo-commit rows and the real
  // history on the same fixed row height. A text filter hides the working tree rows,
  // which cannot match a commit query.
  const entries = useMemo<ReadonlyArray<GitHistoryEntry>>(() => {
    const workingTreeEntries: GitHistoryEntry[] = isSearching
      ? []
      : [
          ...(unstagedStats && unstagedStats.fileCount > 0
            ? [{ kind: "workingTree" as const, scope: "unstaged" as const }]
            : []),
          ...(stagedStats && stagedStats.fileCount > 0
            ? [{ kind: "workingTree" as const, scope: "staged" as const }]
            : []),
        ];
    return [
      ...workingTreeEntries,
      ...visibleCommits.map((commit) => ({ kind: "commit" as const, commit })),
    ];
  }, [isSearching, stagedStats, unstagedStats, visibleCommits]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    estimateSize: () => GIT_GRAPH_ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 16,
    initialRect: { height: 320, width: 0 },
  });

  const selectedCommit = selectedSha
    ? (commits.find((commit) => commit.sha === selectedSha) ?? null)
    : null;

  // Branch and tag chips open the same kind of actions the branch picker offers;
  // without this there is no way to check out a branch from the graph.
  const showRefContextMenu = useCallback(
    async (commit: GitHistoryCommit, ref: GitCommitRef, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api || !viewCwd || ref.kind === "head") return;

      const items =
        ref.kind === "tag"
          ? [
              { id: "checkout-tag" as const, label: t("git:historyCheckoutTag") },
              { id: "create-branch" as const, label: t("git:historyCreateBranchHere") },
              { id: "copy-name" as const, label: t("git:historyCopyRefName") },
              {
                id: "delete-tag" as const,
                label: t("git:historyDeleteTag"),
                separatorBefore: true,
                destructive: true,
              },
            ]
          : [
              { id: "checkout-branch" as const, label: t("git:historyCheckoutBranch") },
              { id: "create-branch" as const, label: t("git:historyCreateBranchHere") },
              { id: "copy-name" as const, label: t("git:historyCopyRefName") },
              ...(ref.kind === "branch"
                ? [
                    {
                      id: "delete-branch" as const,
                      label: t("git:historyDeleteBranch"),
                      separatorBefore: true,
                      destructive: true,
                    },
                  ]
                : []),
            ];

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      if (!action) return;

      if (action === "copy-name") {
        await copyTextToClipboard(ref.name);
        toastManager.add({ type: "success", title: t("git:historyRefNameCopied") });
        return;
      }
      if (action === "create-branch") {
        await commitActions.run(commit, "create-branch");
        return;
      }
      if (action === "delete-branch") {
        setDeleteRef({ kind: "branch", name: ref.name });
        return;
      }
      if (action === "delete-tag") {
        setDeleteRef({ kind: "tag", name: ref.name });
        return;
      }

      try {
        if (action === "checkout-tag") {
          await api.git.checkoutCommit({ cwd: viewCwd, sha: commit.sha });
          toastManager.add({
            type: "success",
            title: t("git:historyTagCheckedOut", { value0: ref.name }),
          });
        } else if (ref.kind === "remote") {
          // A plain `git checkout origin/x` detaches HEAD. Confirm the fetch +
          // fast-forward flow so the user lands on the updated local branch.
          const localName = ref.name.slice(ref.name.indexOf("/") + 1);
          const confirmed = await api.dialogs.confirm(
            t("git:historyCheckoutRemoteConfirm", { value0: ref.name, value1: localName }),
          );
          if (!confirmed) return;
          const result = await api.git.checkoutRemoteBranch({
            cwd: viewCwd,
            remoteBranch: ref.name,
          });
          toastManager.add({
            type: "success",
            title: t("git:historyRemoteBranchCheckedOut", { value0: result.branch }),
          });
        } else {
          await api.git.checkout({ cwd: viewCwd, branch: ref.name });
          toastManager.add({
            type: "success",
            title: t("git:historyBranchCheckedOut", { value0: ref.name }),
          });
        }
        await refreshGitQueriesForCwd(queryClient, viewCwd);
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: t("git:historyRefActionFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [commitActions, viewCwd, queryClient, t],
  );

  // Right-click on a commit row offers the same actions as its detail menu.
  const showCommitContextMenu = useCallback(
    async (commit: GitHistoryCommit, event: ReactMouseEvent) => {
      event.preventDefault();
      const target = event.target;
      if (target instanceof Element && target.closest("[data-git-ref-chip]") !== null) {
        return;
      }
      const api = readNativeApi();
      if (!api) return;
      const action = await api.contextMenu.show(
        commitActions.items.map((item) => ({
          id: item.id,
          label: item.label,
          ...(item.separatorBefore ? { separatorBefore: true } : {}),
        })),
        { x: event.clientX, y: event.clientY },
      );
      if (!action) return;
      await commitActions.run(commit, action);
    },
    [commitActions],
  );

  // Clicking the open row again collapses the detail pane; the pane's X was
  // redundant with the dock tab's close affordance.
  const selectEntry = useCallback((next: GitHistorySelection) => {
    // Leaving focus mode when the selection changes keeps the next commit's detail
    // from inheriting the previous commit's expanded layout.
    setDetailExpanded(false);
    setSelection((current) =>
      current !== null &&
      current.kind === next.kind &&
      (current.kind === "commit" ? current.sha : current.scope) ===
        (next.kind === "commit" ? next.sha : next.scope)
        ? null
        : next,
    );
  }, []);

  const branchFilterLabel =
    branchFilter === ALL_BRANCHES_VALUE
      ? t("git:historyAllBranches")
      : branchFilter === CURRENT_BRANCH_VALUE
        ? (currentBranch ?? t("git:historyCurrentBranch"))
        : branchFilter;
  const refreshing = historyQuery.isFetching && !historyQuery.isFetchingNextPage;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", props.className)}>
      <GitHistoryToolbar
        worktrees={worktreeOptions}
        worktreePath={viewCwd ?? ""}
        onWorktreeChange={(path) => {
          setViewCwd(path);
          setSelection(null);
        }}
        showAllWorktrees={showAllWorktrees}
        onShowAllWorktreesChange={setShowAllWorktrees}
        hiddenWorktreeCount={hiddenWorktreeCount}
        branchFilter={branchFilter}
        branchFilterLabel={branchFilterLabel}
        currentBranch={currentBranch}
        localBranches={localBranches}
        remoteBranches={remoteBranches}
        onBranchFilterChange={setBranchFilter}
        search={search}
        onSearchChange={setSearch}
        refreshing={refreshing}
        onRefresh={() => void historyQuery.refetch()}
      />

      {historyQuery.error ? (
        <Alert variant="error" size="sm" className="mx-1.5 mb-1.5 text-destructive">
          {historyQuery.error instanceof Error
            ? historyQuery.error.message
            : t("git:historyLoadFailed")}
        </Alert>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 overflow-y-auto overflow-x-hidden px-1.5",
          selection === null ? "flex-1" : detailExpanded ? "hidden" : "h-[48%] shrink-0",
        )}
      >
        {historyQuery.isLoading ? (
          <p className="px-1.5 py-2 text-ui-sm text-muted-foreground/70">
            {t("git:historyLoading")}
          </p>
        ) : entries.length === 0 ? (
          <PanelStateMessage density="compact" fill="flex">
            <p>
              {!isSearching
                ? t("git:historyEmpty")
                : historyQuery.hasNextPage
                  ? // Search runs on the loaded pages only, so say that instead of
                    // implying the whole history was searched.
                    t("git:historyNoMatchesLoaded")
                  : t("git:historyNoMatches")}
            </p>
          </PanelStateMessage>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = entries[item.index];
              if (!entry) return null;
              const key = entry.kind === "commit" ? entry.commit.sha : entry.scope;
              return (
                <div
                  key={key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {entry.kind === "commit"
                    ? renderCommitRow({
                        commit: entry.commit,
                        isSearching,
                        row: rowBySha.get(entry.commit.sha),
                        laneCount: layout.laneCount,
                        selection,
                        onSelect: selectEntry,
                        timestampFormat: settings.timestampFormat,
                        onRefContextMenu: showRefContextMenu,
                        onCommitContextMenu: showCommitContextMenu,
                      })
                    : renderWorkingTreeRow({
                        scope: entry.scope,
                        stats: entry.scope === "staged" ? stagedStats : unstagedStats,
                        laneCount: layout.laneCount,
                        selection,
                        onSelect: selectEntry,
                      })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {historyQuery.hasNextPage && !detailExpanded ? (
        <div className="flex shrink-0 items-center justify-center border-t border-border/60 px-1.5 py-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={historyQuery.isFetchingNextPage}
            onClick={() => {
              void historyQuery.fetchNextPage();
            }}
          >
            {historyQuery.isFetchingNextPage
              ? t("git:historyLoadingMore")
              : t("git:historyLoadMore")}
          </Button>
        </div>
      ) : null}

      {selection?.kind === "commit" ? (
        <GitCommitDetail
          // Remount per commit so per-commit dialog state never leaks across selection.
          key={selection.sha}
          cwd={viewCwd}
          sha={selection.sha}
          theme={props.theme}
          listCommit={selectedCommit ?? undefined}
          commitActions={commitActions}
          expanded={detailExpanded}
          onToggleExpanded={() => setDetailExpanded((current) => !current)}
          onRefContextMenu={showRefContextMenu}
        />
      ) : selection?.kind === "workingTree" ? (
        <GitWorkingTreeDetail
          key={selection.scope}
          cwd={viewCwd}
          scope={selection.scope}
          theme={props.theme}
          expanded={detailExpanded}
          onToggleExpanded={() => setDetailExpanded((current) => !current)}
        />
      ) : commits.length > 0 || entries.length > 0 ? (
        <div className="flex shrink-0 items-center justify-center border-t border-border/60 px-2 py-1.5 text-ui-xs text-muted-foreground">
          <GitCommitIcon className="mr-1.5 size-3 shrink-0" aria-hidden="true" />
          {t("git:historySelectCommitHint")}
        </div>
      ) : null}

      {deleteRef ? (
        <GitDeleteRefDialog
          open
          kind={deleteRef.kind}
          cwd={viewCwd}
          name={deleteRef.name}
          onOpenChange={(open) => {
            if (!open) setDeleteRef(null);
          }}
        />
      ) : null}

      {commitActions.dialog}
    </div>
  );
}

function renderWorkingTreeRow(input: {
  scope: "staged" | "unstaged";
  stats: { additions: number; deletions: number; fileCount: number } | null;
  laneCount: number;
  selection: GitHistorySelection | null;
  onSelect: (next: GitHistorySelection) => void;
}) {
  return (
    <GitWorkingTreeRow
      label={
        input.scope === "staged" ? t("git:historyStagedChanges") : t("git:historyUnstagedChanges")
      }
      fileCount={input.stats?.fileCount ?? 0}
      additions={input.stats?.additions ?? 0}
      deletions={input.stats?.deletions ?? 0}
      laneCount={input.laneCount}
      selected={input.selection?.kind === "workingTree" && input.selection.scope === input.scope}
      onSelect={() => input.onSelect({ kind: "workingTree", scope: input.scope })}
    />
  );
}

function renderCommitRow(input: {
  commit: GitHistoryCommit;
  isSearching: boolean;
  row: ReturnType<typeof layoutGitGraph>["rows"][number] | undefined;
  laneCount: number;
  selection: GitHistorySelection | null;
  onSelect: (next: GitHistorySelection) => void;
  timestampFormat: Parameters<typeof formatShortTimestamp>[1];
  onRefContextMenu: (commit: GitHistoryCommit, ref: GitCommitRef, event: ReactMouseEvent) => void;
  onCommitContextMenu: (commit: GitHistoryCommit, event: ReactMouseEvent) => void;
}) {
  const committedAt = input.commit.committedAt;
  const timeLabel = formatHistoryTimestamp(committedAt, input.timestampFormat);
  const dateTimeLabel = formatShortDateTimestamp(committedAt, input.timestampFormat);
  if (input.isSearching || input.row === undefined) {
    return (
      <GitCommitFlatRow
        commit={input.commit}
        selected={input.selection?.kind === "commit" && input.selection.sha === input.commit.sha}
        onSelect={(sha) => input.onSelect({ kind: "commit", sha })}
        authorLabel={input.commit.authorName}
        timeLabel={timeLabel}
        dateTimeLabel={dateTimeLabel}
        onRefContextMenu={input.onRefContextMenu}
        onContextMenu={input.onCommitContextMenu}
      />
    );
  }
  return (
    <GitGraphCommitRow
      commit={input.commit}
      row={input.row}
      laneCount={input.laneCount}
      selected={input.selection?.kind === "commit" && input.selection.sha === input.commit.sha}
      onSelect={(sha) => input.onSelect({ kind: "commit", sha })}
      authorLabel={input.commit.authorName}
      timeLabel={timeLabel}
      dateTimeLabel={dateTimeLabel}
      onRefContextMenu={input.onRefContextMenu}
      onContextMenu={input.onCommitContextMenu}
    />
  );
}
