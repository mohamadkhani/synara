// FILE: useGitCommitActions.ts
// Purpose: One source of truth for the actions a commit offers, shared by the detail
//          pane's overflow menu and the commit row's right-click menu.
// Layer: Git history UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { GitHistoryCommit } from "@synara/contracts";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  gitCherryPickCommitMutationOptions,
  gitCheckoutCommitMutationOptions,
  gitGithubRepositoryQueryOptions,
  gitRevertCommitMutationOptions,
} from "~/lib/gitReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { t } from "~/i18n";
import { toastManager } from "../../ui/toast";
import { GitCommitRefDialog, type GitCommitRefDialogKind } from "./GitCommitRefDialog";

export type GitCommitActionId =
  | "checkout"
  | "create-branch"
  | "create-tag"
  | "cherry-pick"
  | "revert"
  | "copy-sha"
  | "open-github";

export interface GitCommitActionItem {
  id: GitCommitActionId;
  label: string;
  /** The menu draws a rule above this item. */
  separatorBefore?: boolean;
}

/**
 * The commit action surface: the menu items to render, the runner for a chosen
 * item, and the create-branch/create-tag dialog the runner may open. One instance
 * is shared by the history list rows and the detail pane so a pending action and
 * an open dialog are never duplicated.
 */
export interface GitCommitActions {
  items: ReadonlyArray<GitCommitActionItem>;
  run: (commit: GitHistoryCommit, action: GitCommitActionId) => Promise<void>;
  pending: boolean;
  dialog: ReactNode;
}

export function useGitCommitActions(input: { cwd: string | null }): GitCommitActions {
  const queryClient = useQueryClient();
  const { copyToClipboard } = useCopyToClipboard();
  const [pending, setPending] = useState(false);
  const [refDialog, setRefDialog] = useState<{
    kind: GitCommitRefDialogKind;
    commit: GitHistoryCommit;
  } | null>(null);

  const checkout = useMutation(gitCheckoutCommitMutationOptions({ cwd: input.cwd, queryClient }));
  const cherryPick = useMutation(
    gitCherryPickCommitMutationOptions({ cwd: input.cwd, queryClient }),
  );
  const revert = useMutation(gitRevertCommitMutationOptions({ cwd: input.cwd, queryClient }));
  const repositoryQuery = useQuery(gitGithubRepositoryQueryOptions(input.cwd));
  const repository = repositoryQuery.data?.repository ?? null;

  const items = useMemo<ReadonlyArray<GitCommitActionItem>>(
    () => [
      { id: "checkout", label: t("git:historyCheckoutCommit") },
      { id: "create-branch", label: t("git:historyCreateBranchHere") },
      { id: "create-tag", label: t("git:historyCreateTagHere") },
      { id: "cherry-pick", label: t("git:historyCherryPick"), separatorBefore: true },
      { id: "revert", label: t("git:historyRevert") },
      { id: "copy-sha", label: t("git:historyCopySha"), separatorBefore: true },
      ...(repository ? [{ id: "open-github" as const, label: t("git:historyOpenOnGitHub") }] : []),
    ],
    [repository],
  );

  const run = useCallback(
    async (commit: GitHistoryCommit, action: GitCommitActionId) => {
      if (action === "create-branch" || action === "create-tag") {
        setRefDialog({ kind: action === "create-branch" ? "branch" : "tag", commit });
        return;
      }
      if (action === "copy-sha") {
        copyToClipboard(commit.sha, undefined);
        toastManager.add({ type: "success", title: t("git:historyShaCopied") });
        return;
      }
      if (action === "open-github") {
        if (!repository) return;
        const url = `${repository.url.replace(/\.git$/i, "")}/commit/${commit.sha}`;
        void ensureNativeApi().shell.openExternal(url);
        return;
      }

      setPending(true);
      try {
        if (action === "checkout") {
          await checkout.mutateAsync({ sha: commit.sha });
          toastManager.add({
            type: "success",
            title: t("git:historyCheckedOut", { value0: commit.shortSha }),
          });
        } else if (action === "cherry-pick") {
          await cherryPick.mutateAsync({ sha: commit.sha });
          toastManager.add({ type: "success", title: t("git:historyCherryPicked") });
        } else if (action === "revert") {
          await revert.mutateAsync({ sha: commit.sha });
          toastManager.add({ type: "success", title: t("git:historyReverted") });
        }
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: t("git:historyCommitActionFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setPending(false);
      }
    },
    [checkout, cherryPick, copyToClipboard, repository, revert],
  );

  const dialog = refDialog ? (
    <GitCommitRefDialog
      open
      kind={refDialog.kind}
      cwd={input.cwd}
      sha={refDialog.commit.sha}
      shortSha={refDialog.commit.shortSha}
      onOpenChange={(open) => {
        if (!open) setRefDialog(null);
      }}
    />
  ) : null;

  return { items, run, pending, dialog };
}
