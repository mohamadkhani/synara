// FILE: GitDiffFileList.tsx
// Purpose: The file list of a commit or working-tree diff: one folded card per file,
//          a one-letter status per file, and Expand all / Fold all controls.
// Layer: Git history UI

import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import {
  buildFileDiffRenderKey,
  resolveFileDiffPath,
  sortFileDiffsByPath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import { ChevronDownIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { FileDiffCard, FileDiffSurface } from "../FileDiffView";
import { DiffStat } from "../DiffStatLabel";

const FILE_STATUS_STYLES = {
  added:
    "border-[var(--color-status-success)]/40 bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]",
  modified:
    "border-[var(--color-status-neutral)]/40 bg-[var(--color-status-neutral)]/10 text-muted-foreground",
  deleted:
    "border-[var(--color-status-failure)]/40 bg-[var(--color-status-failure)]/10 text-[var(--color-status-failure)]",
  renamed:
    "border-[var(--color-status-open)]/40 bg-[var(--color-status-open)]/10 text-[var(--color-status-open)]",
} as const;

type FileStatus = keyof typeof FILE_STATUS_STYLES;

const FILE_STATUS_LETTERS: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const FILE_STATUS_LABEL_KEYS: Record<FileStatus, string> = {
  added: "git:historyFileAdded",
  modified: "git:historyFileModified",
  deleted: "git:historyFileDeleted",
  renamed: "git:historyFileRenamed",
};

function fileStatus(fileDiff: FileDiffMetadata): FileStatus {
  switch (fileDiff.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    default:
      return "modified";
  }
}

export function GitDiffFileList(props: {
  files: ReadonlyArray<FileDiffMetadata>;
  theme: "light" | "dark";
  /** Rendered above the list, e.g. a truncation warning. */
  header?: ReactNode;
  className?: string;
  /** Single per-file action shown in the header, e.g. stage or unstage. */
  fileAction?: {
    label: string;
    icon: ReactNode;
    onAction: (fileDiff: FileDiffMetadata) => void;
  };
  onFileContextMenu?: (fileDiff: FileDiffMetadata, event: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  const files = useMemo(() => sortFileDiffsByPath([...props.files]), [props.files]);
  const filePaths = useMemo(() => files.map(resolveFileDiffPath), [files]);
  const stats = useMemo(() => summarizeFileDiffStats(files), [files]);
  // Every file starts folded so a large diff lists its files without rendering
  // every patch; the header row and the toolbar expand what the reader needs.
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const toggleFile = (filePath: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", props.className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1">
        <span className="text-ui-xs text-muted-foreground">
          {t("git:historyChangedFiles", { value0: files.length })}
        </span>
        <DiffStat additions={stats.additions} deletions={stats.deletions} className="text-ui-xs" />
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpandedPaths(new Set(filePaths))}
            disabled={expandedPaths.size === filePaths.length}
          >
            {t("git:historyExpandAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpandedPaths(new Set())}
            disabled={expandedPaths.size === 0}
          >
            {t("git:historyFoldAll")}
          </Button>
        </div>
      </div>
      {props.header}
      <FileDiffSurface className="h-full min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="flex flex-col gap-2">
          {files.map((fileDiff) => {
            const filePath = resolveFileDiffPath(fileDiff);
            return (
              <CommitFileCard
                key={`${buildFileDiffRenderKey(fileDiff)}:${props.theme}`}
                fileDiff={fileDiff}
                filePath={filePath}
                theme={props.theme}
                expanded={expandedPaths.has(filePath)}
                onToggle={() => toggleFile(filePath)}
                {...(props.fileAction ? { fileAction: props.fileAction } : {})}
                {...(props.onFileContextMenu ? { onFileContextMenu: props.onFileContextMenu } : {})}
              />
            );
          })}
        </div>
      </FileDiffSurface>
    </div>
  );
}

/** One file: folded by default; clicking the header toggles it. */
function CommitFileCard(props: {
  fileDiff: FileDiffMetadata;
  filePath: string;
  theme: "light" | "dark";
  expanded: boolean;
  onToggle: () => void;
  fileAction?: {
    label: string;
    icon: ReactNode;
    onAction: (fileDiff: FileDiffMetadata) => void;
  };
  onFileContextMenu?: (fileDiff: FileDiffMetadata, event: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  const status = fileStatus(props.fileDiff);

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const composedPath = event.nativeEvent.composedPath?.() ?? [];
    // The header's own controls (stage/unstage, the status chip) must run their
    // click instead of toggling the file; only the header body toggles.
    const clickedControl = composedPath.some(
      (node: EventTarget) =>
        node instanceof Element && node.hasAttribute("data-diff-header-control"),
    );
    if (clickedControl) return;
    const clickedHeader = composedPath.some((node: EventTarget) => {
      if (!(node instanceof Element)) return false;
      return (
        node.hasAttribute("data-diff-file-header") ||
        node.hasAttribute("data-diffs-header") ||
        node.hasAttribute("data-file-info")
      );
    });
    if (!clickedHeader) return;
    event.stopPropagation();
    props.onToggle();
  };

  return (
    <div
      // `contain: paint` clips the sticky file header's scrolling content to the card;
      // with only `overflow: clip` the patch lines painted above the header, into the
      // list gap and over the toolbar.
      className="diff-render-file rounded-md [contain:paint]"
      data-diff-file-path={props.filePath}
      onClickCapture={handleClickCapture}
      onContextMenu={
        props.onFileContextMenu
          ? (event) => {
              event.preventDefault();
              props.onFileContextMenu?.(props.fileDiff, event);
            }
          : undefined
      }
    >
      <FileDiffCard
        fileDiff={props.fileDiff}
        theme={props.theme}
        collapsed={!props.expanded}
        // A pinned header keeps its own scrolled rows visible above the header band
        // when several files share one scroll surface; scrolling it with the card
        // keeps the list readable.
        stickyHeader={false}
        renderHeaderTrailing={() => (
          <span className="flex shrink-0 items-center gap-1.5">
            {props.fileAction ? (
              <span data-diff-header-control="true" className="inline-flex">
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  label={props.fileAction.label}
                  tooltip={props.fileAction.label}
                  onClick={() => props.fileAction?.onAction(props.fileDiff)}
                >
                  {props.fileAction.icon}
                </IconButton>
              </span>
            ) : null}
            <span
              title={t(FILE_STATUS_LABEL_KEYS[status])}
              className={cn(
                "inline-flex size-4 items-center justify-center rounded border text-ui-xs font-semibold leading-none",
                FILE_STATUS_STYLES[status],
              )}
            >
              {FILE_STATUS_LETTERS[status]}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                props.expanded ? "" : "-rotate-90",
              )}
            />
          </span>
        )}
      />
    </div>
  );
}
