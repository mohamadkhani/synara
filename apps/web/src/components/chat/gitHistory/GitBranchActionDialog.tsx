// FILE: GitBranchActionDialog.tsx
// Purpose: Confirmation dialogs for the branch menu's remote and history actions
//          (push, pull, merge, rebase). Each shows the exact git command it will run,
//          and only the checkboxes whose flags git accepts together are enabled. The
//          caller mounts this only while a dialog is open, so every open starts from
//          the documented defaults.
// Layer: Git history UI

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  gitMergeBranchMutationOptions,
  gitPullBranchMutationOptions,
  gitPushBranchMutationOptions,
  gitRebaseBranchMutationOptions,
} from "~/lib/gitReactQuery";
import { useTranslation } from "~/i18n";
import { Checkbox } from "../../ui/checkbox";
import { toastManager } from "../../ui/toast";
import { GitHistoryFormDialog } from "./GitHistoryFormDialog";

function checkRow(input: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-ui text-foreground ${
        input.disabled ? "opacity-64" : ""
      }`}
    >
      <Checkbox
        checked={input.checked}
        onCheckedChange={(value) => input.onCheckedChange(value === true)}
        disabled={input.disabled === true}
      />
      <span>{input.label}</span>
    </label>
  );
}

/**
 * One branch menu action with the arguments already resolved by the menu (the client
 * resolves the remote so the command shown here is exactly what runs).
 */
export type GitBranchAction =
  | { kind: "push"; cwd: string | null; branch: string; remote: string; hasUpstream: boolean }
  | { kind: "pull"; cwd: string | null; remote: string; branch: string; currentBranch: string }
  | { kind: "merge"; cwd: string | null; ref: string; currentBranch: string }
  | { kind: "rebase"; cwd: string | null; ref: string; currentBranch: string };

/** Renders the git command a submit would run, flags included. */
export function buildBranchActionCommand(
  action: GitBranchAction,
  flags: PushFlags & MergeFlags & RebaseFlags,
): string {
  switch (action.kind) {
    case "push":
      return [
        "git push",
        ...(flags.setUpstream ? ["--set-upstream"] : []),
        ...(flags.forceWithLease ? ["--force-with-lease"] : []),
        action.remote,
        action.branch,
      ].join(" ");
    case "pull":
      return ["git pull", ...(flags.rebase ? ["--rebase"] : []), action.remote, action.branch].join(
        " ",
      );
    case "merge": {
      // `--squash` cannot combine with `--no-ff` or `--no-commit`, so squash wins and
      // the other two are dropped from both the command and the request.
      const squash = flags.squash;
      return [
        "git merge",
        ...(squash ? ["--squash"] : []),
        ...(!squash && flags.noFastForward ? ["--no-ff"] : []),
        ...(!squash && flags.noCommit ? ["--no-commit"] : []),
        action.ref,
      ].join(" ");
    }
    case "rebase":
      return [
        "git rebase",
        ...(flags.autosquash ? ["--interactive", "--autosquash"] : []),
        action.ref,
      ].join(" ");
  }
}

interface PushFlags {
  setUpstream: boolean;
  forceWithLease: boolean;
}
interface MergeFlags {
  noFastForward: boolean;
  squash: boolean;
  noCommit: boolean;
}
interface RebaseFlags {
  rebase: boolean;
  autosquash: boolean;
}

function CommandPreview(props: { command: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm text-muted-foreground">
        {t("git:historyBranchActionCommand")}
      </span>
      <code className="block overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-ui-xs text-foreground">
        {props.command}
      </code>
    </div>
  );
}

export function GitBranchActionDialog(props: {
  open: boolean;
  action: GitBranchAction;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const action = props.action;

  // Defaults from the confirmed design: create a merge commit even when a fast-forward
  // is possible, and set the upstream only when the branch has none yet.
  const [noFastForward, setNoFastForward] = useState(true);
  const [squash, setSquash] = useState(false);
  const [noCommit, setNoCommit] = useState(false);
  const [setUpstream, setSetUpstream] = useState(
    action.kind === "push" ? !action.hasUpstream : false,
  );
  const [forceWithLease, setForceWithLease] = useState(false);
  const [rebase, setRebase] = useState(false);
  const [autosquash, setAutosquash] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const push = useMutation(gitPushBranchMutationOptions({ cwd: action.cwd, queryClient }));
  const pull = useMutation(gitPullBranchMutationOptions({ cwd: action.cwd, queryClient }));
  const merge = useMutation(gitMergeBranchMutationOptions({ cwd: action.cwd, queryClient }));
  const rebaseBranch = useMutation(
    gitRebaseBranchMutationOptions({ cwd: action.cwd, queryClient }),
  );

  const command = useMemo(
    () =>
      buildBranchActionCommand(action, {
        setUpstream,
        forceWithLease,
        noFastForward,
        squash,
        noCommit,
        rebase,
        autosquash,
      }),
    [action, setUpstream, forceWithLease, noFastForward, squash, noCommit, rebase, autosquash],
  );

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (action.kind === "push") {
        await push.mutateAsync({
          branch: action.branch,
          remote: action.remote,
          setUpstream,
          forceWithLease,
        });
        toastManager.add({
          type: "success",
          title: t("git:historyPushDone", { value0: action.branch }),
        });
      } else if (action.kind === "pull") {
        const result = await pull.mutateAsync({
          remote: action.remote,
          branch: action.branch,
          rebase,
        });
        toastManager.add({
          type: "success",
          title:
            result.status === "skipped_up_to_date"
              ? t("git:historyPullUpToDate", { value0: action.currentBranch })
              : t("git:historyPullDone", { value0: action.currentBranch }),
        });
      } else if (action.kind === "merge") {
        await merge.mutateAsync({ ref: action.ref, noFastForward, squash, noCommit });
        toastManager.add({
          type: "success",
          title: t("git:historyMergeDone", { value0: action.ref }),
        });
      } else {
        await rebaseBranch.mutateAsync({ ref: action.ref, autosquash });
        toastManager.add({
          type: "success",
          title: t("git:historyRebaseDone", { value0: action.currentBranch }),
        });
      }
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <GitHistoryFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        action.kind === "push"
          ? t("git:historyPushBranchTitle")
          : action.kind === "pull"
            ? t("git:historyPullBranchTitle")
            : action.kind === "merge"
              ? t("git:historyMergeBranchTitle")
              : t("git:historyRebaseBranchTitle")
      }
      description={
        action.kind === "push"
          ? t("git:historyPushBranchDescription", {
              value0: action.branch,
              value1: action.remote,
            })
          : action.kind === "pull"
            ? t("git:historyPullBranchDescription", {
                value0: action.currentBranch,
                value1: `${action.remote}/${action.branch}`,
              })
            : action.kind === "merge"
              ? t("git:historyMergeBranchDescription", {
                  value0: action.ref,
                  value1: action.currentBranch,
                })
              : t("git:historyRebaseBranchDescription", {
                  value0: action.currentBranch,
                  value1: action.ref,
                })
      }
      confirmLabel={
        action.kind === "push"
          ? t("git:historyPushConfirm")
          : action.kind === "pull"
            ? t("git:historyPullConfirm")
            : action.kind === "merge"
              ? t("git:historyMergeConfirm")
              : t("git:historyRebaseConfirm")
      }
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
    >
      {action.kind === "push"
        ? checkRow({
            checked: setUpstream,
            onCheckedChange: setSetUpstream,
            label: t("git:historyPushSetUpstream", {
              value0: `${action.remote}/${action.branch}`,
            }),
          })
        : null}
      {action.kind === "push"
        ? checkRow({
            checked: forceWithLease,
            onCheckedChange: setForceWithLease,
            label: t("git:historyPushForce"),
          })
        : null}
      {action.kind === "pull"
        ? checkRow({
            checked: rebase,
            onCheckedChange: setRebase,
            label: t("git:historyPullRebase"),
          })
        : null}
      {action.kind === "merge"
        ? checkRow({
            checked: noFastForward && !squash,
            onCheckedChange: setNoFastForward,
            label: t("git:historyMergeNoFastForward"),
            disabled: squash,
          })
        : null}
      {action.kind === "merge"
        ? checkRow({
            checked: squash,
            onCheckedChange: setSquash,
            label: t("git:historyMergeSquash"),
          })
        : null}
      {action.kind === "merge"
        ? checkRow({
            checked: noCommit && !squash,
            onCheckedChange: setNoCommit,
            label: t("git:historyMergeNoCommit"),
            disabled: squash,
          })
        : null}
      {action.kind === "rebase"
        ? checkRow({
            checked: autosquash,
            onCheckedChange: setAutosquash,
            label: t("git:historyRebaseAutosquash"),
          })
        : null}
      <CommandPreview command={command} />
    </GitHistoryFormDialog>
  );
}
