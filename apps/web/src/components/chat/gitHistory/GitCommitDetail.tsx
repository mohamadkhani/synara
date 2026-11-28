// FILE: GitCommitDetail.tsx
// Purpose: Commit metadata plus its patch in the history view, with the commit
//          actions Git Graph users expect (checkout, branch, tag, cherry-pick, revert).
// Layer: Git history UI

import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import type { GitHistoryCommit } from "@synara/contracts";
import { useAppSettings } from "~/appSettings";
import {
  getRenderablePatch,
  sortFileDiffsByPath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import { gitCommitDiffQueryOptions } from "~/lib/gitReactQuery";
import {
  EllipsisIcon,
  GitBranchIcon,
  GitCommitIcon,
  Maximize2,
  Minimize2,
  TagIcon,
} from "~/lib/icons";
import { formatShortDateTimestamp } from "~/timestampFormat";
import { useTranslation } from "~/i18n";
import { PanelStateMessage } from "../PanelStateMessage";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { DiffStat } from "../DiffStatLabel";
import { DiffTruncationWarning } from "../../DiffTruncationWarning";
import { CopyTextButton } from "../../ui/copyTextButton";
import { IconButton } from "../../ui/icon-button";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { GitCommitRefBadges } from "./GitCommitRefBadges";
import { GitDiffFileList } from "./GitDiffFileList";
import { type GitCommitActionId, type GitCommitActions } from "./useGitCommitActions";

const COMMIT_ACTION_ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground";

export function GitCommitDetail(props: {
  cwd: string | null;
  sha: string;
  theme: "light" | "dark";
  /** Already-loaded list row, so the header can render before the diff arrives. */
  listCommit?: GitHistoryCommit | undefined;
  /** Configured remotes; a single remote lets its ref chips drop the `origin/` prefix. */
  remoteNames?: readonly string[];
  /** Shared with the history list so pending state and dialogs are not duplicated. */
  commitActions: GitCommitActions;
  /** True while the details take the whole pane instead of sharing it with the list. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onRefContextMenu?: (
    commit: GitHistoryCommit,
    ref: GitHistoryCommit["refs"][number],
    event: ReactMouseEvent,
  ) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const { commitActions } = props;

  const commitQuery = useQuery(gitCommitDiffQueryOptions({ cwd: props.cwd, sha: props.sha }));
  const commit = commitQuery.data?.commit ?? props.listCommit;
  const author = commit?.authorName.trim() ?? "";
  const authorEmail = commit?.authorEmail.trim() ?? "";
  const committedAt = commit?.committedAt ?? "";
  // The header already shows the subject (the message's first line); the rest of the
  // message is real commit data, so show it instead of dropping it.
  const messageBody = useMemo(() => {
    const message = commitQuery.data?.message ?? "";
    const newline = message.indexOf("\n");
    return newline >= 0 ? message.slice(newline + 1).trim() : "";
  }, [commitQuery.data?.message]);

  const renderable = useMemo(
    () => getRenderablePatch(commitQuery.data?.patch, `git-commit:${props.sha}:${props.theme}`),
    [commitQuery.data?.patch, props.sha, props.theme],
  );
  const files = useMemo(
    () => (renderable?.kind === "files" ? sortFileDiffsByPath(renderable.files) : []),
    [renderable],
  );
  const stats = useMemo(() => summarizeFileDiffStats(files), [files]);

  const actionsMenu = (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={t("git:historyCommitActions")}
            tooltip={t("git:historyCommitActions")}
          >
            <EllipsisIcon className="size-3.5" />
          </IconButton>
        }
      />
      <ComposerPickerMenuPopup align="end" side="bottom" className="w-64 min-w-64">
        {commitActions.items.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore ? <MenuSeparator /> : null}
            <MenuItem
              disabled={commitActions.pending}
              onClick={() => {
                if (commit) void commitActions.run(commit, item.id);
              }}
            >
              {commitActionIcon(item.id)}
              <span>{item.label}</span>
            </MenuItem>
          </Fragment>
        ))}
      </ComposerPickerMenuPopup>
    </Menu>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="@container flex min-w-0 items-start gap-2 border-b border-border/70 px-2 py-2">
        <div className="min-w-0 flex-1">
          {commit ? (
            <p className="min-w-0 truncate text-ui-lg font-medium text-foreground">
              {commit.subject}
            </p>
          ) : (
            <Skeleton className="h-5 w-2/3 rounded-full" />
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-ui-xs text-muted-foreground">
            {commit ? (
              <GitCommitRefBadges
                commit={commit}
                // The detail pane has the room and is where a reader checks every ref on a
                // commit, so it never summarises them into a "+N".
                maxVisible={Number.POSITIVE_INFINITY}
                {...(props.remoteNames ? { remoteNames: props.remoteNames } : {})}
                {...(props.onRefContextMenu ? { onRefContextMenu: props.onRefContextMenu } : {})}
              />
            ) : null}
            <span className="inline-flex items-center gap-1 font-mono">
              {commit?.shortSha ?? props.sha.slice(0, 7)}
              <CopyTextButton
                text={props.sha}
                label={t("git:historyCommitSha")}
                iconOnly
                className="size-5"
              />
            </span>
            {author ? (
              <span className="min-w-0 truncate" title={authorEmail || undefined}>
                {authorEmail
                  ? t("git:historyAuthorWithEmail", { value0: author, value1: authorEmail })
                  : author}
              </span>
            ) : null}
            {committedAt ? (
              <span className="tabular-nums">
                {formatShortDateTimestamp(committedAt, settings.timestampFormat)}
              </span>
            ) : null}
            {files.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <span>{t("git:historyChangedFiles", { value0: files.length })}</span>
                <DiffStat additions={stats.additions} deletions={stats.deletions} />
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={props.expanded ? t("git:historyCollapseDetail") : t("git:historyExpandDetail")}
            tooltip={props.expanded ? t("git:historyCollapseDetail") : t("git:historyExpandDetail")}
            onClick={props.onToggleExpanded}
          >
            {props.expanded ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </IconButton>
          {actionsMenu}
        </div>
      </div>

      {messageBody.length > 0 ? (
        <pre className="max-h-40 shrink-0 overflow-auto whitespace-pre-wrap break-words border-b border-border/70 bg-background/70 px-3 py-2 font-mono text-ui-sm leading-relaxed text-muted-foreground/90">
          {messageBody}
        </pre>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {commitQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-2" role="status" aria-live="polite">
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-40 w-full rounded-md" />
          </div>
        ) : commitQuery.error ? (
          <PanelStateMessage density="compact" fill="flex">
            <p className="text-left text-ui-sm text-destructive">
              {commitQuery.error instanceof Error
                ? commitQuery.error.message
                : t("git:historyCommitLoadFailed")}
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
              commitQuery.data?.truncated ? (
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

function commitActionIcon(id: GitCommitActionId) {
  switch (id) {
    case "checkout":
      return <GitCommitIcon className={COMMIT_ACTION_ICON_CLASS_NAME} />;
    case "create-branch":
      return <GitBranchIcon className={COMMIT_ACTION_ICON_CLASS_NAME} />;
    case "create-tag":
      return <TagIcon className={COMMIT_ACTION_ICON_CLASS_NAME} />;
    default:
      return null;
  }
}
