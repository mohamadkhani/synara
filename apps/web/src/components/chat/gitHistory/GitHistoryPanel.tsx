// FILE: GitHistoryPanel.tsx
// Purpose: Commit history for the Git pane: branch-filtered, paged commit list with a
//          lane graph on the left and the selected commit's patch underneath.
// Layer: Git history UI

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type {
  ContextMenuItem,
  GitCommitRef,
  GitHistoryCommit,
  GitStashEntry,
} from "@synara/contracts";
import { useAppSettings } from "~/appSettings";
import {
  gitBranchesQueryOptions,
  gitCommitHistoryQueryOptions,
  gitFetchMutationOptions,
  gitStashApplyMutationOptions,
  gitStashListQueryOptions,
  gitStatusQueryOptions,
  gitWorkingTreeDiffStatsQueryOptions,
  refreshGitQueriesForCwd,
} from "~/lib/gitReactQuery";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { basenameOfPath } from "~/file-icons";
import { serverWorktreesQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import { createWorktreePathOwnershipSelector } from "~/storeSelectors";
import { readNativeApi } from "~/nativeApi";
import { contextMenuGroup, type ContextMenuGroupChild } from "~/lib/contextMenuGroup";
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
import { GitStashDetail } from "./GitStashDetail";
import { GitBranchActionDialog, type GitBranchAction } from "./GitBranchActionDialog";
import { GitDeleteRefDialog, type GitDeleteRefKind } from "./GitDeleteRefDialog";
import { GitDeleteStashDialog } from "./GitDeleteStashDialog";
import { GitStashDialog, type GitStashScope } from "./GitStashDialog";
import { useGitCommitActions } from "./useGitCommitActions";
import {
  GitCommitFlatRow,
  GitGraphCommitRow,
  GitGraphContinuationRow,
  GitStashRow,
  GitWorkingTreeRow,
  gitGraphColumnWidth,
} from "./GitGraphRow";
import { GitWorkingTreeDetail } from "./GitWorkingTreeDetail";
import { GitHistoryToolbar, type GitWorktreeOption } from "./GitHistoryToolbar";
import { branchColorsFromLayout } from "./gitBranchColors";
import { GIT_HISTORY_BRANCH_BUDGET, computeDefaultBranchSelection } from "./gitHistorySelection";
import { useGitHistoryBranchSelection } from "./useGitHistoryBranchSelection";
import { GIT_GRAPH_ROW_HEIGHT, layoutGitGraph } from "./gitGraphLayout";

type GitHistorySelection =
  | { kind: "commit"; sha: string }
  | { kind: "workingTree"; scope: "staged" | "unstaged" }
  | { kind: "stash"; sha: string };

type GitHistoryEntry =
  | { kind: "workingTree"; scope: "staged" | "unstaged" }
  | { kind: "stash"; stash: GitStashEntry }
  | { kind: "commit"; commit: GitHistoryCommit }
  | { kind: "continuation" };

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
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<GitHistorySelection | null>(null);
  // The pane can browse any worktree of the same repository. It follows the
  // thread's active worktree until the reader picks another one.
  const [viewCwd, setViewCwd] = useState<string | null>(props.activeCwd);
  const [showAllWorktrees, setShowAllWorktrees] = useState(false);
  // Remote branches stay in the graph by default; turning them off keeps the walk to
  // local refs so a repository with hundreds of agent branches stays readable.
  const [showRemoteBranches, setShowRemoteBranches] = useState(true);
  const worktreeOwnership = useStore(useMemo(() => createWorktreePathOwnershipSelector(), []));
  // Focus mode: the selected commit's details take the pane, and the list returns
  // when the reader collapses them again.
  const [detailExpanded, setDetailExpanded] = useState(false);
  const selectedSha = selection?.kind === "commit" ? selection.sha : null;
  const selectedStash = selection?.kind === "stash" ? selection.sha : null;
  const [deleteRef, setDeleteRef] = useState<{ kind: GitDeleteRefKind; name: string } | null>(null);
  const [branchAction, setBranchAction] = useState<GitBranchAction | null>(null);
  const [stashScope, setStashScope] = useState<GitStashScope | null>(null);
  const [deleteStash, setDeleteStash] = useState<GitStashEntry | null>(null);
  const queryClient = useQueryClient();
  const commitActions = useGitCommitActions({ cwd: viewCwd });
  const deferredSearch = useDeferredValue(search);
  const fetchMutation = useMutation(gitFetchMutationOptions({ cwd: viewCwd, queryClient }));

  const fetchRemote = useCallback(async () => {
    if (!viewCwd) return;
    try {
      const result = await fetchMutation.mutateAsync();
      toastManager.add({
        type: "success",
        title: t("git:historyFetched", { value0: result.remote }),
      });
      await refreshGitQueriesForCwd(queryClient, viewCwd);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t("git:historyFetchFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [fetchMutation, queryClient, viewCwd, t]);

  const stashApplyMutation = useMutation(
    gitStashApplyMutationOptions({ cwd: viewCwd, queryClient }),
  );

  const applyStash = useCallback(
    async (stash: GitStashEntry, mode: "apply" | "pop") => {
      try {
        const result = await stashApplyMutation.mutateAsync({
          stashRef: stash.stashRef,
          mode,
        });
        if (result.status === "conflicted") {
          // The changes are in the working tree with conflict markers and the entry is
          // kept, so this is a warning that needs a human rather than a failure to retry.
          toastManager.add({
            type: "warning",
            title: t("git:historyStashConflicted", { value0: stash.stashRef }),
            ...(result.detail ? { description: result.detail } : {}),
          });
          return;
        }
        toastManager.add({
          type: "success",
          title: t(mode === "pop" ? "git:historyStashPopped" : "git:historyStashApplied", {
            value0: stash.stashRef,
          }),
        });
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: t("git:historyStashApplyFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [stashApplyMutation, t],
  );

  const showStashContextMenu = useCallback(
    async (stash: GitStashEntry, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api) return;
      const action = await api.contextMenu.show(
        [
          { id: "stash-apply" as const, label: t("git:historyStashApply") },
          { id: "stash-pop" as const, label: t("git:historyStashPop") },
          {
            id: "stash-delete" as const,
            label: t("git:historyStashDelete"),
            separatorBefore: true,
            destructive: true,
          },
        ],
        { x: event.clientX, y: event.clientY },
      );
      if (action === "stash-apply") void applyStash(stash, "apply");
      else if (action === "stash-pop") void applyStash(stash, "pop");
      else if (action === "stash-delete") setDeleteStash(stash);
    },
    [applyStash, t],
  );

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
    () =>
      showRemoteBranches
        ? (branchesQuery.data?.branches ?? []).filter((branch) => branch.isRemote === true)
        : [],
    [branchesQuery.data, showRemoteBranches],
  );
  const currentBranch = useMemo(
    () => branchesQuery.data?.branches.find((branch) => branch.current)?.name ?? null,
    [branchesQuery.data],
  );
  // A single configured remote lets the ref chips drop the `origin/` prefix; with
  // several remotes the prefix is what tells the chips apart.
  const remoteNames = useMemo(() => branchesQuery.data?.remoteNames ?? [], [branchesQuery.data]);
  const defaultBranch = useMemo(
    () => branchesQuery.data?.branches.find((branch) => branch.isDefault)?.name ?? null,
    [branchesQuery.data],
  );
  // The chip bar lists local branches, plus remote branches while the switch is on.
  const candidateBranches = useMemo(
    () => [...localBranches, ...remoteBranches],
    [localBranches, remoteBranches],
  );
  const candidateNames = useMemo(
    () => candidateBranches.map((branch) => branch.name),
    [candidateBranches],
  );
  // The selected refs are what the graph walks; `git log <refs...>` keeps every lane a
  // chosen branch. The status read supplies the current branch's upstream, which the
  // default selection follows. The pane persists the selection per repository.
  const statusQuery = useQuery(gitStatusQueryOptions(viewCwd));
  const upstreamBranch = statusQuery.data?.upstreamBranch ?? null;
  // Relevance order for the budget: the current branch and its upstream first, then the
  // repository default, then every other candidate. A full selection drops from the end.
  const relevanceOrder = useMemo(() => {
    const candidateSet = new Set(candidateNames);
    const ordered: string[] = [];
    const push = (name: string | null) => {
      if (name && candidateSet.has(name) && !ordered.includes(name)) ordered.push(name);
    };
    push(currentBranch);
    push(upstreamBranch);
    push(defaultBranch);
    for (const name of candidateNames) push(name);
    return ordered;
  }, [candidateNames, currentBranch, defaultBranch, upstreamBranch]);
  const branchSelection = useGitHistoryBranchSelection({
    cwd: viewCwd,
    candidates: candidateNames,
    relevanceOrder,
    currentBranch,
    upstreamBranch,
    defaultBranch,
  });
  const selectedBranches = branchSelection.selected;

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

  const historyQuery = useInfiniteQuery(
    gitCommitHistoryQueryOptions({
      cwd: viewCwd,
      ref: null,
      // Only a non-empty selection narrows the walk; an empty one (no branches at all)
      // falls back to every ref, matching how a commit graph is usually browsed.
      refs: selectedBranches.length > 0 ? selectedBranches : null,
      includeRemoteBranches: showRemoteBranches,
    }),
  );

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
  const stashesQuery = useQuery(gitStashListQueryOptions({ cwd: viewCwd }));
  const stashes = stashesQuery.data?.stashes ?? [];

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

  // One width for the graph column of every row (commit, stash, working tree,
  // continuation). A fixed column instead of a pane-width row means the list never
  // re-measures when a scrollbar appears, and the commit text never has to share the row
  // with a scrollbar.
  const graphColumnWidthValue = gitGraphColumnWidth(layout);

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

  // A chip's colour comes from the lane its commit actually draws, so the chip and the line
  // in the graph can never disagree. Reading it from the whole walk (not only the visible
  // rows) keeps a branch's colour stable while it is scrolled out of view.
  const branchColors = useMemo(
    () =>
      branchColorsFromLayout(
        commits,
        new Map(layout.rows.map((row) => [row.sha, row.color] as const)),
      ),
    [commits, layout.rows],
  );

  // The smart default the reset button restores: the current branch and its upstream.
  const defaultBranchSelection = useMemo(
    () =>
      computeDefaultBranchSelection({
        candidates: candidateNames,
        currentBranch,
        upstreamBranch,
        defaultBranch,
      }),
    [candidateNames, currentBranch, defaultBranch, upstreamBranch],
  );
  const canResetBranches =
    selectedBranches.length !== defaultBranchSelection.length ||
    selectedBranches.some((name, index) => name !== defaultBranchSelection[index]);

  // While more history can be loaded, a placeholder row after the last visible commit
  // draws the lanes still open there, so the graph reads as continuing. A text filter hides
  // the graph, so the placeholder is hidden with it.
  const continuationLanes = useMemo(() => {
    if (!historyQuery.hasNextPage || isSearching) return [];
    const last = visibleCommits[visibleCommits.length - 1];
    return last ? (rowBySha.get(last.sha)?.outputLanes ?? []) : [];
  }, [historyQuery.hasNextPage, isSearching, rowBySha, visibleCommits]);

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
    // A text filter hides the stash rows for the same reason as the working-tree rows:
    // their message is not part of the commit search.
    const stashEntries: GitHistoryEntry[] = isSearching
      ? []
      : stashes.map((stash) => ({ kind: "stash" as const, stash }));
    return [
      ...workingTreeEntries,
      ...stashEntries,
      ...visibleCommits.map((commit) => ({ kind: "commit" as const, commit })),
      ...(continuationLanes.length > 0 ? [{ kind: "continuation" as const }] : []),
    ];
  }, [continuationLanes, isSearching, stagedStats, stashes, unstagedStats, visibleCommits]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    estimateSize: () => GIT_GRAPH_ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 16,
    initialRect: { height: 320, width: 0 },
  });

  // The chip bar keeps the branches whose tip is in the graph's viewport at its head. The
  // window is the rows at the current scroll offset; a minimum of eight rows keeps the
  // promotion useful in a short pane. What the graph walks is unchanged: this only reorders
  // chips, so nothing refetches and the width does not grow.
  //
  // These virtualizer reads stay *after* the `entries` memo on purpose: reading them first
  // made React Compiler invalidate that memo inside the render, so `entries` could recompute
  // with a stale `continuationLanes` and the boundary row drew the wrong lane set.
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const visibleRowCount = Math.max(
    8,
    Math.ceil((virtualizer.scrollRect?.height ?? 0) / GIT_GRAPH_ROW_HEIGHT),
  );
  const firstVisibleRow = Math.floor(scrollOffset / GIT_GRAPH_ROW_HEIGHT);
  const visibleBranchKey = useMemo(() => {
    const names: string[] = [];
    for (let index = firstVisibleRow; index < firstVisibleRow + visibleRowCount; index += 1) {
      const entry = entries[index];
      if (!entry || entry.kind !== "commit") continue;
      for (const ref of entry.commit.refs) {
        if (ref.kind !== "branch" && ref.kind !== "remote") continue;
        if (!names.includes(ref.name)) names.push(ref.name);
      }
    }
    return names.join("\u0000");
  }, [entries, firstVisibleRow, visibleRowCount]);
  // NUL is not valid in a ref name, so the join/split round-trips exactly. Keying the array
  // on the joined string keeps its identity stable while the visible set is unchanged.
  const visibleBranches = useMemo(
    () => (visibleBranchKey ? visibleBranchKey.split("\u0000") : []),
    [visibleBranchKey],
  );

  const selectedCommit = selectedSha
    ? (commits.find((commit) => commit.sha === selectedSha) ?? null)
    : null;
  const selectedStashEntry = selectedStash
    ? (stashes.find((stash) => stash.sha === selectedStash) ?? null)
    : null;

  // The staged and unstaged pseudo-commit rows stash their own scope. The dialog asks
  // for the stash title; only a staged stash offers "include unstaged".
  const showWorkingTreeContextMenu = useCallback(
    async (scope: GitStashScope, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api) return;
      const action = await api.contextMenu.show(
        [
          {
            id: "stash-changes" as const,
            label:
              scope === "staged"
                ? t("git:historyStashStagedChanges")
                : t("git:historyStashUnstagedChanges"),
          },
        ],
        { x: event.clientX, y: event.clientY },
      );
      if (action === "stash-changes") setStashScope(scope);
    },
    [t],
  );

  // Branch and tag chips open the same kind of actions the branch picker offers;
  // without this there is no way to check out a branch from the graph.
  const showRefContextMenu = useCallback(
    async (commit: GitHistoryCommit, ref: GitCommitRef, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api || !viewCwd || ref.kind === "head") return;

      const branchList = branchesQuery.data;
      const remoteNames = branchList?.remoteNames ?? [];
      const hasOriginRemote = branchList?.hasOriginRemote ?? false;
      // Push target: the branch's configured upstream remote, else origin, else the
      // only remote. Null hides push until a remote exists to push to.
      const resolveLocalRemote = (
        branchName: string,
      ): { remote: string; hasUpstream: boolean } | null => {
        const branch = branchList?.branches.find(
          (candidate) => candidate.isRemote !== true && candidate.name === branchName,
        );
        if (branch?.upstreamRemote) {
          return { remote: branch.upstreamRemote, hasUpstream: true };
        }
        if (hasOriginRemote) return { remote: "origin", hasUpstream: false };
        if (remoteNames.length === 1) return { remote: remoteNames[0]!, hasUpstream: false };
        return null;
      };
      const remoteBranchEntry = branchList?.branches.find(
        (candidate) => candidate.isRemote === true && candidate.name === ref.name,
      );
      // Split `remote/branch` with a known remote name, since branch names may contain
      // slashes of their own. Empty means the chip is not a remote branch at all.
      const remotePrefix =
        remoteBranchEntry?.remoteName ??
        remoteNames.find((name) => ref.name.startsWith(`${name}/`)) ??
        (ref.name.includes("/") ? ref.name.slice(0, ref.name.indexOf("/")) : "");
      const remoteBranchName = remotePrefix ? ref.name.slice(remotePrefix.length + 1) : ref.name;

      // The branch menu resolves each action to the exact command it will confirm, so
      // the dialog never shows a command the server would not run.
      const branchActionByMenuId = new Map<string, GitBranchAction>();
      const branchActions: ContextMenuGroupChild<string>[] = [];
      if (ref.kind === "branch") {
        const local = resolveLocalRemote(ref.name);
        if (local) {
          branchActionByMenuId.set("branch-push", {
            kind: "push",
            cwd: viewCwd,
            branch: ref.name,
            remote: local.remote,
            hasUpstream: local.hasUpstream,
          });
          branchActions.push({ id: "branch-push", label: t("git:historyPushBranch") });
        }
        if (ref.checkedOut) {
          if (local?.hasUpstream) {
            branchActionByMenuId.set("branch-pull", {
              kind: "pull",
              cwd: viewCwd,
              remote: local.remote,
              branch: ref.name,
              currentBranch: ref.name,
            });
            branchActions.push({ id: "branch-pull", label: t("git:historyPullBranch") });
          }
        } else if (currentBranch && ref.name !== currentBranch) {
          branchActionByMenuId.set("branch-merge", {
            kind: "merge",
            cwd: viewCwd,
            ref: ref.name,
            currentBranch,
          });
          branchActions.push({
            id: "branch-merge",
            label: t("git:historyMergeBranch", { value0: currentBranch }),
          });
          branchActionByMenuId.set("branch-rebase", {
            kind: "rebase",
            cwd: viewCwd,
            ref: ref.name,
            currentBranch,
          });
          branchActions.push({
            id: "branch-rebase",
            label: t("git:historyRebaseBranch", { value0: currentBranch, value1: ref.name }),
          });
        }
      } else if (ref.kind === "remote" && currentBranch && remotePrefix) {
        if (remoteBranchName === currentBranch) {
          branchActionByMenuId.set("branch-pull", {
            kind: "pull",
            cwd: viewCwd,
            remote: remotePrefix,
            branch: remoteBranchName,
            currentBranch,
          });
          branchActions.push({ id: "branch-pull", label: t("git:historyPullBranch") });
        } else {
          branchActionByMenuId.set("branch-merge", {
            kind: "merge",
            cwd: viewCwd,
            ref: ref.name,
            currentBranch,
          });
          branchActions.push({
            id: "branch-merge",
            label: t("git:historyMergeBranch", { value0: currentBranch }),
          });
          branchActionByMenuId.set("branch-rebase", {
            kind: "rebase",
            cwd: viewCwd,
            ref: ref.name,
            currentBranch,
          });
          branchActions.push({
            id: "branch-rebase",
            label: t("git:historyRebaseBranch", { value0: currentBranch, value1: ref.name }),
          });
        }
      }

      const items: ContextMenuItem<string>[] =
        ref.kind === "tag"
          ? [
              { id: "checkout-tag", label: t("git:historyCheckoutTag") },
              { id: "create-branch", label: t("git:historyCreateBranchHere") },
              { id: "copy-name", label: t("git:historyCopyRefName") },
              {
                id: "delete-tag",
                label: t("git:historyDeleteTag"),
                separatorBefore: true,
                destructive: true,
              },
            ]
          : [
              // A branch that is already checked out has no checkout row to offer.
              ...(ref.kind === "branch" && ref.checkedOut
                ? []
                : [{ id: "checkout-branch", label: t("git:historyCheckoutBranch") }]),
              ...contextMenuGroup(
                { id: "branch-actions", label: t("git:historyBranchActions") },
                branchActions,
              ),
              { id: "create-branch", label: t("git:historyCreateBranchHere") },
              { id: "copy-name", label: t("git:historyCopyRefName") },
              ...(ref.kind === "branch"
                ? [
                    {
                      id: "delete-branch",
                      label: t("git:historyDeleteBranch"),
                      separatorBefore: true,
                      destructive: true,
                    },
                  ]
                : []),
            ];

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      if (!action) return;

      const resolvedAction = branchActionByMenuId.get(action);
      if (resolvedAction) {
        setBranchAction(resolvedAction);
        return;
      }

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
    [commitActions, viewCwd, queryClient, t, currentBranch, branchesQuery.data],
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
    setSelection((current) => {
      if (current === null || current.kind !== next.kind) return next;
      if (current.kind === "commit" && next.kind === "commit" && current.sha === next.sha)
        return null;
      if (current.kind === "stash" && next.kind === "stash" && current.sha === next.sha)
        return null;
      if (
        current.kind === "workingTree" &&
        next.kind === "workingTree" &&
        current.scope === next.scope
      )
        return null;
      return next;
    });
  }, []);

  const hiddenBranchCount = Math.max(0, candidateNames.length - selectedBranches.length);
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
        candidateBranches={candidateBranches}
        selectedBranches={selectedBranches}
        branchColors={branchColors}
        droppedBranch={branchSelection.dropped}
        branchBudget={GIT_HISTORY_BRANCH_BUDGET}
        hiddenBranchCount={hiddenBranchCount}
        onToggleBranch={branchSelection.toggle}
        onShowOnlyBranch={branchSelection.showOnly}
        onHideRestBranches={branchSelection.hideRest}
        onShowAllBranches={branchSelection.showAll}
        visibleBranches={visibleBranches}
        canResetBranches={canResetBranches}
        onResetBranches={branchSelection.reset}
        showRemoteBranches={showRemoteBranches}
        onShowRemoteBranchesChange={setShowRemoteBranches}
        search={search}
        onSearchChange={setSearch}
        refreshing={refreshing}
        onRefresh={() => void historyQuery.refetch()}
        fetching={fetchMutation.isPending}
        onFetch={() => void fetchRemote()}
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
        data-git-history-scroll=""
        className={cn(
          // The vertical scrollbar is reserved from the first paint in both axes, so a
          // scrollbar appearing after the first page fits cannot change the list's height
          // (which reset the scroll position) or its width (which re-measured the graph).
          // The bottom gutter keeps the room for the graph's sideways scroll track.
          "min-h-0 overflow-auto px-1.5 [scrollbar-gutter:stable]",
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
              const key =
                entry.kind === "commit"
                  ? entry.commit.sha
                  : entry.kind === "stash"
                    ? `stash:${entry.stash.sha}`
                    : entry.kind === "continuation"
                      ? "continuation"
                      : entry.scope;
              return (
                <div
                  key={key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {entry.kind === "stash" ? (
                    <GitStashRow
                      stash={entry.stash}
                      columnWidth={graphColumnWidthValue}
                      selected={selectedStash === entry.stash.sha}
                      onSelect={(stash) => selectEntry({ kind: "stash", sha: stash.sha })}
                      onContextMenu={(event) => void showStashContextMenu(entry.stash, event)}
                    />
                  ) : entry.kind === "commit" ? (
                    renderCommitRow({
                      commit: entry.commit,
                      columnWidth: graphColumnWidthValue,
                      isSearching,
                      row: rowBySha.get(entry.commit.sha),
                      remoteNames,
                      selection,
                      onSelect: selectEntry,
                      timestampFormat: settings.timestampFormat,
                      onRefContextMenu: showRefContextMenu,
                      onCommitContextMenu: showCommitContextMenu,
                    })
                  ) : entry.kind === "continuation" ? (
                    <GitGraphContinuationRow
                      lanes={continuationLanes}
                      columnWidth={graphColumnWidthValue}
                    />
                  ) : (
                    renderWorkingTreeRow({
                      scope: entry.scope,
                      columnWidth: graphColumnWidthValue,
                      stats: entry.scope === "staged" ? stagedStats : unstagedStats,
                      selection,
                      onSelect: selectEntry,
                      onContextMenu: showWorkingTreeContextMenu,
                    })
                  )}
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
          remoteNames={remoteNames}
          theme={props.theme}
          listCommit={selectedCommit ?? undefined}
          commitActions={commitActions}
          expanded={detailExpanded}
          onToggleExpanded={() => setDetailExpanded((current) => !current)}
          onRefContextMenu={showRefContextMenu}
        />
      ) : selection?.kind === "stash" && selectedStashEntry ? (
        <GitStashDetail
          key={selection.sha}
          cwd={viewCwd}
          stash={selectedStashEntry}
          theme={props.theme}
          expanded={detailExpanded}
          onToggleExpanded={() => setDetailExpanded((current) => !current)}
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

      {stashScope ? (
        <GitStashDialog
          open
          cwd={viewCwd}
          scope={stashScope}
          onOpenChange={(open) => {
            if (!open) setStashScope(null);
          }}
        />
      ) : null}

      {deleteStash ? (
        <GitDeleteStashDialog
          open
          cwd={viewCwd}
          stashRef={deleteStash.stashRef}
          message={deleteStash.message}
          onOpenChange={(open) => {
            if (!open) setDeleteStash(null);
          }}
        />
      ) : null}

      {branchAction ? (
        <GitBranchActionDialog
          open
          action={branchAction}
          onOpenChange={(open) => {
            if (!open) setBranchAction(null);
          }}
        />
      ) : null}

      {commitActions.dialog}
    </div>
  );
}

function renderWorkingTreeRow(input: {
  scope: "staged" | "unstaged";
  columnWidth: number;
  stats: { additions: number; deletions: number; fileCount: number } | null;
  selection: GitHistorySelection | null;
  onSelect: (next: GitHistorySelection) => void;
  onContextMenu: (scope: GitStashScope, event: ReactMouseEvent) => void;
}) {
  return (
    <GitWorkingTreeRow
      columnWidth={input.columnWidth}
      label={
        input.scope === "staged" ? t("git:historyStagedChanges") : t("git:historyUnstagedChanges")
      }
      fileCount={input.stats?.fileCount ?? 0}
      additions={input.stats?.additions ?? 0}
      deletions={input.stats?.deletions ?? 0}
      selected={input.selection?.kind === "workingTree" && input.selection.scope === input.scope}
      onSelect={() => input.onSelect({ kind: "workingTree", scope: input.scope })}
      onContextMenu={(event) => input.onContextMenu(input.scope, event)}
    />
  );
}

function renderCommitRow(input: {
  commit: GitHistoryCommit;
  columnWidth: number;
  isSearching: boolean;
  row: ReturnType<typeof layoutGitGraph>["rows"][number] | undefined;
  remoteNames: readonly string[];
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
        columnWidth={input.columnWidth}
        commit={input.commit}
        selected={input.selection?.kind === "commit" && input.selection.sha === input.commit.sha}
        onSelect={(sha) => input.onSelect({ kind: "commit", sha })}
        authorLabel={input.commit.authorName}
        timeLabel={timeLabel}
        dateTimeLabel={dateTimeLabel}
        remoteNames={input.remoteNames}
        onRefContextMenu={input.onRefContextMenu}
        onContextMenu={input.onCommitContextMenu}
      />
    );
  }
  return (
    <GitGraphCommitRow
      commit={input.commit}
      row={input.row}
      columnWidth={input.columnWidth}
      selected={input.selection?.kind === "commit" && input.selection.sha === input.commit.sha}
      onSelect={(sha) => input.onSelect({ kind: "commit", sha })}
      authorLabel={input.commit.authorName}
      timeLabel={timeLabel}
      dateTimeLabel={dateTimeLabel}
      remoteNames={input.remoteNames}
      onRefContextMenu={input.onRefContextMenu}
      onContextMenu={input.onCommitContextMenu}
    />
  );
}
