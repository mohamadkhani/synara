// FILE: GitStashDetail.tsx
// Purpose: Detail pane for a stash entry: its message, ref, date, and the patch it
//          contains, folded per file. Read-only; apply/pop/delete live on the row's
//          context menu. The caller mounts this only while a stash is selected.
// Layer: Git history UI

import { useQuery } from "@tanstack/react-query";
import { useMemo, type MouseEvent as ReactMouseEvent } from "react";

import type { GitStashEntry } from "@synara/contracts";
import {
  getRenderablePatch,
  resolveFileDiffIndexPaths,
  resolveFileDiffPath,
  sortFileDiffsByPath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import { gitCommitDiffQueryOptions } from "~/lib/gitReactQuery";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readNativeApi } from "~/nativeApi";
import { useTranslation } from "~/i18n";
import { toastManager } from "../../ui/toast";
import { Maximize2, Minimize2 } from "~/lib/icons";
import { IconButton } from "../../ui/icon-button";
import { PanelStateMessage } from "../PanelStateMessage";
import { DiffStat } from "../DiffStatLabel";
import { DiffTruncationWarning } from "../../DiffTruncationWarning";
import { Skeleton } from "../../ui/skeleton";
import { GitDiffFileList } from "./GitDiffFileList";

export function GitStashDetail(props: {
  cwd: string | null;
  stash: GitStashEntry;
  theme: "light" | "dark";
  /** True while the details take the whole pane instead of sharing it with the list. */
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery(gitCommitDiffQueryOptions({ cwd: props.cwd, sha: props.stash.sha }));
  const renderable = useMemo(
    () => getRenderablePatch(query.data?.patch, `git-stash:${props.stash.sha}:${props.theme}`),
    [query.data?.patch, props.stash.sha, props.theme],
  );
  const files = useMemo(
    () => (renderable?.kind === "files" ? sortFileDiffsByPath(renderable.files) : []),
    [renderable],
  );
  const stats = useMemo(() => summarizeFileDiffStats(files), [files]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/70 px-2 py-2">
        <span className="min-w-0 flex-1 truncate text-ui-lg font-medium text-foreground">
          {props.stash.message}
        </span>
        {files.length > 0 ? (
          <span className="flex shrink-0 items-center gap-2 text-ui-xs text-muted-foreground">
            <span>{t("git:historyChangedFiles", { value0: files.length })}</span>
            <DiffStat additions={stats.additions} deletions={stats.deletions} />
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-ui-xs text-muted-foreground">
          {props.stash.stashRef}
        </span>
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
