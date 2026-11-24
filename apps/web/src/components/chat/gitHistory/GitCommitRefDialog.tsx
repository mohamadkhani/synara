// FILE: GitCommitRefDialog.tsx
// Purpose: Create a branch or tag at a selected commit. Branch creation can also
//          check the new branch out; tags accept an optional annotation message.
//          The caller mounts this only while the dialog is open, so every open
//          starts from an empty form.
// Layer: Git history UI

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTranslation } from "~/i18n";
import { toastManager } from "../../ui/toast";
import { Checkbox } from "../../ui/checkbox";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import {
  gitCreateBranchMutationOptions,
  gitCreateTagMutationOptions,
} from "../../../lib/gitReactQuery";
import { GitHistoryFormDialog } from "./GitHistoryFormDialog";

export type GitCommitRefDialogKind = "branch" | "tag";

export function GitCommitRefDialog(props: {
  open: boolean;
  kind: GitCommitRefDialogKind;
  cwd: string | null;
  sha: string;
  shortSha: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isBranch = props.kind === "branch";
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createBranch = useMutation(gitCreateBranchMutationOptions({ cwd: props.cwd, queryClient }));
  const createTag = useMutation(gitCreateTagMutationOptions({ cwd: props.cwd, queryClient }));

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !trimmedName.startsWith("-") && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      if (isBranch) {
        await createBranch.mutateAsync({
          branch: trimmedName,
          startPoint: props.sha,
          checkout,
        });
        toastManager.add({
          type: "success",
          title: t("git:historyBranchCreated", { value0: trimmedName }),
        });
      } else {
        await createTag.mutateAsync({
          sha: props.sha,
          name: trimmedName,
          ...(message.trim() ? { message: message.trim() } : {}),
        });
        toastManager.add({
          type: "success",
          title: t("git:historyTagCreated", { value0: trimmedName }),
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
      title={isBranch ? t("git:historyCreateBranchTitle") : t("git:historyCreateTagTitle")}
      description={
        isBranch
          ? t("git:historyCreateBranchDescription", { value0: props.shortSha })
          : t("git:historyCreateTagDescription", { value0: props.shortSha })
      }
      confirmLabel={isBranch ? t("git:historyCreateBranchAction") : t("git:historyCreateTagAction")}
      submitDisabled={!canSubmit}
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="git-commit-ref-name">
          {isBranch ? t("git:historyBranchName") : t("git:historyTagName")}
        </Label>
        <Input
          id="git-commit-ref-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={
            isBranch ? t("git:historyBranchNamePlaceholder") : t("git:historyTagNamePlaceholder")
          }
          autoFocus
        />
      </div>
      {isBranch ? (
        <label className="flex items-center gap-2 text-ui text-foreground">
          <Checkbox checked={checkout} onCheckedChange={(value) => setCheckout(value === true)} />
          <span>{t("git:historyCheckoutNewBranch")}</span>
        </label>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="git-commit-ref-message">{t("git:historyTagMessage")}</Label>
          <Textarea
            id="git-commit-ref-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("git:historyTagMessagePlaceholder")}
            rows={4}
          />
        </div>
      )}
    </GitHistoryFormDialog>
  );
}
