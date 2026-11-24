// FILE: GitWorkingTreeDetail.tsx
// Purpose: Detail pane for the synthetic working-tree rows in the history list: the
//          staged or unstaged patch, folded per file, with no commit metadata or actions.
// Layer: Git history UI

import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import {
  getRenderablePatch,
  resolveFileDiffIndexPaths,
  resolveFileDiffPath,
  sortFileDiffsByPath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import {
  gitStageFilesMutationOptions,
  gitUnstageFilesMutationOptions,
  gitWorkingTreeDiffQueryOptions,
} from "~/lib/gitReactQuery";
import { Maximize2, Minimize2, PlusIcon, ResetIcon } from "~/lib/icons";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../../ui/toast";
import { useTranslation } from "~/i18n";
import { DiffTruncationWarning } from "../../DiffTruncationWarning";
import { IconButton } from "../../ui/icon-button";
import { PanelStateMessage } from "../PanelStateMessage";
import { DiffStat } from "../DiffStatLabel";
import { Skeleton } from "../../ui/skeleton";
import { GitDiffFileList } from "./GitDiffFileList";

export function GitWorkingTreeDetail(props: {
  cwd: string | null;
  scope: "staged" | "unstaged";
  theme: "light" | "dark";
  /** True while the details take the whole pane instead of sharing it with the list. */
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery(gitWorkingTreeDiffQueryOptions({ cwd: props.cwd, scope: props.scope }));
  // Stage/unstage invalidate the whole cwd family on settle (makeGitMutationOptions),
  // which already covers this pane and the working-tree rows above it.
  const stageMutation = useMutation(gitStageFilesMutationOptions({ cwd: props.cwd, queryClient }));
  const unstageMutation = useMutation(
    gitUnstageFilesMutationOptions({ cwd: props.cwd, queryClient }),
  );
  const isStaged = props.scope === "staged";
  const fileActionLabel = isStaged ? t("git:historyUnstageFile") : t("git:historyStageFile");

  const runFileAction = (fileDiff: FileDiffMetadata) => {
    if (!props.cwd) return;
    if (isStaged) unstageMutation.mutate(resolveFileDiffIndexPaths(fileDiff));
    else stageMutation.mutate([resolveFileDiffPath(fileDiff)]);
  };

  const showFileContextMenu = useCallback(
    async (fileDiff: FileDiffMetadata, event: ReactMouseEvent) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api || !props.cwd) return;
      const action = await api.contextMenu.show(
        [
          { id: "toggle-stage" as const, label: fileActionLabel },
          { id: "copy-path" as const, label: t("common:diff_copyPath") },
        ],
        { x: event.clientX, y: event.clientY },
      );
      if (action === "copy-path") {
        await copyTextToClipboard(resolveFileDiffPath(fileDiff));
        toastManager.add({
          type: "success",
          title: t("common:copied", { value0: fileActionLabel }),
        });
        return;
      }
      if (action !== "toggle-stage") return;
      if (isStaged) unstageMutation.mutate(resolveFileDiffIndexPaths(fileDiff));
      else stageMutation.mutate([resolveFileDiffPath(fileDiff)]);
    },
    [fileActionLabel, isStaged, props.cwd, stageMutation, unstageMutation, t],
  );
  const renderable = useMemo(
    () => getRenderablePatch(query.data?.patch, `git-worktree:${props.scope}:${props.theme}`),
    [query.data?.patch, props.scope, props.theme],
  );
  const files = useMemo(
    () => (renderable?.kind === "files" ? sortFileDiffsByPath(renderable.files) : []),
    [renderable],
  );
  const stats = useMemo(() => summarizeFileDiffStats(files), [files]);
  const title =
    props.scope === "staged" ? t("git:historyStagedChanges") : t("git:historyUnstagedChanges");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/70 px-2 py-2">
        <span className="min-w-0 flex-1 truncate text-ui-lg font-medium text-foreground">
          {title}
        </span>
        {files.length > 0 ? (
          <span className="flex shrink-0 items-center gap-2 text-ui-xs text-muted-foreground">
            <span>{t("git:historyChangedFiles", { value0: files.length })}</span>
            <DiffStat additions={stats.additions} deletions={stats.deletions} />
          </span>
        ) : null}
        <IconButton
          variant="ghost"
          size="icon-xs"
          label={props.expanded ? t("git:historyCollapseDetail") : t("git:historyExpandDetail")}
          tooltip={props.expanded ? t("git:historyCollapseDetail") : t("git:historyExpandDetail")}
          onClick={props.onToggleExpanded}
        >
          {props.expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </IconButton>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-2" role="status" aria-live="polite">
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-40 w-full rounded-md" />
          </div>
        ) : query.error ? (
          <PanelStateMessage density="compact" fill="flex">
            <p className="text-left text-ui-sm text-destructive">
              {query.error instanceof Error ? query.error.message : t("git:historyLoadFailed")}
            </p>
          </PanelStateMessage>
        ) : renderable === null ? (
          <PanelStateMessage density="compact" fill="flex">
            {t("git:historyCommitNoChanges")}
          </PanelStateMessage>
        ) : renderable.kind === "files" ? (
          <GitDiffFileList
            files={files}
            theme={props.theme}
            fileAction={{
              label: fileActionLabel,
              icon: isStaged ? (
                <ResetIcon className="size-3.5" />
              ) : (
                <PlusIcon className="size-3.5" />
              ),
              pending: isStaged ? unstageMutation.isPending : stageMutation.isPending,
              onAction: runFileAction,
            }}
            onFileContextMenu={showFileContextMenu}
            header={
              query.data?.truncated ? (
                <DiffTruncationWarning className="mx-2 mt-2">
                  {t("git:historyCommitDiffTruncated")}
                </DiffTruncationWarning>
              ) : null
            }
          />
        ) : (
          <div className="h-full overflow-auto p-2">
            <p className="text-ui-sm text-muted-foreground/75">{renderable.reason}</p>
            <pre className="mt-2 rounded-md border border-border/70 bg-background/70 p-3 font-mono text-ui-sm leading-relaxed text-muted-foreground/90">
              {renderable.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
