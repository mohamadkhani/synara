import { Option, Schema } from "effect";
import {
  CommandId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "./model";
import { ModelSelection, ProviderStartOptions } from "./orchestration";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

// Domain Types

export const GitStackedAction = Schema.Literals([
  "commit",
  "push",
  "create_pr",
  "commit_push",
  "commit_push_pr",
]);
export type GitStackedAction = typeof GitStackedAction.Type;
export const GitActionProgressPhase = Schema.Literals(["branch", "commit", "push", "pr"]);
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type;
export const GitActionProgressKind = Schema.Literals([
  "action_started",
  "phase_started",
  "hook_started",
  "hook_output",
  "hook_finished",
  "action_finished",
  "action_failed",
]);
export type GitActionProgressKind = typeof GitActionProgressKind.Type;
export const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
export type GitActionProgressStream = typeof GitActionProgressStream.Type;
const GitCommitStepStatus = Schema.Literals([
  "created",
  "skipped_no_changes",
  "skipped_not_requested",
]);
const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals(["created", "opened_existing", "skipped_not_requested"]);
const GitStatusPrState = Schema.Literals(["open", "closed", "merged"]);
const GitPullRequestReference = TrimmedNonEmptyStringSchema;
const GitPullRequestState = Schema.Literals(["open", "closed", "merged"]);
// GitHub's mergeability is eventually consistent: "unknown" is a real transient state
// while GitHub recomputes after a push, not a decode fallback to branch on.
export const GitPullRequestMergeability = Schema.Literals(["mergeable", "conflicting", "unknown"]);
export type GitPullRequestMergeability = typeof GitPullRequestMergeability.Type;
const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
const GitHandoffThreadMode = Schema.Literals(["local", "worktree"]);

export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  /**
   * Local branch only: the remote its configured upstream tracks, when it has one.
   * The branch menu pushes a branch to its upstream remote instead of guessing.
   */
  upstreamRemote: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitBranch = typeof GitBranch.Type;

export const GitRecentCommit = Schema.Struct({
  sha: TrimmedNonEmptyStringSchema,
  shortSha: TrimmedNonEmptyStringSchema,
  subject: Schema.String,
  committedAt: Schema.String,
});
export type GitRecentCommit = typeof GitRecentCommit.Type;

// Decoration attached to a commit row. `head` marks the checked-out commit itself
// (detached or attached); `branch`/`remote`/`tag` carry the short ref name so the
// history view can render colored badges without a second refs read.
export const GitCommitRefKind = Schema.Literals(["head", "branch", "remote", "tag"]);
export type GitCommitRefKind = typeof GitCommitRefKind.Type;

export const GitCommitRef = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  kind: GitCommitRefKind,
  /**
   * True only for the local branch HEAD points at. Recorded by the parser so the
   * UI never has to infer "checked out" from decoration ordering.
   */
  checkedOut: Schema.Boolean,
});
export type GitCommitRef = typeof GitCommitRef.Type;

export const GitHistoryCommit = Schema.Struct({
  sha: TrimmedNonEmptyStringSchema,
  shortSha: TrimmedNonEmptyStringSchema,
  // Parent object ids in `%P` order. The first parent is the branch-advancing
  // parent; extra parents make this a merge commit.
  parents: Schema.Array(TrimmedNonEmptyStringSchema),
  subject: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  committedAt: Schema.String,
  refs: Schema.Array(GitCommitRef),
});
export type GitHistoryCommit = typeof GitHistoryCommit.Type;

const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
const GitDetachedWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  ref: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
const GitResolvedPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
  isDraft: Schema.Boolean,
  mergeability: GitPullRequestMergeability,
  // Null when `gh` did not report diff sizes, so the UI can hide the stat instead of
  // rendering a misleading "+0 −0".
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  changedFiles: Schema.NullOr(NonNegativeInt),
});
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type;

// Normalized CI check state combining GitHub CheckRun conclusions and commit status states.
export const GitPullRequestCheckStatus = Schema.Literals([
  "pending",
  "success",
  "failure",
  "skipped",
  "neutral",
  "cancelled",
]);
export type GitPullRequestCheckStatus = typeof GitPullRequestCheckStatus.Type;

export const GitPullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  status: GitPullRequestCheckStatus,
  url: Schema.NullOr(Schema.String),
});
export type GitPullRequestCheck = typeof GitPullRequestCheck.Type;

// Root comment of an unresolved review thread (resolved threads and replies are excluded).
export const GitPullRequestComment = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  author: Schema.NullOr(TrimmedNonEmptyStringSchema),
  body: Schema.String,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
  url: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitPullRequestComment = typeof GitPullRequestComment.Type;

// RPC Inputs

export const GitStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStatusInput = typeof GitStatusInput.Type;

export const GitHubRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitHubRepositoryInput = typeof GitHubRepositoryInput.Type;

const GIT_REV_MAX_LENGTH = 256;

// A revision names a commit, never a flag: rejecting option-like values here
// keeps client-supplied revisions from being parsed as git options.
const GitRevisionArgumentSchema = TrimmedNonEmptyStringSchema.check(
  Schema.isMaxLength(GIT_REV_MAX_LENGTH),
  Schema.isPattern(/^[^-]/),
);

export const GitReadWorkingTreeDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  scope: Schema.optional(
    Schema.Literals(["workingTree", "unstaged", "staged", "branch", "ref"]),
  ).pipe(Schema.withConstructorDefault(() => Option.some("workingTree" as const))),
  compareRef: Schema.optional(GitRevisionArgumentSchema),
  /** Limit a workingTree patch to one exact workspace-relative file. */
  filePath: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitReadWorkingTreeDiffInput = typeof GitReadWorkingTreeDiffInput.Type;

export const GitBlameLineInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  filePath: TrimmedNonEmptyStringSchema,
  line: PositiveInt,
  rev: Schema.optional(GitRevisionArgumentSchema),
  /** Blame at the branch diff's base (upstream or fallback merge base) instead of `rev`. */
  base: Schema.optional(Schema.Literal("branch")),
});
export type GitBlameLineInput = typeof GitBlameLineInput.Type;

export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitPullInput = typeof GitPullInput.Type;

export const GitFetchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitFetchInput = typeof GitFetchInput.Type;

export const GIT_READ_FILE_AT_REV_MAX_BYTES = 1_000_000;
const GIT_READ_FILE_AT_REV_PATH_MAX_LENGTH = 2048;

export const GitReadFileAtRevInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  filePath: TrimmedNonEmptyStringSchema.check(
    Schema.isMaxLength(GIT_READ_FILE_AT_REV_PATH_MAX_LENGTH),
  ),
  rev: Schema.optional(GitRevisionArgumentSchema),
  /**
   * Read the file at a base the server resolves: the branch diff's upstream or
   * fallback merge base, or the index (stage 0) for unstaged-scope diffs.
   */
  base: Schema.optional(Schema.Literals(["branch", "index"])),
  maxBytes: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_READ_FILE_AT_REV_MAX_BYTES)),
  ),
});
export type GitReadFileAtRevInput = typeof GitReadFileAtRevInput.Type;

export const GitReadFileAtRevResult = Schema.Struct({
  contents: Schema.String,
  resolvedRev: Schema.String,
  missing: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type GitReadFileAtRevResult = typeof GitReadFileAtRevResult.Type;

// Read-only diff summary requests reuse the shared git text-generation model settings.
export const GitSummarizeDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  scope: Schema.optional(Schema.Literals(["workingTree", "unstaged", "staged", "branch"])).pipe(
    Schema.withConstructorDefault(() => Option.some("workingTree" as const)),
  ),
  codexHomePath: Schema.optional(TrimmedNonEmptyStringSchema),
  providerOptions: Schema.optional(ProviderStartOptions),
  textGenerationModel: Schema.optional(TrimmedNonEmptyStringSchema).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_TEXT_GENERATION_MODEL)),
  ),
  textGenerationModelSelection: Schema.optional(ModelSelection),
});
export type GitSummarizeDiffInput = typeof GitSummarizeDiffInput.Type;

export const GitRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  // Only recovery-aware clients opt into work that survives observer loss.
  recoverable: Schema.optional(Schema.Boolean),
  // Reattach only: never start a missing action after a lost acknowledgement.
  resume: Schema.optional(Schema.Boolean),
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  // Thread the action runs for: the server links the PR it creates, or the open PR it pushes
  // to, to this thread. Omitted by callers outside a thread (and by older clients).
  threadId: Schema.optional(ThreadId),
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  // PR content overrides for create_pr/commit_push_pr; missing fields are generated.
  prTitle: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(300))),
  prBody: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(60_000))),
  prDraft: Schema.optional(Schema.Boolean),
  // The user explicitly chose to leave working-tree changes out of a push/create_pr,
  // so the dirty-tree safety guard must not reject the action.
  allowDirtyWorkingTree: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
  ),
  codexHomePath: Schema.optional(TrimmedNonEmptyStringSchema),
  providerOptions: Schema.optional(ProviderStartOptions),
  textGenerationModel: Schema.optional(TrimmedNonEmptyStringSchema).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_TEXT_GENERATION_MODEL)),
  ),
  textGenerationModelSelection: Schema.optional(ModelSelection),
});
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type;

export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitListBranchesInput = typeof GitListBranchesInput.Type;

export const DEFAULT_GIT_RECENT_COMMIT_LIMIT = 20;
// The compare-with picker shows at most a handful of rows; a hard ceiling keeps
// an untrusted client from asking `git log` for an unbounded history.
export const MAX_GIT_RECENT_COMMIT_LIMIT = 50;

export const GitListRecentCommitsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_GIT_RECENT_COMMIT_LIMIT)),
  ).pipe(Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_RECENT_COMMIT_LIMIT))),
});
export type GitListRecentCommitsInput = typeof GitListRecentCommitsInput.Type;

export const DEFAULT_GIT_COMMIT_HISTORY_LIMIT = 100;
// The history view pages `git log`; cap one page so a client cannot ask for an
// unbounded walk on a large monorepo.
export const MAX_GIT_COMMIT_HISTORY_LIMIT = 200;
// The graph walks only the refs the user selected, so every lane belongs to a chosen
// branch and resolves. The pane's lane budget (8) is far below this; the server cap
// exists so a client cannot build an unbounded `git log` command line.
export const MAX_GIT_COMMIT_HISTORY_REFS = 32;

export const GitListCommitHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_GIT_COMMIT_HISTORY_LIMIT)),
  ).pipe(Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_COMMIT_HISTORY_LIMIT))),
  // Offset into the same order the server walks, used for paging. Zero means the
  // first page; the UI only ever advances by `limit`.
  skip: Schema.optional(NonNegativeInt).pipe(Schema.withConstructorDefault(() => Option.some(0))),
  // Restrict the walk to one revision (a branch, remote branch, tag, or commit).
  // Missing means every ref, matching how a commit graph is usually browsed.
  ref: Schema.optional(GitRevisionArgumentSchema),
  // The selected set of revisions to walk together, in preference to `ref` and the
  // all-refs walk. Each entry obeys the same revision rules as `ref`; the list must
  // hold at least one entry and no more than MAX_GIT_COMMIT_HISTORY_REFS.
  refs: Schema.optional(
    Schema.Array(GitRevisionArgumentSchema).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_GIT_COMMIT_HISTORY_REFS),
    ),
  ),
  // All-refs walks include `refs/remotes/*` unless this is false, which is the
  // "Show remote branches" switch in the history toolbar.
  includeRemoteBranches: Schema.optional(Schema.Boolean),
});
export type GitListCommitHistoryInput = typeof GitListCommitHistoryInput.Type;

export const GitListCommitHistoryResult = Schema.Struct({
  commits: Schema.Array(GitHistoryCommit),
  hasMore: Schema.Boolean,
});
export type GitListCommitHistoryResult = typeof GitListCommitHistoryResult.Type;

export const GitReadCommitDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: GitRevisionArgumentSchema,
});
export type GitReadCommitDiffInput = typeof GitReadCommitDiffInput.Type;

export const GitReadCommitDiffResult = Schema.Struct({
  // The resolved commit, including decorations, so a deep-linked or reloaded
  // detail view does not depend on the list page that happened to load it.
  commit: GitHistoryCommit,
  // Full commit message; `commit.subject` is its first line.
  message: Schema.String,
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitReadCommitDiffResult = typeof GitReadCommitDiffResult.Type;

export const GitCheckoutCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: GitRevisionArgumentSchema,
});
export type GitCheckoutCommitInput = typeof GitCheckoutCommitInput.Type;

export const GitCherryPickCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: GitRevisionArgumentSchema,
});
export type GitCherryPickCommitInput = typeof GitCherryPickCommitInput.Type;

export const GitRevertCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: GitRevisionArgumentSchema,
});
export type GitRevertCommitInput = typeof GitRevertCommitInput.Type;

// Cherry-pick and revert create a new commit; returning its id and subject lets
// the UI confirm what landed without re-reading the log.
export const GitCommitActionResult = Schema.Struct({
  commitSha: TrimmedNonEmptyStringSchema,
  subject: Schema.String,
});
export type GitCommitActionResult = typeof GitCommitActionResult.Type;

// Branch-level remote and history actions offered from the Git Graph ref menu.
// Each resolves to a single git command run under the repository mutation lock.

export const GitPushBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  // The local branch to push. Flag-like values are rejected so nothing is read as an option.
  branch: GitRevisionArgumentSchema,
  // The remote the client resolved (upstream remote, else origin, else the only remote).
  // Required so the confirmed command is exactly what runs.
  remote: GitRevisionArgumentSchema,
  // Push with `-u`. The client offers it when the branch has no upstream.
  setUpstream: Schema.optional(Schema.Boolean),
  // `--force-with-lease`: overwrite the remote ref only while its tracking ref is unchanged.
  forceWithLease: Schema.optional(Schema.Boolean),
});
export type GitPushBranchInput = typeof GitPushBranchInput.Type;

export const GitPullBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  remote: GitRevisionArgumentSchema,
  // The upstream branch name to pull from `remote`.
  branch: GitRevisionArgumentSchema,
  // `--rebase` instead of the default merge.
  rebase: Schema.optional(Schema.Boolean),
});
export type GitPullBranchInput = typeof GitPullBranchInput.Type;

// The three merge options are mutually constrained by git: `--squash` cannot combine
// with `--no-ff` or `--no-commit`, so a client disables those while squash is set.
export const GitMergeBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  // The ref to merge into the current branch.
  ref: GitRevisionArgumentSchema,
  noFastForward: Schema.optional(Schema.Boolean),
  squash: Schema.optional(Schema.Boolean),
  noCommit: Schema.optional(Schema.Boolean),
});
export type GitMergeBranchInput = typeof GitMergeBranchInput.Type;

export const GitRebaseBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  // The ref the current branch is rebased onto.
  ref: GitRevisionArgumentSchema,
  // Runs `rebase -i --autosquash` with a no-op sequence editor, absorbing
  // `fixup!`/`squash!` commits without opening a real editor.
  autosquash: Schema.optional(Schema.Boolean),
});
export type GitRebaseBranchInput = typeof GitRebaseBranchInput.Type;

// Fire-and-forget ref mutations; callers refetch status and history afterwards.
export const GitBranchActionResult = Schema.Struct({ ok: Schema.Boolean });
export type GitBranchActionResult = typeof GitBranchActionResult.Type;

export const GitDeleteBranchRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  // Force deletion allows an unmerged branch; the UI only asks for it after the
  // plain delete fails.
  force: Schema.optional(Schema.Boolean),
  deleteRemote: Schema.optional(Schema.Boolean),
});
export type GitDeleteBranchRefInput = typeof GitDeleteBranchRefInput.Type;

export const GitDeleteTagRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  name: TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(255)),
  deleteRemote: Schema.optional(Schema.Boolean),
});
export type GitDeleteTagRefInput = typeof GitDeleteTagRefInput.Type;

// The remote a deletion reached, or null when only the local ref was removed.
export const GitDeleteRefResult = Schema.Struct({
  remoteName: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  /**
   * True when a plain branch delete was refused because the branch has commits not
   * merged into HEAD; nothing was deleted. The client confirms the consequence and
   * retries with `force: true`.
   */
  requiresForce: Schema.optional(Schema.Boolean),
});
export type GitDeleteRefResult = typeof GitDeleteRefResult.Type;

export const GitCreateTagInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: GitRevisionArgumentSchema,
  name: TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(255)),
  // Present means an annotated tag; missing means a lightweight tag.
  message: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
});
export type GitCreateTagInput = typeof GitCreateTagInput.Type;

export const GitCreateTagResult = Schema.Struct({ ok: Schema.Boolean });
export type GitCreateTagResult = typeof GitCreateTagResult.Type;

export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type;

export const GitCreateDetachedWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  ref: TrimmedNonEmptyStringSchema,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
  copyChangesFrom: Schema.optional(TrimmedNonEmptyStringSchema),
  // When set, the worktree is created on this new branch (pinned at `ref`)
  // instead of a detached HEAD, so threads get a branch attached from birth.
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  // Caller-chosen correlation id echoed on every setup progress event, so
  // concurrent creations can be told apart by progress subscribers.
  progressId: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitCreateDetachedWorktreeInput = typeof GitCreateDetachedWorktreeInput.Type;

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type;

export const GitPullRequestSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestSnapshotInput = typeof GitPullRequestSnapshotInput.Type;

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
});
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type;

export const GitHandoffThreadInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  cwd: TrimmedNonEmptyStringSchema,
  targetMode: GitHandoffThreadMode,
  currentBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreeBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreeRef: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredLocalBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredWorktreeBaseBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredNewWorktreeName: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitHandoffThreadInput = typeof GitHandoffThreadInput.Type;

export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
  // Automatic archive cleanup must revalidate the exact archived event on the
  // server before removing a checkout. Manual removals leave this unset.
  archiveCleanup: Schema.optional(
    Schema.Struct({
      threadId: ThreadId,
      archiveSequence: NonNegativeInt,
    }),
  ),
  // Managed worktrees are born on temporary synara/* branches. When set, a
  // removal also deletes that branch so retiring the worktree cannot strand it;
  // user-named branches are never touched. Handoff flows leave this unset
  // because they re-home the branch into the root checkout instead.
  reclaimTemporaryBranch: Schema.optional(Schema.Boolean),
});
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type;

export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  publish: Schema.optional(Schema.Boolean),
  // Revision the new branch starts at; missing means the current HEAD.
  startPoint: Schema.optional(GitRevisionArgumentSchema),
  // When true the new branch is checked out immediately; missing keeps the current
  // checkout on its HEAD and only creates the ref.
  checkout: Schema.optional(Schema.Boolean),
});
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type;

export const GitCheckoutRemoteBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  // Remote-tracking ref as shown in the graph, e.g. "origin/main".
  remoteBranch: TrimmedNonEmptyStringSchema,
});
export type GitCheckoutRemoteBranchInput = typeof GitCheckoutRemoteBranchInput.Type;

export const GitCheckoutRemoteBranchResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema,
  created: Schema.Boolean,
  updated: Schema.Boolean,
});
export type GitCheckoutRemoteBranchResult = typeof GitCheckoutRemoteBranchResult.Type;

export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCheckoutInput = typeof GitCheckoutInput.Type;

export const GitStashAndCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitStashAndCheckoutInput = typeof GitStashAndCheckoutInput.Type;

export const GitStashDropInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  stashRef: TrimmedNonEmptyStringSchema,
});
export type GitStashDropInput = typeof GitStashDropInput.Type;

export const GitStashInfoInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStashInfoInput = typeof GitStashInfoInput.Type;

// Creates a stash from the Git Graph working-tree rows. `unstaged` stashes the
// working-tree changes and leaves the index in place; `staged` stashes only the index,
// and `includeUnstaged` extends that to the whole working tree.
export const GitStashCreateInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  // Required so the stash is identifiable in `git stash list`; shown in the dialog.
  message: TrimmedNonEmptyStringSchema,
  scope: Schema.Literals(["staged", "unstaged"]),
  // Staged scope only: also stash the unstaged and untracked changes.
  includeUnstaged: Schema.optional(Schema.Boolean),
  // Unstaged scope only: also stash the staged changes instead of leaving the index.
  includeStaged: Schema.optional(Schema.Boolean),
});
export type GitStashCreateInput = typeof GitStashCreateInput.Type;

export const GitStashListInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStashListInput = typeof GitStashListInput.Type;

export const GitStashApplyInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  stashRef: TrimmedNonEmptyStringSchema,
  // `pop` drops the entry after a clean apply; `apply` always keeps it.
  mode: Schema.Literals(["apply", "pop"]),
});
export type GitStashApplyInput = typeof GitStashApplyInput.Type;

export const GitRemoveIndexLockInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitRemoveIndexLockInput = typeof GitRemoveIndexLockInput.Type;

export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitInitInput = typeof GitInitInput.Type;

export const GitStageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export type GitStageFilesInput = typeof GitStageFilesInput.Type;

export const GitUnstageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export type GitUnstageFilesInput = typeof GitUnstageFilesInput.Type;

// RPC Results

const GitStatusPr = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitStatusPrState,
  isDraft: Schema.Boolean,
  mergeability: GitPullRequestMergeability,
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  changedFiles: Schema.NullOr(NonNegativeInt),
});

export const GitStatusResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      }),
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  hasUpstream: Schema.Boolean,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  configuredPrBaseBranch: Schema.optional(TrimmedNonEmptyStringSchema.pipe(Schema.NullOr)),
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  pr: Schema.NullOr(GitStatusPr),
});
export type GitStatusResult = typeof GitStatusResult.Type;

export const GitStatusLocalResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: GitStatusResult.fields.workingTree,
});
export type GitStatusLocalResult = typeof GitStatusLocalResult.Type;

export const GitStatusRemoteResult = Schema.Struct({
  hasUpstream: Schema.Boolean,
  upstreamBranch: GitStatusResult.fields.upstreamBranch,
  configuredPrBaseBranch: GitStatusResult.fields.configuredPrBaseBranch,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  pr: Schema.NullOr(GitStatusPr),
});
export type GitStatusRemoteResult = typeof GitStatusRemoteResult.Type;

export const GitHubRepositoryResult = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      nameWithOwner: TrimmedNonEmptyStringSchema,
      url: TrimmedNonEmptyStringSchema,
    }),
  ),
  repositories: Schema.Array(
    Schema.Struct({
      nameWithOwner: TrimmedNonEmptyStringSchema,
      url: TrimmedNonEmptyStringSchema,
    }),
  ),
});
export type GitHubRepositoryResult = typeof GitHubRepositoryResult.Type;

export const GitStatusStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    local: GitStatusLocalResult,
    remote: Schema.NullOr(GitStatusRemoteResult),
  }),
  Schema.TaggedStruct("localUpdated", {
    local: GitStatusLocalResult,
  }),
  Schema.TaggedStruct("remoteUpdated", {
    remote: Schema.NullOr(GitStatusRemoteResult),
  }),
]);
export type GitStatusStreamEvent = typeof GitStatusStreamEvent.Type;

export const GitReadWorkingTreeDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitReadWorkingTreeDiffResult = typeof GitReadWorkingTreeDiffResult.Type;

export const GitBlameLineResult = Schema.Struct({
  sha: Schema.String,
  shortSha: Schema.String,
  author: Schema.String,
  authorEmail: Schema.String,
  authorTime: Schema.String,
  summary: Schema.String,
  uncommitted: Schema.Boolean,
});
export type GitBlameLineResult = typeof GitBlameLineResult.Type;

/**
 * Line counts for a scope's patch, without the patch itself.
 *
 * The `+N/-M` badge surfaces only ever needed these three numbers, and a working tree with a
 * large diff makes the patch text megabytes — sending it so the renderer can re-derive them
 * costs bandwidth and main-thread parse time proportional to the diff. `null` totals mean the
 * scope is clean.
 */
export const GitWorkingTreeDiffStatsResult = Schema.Struct({
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  fileCount: NonNegativeInt,
});
export type GitWorkingTreeDiffStatsResult = typeof GitWorkingTreeDiffStatsResult.Type;

// Stage/unstage are fire-and-forget index mutations; callers refetch status/diff.
export const GitStageFilesResult = Schema.Struct({
  ok: Schema.Boolean,
});
export type GitStageFilesResult = typeof GitStageFilesResult.Type;

export const GitUnstageFilesResult = GitStageFilesResult;
export type GitUnstageFilesResult = GitStageFilesResult;

export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
  /** Every configured remote; the branch menu falls back to the only one when there is no origin. */
  remoteNames: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema)),
});
export type GitListBranchesResult = typeof GitListBranchesResult.Type;

export const GitListRecentCommitsResult = Schema.Struct({
  commits: Schema.Array(GitRecentCommit),
});
export type GitListRecentCommitsResult = typeof GitListRecentCommitsResult.Type;

export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
});
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type;

export const GitCreateDetachedWorktreeResult = Schema.Struct({
  worktree: GitDetachedWorktree,
});
export type GitCreateDetachedWorktreeResult = typeof GitCreateDetachedWorktreeResult.Type;

// Real phases of detached-worktree creation, in execution order: create the
// branch, materialize the checkout, then copy local changes (when requested).
export const GitWorktreeSetupPhase = Schema.Literals(["branch", "worktree", "copy-changes"]);
export type GitWorktreeSetupPhase = typeof GitWorktreeSetupPhase.Type;

const GitWorktreeSetupProgressBase = Schema.Struct({
  progressId: Schema.NullOr(TrimmedNonEmptyStringSchema),
});

const GitWorktreeSetupPhaseStartedEvent = Schema.Struct({
  ...GitWorktreeSetupProgressBase.fields,
  kind: Schema.Literal("phase_started"),
  phase: GitWorktreeSetupPhase,
});
const GitWorktreeSetupCompletedEvent = Schema.Struct({
  ...GitWorktreeSetupProgressBase.fields,
  kind: Schema.Literal("completed"),
  result: GitCreateDetachedWorktreeResult,
});

export const GitWorktreeSetupProgressEvent = Schema.Union([
  GitWorktreeSetupPhaseStartedEvent,
  GitWorktreeSetupCompletedEvent,
]);
export type GitWorktreeSetupProgressEvent = typeof GitWorktreeSetupProgressEvent.Type;

export const GitStashInfoResult = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  stashRef: TrimmedNonEmptyStringSchema,
  message: TrimmedNonEmptyStringSchema,
  files: Schema.Array(TrimmedNonEmptyStringSchema),
});
export type GitStashInfoResult = typeof GitStashInfoResult.Type;

export const GitStashCreateResult = Schema.Struct({
  message: TrimmedNonEmptyStringSchema,
});
export type GitStashCreateResult = typeof GitStashCreateResult.Type;

export const GitStashEntry = Schema.Struct({
  /** Reflog selector, e.g. `stash@{0}`; the stable handle every action takes. */
  stashRef: TrimmedNonEmptyStringSchema,
  /** `git stash list` subject, e.g. `On main: wip`. */
  message: TrimmedNonEmptyStringSchema,
  /** Commit id of the stash entry. */
  sha: TrimmedNonEmptyStringSchema,
  /** Committer date, ISO-8601, for ordering and the row tooltip. */
  createdAt: TrimmedNonEmptyStringSchema,
});
export type GitStashEntry = typeof GitStashEntry.Type;

export const GitStashListResult = Schema.Struct({
  stashes: Schema.Array(GitStashEntry),
});
export type GitStashListResult = typeof GitStashListResult.Type;

// `conflicted` is a success: the stash was applied but left merge conflicts in the
// working tree, and the entry is kept so the user can resolve them and drop it.
export const GitStashApplyResult = Schema.Struct({
  status: Schema.Literals(["applied", "conflicted"]),
  detail: Schema.optional(Schema.String),
});
export type GitStashApplyResult = typeof GitStashApplyResult.Type;

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type;

// Live CI + review-comment snapshot for one PR (drives the Environment panel PR section).
export const GitPullRequestSnapshotResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  checks: Schema.Array(GitPullRequestCheck),
  comments: Schema.Array(GitPullRequestComment),
  commentsTruncated: Schema.Boolean,
  commentsError: Schema.NullOr(Schema.String),
});
export type GitPullRequestSnapshotResult = typeof GitPullRequestSnapshotResult.Type;

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type;

export const GitHandoffThreadResult = Schema.Struct({
  targetMode: GitHandoffThreadMode,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreeBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreeRef: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  changesTransferred: Schema.Boolean,
  conflictsDetected: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type GitHandoffThreadResult = typeof GitHandoffThreadResult.Type;

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
});
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type;

export const GitPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPullResult = typeof GitPullResult.Type;

export const GitFetchResult = Schema.Struct({
  remote: TrimmedNonEmptyStringSchema,
});
export type GitFetchResult = typeof GitFetchResult.Type;

export const GitSummarizeDiffResult = Schema.Struct({
  summary: TrimmedNonEmptyStringSchema,
});
export type GitSummarizeDiffResult = typeof GitSummarizeDiffResult.Type;

const GitActionProgressBase = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
});

const GitActionStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_started"),
  phases: Schema.Array(GitActionProgressPhase),
});
const GitActionPhaseStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("phase_started"),
  phase: GitActionProgressPhase,
  label: TrimmedNonEmptyStringSchema,
});
const GitActionHookStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_started"),
  hookName: TrimmedNonEmptyStringSchema,
});
const GitActionHookOutputEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_output"),
  hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  stream: GitActionProgressStream,
  text: TrimmedNonEmptyStringSchema,
});
const GitActionHookFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_finished"),
  hookName: TrimmedNonEmptyStringSchema,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(NonNegativeInt),
});
const GitActionFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_finished"),
  result: GitRunStackedActionResult,
});
const GitActionFailedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_failed"),
  phase: Schema.NullOr(GitActionProgressPhase),
  message: TrimmedNonEmptyStringSchema,
});

export const GitActionProgressEvent = Schema.Union([
  GitActionStartedEvent,
  GitActionPhaseStartedEvent,
  GitActionHookStartedEvent,
  GitActionHookOutputEvent,
  GitActionHookFinishedEvent,
  GitActionFinishedEvent,
  GitActionFailedEvent,
]);
export type GitActionProgressEvent = typeof GitActionProgressEvent.Type;
