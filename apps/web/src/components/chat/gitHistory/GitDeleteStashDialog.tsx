// FILE: GitDeleteStashDialog.tsx
// Purpose: Confirms dropping one stash entry, since dropping is the part of the stash
//          menu that cannot be undone. The caller mounts this only while it is open.
// Layer: Git history UI

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { gitStashDropMutationOptions } from "~/lib/gitReactQuery";
import { useTranslation } from "~/i18n";
import { toastManager } from "../../ui/toast";
import { GitHistoryFormDialog } from "./GitHistoryFormDialog";

export function GitDeleteStashDialog(props: {
  open: boolean;
  cwd: string | null;
  stashRef: string;
  message: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stashDrop = useMutation(gitStashDropMutationOptions({ cwd: props.cwd, queryClient }));

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await stashDrop.mutateAsync({ stashRef: props.stashRef });
      toastManager.add({
        type: "success",
        title: t("git:historyStashDeleted", { value0: props.stashRef }),
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
      title={t("git:historyStashDeleteTitle")}
      description={t("git:historyStashDeleteDescription", {
        value0: props.stashRef,
        value1: props.message,
      })}
      confirmLabel={t("git:historyStashDeleteConfirm")}
      confirmVariant="destructive"
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
    >
      {null}
    </GitHistoryFormDialog>
  );
}
