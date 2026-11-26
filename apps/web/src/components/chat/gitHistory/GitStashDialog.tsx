// FILE: GitStashDialog.tsx
// Purpose: Names and confirms a stash from the Git Graph working-tree rows. Each scope
//          can also pull the other one in: a staged stash can include the unstaged
//          changes, and an unstaged stash can include the staged changes. The caller
//          mounts this only while the dialog is open, so every open starts from an
//          empty title and the unchecked defaults.
// Layer: Git history UI

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { gitStashCreateMutationOptions } from "~/lib/gitReactQuery";
import { useTranslation } from "~/i18n";
import { Checkbox } from "../../ui/checkbox";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { toastManager } from "../../ui/toast";
import { GitHistoryFormDialog } from "./GitHistoryFormDialog";

export type GitStashScope = "staged" | "unstaged";

export function GitStashDialog(props: {
  open: boolean;
  cwd: string | null;
  scope: GitStashScope;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isStaged = props.scope === "staged";
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(false);
  const [includeStaged, setIncludeStaged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stashCreate = useMutation(gitStashCreateMutationOptions({ cwd: props.cwd, queryClient }));

  const trimmedMessage = message.trim();
  const canSubmit = trimmedMessage.length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await stashCreate.mutateAsync({
        message: trimmedMessage,
        scope: props.scope,
        ...(isStaged ? { includeUnstaged } : { includeStaged }),
      });
      toastManager.add({
        type: "success",
        title: t("git:historyStashCreated", { value0: trimmedMessage }),
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
      title={isStaged ? t("git:historyStashStagedChanges") : t("git:historyStashUnstagedChanges")}
      description={
        isStaged ? t("git:historyStashStagedDescription") : t("git:historyStashUnstagedDescription")
      }
      confirmLabel={t("git:historyStashConfirm")}
      submitDisabled={!canSubmit}
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="git-stash-message">{t("git:historyStashMessage")}</Label>
        <Input
          id="git-stash-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("git:historyStashMessagePlaceholder")}
          autoFocus
        />
      </div>
      <label className="flex items-center gap-2 text-ui text-foreground">
        <Checkbox
          checked={isStaged ? includeUnstaged : includeStaged}
          onCheckedChange={(value) => {
            if (isStaged) setIncludeUnstaged(value === true);
            else setIncludeStaged(value === true);
          }}
        />
        <span>
          {isStaged ? t("git:historyStashIncludeUnstaged") : t("git:historyStashIncludeStaged")}
        </span>
      </label>
    </GitHistoryFormDialog>
  );
}
