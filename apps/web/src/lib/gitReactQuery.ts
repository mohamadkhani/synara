import {
  DEFAULT_GIT_COMMIT_HISTORY_LIMIT,
  DEFAULT_GIT_RECENT_COMMIT_LIMIT,
} from "@synara/contracts";
import type {
  GitHandoffThreadInput,
  GitReadWorkingTreeDiffInput,
  GitRemoveWorktreeInput,
  GitStackedAction,
  ModelSelection,
  NativeApi,
  ProviderStartOptions,
  ThreadId,
} from "@synara/contracts";
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { createActivityRefreshThrottle } from "./activityRefreshThrottle";
import { EXPENSIVE_READ_RETRY_OPTIONS, isRpcCapacityExceededError } from "./expensiveReadRetry";
import { preserveActivePullRequestActionGitFields } from "./pullRequestGitCache";
import { capturePullRequestActionReadFence } from "./pullRequestMutationCoordinator";

const GIT_STATUS_STALE_TIME_MS = 30_000;
// Freshness is driven primarily by event-based invalidation (turn lifecycle +
// file-change domain events in __root.tsx) plus refetchOnWindowFocus/reconnect.
// The periodic timers are only a safety net for out-of-band edits while the tab
// stays focused, so they run at a relaxed cadence instead of every minute.
const GIT_STATUS_REFETCH_INTERVAL_MS = 300_000;
const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 300_000;
const GIT_WORKING_TREE_DIFF_STALE_TIME_MS = 5_000;
const GIT_BLAME_LINE_STALE_TIME_MS = 30_000;
export const GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS = 4_000;

export function isGitExpensiveReadCapacityError(
  error: unknown,
): error is { readonly code: string; readonly retryAfterMs?: unknown } {
  return isRpcCapacityExceededError(error);
}

const GIT_EXPENSIVE_READ_RETRY_OPTIONS = EXPENSIVE_READ_RETRY_OPTIONS;

export const gitQueryKeys = {
  all: ["git"] as const,
  statuses: ["git", "status"] as const,
  pullRequests: ["git", "pull-request"] as const,
  githubRepository: (cwd: string | null) => ["git", "github-repository", cwd] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  branches: (cwd: string | null) => ["git", "branches", cwd] as const,
  recentCommits: (cwd: string | null, limit: number) =>
    ["git", "recent-commits", cwd, limit] as const,
  commitHistory: (
    cwd: string | null,
    ref: string | null,
    refs: readonly string[] | null,
    limit: number,
    includeRemote = true,
  ) => ["git", "commit-history", cwd, ref, refs, limit, includeRemote] as const,
  commitDiff: (cwd: string | null, sha: string | null) => ["git", "commit-diff", cwd, sha] as const,
  pullRequest: (cwd: string | null) => ["git", "pull-request", cwd] as const,
  workingTreeDiffs: (cwd: string | null) => ["git", "working-tree-diff", cwd] as const,
  stashes: (cwd: string | null) => ["git", "stash", cwd] as const,
  workingTreeDiff: (
    cwd: string | null,
    scope: GitReadWorkingTreeDiffInput["scope"] = "workingTree",
    compareRef: string | null = null,
    filePath: string | null = null,
  ) =>
    filePath === null
      ? (["git", "working-tree-diff", cwd, scope, compareRef] as const)
      : (["git", "working-tree-diff", cwd, scope, compareRef, "file", filePath] as const),
  // Deliberately nested under the patch key so every existing
  // `["git", "working-tree-diff", ...]` invalidation refreshes the counts too.
  workingTreeDiffStats: (
    cwd: string | null,
    scope: GitReadWorkingTreeDiffInput["scope"] = "workingTree",
    compareRef: string | null = null,
  ) => ["git", "working-tree-diff", cwd, scope, compareRef, "stats"] as const,
  blameLine: (
    cwd: string | null,
    filePath: string | null,
    line: number | null,
    rev: string | null,
    base: "branch" | null,
  ) => ["git", "blame-line", cwd, filePath, line, rev, base] as const,
  fileAtRev: (
    cwd: string | null,
    filePath: string | null,
    rev: string | null,
    base: "branch" | "index" | null,
  ) => ["git", "file-at-rev", cwd, filePath, rev, base] as const,
  diffSummary: (
    cacheScope: string | null,
    model: string | null,
    modelSelectionKey: string | null,
    codexHomePath: string | null,
    providerOptionsKey: string | null,
    patchKey: string | null,
  ) =>
    [
      "git",
      "diff-summary",
      cacheScope,
      model,
      modelSelectionKey,
      codexHomePath,
      providerOptionsKey,
      patchKey,
    ] as const,
};

export const gitMutationKeys = {
  init: (cwd: string | null) => ["git", "mutation", "init", cwd] as const,
  checkout: (cwd: string | null) => ["git", "mutation", "checkout", cwd] as const,
  runStackedAction: (cwd: string | null) => ["git", "mutation", "run-stacked-action", cwd] as const,
  pull: (cwd: string | null) => ["git", "mutation", "pull", cwd] as const,
  fetch: (cwd: string | null) => ["git", "mutation", "fetch", cwd] as const,
  preparePullRequestThread: (cwd: string | null) =>
    ["git", "mutation", "prepare-pull-request-thread", cwd] as const,
  handoffThread: (cwd: string | null) => ["git", "mutation", "handoff-thread", cwd] as const,
  stageFiles: (cwd: string | null) => ["git", "mutation", "stage-files", cwd] as const,
  unstageFiles: (cwd: string | null) => ["git", "mutation", "unstage-files", cwd] as const,
  checkoutCommit: (cwd: string | null) => ["git", "mutation", "checkout-commit", cwd] as const,
  checkoutRemoteBranch: (cwd: string | null) =>
    ["git", "mutation", "checkout-remote-branch", cwd] as const,
  createBranch: (cwd: string | null) => ["git", "mutation", "create-branch", cwd] as const,
  cherryPickCommit: (cwd: string | null) => ["git", "mutation", "cherry-pick-commit", cwd] as const,
  revertCommit: (cwd: string | null) => ["git", "mutation", "revert-commit", cwd] as const,
  createTag: (cwd: string | null) => ["git", "mutation", "create-tag", cwd] as const,
  deleteBranchRef: (cwd: string | null) => ["git", "mutation", "delete-branch-ref", cwd] as const,
  deleteTagRef: (cwd: string | null) => ["git", "mutation", "delete-tag-ref", cwd] as const,
  pushBranch: (cwd: string | null) => ["git", "mutation", "push-branch", cwd] as const,
  pullBranch: (cwd: string | null) => ["git", "mutation", "pull-branch", cwd] as const,
  mergeBranch: (cwd: string | null) => ["git", "mutation", "merge-branch", cwd] as const,
  rebaseBranch: (cwd: string | null) => ["git", "mutation", "rebase-branch", cwd] as const,
  stashCreate: (cwd: string | null) => ["git", "mutation", "stash-create", cwd] as const,
  stashApply: (cwd: string | null) => ["git", "mutation", "stash-apply", cwd] as const,
  stashDrop: (cwd: string | null) => ["git", "mutation", "stash-drop", cwd] as const,
};

type GitRefreshDepth = "availability" | "active-details";
/**
 * "local" skips the GitHub repository and pull-request reads: agent tool activity only
 * moves the working copy, and those remote reads fan out per visible PR in the folder.
 */
type GitRefreshScope = "all" | "local";

interface ActiveGitRefresh {
  depth: GitRefreshDepth;
  /** Read when each phase starts, so a queued "local" refresh can be upgraded to "all". */
  includeRemote: boolean;
  /** Read when the availability phase starts; upgraded by later mutation-driven calls. */
  refetchHistory: boolean;
  started: boolean;
  /** Resolves after the availability phase (repository/status/branches). */
  availability: Promise<void>;
  /** Resolves after the full refresh, including active detail reads when requested. */
  promise: Promise<void>;
}

const activeGitRefreshes = new WeakMap<QueryClient, Map<string, ActiveGitRefresh>>();
const gitRefreshQueueTails = new WeakMap<QueryClient, Promise<void>>();
/**
 * Last availability state that can move a ref, per cwd. Commit history is the most
 * expensive family to re-read, so an activity-driven refresh only re-walks it when
 * one of these values changed since the previous refresh.
 */
const lastHistorySnapshots = new WeakMap<QueryClient, Map<string, string>>();

interface GitHistorySnapshotInput {
  branch: string | null;
  hasUpstream: boolean;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
}

function readHistorySnapshot(queryClient: QueryClient, cwd: string): string {
  const status = queryClient.getQueryData<GitHistorySnapshotInput>(gitQueryKeys.status(cwd));
  if (!status) return "unknown";
  return [
    status.branch ?? "",
    status.hasUpstream ? "1" : "0",
    status.upstreamBranch ?? "",
    String(status.aheadCount),
    String(status.behindCount),
  ].join("\u0000");
}

function commitHistoryMightHaveMoved(
  queryClient: QueryClient,
  cwd: string,
  refetchHistory: boolean,
): boolean {
  const snapshot = readHistorySnapshot(queryClient, cwd);
  let snapshots = lastHistorySnapshots.get(queryClient);
  if (!snapshots) {
    snapshots = new Map();
    lastHistorySnapshots.set(queryClient, snapshots);
  }
  const previous = snapshots.get(cwd);
  snapshots.set(cwd, snapshot);
  return refetchHistory || previous === undefined || previous !== snapshot;
}

function enqueueGitRefresh(queryClient: QueryClient, refresh: () => Promise<void>): Promise<void> {
  const previous = gitRefreshQueueTails.get(queryClient) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(refresh);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  gitRefreshQueueTails.set(queryClient, settled);
  void settled.then(() => {
    if (gitRefreshQueueTails.get(queryClient) === settled) {
      gitRefreshQueueTails.delete(queryClient);
    }
  });
  return result;
}

function trackGitRefresh(
  queryClient: QueryClient,
  cwd: string,
  entry: ActiveGitRefresh,
): Promise<void> {
  let refreshes = activeGitRefreshes.get(queryClient);
  if (!refreshes) {
    refreshes = new Map();
    activeGitRefreshes.set(queryClient, refreshes);
  }
  refreshes.set(cwd, entry);
  const cleanup = () => {
    if (refreshes.get(cwd) === entry) refreshes.delete(cwd);
  };
  void entry.promise.then(cleanup, cleanup);
  return entry.promise;
}

/**
 * Refetches the matching active queries from scratch. A fetch already in flight may have
 * read the repository before whatever change triggered this refresh (e.g. a checkout or
 * pull that just settled), so reusing it would mark stale data fresh. It is cancelled
 * explicitly first because refetchQueries' cancelRefetch only cancels fetches on queries
 * that already hold data — a cold query's initial fetch would otherwise be joined.
 */
async function refetchFreshGitQueries(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true, fetchStatus: "fetching" });
  await queryClient.refetchQueries(
    { queryKey, exact: true, type: "active" },
    { cancelRefetch: true },
  );
}

async function refreshGitAvailability(
  queryClient: QueryClient,
  cwd: string,
  includeRemote: boolean,
  refetchHistory: boolean,
): Promise<void> {
  await Promise.all([
    includeRemote
      ? queryClient.invalidateQueries({
          queryKey: gitQueryKeys.githubRepository(cwd),
          exact: true,
          refetchType: "none",
        })
      : undefined,
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.status(cwd),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.branches(cwd),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: ["git", "recent-commits", cwd] as const,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: ["git", "commit-history", cwd] as const,
      refetchType: "none",
    }),
  ]);
  await Promise.all([
    includeRemote
      ? refetchFreshGitQueries(queryClient, gitQueryKeys.githubRepository(cwd))
      : undefined,
    refetchFreshGitQueries(queryClient, gitQueryKeys.status(cwd)),
    refetchFreshGitQueries(queryClient, gitQueryKeys.branches(cwd)),
    ...queryClient
      .getQueryCache()
      .findAll({ queryKey: ["git", "recent-commits", cwd] as const, type: "active" })
      .map((query) => refetchFreshGitQueries(queryClient, query.queryKey)),
  ]);

  // History pages are keyed by ref and paging is offset-based, so a new commit shifts
  // later pages: when the walk might have moved, every active page set is re-read
  // (refetching only page 0 would leave the flattened list inconsistent). A mutation or
  // branch action always re-reads; agent tool activity only re-reads when the branch,
  // its upstream, or ahead/behind counts actually changed, which a file edit does not.
  if (!commitHistoryMightHaveMoved(queryClient, cwd, refetchHistory)) return;
  await Promise.all(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ["git", "commit-history", cwd] as const, type: "active" })
      .map((query) => refetchFreshGitQueries(queryClient, query.queryKey)),
  );
}

function activeGitDetailQueries(queryClient: QueryClient, cwd: string, includeRemote = true) {
  const queryCache = queryClient.getQueryCache();
  const queries = [
    ...queryCache.findAll({
      queryKey: gitQueryKeys.workingTreeDiffs(cwd),
      type: "active",
    }),
    ...queryCache.findAll({ queryKey: gitQueryKeys.stashes(cwd), type: "active" }),
    ...(includeRemote
      ? queryCache.findAll({ queryKey: gitQueryKeys.pullRequest(cwd), type: "active" })
      : []),
    // A mounted diff editor keeps showing a base blob, and an open blame
    // popover its attribution, until refetched.
    ...queryCache.findAll({ queryKey: ["git", "file-at-rev", cwd] as const, type: "active" }),
    ...queryCache.findAll({ queryKey: ["git", "blame-line", cwd] as const, type: "active" }),
  ];
  const uniqueQueries = [...new Map(queries.map((query) => [query.queryHash, query])).values()];
  return uniqueQueries.toSorted((left, right) => {
    const leftIsStats = left.queryKey.at(-1) === "stats";
    const rightIsStats = right.queryKey.at(-1) === "stats";
    if (leftIsStats !== rightIsStats) return leftIsStats ? -1 : 1;
    const leftIsPatch = left.queryKey[1] === "working-tree-diff" && !leftIsStats;
    const rightIsPatch = right.queryKey[1] === "working-tree-diff" && !rightIsStats;
    if (leftIsPatch !== rightIsPatch) return leftIsPatch ? 1 : -1;
    return left.queryHash.localeCompare(right.queryHash);
  });
}

async function refreshActiveGitDetails(
  queryClient: QueryClient,
  cwd: string,
  includeRemote: boolean,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.workingTreeDiffs(cwd),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.stashes(cwd),
      refetchType: "none",
    }),
    includeRemote
      ? queryClient.invalidateQueries({
          queryKey: gitQueryKeys.pullRequest(cwd),
          refetchType: "none",
        })
      : undefined,
    // Revision-dependent families: after a save, commit, or branch movement the
    // cached attribution/blobs would otherwise survive their stale windows.
    queryClient.invalidateQueries({
      queryKey: ["git", "blame-line", cwd] as const,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: ["git", "file-at-rev", cwd] as const,
      refetchType: "none",
    }),
    // Marked stale but not eagerly refetched: a commit object's patch never changes,
    // and an open detail pane re-reads it when it remounts on the next selection.
    queryClient.invalidateQueries({
      queryKey: ["git", "commit-diff", cwd] as const,
      refetchType: "none",
    }),
  ]);
  for (const query of activeGitDetailQueries(queryClient, cwd, includeRemote)) {
    await enqueueGitRefresh(queryClient, () => refetchFreshGitQueries(queryClient, query.queryKey));
  }
}

/**
 * Revalidates active working-tree diff variants from scratch after a watched
 * file changes. Reads stay on the shared Git queue so stats and patch variants
 * cannot consume expensive-read capacity in parallel.
 */
export async function refreshGitWorkingTreeDiffsForCwd(
  queryClient: QueryClient,
  cwd: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: gitQueryKeys.workingTreeDiffs(cwd),
    refetchType: "none",
  });
  const queries = activeGitDetailQueries(queryClient, cwd).filter(
    (query) => query.queryKey[1] === "working-tree-diff",
  );
  for (const query of queries) {
    await enqueueGitRefresh(queryClient, () => refetchFreshGitQueries(queryClient, query.queryKey));
  }
}

const activeFileWriteRefreshes = new WeakMap<
  QueryClient,
  Map<string, { generation: number; promise: Promise<void> }>
>();

/** Refresh only working-copy data after file writes. Autosave must not refetch
 * PRs, branches or revision blobs for each pause in typing. Watcher echoes join
 * the pending refresh; events arriving during a read request one fresh pass. */
export function refreshGitAfterFileWrite(queryClient: QueryClient, cwd: string): Promise<void> {
  let refreshes = activeFileWriteRefreshes.get(queryClient);
  if (!refreshes) {
    refreshes = new Map();
    activeFileWriteRefreshes.set(queryClient, refreshes);
  }
  const existing = refreshes.get(cwd);
  if (existing) {
    existing.generation += 1;
    return existing.promise;
  }
  const entry = { generation: 0, promise: Promise.resolve() };
  refreshes.set(cwd, entry);
  entry.promise = (async () => {
    let completed: number;
    do {
      completed = entry.generation;
      // Keep the visible patch first: status may need a separate Git process.
      await refreshGitWorkingTreeDiffsForCwd(queryClient, cwd);
      await queryClient.invalidateQueries({
        queryKey: gitQueryKeys.status(cwd),
        exact: true,
        refetchType: "none",
      });
      await enqueueGitRefresh(queryClient, () =>
        refetchFreshGitQueries(queryClient, gitQueryKeys.status(cwd)),
      );
    } while (completed !== entry.generation);
  })().finally(() => {
    if (refreshes.get(cwd) === entry) refreshes.delete(cwd);
  });
  return entry.promise;
}

/**
 * Coalesces refreshes by repository and serializes their expensive reads across the client.
 * Availability is refreshed first; active diff/PR details follow one at a time so Git UI work
 * cannot consume both expensive-read leases or fan out across every visible worktree.
 *
 * A refresh only joins an existing one while that refresh is still queued: once its reads
 * have begun they may predate whatever change triggered this request (a checkout or pull
 * that just settled), so joining would return without ever observing the new repository
 * state. In that case a fresh refresh is queued behind the running one instead.
 */
export function refreshGitQueriesForCwd(
  queryClient: QueryClient,
  cwd: string,
  depth: GitRefreshDepth = "active-details",
  scope: GitRefreshScope = "all",
  refetchHistory = false,
): Promise<void> {
  const existing = activeGitRefreshes.get(queryClient)?.get(cwd);
  if (existing && !existing.started) {
    if (depth === "active-details") existing.depth = "active-details";
    if (scope === "all") existing.includeRemote = true;
    if (refetchHistory) existing.refetchHistory = true;
    return depth === "availability" ? existing.availability : existing.promise;
  }

  const entry: ActiveGitRefresh = {
    depth,
    includeRemote: scope === "all",
    refetchHistory,
    started: false,
    availability: Promise.resolve(),
    promise: Promise.resolve(),
  };
  entry.availability = enqueueGitRefresh(queryClient, () => {
    entry.started = true;
    return refreshGitAvailability(queryClient, cwd, entry.includeRemote, entry.refetchHistory);
  });
  // Read entry.depth only after availability settles so a pre-start upgrade to
  // "active-details" is honored even when the original request was availability-only.
  entry.promise = entry.availability.then(() =>
    entry.depth === "active-details"
      ? refreshActiveGitDetails(queryClient, cwd, entry.includeRemote)
      : undefined,
  );
  trackGitRefresh(queryClient, cwd, entry);
  return depth === "availability" ? entry.availability : entry.promise;
}

/** Resolves once repository/status/branches are fresh, even when the underlying refresh
 * was upgraded to also re-read active details after the availability phase. */
export function refreshGitActionAvailability(queryClient: QueryClient, cwd: string): Promise<void> {
  return refreshGitQueriesForCwd(queryClient, cwd, "availability");
}

function cachedGitCwds(queryClient: QueryClient): string[] {
  const cwdFamilies = new Set([
    "github-repository",
    "status",
    "branches",
    "recent-commits",
    "commit-history",
    "commit-diff",
    "working-tree-diff",
    "pull-request",
  ]);
  const cwds = queryClient
    .getQueryCache()
    .findAll({ queryKey: gitQueryKeys.all })
    .flatMap((query) => {
      const family = query.queryKey[1];
      const cwd = query.queryKey[2];
      return typeof family === "string" && cwdFamilies.has(family) && typeof cwd === "string"
        ? [cwd]
        : [];
    });
  return [...new Set(cwds)];
}

// excludeCwds lets a caller that already refreshed (and awaited) specific checkouts fan the
// rest out in the background without queueing duplicate refreshes for the awaited ones.
export function invalidateGitQueries(
  queryClient: QueryClient,
  options?: { readonly excludeCwds?: Iterable<string> },
) {
  const excludedCwds = new Set(options?.excludeCwds ?? []);
  return Promise.all(
    cachedGitCwds(queryClient)
      .filter((cwd) => !excludedCwds.has(cwd))
      .map((cwd) => refreshGitQueriesForCwd(queryClient, cwd, "active-details", "all", true)),
  );
}

// Scope live file-change invalidations so unrelated project/worktree git caches stay warm.
// Callers are mutation-driven (a user action or an applied agent change), so history is
// re-read even when the availability snapshot looks unchanged.
export function invalidateGitQueriesForCwds(queryClient: QueryClient, cwds: Iterable<string>) {
  const uniqueCwds = [...new Set([...cwds].filter((cwd) => cwd.length > 0))];
  return Promise.all(
    uniqueCwds.map((cwd) =>
      refreshGitQueriesForCwd(queryClient, cwd, "active-details", "all", true),
    ),
  );
}

/**
 * Event-driven full refresh (including GitHub repository and pull requests) for checkouts
 * whose turn diff or workspace metadata just changed; see activityRefreshThrottle.
 */
export const refreshGitQueriesForCwdsAfterActivity = createActivityRefreshThrottle(
  (queryClient, cwd) => {
    void refreshGitQueriesForCwd(queryClient, cwd).catch(() => undefined);
  },
);

/**
 * Mid-turn refresh after agent tool calls: local Git state only. Pull requests and the
 * GitHub repository wait for the finalized turn diff, focus or their own polling.
 */
export const refreshLocalGitQueriesForCwdsAfterActivity = createActivityRefreshThrottle(
  (queryClient, cwd) => {
    void refreshGitQueriesForCwd(queryClient, cwd, "active-details", "local").catch(
      () => undefined,
    );
  },
);

/**
 * Refreshes the given checkouts and resolves once they are fresh; every other cached
 * repository refreshes in the background. For callers gating UI on a refresh (e.g. a
 * branch action transition) so one slow unrelated worktree cannot hold the UI busy.
 * The awaited checkouts are queued first so background work cannot delay them.
 */
export function refreshGitQueriesScoped(
  queryClient: QueryClient,
  cwds: Iterable<string>,
): Promise<void> {
  const awaitedCwds = [...new Set([...cwds].filter((cwd) => cwd.length > 0))];
  const scoped = invalidateGitQueriesForCwds(queryClient, awaitedCwds);
  void invalidateGitQueries(queryClient, { excludeCwds: awaitedCwds }).catch(() => undefined);
  return scoped.then(() => undefined);
}

export function gitStatusQueryOptions(cwd: string | null, enabled = true) {
  return queryOptions({
    queryKey: gitQueryKeys.status(cwd),
    queryFn: async ({ client }) => {
      const readFence = capturePullRequestActionReadFence(client);
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git status is unavailable.");
      return preserveActivePullRequestActionGitFields(
        client,
        await api.git.status({ cwd }),
        readFence,
      );
    },
    enabled: enabled && cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitGithubRepositoryQueryOptions(cwd: string | null, enabled = true) {
  return queryOptions({
    queryKey: gitQueryKeys.githubRepository(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("GitHub repository is unavailable.");
      return api.git.githubRepository({ cwd });
    },
    enabled: enabled && cwd !== null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

function resolveGitCompareRef(
  scope: GitReadWorkingTreeDiffInput["scope"],
  compareRef: string | null | undefined,
): string | null {
  if (scope !== "ref") {
    return null;
  }
  const trimmed = compareRef?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function gitRecentCommitsQueryOptions(input: {
  cwd: string | null;
  limit?: number;
  enabled?: boolean;
}) {
  const limit = input.limit ?? DEFAULT_GIT_RECENT_COMMIT_LIMIT;
  return queryOptions({
    queryKey: gitQueryKeys.recentCommits(input.cwd, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Git commits are unavailable.");
      return api.git.listRecentCommits({ cwd: input.cwd, limit });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitCommitHistoryQueryOptions(input: {
  cwd: string | null;
  ref: string | null;
  /** Selected refs the graph walks together; takes precedence over `ref` when non-empty. */
  refs?: readonly string[] | null;
  limit?: number;
  /** False drops `refs/remotes/*` from the all-refs walk (the toolbar switch). */
  includeRemoteBranches?: boolean;
  enabled?: boolean;
}) {
  const limit = input.limit ?? DEFAULT_GIT_COMMIT_HISTORY_LIMIT;
  const includeRemoteBranches = input.includeRemoteBranches ?? true;
  // Sort the selection so the same set always maps to one cache key, whatever order
  // the chips were toggled in; `git log` walks a starting set independently of order.
  const refs = input.refs && input.refs.length > 0 ? input.refs.toSorted() : null;
  return infiniteQueryOptions({
    queryKey: gitQueryKeys.commitHistory(input.cwd, input.ref, refs, limit, includeRemoteBranches),
    queryFn: async ({ pageParam }) => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Commit history is unavailable.");
      return api.git.listCommitHistory({
        cwd: input.cwd,
        limit,
        skip: pageParam,
        includeRemoteBranches,
        ...(refs ? { refs } : {}),
        ...(input.ref ? { ref: input.ref } : {}),
      });
    },
    initialPageParam: 0,
    // Derive the next offset from the commits actually received, not the page index:
    // a truncated server page returns fewer records than `limit` while still reporting
    // `hasMore`, so `allPages.length * limit` would skip past commits.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore
        ? allPages.reduce((total, page) => total + page.commits.length, 0)
        : undefined,
    enabled: (input.enabled ?? true) && input.cwd !== null,
    // A selection change starts a new walk under a new cache key. Keeping the previous pages
    // rendered while the new one loads stops the list from collapsing for a moment, which
    // would throw the reader's scroll position back to the newest commit.
    placeholderData: (previous) => previous,
    // History only moves when this client commits, fetches, or an agent does; the
    // git invalidation pipeline covers those, so no polling is needed here.
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitCommitDiffQueryOptions(input: {
  cwd: string | null;
  sha: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.commitDiff(input.cwd, input.sha),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.sha) throw new Error("Commit is unavailable.");
      return api.git.readCommitDiff({ cwd: input.cwd, sha: input.sha });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.sha !== null,
    // A commit object never changes, so its patch is safe to cache for the session.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitBranchesQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitQueryKeys.branches(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git branches are unavailable.");
      return api.git.listBranches({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitResolvePullRequestQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  pollIntervalMs?: number;
}) {
  return queryOptions({
    queryKey: [...gitQueryKeys.pullRequest(input.cwd), input.reference] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request lookup is unavailable.");
      }
      return api.git.resolvePullRequest({ cwd: input.cwd, reference: input.reference });
    },
    enabled: input.cwd !== null && input.reference !== null,
    staleTime: 30_000,
    // A merged pull request is final; polling it forever only burns GitHub rate limit.
    refetchInterval: (query) =>
      input.pollIntervalMs === undefined || query.state.data?.pullRequest.state === "merged"
        ? false
        : input.pollIntervalMs,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

// Refresh cadence for the Environment panel PR section: cheap enough to poll while the
// panel is open, and event-based git invalidation covers pushes from this client.
const GIT_PR_SNAPSHOT_STALE_TIME_MS = 30_000;
const GIT_PR_SNAPSHOT_REFETCH_INTERVAL_MS = 60_000;

export function gitPullRequestSnapshotQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    // Shares the ["git", "pull-request", cwd] prefix so existing invalidations cover it.
    queryKey: [...gitQueryKeys.pullRequest(input.cwd), "snapshot", input.reference] as const,
    queryFn: async ({ client }) => {
      const readFence = capturePullRequestActionReadFence(client);
      const api = ensureNativeApi();
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request snapshot is unavailable.");
      }
      return preserveActivePullRequestActionGitFields(
        client,
        await api.git.pullRequestSnapshot({ cwd: input.cwd, reference: input.reference }),
        readFence,
      );
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.reference !== null,
    staleTime: GIT_PR_SNAPSHOT_STALE_TIME_MS,
    // Once the snapshot itself reports the PR merged/closed, stop polling it — the cached
    // git status can lag behind and would otherwise keep the interval alive.
    refetchInterval: (query) =>
      query.state.data && query.state.data.pullRequest.state !== "open"
        ? false
        : GIT_PR_SNAPSHOT_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: (query) =>
      !query.state.data || query.state.data.pullRequest.state === "open",
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

/**
 * Line counts for the selected scope, resolved server-side.
 *
 * Separate from `gitWorkingTreeDiffQueryOptions` on purpose: the badge surfaces poll these
 * numbers every few seconds while a turn is live, and the patch they used to be derived from
 * grows with the working tree — on a 10k-line diff that meant refetching megabytes of text and
 * reparsing it on the renderer's main thread just to show `+N/-M`. The response here is three
 * integers regardless of diff size. Fetch the patch itself only when showing the diff.
 */
export function gitWorkingTreeDiffStatsQueryOptions(input: {
  cwd: string | null;
  scope?: GitReadWorkingTreeDiffInput["scope"];
  compareRef?: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const scope = input.scope ?? "workingTree";
  const compareRef = resolveGitCompareRef(scope, input.compareRef);
  const refetchInterval = input.refetchInterval;
  return queryOptions({
    queryKey: gitQueryKeys.workingTreeDiffStats(input.cwd, scope, compareRef),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Working tree diff stats are unavailable.");
      }
      return api.git.workingTreeDiffStats({
        cwd: input.cwd,
        scope,
        ...(compareRef ? { compareRef } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && (scope !== "ref" || !!compareRef),
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitStashListQueryOptions(input: {
  cwd: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const refetchInterval = input.refetchInterval;
  return queryOptions({
    queryKey: gitQueryKeys.stashes(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("The stash list is unavailable.");
      return api.git.stashList({ cwd: input.cwd });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitReadFileAtRevQueryOptions(input: {
  cwd: string | null;
  filePath: string | null;
  rev?: string | undefined;
  base?: "branch" | "index" | undefined;
  enabled?: boolean;
}) {
  const { cwd, filePath, base, rev } = input;
  return queryOptions({
    queryKey: gitQueryKeys.fileAtRev(cwd, filePath, rev ?? null, base ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd || !filePath) {
        throw new Error("File revision read is unavailable.");
      }
      return api.git.readFileAtRev({
        cwd,
        filePath,
        ...(rev !== undefined ? { rev } : {}),
        ...(base !== undefined ? { base } : {}),
      });
    },
    enabled: (input.enabled ?? true) && cwd !== null && filePath !== null,
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
  });
}

export function gitWorkingTreeDiffQueryOptions(input: {
  cwd: string | null;
  scope?: GitReadWorkingTreeDiffInput["scope"];
  compareRef?: string | null;
  filePath?: string | null | undefined;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const scope = input.scope ?? "workingTree";
  const compareRef = resolveGitCompareRef(scope, input.compareRef);
  const refetchInterval = input.refetchInterval;
  return queryOptions({
    queryKey: gitQueryKeys.workingTreeDiff(input.cwd, scope, compareRef, input.filePath ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Working tree diff is unavailable.");
      }
      return api.git.readWorkingTreeDiff({
        cwd: input.cwd,
        scope,
        ...(compareRef ? { compareRef } : {}),
        ...(input.filePath ? { filePath: input.filePath } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && (scope !== "ref" || !!compareRef),
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitBlameLineQueryOptions(input: {
  cwd: string | null;
  filePath: string | null;
  line: number | null;
  rev?: string | undefined;
  base?: "branch" | undefined;
  enabled?: boolean;
}) {
  const rev = input.rev ?? null;
  const base = input.base ?? null;
  return queryOptions({
    queryKey: gitQueryKeys.blameLine(input.cwd, input.filePath, input.line, rev, base),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.filePath || input.line === null) {
        throw new Error("Git blame is unavailable.");
      }
      return api.git.blameLine({
        cwd: input.cwd,
        filePath: input.filePath,
        line: input.line,
        ...(rev !== null ? { rev } : {}),
        ...(base !== null ? { base } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.cwd !== null &&
      input.filePath !== null &&
      input.line !== null,
    staleTime: GIT_BLAME_LINE_STALE_TIME_MS,
    retry: false,
  });
}

type GitMutationInvalidation = "all" | "cwd";
type GitMutationInvalidateOn = "success" | "settled";

// Shared scaffolding for cwd-bound git mutations: resolve the native API, guard a
// missing cwd with a clear message, run the single call, then invalidate git
// caches — globally or scoped to this cwd — on success or settle. Keeps each
// mutation definition down to its key + the one API call it performs.
function makeGitMutationOptions<TArgs, TResult>(config: {
  cwd: string | null;
  queryClient: QueryClient;
  mutationKey: readonly unknown[];
  unavailableMessage: string;
  run: (api: NativeApi, cwd: string, args: TArgs) => Promise<TResult>;
  invalidate?: GitMutationInvalidation;
  invalidateOn?: GitMutationInvalidateOn;
  awaitInvalidation?: boolean;
}) {
  const invalidate = config.invalidate ?? "all";
  const invalidateOn = config.invalidateOn ?? "settled";
  const runInvalidation = async () => {
    if (invalidate === "cwd") {
      if (config.cwd) {
        await invalidateGitQueriesForCwds(config.queryClient, [config.cwd]);
      }
      return;
    }
    await invalidateGitQueries(config.queryClient);
  };
  const handleInvalidation =
    config.awaitInvalidation === false
      ? () => {
          void runInvalidation().catch(() => undefined);
        }
      : runInvalidation;

  return mutationOptions({
    mutationKey: config.mutationKey,
    mutationFn: async (args: TArgs) => {
      const api = ensureNativeApi();
      if (!config.cwd) throw new Error(config.unavailableMessage);
      return config.run(api, config.cwd, args);
    },
    ...(invalidateOn === "success"
      ? { onSuccess: handleInvalidation }
      : { onSettled: handleInvalidation }),
  });
}

export function gitInitMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return makeGitMutationOptions<void, void>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.init(input.cwd),
    unavailableMessage: "Git init is unavailable.",
    invalidateOn: "success",
    run: (api, cwd) => api.git.init({ cwd }),
  });
}

export function gitStageFilesMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<readonly string[], { ok: boolean }>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.stageFiles(input.cwd),
    unavailableMessage: "Staging is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, paths) => {
      if (paths.length === 0) throw new Error("No files selected to stage.");
      return api.git.stageFiles({ cwd, paths: [...paths] });
    },
  });
}

export function gitUnstageFilesMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<readonly string[], { ok: boolean }>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.unstageFiles(input.cwd),
    unavailableMessage: "Unstaging is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, paths) => {
      if (paths.length === 0) throw new Error("No files selected to unstage.");
      return api.git.unstageFiles({ cwd, paths: [...paths] });
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  model?: string | null;
  modelSelection?: ModelSelection | null;
  codexHomePath?: string | null;
  providerOptions?: ProviderStartOptions | null;
}) {
  return makeGitMutationOptions<
    {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
      prTitle?: string;
      prBody?: string;
      prDraft?: boolean;
      allowDirtyWorkingTree?: boolean;
      /** Thread the action runs for; the server links the PR it creates or pushes to. */
      threadId?: ThreadId;
    },
    Awaited<ReturnType<NativeApi["git"]["runStackedAction"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.runStackedAction(input.cwd),
    unavailableMessage: "Git action is unavailable.",
    invalidate: "cwd",
    awaitInvalidation: false,
    run: (
      api,
      cwd,
      {
        actionId,
        action,
        commitMessage,
        featureBranch,
        filePaths,
        prTitle,
        prBody,
        prDraft,
        allowDirtyWorkingTree,
        threadId,
      },
    ) =>
      api.git.runStackedAction({
        actionId,
        cwd,
        action,
        ...(threadId ? { threadId } : {}),
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...(prTitle ? { prTitle } : {}),
        ...(prBody ? { prBody } : {}),
        ...(prDraft !== undefined ? { prDraft } : {}),
        ...(allowDirtyWorkingTree ? { allowDirtyWorkingTree } : {}),
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { textGenerationModel: input.model } : {}),
        ...(input.modelSelection ? { textGenerationModelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      }),
  });
}

export function gitPullMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return makeGitMutationOptions<void, Awaited<ReturnType<NativeApi["git"]["pull"]>>>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.pull(input.cwd),
    unavailableMessage: "Git pull is unavailable.",
    invalidate: "cwd",
    awaitInvalidation: false,
    run: (api, cwd) => api.git.pull({ cwd }),
  });
}

export function gitFetchMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return makeGitMutationOptions<void, Awaited<ReturnType<NativeApi["git"]["fetch"]>>>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.fetch(input.cwd),
    unavailableMessage: "Git fetch is unavailable.",
    invalidate: "cwd",
    awaitInvalidation: false,
    run: (api, cwd) => api.git.fetch({ cwd }),
  });
}

export function gitCreateDetachedWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      ref,
      path,
      copyChangesFrom,
      newBranch,
      progressId,
    }: {
      cwd: string;
      ref: string;
      path?: string | null;
      copyChangesFrom?: string;
      newBranch?: string;
      progressId?: string;
    }) => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git worktree creation is unavailable.");
      return api.git.createDetachedWorktree({
        cwd,
        ref,
        path: path ?? null,
        ...(copyChangesFrom ? { copyChangesFrom } : {}),
        ...(newBranch ? { newBranch } : {}),
        ...(progressId ? { progressId } : {}),
      });
    },
    mutationKey: ["git", "mutation", "create-detached-worktree"] as const,
    // The result already identifies the new worktree, and the first send links the
    // thread to it before starting the turn. Like `awaitInvalidation: false` above,
    // that must not wait for status/PR refreshes in every cached project and worktree.
    onSettled: () => {
      void invalidateGitQueries(input.queryClient).catch(() => undefined);
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      path,
      force,
      archiveCleanup,
      reclaimTemporaryBranch = true,
    }: GitRemoveWorktreeInput) => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git worktree removal is unavailable.");
      // Every UI removal retires a thread-scoped managed worktree, so its
      // temporary synara/* branch (if any) is reclaimed with it.
      return api.git.removeWorktree({ cwd, path, force, reclaimTemporaryBranch, archiveCleanup });
    },
    mutationKey: ["git", "mutation", "remove-worktree"] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    // `cwd` targets another checkout of the same repository (a second project on one repo);
    // the prepare step invalidates every git query, so the cache stays correct either way.
    { reference: string; mode: "local" | "worktree"; cwd?: string | undefined },
    Awaited<ReturnType<NativeApi["git"]["preparePullRequestThread"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.preparePullRequestThread(input.cwd),
    unavailableMessage: "Pull request thread preparation is unavailable.",
    // The result already identifies the prepared checkout. Opening its draft must not
    // wait for status/diff refreshes in every cached project and worktree.
    awaitInvalidation: false,
    run: (api, cwd, { reference, mode, cwd: targetCwd }) =>
      api.git.preparePullRequestThread({ cwd: targetCwd ?? cwd, reference, mode }),
  });
}

export function gitHandoffThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    Omit<GitHandoffThreadInput, "cwd">,
    Awaited<ReturnType<NativeApi["git"]["handoffThread"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.handoffThread(input.cwd),
    unavailableMessage: "Git handoff is unavailable.",
    run: (api, cwd, request) => api.git.handoffThread({ cwd, ...request }),
  });
}

export function gitCheckoutCommitMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<{ sha: string }, void>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.checkoutCommit(input.cwd),
    unavailableMessage: "Checking out a commit is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { sha }) => api.git.checkoutCommit({ cwd, sha }),
  });
}

export function gitCreateBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { branch: string; publish?: boolean; startPoint?: string; checkout?: boolean },
    Awaited<ReturnType<NativeApi["git"]["createBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.createBranch(input.cwd),
    unavailableMessage: "Creating a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { branch, publish, startPoint, checkout }) =>
      api.git.createBranch({
        cwd,
        branch,
        ...(publish !== undefined ? { publish } : {}),
        ...(startPoint !== undefined ? { startPoint } : {}),
        ...(checkout !== undefined ? { checkout } : {}),
      }),
  });
}

export function gitCherryPickCommitMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { sha: string },
    Awaited<ReturnType<NativeApi["git"]["cherryPickCommit"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.cherryPickCommit(input.cwd),
    unavailableMessage: "Cherry-pick is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { sha }) => api.git.cherryPickCommit({ cwd, sha }),
  });
}

export function gitRevertCommitMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { sha: string },
    Awaited<ReturnType<NativeApi["git"]["revertCommit"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.revertCommit(input.cwd),
    unavailableMessage: "Revert is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { sha }) => api.git.revertCommit({ cwd, sha }),
  });
}

export function gitCreateTagMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { sha: string; name: string; message?: string },
    Awaited<ReturnType<NativeApi["git"]["createTag"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.createTag(input.cwd),
    unavailableMessage: "Creating a tag is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { sha, name, message }) =>
      api.git.createTag({ cwd, sha, name, ...(message ? { message } : {}) }),
  });
}

export function gitDeleteBranchRefMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { branch: string; force?: boolean; deleteRemote?: boolean },
    Awaited<ReturnType<NativeApi["git"]["deleteBranchRef"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.deleteBranchRef(input.cwd),
    unavailableMessage: "Deleting a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { branch, force, deleteRemote }) =>
      api.git.deleteBranchRef({
        cwd,
        branch,
        ...(force !== undefined ? { force } : {}),
        ...(deleteRemote !== undefined ? { deleteRemote } : {}),
      }),
  });
}

export function gitDeleteTagRefMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { name: string; deleteRemote?: boolean },
    Awaited<ReturnType<NativeApi["git"]["deleteTagRef"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.deleteTagRef(input.cwd),
    unavailableMessage: "Deleting a tag is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { name, deleteRemote }) =>
      api.git.deleteTagRef({ cwd, name, ...(deleteRemote !== undefined ? { deleteRemote } : {}) }),
  });
}

export function gitCheckoutRemoteBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { remoteBranch: string },
    Awaited<ReturnType<NativeApi["git"]["checkoutRemoteBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.checkoutRemoteBranch(input.cwd),
    unavailableMessage: "Checking out a remote branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { remoteBranch }) => api.git.checkoutRemoteBranch({ cwd, remoteBranch }),
  });
}

export function gitPushBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { branch: string; remote: string; setUpstream?: boolean; forceWithLease?: boolean },
    Awaited<ReturnType<NativeApi["git"]["pushBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.pushBranch(input.cwd),
    unavailableMessage: "Pushing a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { branch, remote, setUpstream, forceWithLease }) =>
      api.git.pushBranch({
        cwd,
        branch,
        remote,
        ...(setUpstream !== undefined ? { setUpstream } : {}),
        ...(forceWithLease !== undefined ? { forceWithLease } : {}),
      }),
  });
}

export function gitPullBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { remote: string; branch: string; rebase?: boolean },
    Awaited<ReturnType<NativeApi["git"]["pullBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.pullBranch(input.cwd),
    unavailableMessage: "Pulling a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { remote, branch, rebase }) =>
      api.git.pullBranch({ cwd, remote, branch, ...(rebase !== undefined ? { rebase } : {}) }),
  });
}

export function gitMergeBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { ref: string; noFastForward?: boolean; squash?: boolean; noCommit?: boolean },
    Awaited<ReturnType<NativeApi["git"]["mergeBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.mergeBranch(input.cwd),
    unavailableMessage: "Merging a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { ref, noFastForward, squash, noCommit }) =>
      api.git.mergeBranch({
        cwd,
        ref,
        ...(noFastForward !== undefined ? { noFastForward } : {}),
        ...(squash !== undefined ? { squash } : {}),
        ...(noCommit !== undefined ? { noCommit } : {}),
      }),
  });
}

export function gitRebaseBranchMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { ref: string; autosquash?: boolean },
    Awaited<ReturnType<NativeApi["git"]["rebaseBranch"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.rebaseBranch(input.cwd),
    unavailableMessage: "Rebasing a branch is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { ref, autosquash }) =>
      api.git.rebaseBranch({ cwd, ref, ...(autosquash !== undefined ? { autosquash } : {}) }),
  });
}

export function gitStashCreateMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    {
      message: string;
      scope: "staged" | "unstaged";
      includeUnstaged?: boolean;
      includeStaged?: boolean;
    },
    Awaited<ReturnType<NativeApi["git"]["stashCreate"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.stashCreate(input.cwd),
    unavailableMessage: "Creating a stash is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { message, scope, includeUnstaged, includeStaged }) =>
      api.git.stashCreate({
        cwd,
        message,
        scope,
        ...(includeUnstaged !== undefined ? { includeUnstaged } : {}),
        ...(includeStaged !== undefined ? { includeStaged } : {}),
      }),
  });
}

export function gitStashApplyMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { stashRef: string; mode: "apply" | "pop" },
    Awaited<ReturnType<NativeApi["git"]["stashApply"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.stashApply(input.cwd),
    unavailableMessage: "Applying a stash is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { stashRef, mode }) => api.git.stashApply({ cwd, stashRef, mode }),
  });
}

export function gitStashDropMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { stashRef: string },
    Awaited<ReturnType<NativeApi["git"]["stashDrop"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.stashDrop(input.cwd),
    unavailableMessage: "Dropping a stash is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, { stashRef }) => api.git.stashDrop({ cwd, stashRef }),
  });
}
