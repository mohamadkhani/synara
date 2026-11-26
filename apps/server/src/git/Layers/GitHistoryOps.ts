// FILE: GitHistoryOps.ts
// Purpose: The commit-history and ref operations: paged `git log` reads, one commit's
//          metadata and patch, detached and remote-tracking checkouts, cherry-pick,
//          revert, tag creation, and ref deletion. They share one shape — resolve a
//          revision, run a single git command, map its failure — so they live together
//          instead of growing the core Git layer.
// Layer: Server Git layer
//
// The core layer builds these once and spreads them into its own shape; every helper
// they need (command execution, revision resolution, the shared failure builders) is
// injected, so this module has no runtime dependency on GitCore.ts.

import { Effect, Result } from "effect";

import {
  DEFAULT_GIT_COMMIT_HISTORY_LIMIT,
  MAX_GIT_COMMIT_HISTORY_LIMIT,
  type GitBranchActionResult,
  type GitCheckoutRemoteBranchResult,
  type GitCommitActionResult,
  type GitCreateTagResult,
  type GitDeleteRefResult,
  type GitHistoryCommit,
  type GitListCommitHistoryResult,
  type GitPullResult,
  type GitReadCommitDiffResult,
  type GitStashApplyResult,
  type GitStashCreateResult,
  type GitStashListResult,
} from "@synara/contracts";

import { GitCheckoutDirtyWorktreeError, GitCommandError } from "../Errors.ts";
import { CHECKPOINT_REFS_PREFIX } from "../../checkpointing/Utils.ts";
import {
  COMMIT_HISTORY_DETAIL_FORMAT,
  COMMIT_HISTORY_FIELD_SEPARATOR,
  COMMIT_HISTORY_LIST_FORMAT,
  parseCommitDetailLog,
  parseCommitHistoryLog,
} from "../gitHistoryParsing.ts";
import type { ExecuteGitOptions } from "./GitCore.ts";
import type { ExecuteGitResult, GitCoreShape } from "../Services/GitCore.ts";

const UNMERGED_BRANCH_REFUSAL_PATTERN = /not fully merged/i;

/** True when `git branch -d` refused because the branch is not merged into HEAD. */
export function isUnmergedBranchRefusal(error: GitCommandError): boolean {
  return UNMERGED_BRANCH_REFUSAL_PATTERN.test(`${error.detail}\n${error.message}`);
}

/** Widens a plain boolean into the branch-deletion outcome shape both paths share. */
function branchDeletionOutcome(requiresForce: boolean): { requiresForce: boolean } {
  return { requiresForce };
}

export interface GitHistoryOpsDeps {
  executeGit: (
    operation: string,
    cwd: string,
    args: readonly string[],
    options?: ExecuteGitOptions,
  ) => Effect.Effect<ExecuteGitResult, GitCommandError>;
  resolveCommitObjectId: (
    cwd: string,
    rev: string,
    operation: string,
  ) => Effect.Effect<string, GitCommandError>;
  commitActionFailure: (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    stderr: string,
    fallback: string,
  ) => GitCommandError;
  assertUsableRefName: (
    cwd: string,
    kind: "branch" | "tag",
    name: string,
  ) => Effect.Effect<void, GitCommandError>;
  checkoutBranch: GitCoreShape["checkoutBranch"];
  deleteBranch: GitCoreShape["deleteBranch"];
  /** Precondition read for the dirty-working-tree guard and the current branch name. */
  readActionStatus: GitCoreShape["readActionStatus"];
  resolvePushRemoteName: (
    cwd: string,
    branch: string,
  ) => Effect.Effect<string | null, GitCommandError>;
  createGitCommandError: (
    operation: string,
    cwd: string,
    args: readonly string[],
    detail: string,
    cause?: unknown,
  ) => GitCommandError;
  parseDirtyWorktreeFiles: (stderr: string) => string[] | null;
  /** True when a failure means the checkout itself is gone. */
  isMissingGitCwdError: (error: GitCommandError) => boolean;
  /** Timeout/output options shared by every ref mutation. */
  mutationOptions: ExecuteGitOptions;
}

export function makeGitHistoryOps(deps: GitHistoryOpsDeps): {
  listCommitHistory: GitCoreShape["listCommitHistory"];
  readCommitDiff: GitCoreShape["readCommitDiff"];
  checkoutCommit: GitCoreShape["checkoutCommit"];
  checkoutRemoteBranch: GitCoreShape["checkoutRemoteBranch"];
  cherryPickCommit: GitCoreShape["cherryPickCommit"];
  revertCommit: GitCoreShape["revertCommit"];
  createTag: GitCoreShape["createTag"];
  deleteBranchRef: GitCoreShape["deleteBranchRef"];
  deleteTagRef: GitCoreShape["deleteTagRef"];
  pushBranch: GitCoreShape["pushBranch"];
  pullBranch: GitCoreShape["pullBranch"];
  mergeBranch: GitCoreShape["mergeBranch"];
  rebaseBranch: GitCoreShape["rebaseBranch"];
  stashCreate: GitCoreShape["stashCreate"];
  stashList: GitCoreShape["stashList"];
  stashApply: GitCoreShape["stashApply"];
} {
  const {
    executeGit,
    resolveCommitObjectId,
    commitActionFailure,
    assertUsableRefName,
    checkoutBranch,
    deleteBranch,
    readActionStatus,
    resolvePushRemoteName,
    createGitCommandError,
    parseDirtyWorktreeFiles,
    isMissingGitCwdError,
    mutationOptions,
  } = deps;

  // Lines Git prints when `stash apply`/`pop` leaves merge conflicts behind. Git reports
  // a conflicted apply on stdout ("Auto-merging ...", "CONFLICT ..."), so both streams
  // are searched.
  const CONFLICT_MARKERS = ["CONFLICT (", "Merge conflict in", "Automatic merge failed"];

  const COMMIT_HISTORY_PATCH_MAX_OUTPUT_BYTES = 10_000_000;
  const COMMIT_HISTORY_TIMEOUT_MS = 20_000;
  // Exit codes that mean "there is no page to show", not "the read failed":
  // an unborn branch has no commits yet, and a removed checkout has no repo.
  const COMMIT_HISTORY_EMPTY_STDERR_FRAGMENTS = [
    "does not have any commits yet",
    "not a git repository",
  ];

  const isEmptyCommitHistoryError = (stderr: string): boolean => {
    const normalized = stderr.toLowerCase();
    return COMMIT_HISTORY_EMPTY_STDERR_FRAGMENTS.some((fragment) => normalized.includes(fragment));
  };

  const listCommitHistory: GitCoreShape["listCommitHistory"] = (input) =>
    Effect.gen(function* () {
      const requestedLimit = input.limit ?? DEFAULT_GIT_COMMIT_HISTORY_LIMIT;
      const limit = Math.min(Math.max(requestedLimit, 1), MAX_GIT_COMMIT_HISTORY_LIMIT);
      const skip = Math.max(input.skip ?? 0, 0);
      const ref = input.ref?.trim() ?? "";

      // Resolve a caller-supplied revision first so an unknown ref reports a real
      // error instead of silently walking HEAD, and so option-like values never
      // reach `git log` as arguments.
      const resolvedRef =
        ref.length > 0
          ? yield* resolveCommitObjectId(input.cwd, ref, "GitCore.listCommitHistory")
          : null;

      const args = [
        "log",
        // `--date-order` keeps the guarantee the lane layout needs (no parent
        // before its children) and is cheaper than a full topological sort, which
        // matters because a refresh that does re-walk the loaded pages pays it
        // again for every page.
        "--date-order",
        "--decorate=full",
        "--no-color",
        "--no-show-signature",
        `--format=${COMMIT_HISTORY_LIST_FORMAT}`,
        "-n",
        String(limit + 1),
        "--skip",
        String(skip),
        // Synara's turn checkpoints live under refs/synara/checkpoints. They are
        // local snapshots for diff/rewind, not branches a user browses, so keep
        // them out of the graph instead of flooding it with snapshot commits.
        // `--all` also walks refs/notes, refs/replace, and refs/bisect, which would
        // surface unrelated commits such as "Notes added by 'git notes add'" as
        // graph roots, so exclude those namespaces too. HEAD stays included for a
        // detached checkout.
        ...(resolvedRef === null
          ? [
              "--exclude=refs/stash",
              `--exclude=${CHECKPOINT_REFS_PREFIX}/*`,
              "--exclude=refs/notes/*",
              "--exclude=refs/replace/*",
              "--exclude=refs/bisect/*",
              "--all",
            ]
          : [resolvedRef]),
        "--",
      ];

      const result = yield* executeGit("GitCore.listCommitHistory", input.cwd, args, {
        timeoutMs: COMMIT_HISTORY_TIMEOUT_MS,
        maxOutputBytes: 8 * 1024 * 1024,
        outputMode: "truncate",
        allowNonZeroExit: true,
      }).pipe(
        Effect.catchIf(isMissingGitCwdError, () =>
          Effect.succeed({
            code: 128,
            stdout: "",
            stderr: "fatal: not a git repository",
            stdoutTruncated: false,
          }),
        ),
      );

      // An unborn branch or a removed checkout has no page worth showing; any other
      // non-zero exit (lock, permissions, corrupt object store) is a real failure the
      // caller must see instead of an empty graph.
      if (result.code !== 0) {
        if (isEmptyCommitHistoryError(result.stderr)) {
          return { commits: [], hasMore: false } satisfies GitListCommitHistoryResult;
        }
        return yield* createGitCommandError(
          "GitCore.listCommitHistory",
          input.cwd,
          args,
          result.stderr.trim() || "git log failed",
        );
      }

      const parsed = parseCommitHistoryLog(result.stdout);
      // Truncated output can cut the last record mid-field, so drop it; the cap was
      // hit, which already proves there is more history to page through.
      const complete = result.stdoutTruncated === true ? parsed.slice(0, -1) : parsed;
      return {
        commits: complete.slice(0, limit),
        hasMore: complete.length > limit || result.stdoutTruncated === true,
      } satisfies GitListCommitHistoryResult;
    });

  const readCommitDiff: GitCoreShape["readCommitDiff"] = (input) =>
    Effect.gen(function* () {
      const resolvedSha = yield* resolveCommitObjectId(
        input.cwd,
        input.sha,
        "GitCore.readCommitDiff",
      );

      const detailOutput = yield* executeGit(
        "GitCore.readCommitDiff.metadata",
        input.cwd,
        [
          "log",
          "-1",
          "--decorate=full",
          "--no-color",
          "--no-show-signature",
          `--format=${COMMIT_HISTORY_DETAIL_FORMAT}`,
          resolvedSha,
          "--",
        ],
        {
          timeoutMs: COMMIT_HISTORY_TIMEOUT_MS,
          maxOutputBytes: COMMIT_HISTORY_PATCH_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
          allowNonZeroExit: true,
        },
      );
      const detail = parseCommitDetailLog(detailOutput.stdout);
      if (detailOutput.code !== 0 || detail === null) {
        return yield* createGitCommandError(
          "GitCore.readCommitDiff.metadata",
          input.cwd,
          ["log", "-1", resolvedSha],
          detailOutput.stderr.trim() || `Commit ${input.sha} could not be read.`,
        );
      }

      // A merge commit has no single patch; show what it brought in relative to
      // its first parent, which is the branch that was merged into.
      const patchArgs =
        detail.commit.parents.length > 1
          ? [
              "diff",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "--src-prefix=a/",
              "--dst-prefix=b/",
              `${resolvedSha}^1`,
              resolvedSha,
              "--",
            ]
          : [
              "show",
              "--format=",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "--no-show-signature",
              "--src-prefix=a/",
              "--dst-prefix=b/",
              resolvedSha,
              "--",
            ];

      const patchOutput = yield* executeGit("GitCore.readCommitDiff.patch", input.cwd, patchArgs, {
        timeoutMs: COMMIT_HISTORY_TIMEOUT_MS,
        maxOutputBytes: COMMIT_HISTORY_PATCH_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      });

      return {
        commit: detail.commit satisfies GitHistoryCommit,
        message: detail.message,
        patch: patchOutput.stdout,
        truncated: patchOutput.stdoutTruncated === true,
      } satisfies GitReadCommitDiffResult;
    });

  const checkoutRemoteBranch: GitCoreShape["checkoutRemoteBranch"] = (input) =>
    Effect.gen(function* () {
      const remoteBranch = input.remoteBranch.trim();
      const separator = remoteBranch.indexOf("/");
      if (separator <= 0 || separator === remoteBranch.length - 1) {
        return yield* createGitCommandError(
          "GitCore.checkoutRemoteBranch",
          input.cwd,
          ["checkout", remoteBranch],
          `"${remoteBranch}" is not a remote-tracking branch.`,
        );
      }
      const remoteName = remoteBranch.slice(0, separator);
      const branchName = remoteBranch.slice(separator + 1);
      // A remote-tracking ref names a remote and a branch; a leading dash in either
      // would be read as an option by the fetch/merge commands below.
      if (remoteName.startsWith("-") || branchName.startsWith("-")) {
        return yield* createGitCommandError(
          "GitCore.checkoutRemoteBranch",
          input.cwd,
          ["checkout", remoteBranch],
          `"${remoteBranch}" is not a remote-tracking branch.`,
        );
      }
      const remoteRef = `refs/remotes/${remoteName}/${branchName}`;
      const localRef = `refs/heads/${branchName}`;

      const remoteExists = yield* executeGit(
        "GitCore.checkoutRemoteBranch.remoteExists",
        input.cwd,
        ["show-ref", "--verify", "--quiet", remoteRef],
        { timeoutMs: 5_000, allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));
      if (!remoteExists) {
        return yield* createGitCommandError(
          "GitCore.checkoutRemoteBranch.remoteExists",
          input.cwd,
          ["show-ref", remoteRef],
          `Remote branch "${remoteBranch}" does not exist.`,
        );
      }

      // Refresh the tracking ref before deciding anything about the local branch,
      // so the fast-forward uses what the remote has right now. The existence wait
      // above runs first only to turn a missing branch into a clear message.
      yield* executeGit(
        "GitCore.checkoutRemoteBranch.fetch",
        input.cwd,
        ["fetch", "--", remoteName, branchName],
        { ...mutationOptions, fallbackErrorMessage: "git fetch failed" },
      );

      const localExists = yield* executeGit(
        "GitCore.checkoutRemoteBranch.localExists",
        input.cwd,
        ["show-ref", "--verify", "--quiet", localRef],
        { timeoutMs: 5_000, allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));

      if (!localExists) {
        const args = ["checkout", "-b", branchName, "--track", `${remoteName}/${branchName}`];
        const result = yield* executeGit(
          "GitCore.checkoutRemoteBranch.createTracking",
          input.cwd,
          args,
          { timeoutMs: 30_000, allowNonZeroExit: true },
        );
        if (result.code !== 0) {
          const conflictingFiles = parseDirtyWorktreeFiles(result.stderr);
          if (conflictingFiles) {
            return yield* new GitCheckoutDirtyWorktreeError({
              branch: branchName,
              cwd: input.cwd,
              conflictingFiles,
            });
          }
          return yield* createGitCommandError(
            "GitCore.checkoutRemoteBranch.createTracking",
            input.cwd,
            args,
            result.stderr.trim() || "git checkout failed",
          );
        }
        return {
          branch: branchName,
          created: true,
          updated: true,
        } satisfies GitCheckoutRemoteBranchResult;
      }

      // Never merge a diverged history implicitly: tell the user instead of
      // creating a merge commit or detaching onto the remote tip.
      const canFastForward = yield* executeGit(
        "GitCore.checkoutRemoteBranch.ancestor",
        input.cwd,
        ["merge-base", "--is-ancestor", localRef, remoteRef],
        { timeoutMs: 10_000, allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));
      if (!canFastForward) {
        return yield* createGitCommandError(
          "GitCore.checkoutRemoteBranch.ancestor",
          input.cwd,
          ["merge-base", "--is-ancestor", localRef, remoteRef],
          `Local branch "${branchName}" has diverged from ${remoteBranch}. Check it out and pull manually.`,
        );
      }

      yield* checkoutBranch({ cwd: input.cwd, branch: branchName });
      yield* executeGit(
        "GitCore.checkoutRemoteBranch.fastForward",
        input.cwd,
        ["merge", "--ff-only", `${remoteName}/${branchName}`],
        { ...mutationOptions, fallbackErrorMessage: "git merge --ff-only failed" },
      );

      return {
        branch: branchName,
        created: false,
        updated: true,
      } satisfies GitCheckoutRemoteBranchResult;
    });

  const checkoutCommit: GitCoreShape["checkoutCommit"] = (input) =>
    Effect.gen(function* () {
      const resolvedSha = yield* resolveCommitObjectId(
        input.cwd,
        input.sha,
        "GitCore.checkoutCommit",
      );
      const args = ["checkout", "--detach", resolvedSha];
      const result = yield* executeGit("GitCore.checkoutCommit.checkout", input.cwd, args, {
        timeoutMs: 30_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git checkout failed",
      });
      if (result.code !== 0) {
        const conflictingFiles = parseDirtyWorktreeFiles(result.stderr);
        if (conflictingFiles) {
          return yield* new GitCheckoutDirtyWorktreeError({
            branch: `commit ${input.sha}`,
            cwd: input.cwd,
            conflictingFiles,
          });
        }
        return yield* commitActionFailure(
          "GitCore.checkoutCommit.checkout",
          input.cwd,
          args,
          result.stderr,
          "git checkout failed",
        );
      }
    });

  const readHeadCommitActionResult = (cwd: string, operation: string) =>
    executeGit(operation, cwd, [
      "log",
      "-1",
      "--no-show-signature",
      "--format=%H%x1f%s",
      "HEAD",
      "--",
    ]).pipe(
      Effect.map((result): GitCommitActionResult => {
        const [commitSha = "", subject = ""] = result.stdout
          .trim()
          .split(COMMIT_HISTORY_FIELD_SEPARATOR);
        return { commitSha, subject };
      }),
    );

  const cherryPickCommit: GitCoreShape["cherryPickCommit"] = (input) =>
    Effect.gen(function* () {
      const resolvedSha = yield* resolveCommitObjectId(
        input.cwd,
        input.sha,
        "GitCore.cherryPickCommit",
      );
      const args = ["cherry-pick", "--no-edit", resolvedSha];
      const result = yield* executeGit("GitCore.cherryPickCommit", input.cwd, args, {
        timeoutMs: 120_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git cherry-pick failed",
      });
      if (result.code !== 0) {
        // A conflict leaves CHERRY_PICK_HEAD behind on purpose: the message tells
        // the user to resolve it (or abort) rather than pretending nothing applied.
        return yield* commitActionFailure(
          "GitCore.cherryPickCommit",
          input.cwd,
          args,
          result.stderr,
          "git cherry-pick failed",
        );
      }
      return yield* readHeadCommitActionResult(input.cwd, "GitCore.cherryPickCommit.head");
    });

  const revertCommit: GitCoreShape["revertCommit"] = (input) =>
    Effect.gen(function* () {
      const resolvedSha = yield* resolveCommitObjectId(
        input.cwd,
        input.sha,
        "GitCore.revertCommit",
      );
      const args = ["revert", "--no-edit", resolvedSha];
      const result = yield* executeGit("GitCore.revertCommit", input.cwd, args, {
        timeoutMs: 120_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git revert failed",
      });
      if (result.code !== 0) {
        return yield* commitActionFailure(
          "GitCore.revertCommit",
          input.cwd,
          args,
          result.stderr,
          "git revert failed",
        );
      }
      return yield* readHeadCommitActionResult(input.cwd, "GitCore.revertCommit.head");
    });

  const createTag: GitCoreShape["createTag"] = (input) =>
    Effect.gen(function* () {
      const name = input.name.trim();
      yield* assertUsableRefName(input.cwd, "tag", name);
      const resolvedSha = yield* resolveCommitObjectId(input.cwd, input.sha, "GitCore.createTag");
      const message = input.message?.trim();
      const args = [
        "tag",
        ...(message && message.length > 0 ? ["-a", "-m", message] : []),
        "--",
        name,
        resolvedSha,
      ];
      const result = yield* executeGit("GitCore.createTag", input.cwd, args, {
        timeoutMs: 15_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git tag failed",
      });
      if (result.code !== 0) {
        return yield* commitActionFailure(
          "GitCore.createTag",
          input.cwd,
          args,
          result.stderr,
          "git tag failed",
        );
      }
      return { ok: true } satisfies GitCreateTagResult;
    });

  const noRemoteForDeletionError = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    createGitCommandError(
      operation,
      cwd,
      args,
      "Cannot delete the remote ref because no git remote is configured for this repository.",
    );

  /**
   * Deletes the local ref first on purpose: that is the step git itself guards
   * (an unmerged branch refuses without `force`), so a refusal leaves both sides
   * untouched. When the remote push then fails, the error names the half-done
   * state instead of leaving the user to guess.
   */
  const partialRemoteDeletionError = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    stderr: string,
    localRef: string,
  ) =>
    createGitCommandError(
      operation,
      cwd,
      args,
      `${stderr.trim() || "git push failed"} The local ${localRef} was already deleted; its remote copy remains.`,
    );

  /** True when the branch's tree is identical to HEAD's, so deleting it drops no content. */
  const branchContentMatchesHead = (cwd: string, branch: string) =>
    executeGit(
      "GitCore.deleteBranchRef.contentCheck",
      cwd,
      ["diff", "--quiet", branch, "HEAD", "--"],
      { timeoutMs: 10_000, allowNonZeroExit: true },
    ).pipe(Effect.map((result) => result.code === 0));

  /**
   * Deletes a local branch, stopping for confirmation before dropping unmerged work.
   *
   * `git branch -d` refuses a branch that is not merged into HEAD. When the branch's
   * tree already matches HEAD (a branch created at a snapshot commit) the refusal is
   * pure bookkeeping and the delete finishes by force. Otherwise a plain delete stops
   * and reports `requiresForce`, so the caller can warn the user and retry with
   * `force: true` instead of dropping commits silently.
   */
  const deleteBranchLocally = (
    cwd: string,
    branch: string,
    force: boolean | undefined,
  ): Effect.Effect<{ requiresForce: boolean }, GitCommandError> => {
    if (force === true) {
      return deleteBranch({ cwd, branch, force: true }).pipe(
        Effect.as(branchDeletionOutcome(false)),
      );
    }
    return Effect.result(deleteBranch({ cwd, branch, force })).pipe(
      Effect.flatMap((attempt) => {
        if (Result.isSuccess(attempt)) return Effect.succeed(branchDeletionOutcome(false));
        if (!isUnmergedBranchRefusal(attempt.failure)) return Effect.fail(attempt.failure);
        return branchContentMatchesHead(cwd, branch).pipe(
          Effect.flatMap((matchesHead) =>
            matchesHead
              ? deleteBranch({ cwd, branch, force: true }).pipe(
                  Effect.as(branchDeletionOutcome(false)),
                )
              : Effect.succeed(branchDeletionOutcome(true)),
          ),
        );
      }),
    );
  };

  const deleteBranchRef: GitCoreShape["deleteBranchRef"] = (input) =>
    Effect.gen(function* () {
      yield* assertUsableRefName(input.cwd, "branch", input.branch);
      const local = yield* deleteBranchLocally(input.cwd, input.branch, input.force);
      if (local.requiresForce) {
        // Nothing was deleted: the branch has commits that are not merged into HEAD,
        // so the caller must confirm and retry with `force: true`.
        return { remoteName: null, requiresForce: true } satisfies GitDeleteRefResult;
      }
      if (input.deleteRemote !== true) {
        return { remoteName: null, requiresForce: false } satisfies GitDeleteRefResult;
      }

      const remoteName = yield* resolvePushRemoteName(input.cwd, input.branch);
      if (remoteName === null || remoteName.length === 0) {
        return yield* noRemoteForDeletionError("GitCore.deleteBranchRef.remote", input.cwd, [
          "push",
          "--delete",
          "--",
          input.branch,
        ]);
      }
      const args = ["push", remoteName, "--delete", "--", input.branch];
      const result = yield* executeGit("GitCore.deleteBranchRef.remote", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        return yield* partialRemoteDeletionError(
          "GitCore.deleteBranchRef.remote",
          input.cwd,
          args,
          result.stderr,
          `branch "${input.branch}"`,
        );
      }
      return { remoteName, requiresForce: false } satisfies GitDeleteRefResult;
    });

  const deleteTagRef: GitCoreShape["deleteTagRef"] = (input) =>
    Effect.gen(function* () {
      const name = input.name.trim();
      yield* assertUsableRefName(input.cwd, "tag", name);
      yield* executeGit("GitCore.deleteTagRef", input.cwd, ["tag", "-d", "--", name], {
        timeoutMs: 15_000,
        fallbackErrorMessage: "git tag delete failed",
      });

      if (input.deleteRemote !== true) {
        return { remoteName: null } satisfies GitDeleteRefResult;
      }

      const remoteName = yield* resolvePushRemoteName(input.cwd, name);
      if (remoteName === null || remoteName.length === 0) {
        return yield* noRemoteForDeletionError("GitCore.deleteTagRef.remote", input.cwd, [
          "push",
          "--",
          `:refs/tags/${name}`,
        ]);
      }
      const args = ["push", remoteName, "--", `:refs/tags/${name}`];
      const result = yield* executeGit("GitCore.deleteTagRef.remote", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        return yield* partialRemoteDeletionError(
          "GitCore.deleteTagRef.remote",
          input.cwd,
          args,
          result.stderr,
          `tag "${name}"`,
        );
      }
      return { remoteName } satisfies GitDeleteRefResult;
    });

  /** Reads HEAD's object id; empty when the branch is unborn. */
  const readHeadObjectId = (operation: string, cwd: string) =>
    executeGit(operation, cwd, ["rev-parse", "HEAD"], {
      timeoutMs: 5_000,
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.stdout.trim()));

  /**
   * The checked-out branch name, or empty on a detached HEAD. Pull reads the branch this
   * way instead of `readActionStatus`, whose upstream refresh would fetch at the same time
   * as the pull's own fetch and race on the remote-tracking ref lock.
   */
  const readCurrentBranchName = (operation: string, cwd: string) =>
    executeGit(operation, cwd, ["symbolic-ref", "--short", "-q", "HEAD"], {
      timeoutMs: 5_000,
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")));

  /**
   * Clears an in-progress merge/rebase after a failed action so the working tree is
   * left clean. The abort is best-effort: when the failure never created that state
   * (a rejected push-style refusal, a dirty-tree rejection) the command errors and is
   * ignored, and the original failure is what the caller reports.
   */
  const abortGitOperation = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    executeGit(operation, cwd, args, { ...mutationOptions, allowNonZeroExit: true }).pipe(
      Effect.catch(() => Effect.void),
      Effect.asVoid,
    );

  /** Merge and rebase must not run over uncommitted work; git would refuse or straddle it. */
  const assertCleanWorkingTree = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
  ): Effect.Effect<void, GitCommandError> =>
    Effect.gen(function* () {
      const status = yield* readActionStatus(cwd);
      if (status.hasWorkingTreeChanges) {
        return yield* createGitCommandError(
          operation,
          cwd,
          args,
          "Commit or stash your changes before merging or rebasing.",
        );
      }
    });

  const pushBranch: GitCoreShape["pushBranch"] = (input) =>
    Effect.gen(function* () {
      const args = [
        "push",
        ...(input.setUpstream === true ? ["--set-upstream"] : []),
        ...(input.forceWithLease === true ? ["--force-with-lease"] : []),
        input.remote,
        input.branch,
      ];
      const result = yield* executeGit("GitCore.pushBranch", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        return yield* commitActionFailure(
          "GitCore.pushBranch",
          input.cwd,
          args,
          result.stderr,
          "git push failed",
        );
      }
      return { ok: true } satisfies GitBranchActionResult;
    });

  const pullBranch: GitCoreShape["pullBranch"] = (input) =>
    Effect.gen(function* () {
      const branch = yield* readCurrentBranchName("GitCore.pullBranch.branch", input.cwd);
      if (!branch) {
        return yield* createGitCommandError(
          "GitCore.pullBranch",
          input.cwd,
          ["pull"],
          "Cannot pull from detached HEAD.",
        );
      }
      const rebase = input.rebase === true;
      const args = ["pull", ...(rebase ? ["--rebase"] : []), input.remote, input.branch];
      const beforeSha = yield* readHeadObjectId("GitCore.pullBranch.beforeSha", input.cwd);
      const result = yield* executeGit("GitCore.pullBranch", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        yield* abortGitOperation(
          "GitCore.pullBranch.abort",
          input.cwd,
          rebase ? ["rebase", "--abort"] : ["merge", "--abort"],
        );
        return yield* commitActionFailure(
          "GitCore.pullBranch",
          input.cwd,
          args,
          result.stderr,
          "git pull failed",
        );
      }
      const afterSha = yield* readHeadObjectId("GitCore.pullBranch.afterSha", input.cwd);
      return {
        status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
        branch,
        upstreamBranch: `${input.remote}/${input.branch}`,
      } satisfies GitPullResult;
    });

  const mergeBranch: GitCoreShape["mergeBranch"] = (input) =>
    Effect.gen(function* () {
      // `--squash` cannot combine with `--no-ff` or `--no-commit`; the caller disables
      // those while squash is set, and this never emits an invalid combination.
      const squash = input.squash === true;
      const args = [
        "merge",
        ...(squash ? ["--squash"] : []),
        ...(!squash && input.noFastForward === true ? ["--no-ff"] : []),
        ...(!squash && input.noCommit === true ? ["--no-commit"] : []),
        input.ref,
      ];
      yield* assertCleanWorkingTree("GitCore.mergeBranch.dirtyCheck", input.cwd, args);
      const result = yield* executeGit("GitCore.mergeBranch", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        // `--squash` never writes MERGE_HEAD, so `merge --abort` refuses and the conflicts
        // would stay in the tree. The tree was clean before this command, so resetting to
        // HEAD discards exactly this merge's work.
        yield* abortGitOperation(
          "GitCore.mergeBranch.abort",
          input.cwd,
          squash ? ["reset", "--merge", "HEAD"] : ["merge", "--abort"],
        );
        return yield* commitActionFailure(
          "GitCore.mergeBranch",
          input.cwd,
          args,
          result.stderr,
          "git merge failed",
        );
      }
      return { ok: true } satisfies GitBranchActionResult;
    });

  const rebaseBranch: GitCoreShape["rebaseBranch"] = (input) =>
    Effect.gen(function* () {
      const autosquash = input.autosquash === true;
      // A GUI has no terminal editor, so autosquash runs `rebase -i` with a no-op
      // sequence editor: autosquash rewrites the todo list, the editor accepts it,
      // and GIT_EDITOR covers the combined message of a `squash!` commit.
      const args = autosquash
        ? ["rebase", "--interactive", "--autosquash", input.ref]
        : ["rebase", input.ref];
      yield* assertCleanWorkingTree("GitCore.rebaseBranch.dirtyCheck", input.cwd, args);
      const result = yield* executeGit("GitCore.rebaseBranch", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
        ...(autosquash ? { env: { GIT_SEQUENCE_EDITOR: "true", GIT_EDITOR: "true" } } : {}),
      });
      if (result.code !== 0) {
        yield* abortGitOperation("GitCore.rebaseBranch.abort", input.cwd, ["rebase", "--abort"]);
        return yield* commitActionFailure(
          "GitCore.rebaseBranch",
          input.cwd,
          args,
          result.stderr,
          "git rebase failed",
        );
      }
      return { ok: true } satisfies GitBranchActionResult;
    });

  /**
   * Whether the index and the working tree hold changes the stash rows can act on, and
   * whether any file has staged and unstaged edits at once. That last case is the one
   * `git stash push --staged` cannot split: it saves the stash, then fails to restore the
   * worktree, so the caller rejects it before git runs.
   */
  const readStashPresence = (operation: string, cwd: string) =>
    Effect.gen(function* () {
      const staged = yield* executeGit(operation, cwd, ["diff", "--cached", "--quiet"], {
        timeoutMs: 10_000,
        allowNonZeroExit: true,
      });
      const unstaged = yield* executeGit(operation, cwd, ["diff", "--quiet"], {
        timeoutMs: 10_000,
        allowNonZeroExit: true,
      });
      const untracked = yield* executeGit(
        operation,
        cwd,
        ["ls-files", "--others", "--exclude-standard"],
        { timeoutMs: 10_000, allowNonZeroExit: true },
      );
      const status = yield* executeGit(
        operation,
        cwd,
        ["status", "--porcelain=v1", "--untracked-files=no"],
        { timeoutMs: 10_000, allowNonZeroExit: true },
      );
      // A porcelain row is XY where X is the index and Y the worktree; both set on one
      // path means a staged and an unstaged edit share a file.
      const hasMixedChanges = status.stdout
        .split("\n")
        .some((line) => line.length > 1 && line[0] !== " " && line[1] !== " ");
      // `git diff --quiet` exits 1 exactly when there is something to stash.
      return {
        hasStaged: staged.code === 1,
        hasUnstaged:
          unstaged.code === 1 || (untracked.code === 0 && untracked.stdout.trim().length > 0),
        hasMixedChanges,
      };
    });

  /** Object id of the newest stash entry, or empty when there is none. */
  const readStashObjectId = (operation: string, cwd: string) =>
    executeGit(operation, cwd, ["rev-parse", "--verify", "--quiet", "refs/stash"], {
      timeoutMs: 5_000,
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")));

  const stashCreate: GitCoreShape["stashCreate"] = (input) =>
    Effect.gen(function* () {
      const stagedOnly = input.scope === "staged" && input.includeUnstaged !== true;
      const unstagedKeepsIndex = input.scope === "unstaged" && input.includeStaged !== true;
      const args =
        input.scope === "unstaged"
          ? // Without "include staged", keep the index where it is: the unstaged changes
            // leave the working tree and the staged ones stay visible, which is what the
            // row promises. With it, the whole tree is stashed.
            unstagedKeepsIndex
            ? ["stash", "push", "--keep-index", "--include-untracked", "-m", input.message]
            : ["stash", "push", "--include-untracked", "-m", input.message]
          : stagedOnly
            ? ["stash", "push", "--staged", "-m", input.message]
            : ["stash", "push", "--include-untracked", "-m", input.message];

      const presence = yield* readStashPresence("GitCore.stashCreate.presence", input.cwd);
      if (stagedOnly && !presence.hasStaged) {
        return yield* createGitCommandError(
          "GitCore.stashCreate",
          input.cwd,
          args,
          "There are no staged changes to stash.",
        );
      }
      if (stagedOnly && presence.hasMixedChanges) {
        return yield* createGitCommandError(
          "GitCore.stashCreate",
          input.cwd,
          args,
          "Git cannot stash only the staged changes while a file also has unstaged edits. Include unstaged changes, or stash the unstaged changes first.",
        );
      }
      if (unstagedKeepsIndex && !presence.hasUnstaged) {
        return yield* createGitCommandError(
          "GitCore.stashCreate",
          input.cwd,
          args,
          "There are no unstaged changes to stash.",
        );
      }
      if (!presence.hasStaged && !presence.hasUnstaged) {
        return yield* createGitCommandError(
          "GitCore.stashCreate",
          input.cwd,
          args,
          "There are no changes to stash.",
        );
      }

      // `--staged` can still save an entry before it refuses to restore the worktree
      // (older Git, or a change the status pre-check could not classify). Drop the
      // entry it just made so a failed dialog leaves the repository as it was.
      const stashBefore = stagedOnly
        ? yield* readStashObjectId("GitCore.stashCreate.stashBefore", input.cwd)
        : "";
      const result = yield* executeGit("GitCore.stashCreate", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        if (stagedOnly && result.stderr.includes("Cannot remove worktree changes")) {
          const stashAfter = yield* readStashObjectId("GitCore.stashCreate.stashAfter", input.cwd);
          if (stashAfter.length > 0 && stashAfter !== stashBefore) {
            yield* executeGit("GitCore.stashCreate.rollback", input.cwd, ["stash", "drop"], {
              ...mutationOptions,
              allowNonZeroExit: true,
            });
          }
          return yield* createGitCommandError(
            "GitCore.stashCreate",
            input.cwd,
            args,
            "Git cannot stash only the staged changes while a file also has unstaged edits. Include unstaged changes, or stash the unstaged changes first.",
          );
        }
        return yield* commitActionFailure(
          "GitCore.stashCreate",
          input.cwd,
          args,
          result.stderr,
          "git stash failed",
        );
      }
      return { message: input.message } satisfies GitStashCreateResult;
    });

  const stashList: GitCoreShape["stashList"] = (input) =>
    Effect.gen(function* () {
      const format = "%gd%x09%H%x09%cI%x09%gs";
      const result = yield* executeGit(
        "GitCore.stashList",
        input.cwd,
        ["stash", "list", `--format=${format}`],
        { timeoutMs: 15_000, allowNonZeroExit: true },
      );
      if (result.code !== 0) {
        return yield* commitActionFailure(
          "GitCore.stashList",
          input.cwd,
          ["stash", "list", `--format=${format}`],
          result.stderr,
          "git stash list failed",
        );
      }
      const stashes = result.stdout
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          const [stashRef, sha, createdAt, message] = line.split("\t");
          // A malformed row is dropped rather than rendered as an action target that
          // would fail every command it feeds.
          if (!stashRef || !sha || !createdAt || !message) return [];
          return [
            {
              stashRef: stashRef.trim(),
              sha: sha.trim(),
              createdAt: createdAt.trim(),
              message: message.trim(),
            },
          ];
        });
      return { stashes } satisfies GitStashListResult;
    });

  const stashApply: GitCoreShape["stashApply"] = (input) =>
    Effect.gen(function* () {
      const args = ["stash", input.mode, input.stashRef];
      const result = yield* executeGit("GitCore.stashApply", input.cwd, args, {
        ...mutationOptions,
        allowNonZeroExit: true,
      });
      if (result.code === 0) {
        return { status: "applied" } satisfies GitStashApplyResult;
      }
      const stderr = result.stderr.trim();
      // Git's own markers, not the word "conflict": a path may be named after it. A
      // conflicted apply still leaves the changes in the working tree and keeps the entry
      // (pop included, because the drop only runs after a clean apply), so it is reported
      // as a warning the caller can act on instead of a retryable failure.
      const output = `${result.stdout}\n${stderr}`;
      if (CONFLICT_MARKERS.some((marker) => output.includes(marker))) {
        const detail = result.stdout.trim() || stderr;
        return {
          status: "conflicted",
          ...(detail.length > 0 ? { detail } : {}),
        } satisfies GitStashApplyResult;
      }
      return yield* commitActionFailure(
        "GitCore.stashApply",
        input.cwd,
        args,
        stderr || result.stdout.trim(),
        "git stash apply failed",
      );
    });

  return {
    listCommitHistory,
    readCommitDiff,
    checkoutCommit,
    checkoutRemoteBranch,
    cherryPickCommit,
    revertCommit,
    createTag,
    deleteBranchRef,
    deleteTagRef,
    pushBranch,
    pullBranch,
    mergeBranch,
    rebaseBranch,
    stashCreate,
    stashList,
    stashApply,
  };
}
