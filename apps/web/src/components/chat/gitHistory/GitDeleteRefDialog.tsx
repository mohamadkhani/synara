// FILE: GitDeleteRefDialog.tsx
// Purpose: Confirm dialog for deleting a branch or tag, with an opt-in to also delete
//          the ref from its remote. A branch with unmerged commits needs a second
//          confirmation before the force delete runs. The caller mounts this only
//          while the dialog is open, so every open starts unchecked.
// Layer: Git history UI

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  gitDeleteBranchRefMutationOptions,
  gitDeleteTagRefMutationOptions,
} from "~/lib/gitReactQuery";
import { useTranslation } from "~/i18n";
import { Checkbox } from "../../ui/checkbox";
import { toastManager } from "../../ui/toast";
import { GitHistoryFormDialog } from "./GitHistoryFormDialog";

export type GitDeleteRefKind = "branch" | "tag";

export function GitDeleteRefDialog(props: {
  open: boolean;
  kind: GitDeleteRefKind;
  cwd: string | null;
  name: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isBranch = props.kind === "branch";
  const [deleteRemote, setDeleteRemote] = useState(false);
  // Set after a plain branch delete is refused: the second confirm sends `force`.
  const [force, setForce] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteBranch = useMutation(
    gitDeleteBranchRefMutationOptions({ cwd: props.cwd, queryClient }),
  );
  const deleteTag = useMutation(gitDeleteTagRefMutationOptions({ cwd: props.cwd, queryClient }));

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      // A plain delete stops when the branch has unmerged commits. Rather than dropping
      // that work on the first confirmation, switch to a second confirmation state that
      // warns and resends with `force: true`.
      const result = isBranch
        ? await deleteBranch.mutateAsync({
            branch: props.name,
            deleteRemote,
            ...(force ? { force: true } : {}),
          })
        : await deleteTag.mutateAsync({ name: props.name, deleteRemote });
      if (isBranch && result.requiresForce === true) {
        setForce(true);
        return;
      }
      toastManager.add({
        type: "success",
        title: result.remoteName
          ? t("git:historyDeletedRefRemote", { value0: props.name, value1: result.remoteName })
          : t("git:historyDeletedRef", { value0: props.name }),
      });
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
      title={isBranch ? t("git:historyDeleteBranchTitle") : t("git:historyDeleteTagTitle")}
      description={
        force
          ? t("git:historyDeleteBranchForceWarning", { value0: props.name })
          : isBranch
            ? t("git:historyDeleteBranchDescription", { value0: props.name })
            : t("git:historyDeleteTagDescription", { value0: props.name })
      }
      confirmLabel={
        force ? t("git:historyDeleteBranchForceConfirm") : t("git:historyDeleteRefConfirm")
      }
      confirmVariant="destructive"
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
    >
      <label className="flex items-center gap-2 text-ui text-foreground">
        <Checkbox
          checked={deleteRemote}
          onCheckedChange={(value) => setDeleteRemote(value === true)}
        />
        <span>{t("git:historyDeleteFromRemote")}</span>
      </label>
    </GitHistoryFormDialog>
  );
}
