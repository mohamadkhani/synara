// FILE: GitCommitRefBadges.tsx
// Purpose: The ref chips shown on a commit row and in the commit detail header:
//          HEAD, checked-out branch, other local branches, remote branches, and tags.
// Layer: Git history UI

import type { GitHistoryCommit } from "@synara/contracts";
import type { MouseEvent as ReactMouseEvent } from "react";

import { GitBranchIcon, GlobeIcon, TagIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";

const REF_KIND_PRIORITY: Record<GitHistoryCommit["refs"][number]["kind"], number> = {
  head: 0,
  branch: 1,
  tag: 2,
  remote: 3,
};

/** Head and branch first so the most useful labels survive the visible cap. */
function orderRefsForDisplay(commit: GitHistoryCommit) {
  return commit.refs.toSorted(
    (left, right) => REF_KIND_PRIORITY[left.kind] - REF_KIND_PRIORITY[right.kind],
  );
}

export function GitCommitRefBadges(props: {
  commit: GitHistoryCommit;
  className?: string;
  /** Caps the row width: extra refs collapse into a "+N" chip. */
  maxVisible?: number;
  onRefContextMenu?: (
    commit: GitHistoryCommit,
    ref: GitHistoryCommit["refs"][number],
    event: ReactMouseEvent,
  ) => void;
}) {
  const { t } = useTranslation();
  const { commit, onRefContextMenu } = props;
  if (commit.refs.length === 0) return null;
  const maxVisible = props.maxVisible ?? 2;
  // The checked-out branch is decorated as both `HEAD` and the branch name. Showing
  // them separately spent a slot and hid the branch name on busy commits, so the
  // branch chip carries the HEAD marker instead and detached HEAD keeps its own chip.
  // The parser records `checkedOut`, so this never depends on decoration order.
  const checkedOutBranch = commit.refs.find((ref) => ref.kind === "branch" && ref.checkedOut);
  const ordered = orderRefsForDisplay(commit).filter(
    (ref) => !(ref.kind === "head" && checkedOutBranch !== undefined),
  );
  const visible = ordered.slice(0, maxVisible);

  return (
    <span className={cn("flex shrink-0 items-center gap-1", props.className)}>
      {visible.map((ref) => {
        const isHead = ref.kind === "head";
        const isTag = ref.kind === "tag";
        const isRemote = ref.kind === "remote";
        const Icon = isTag ? TagIcon : isRemote ? GlobeIcon : GitBranchIcon;
        const isCheckedOutBranch = ref.kind === "branch" && ref.checkedOut;
        const label = isHead ? t("git:historyHeadBadge") : ref.name;
        return (
          <span
            key={`${ref.kind}:${ref.name}`}
            data-git-ref-chip="true"
            onContextMenu={
              onRefContextMenu
                ? (event) => {
                    event.preventDefault();
                    // The chip lives inside the commit row, which has its own
                    // context menu; without this the row menu replaces this one.
                    event.stopPropagation();
                    onRefContextMenu(commit, ref, event);
                  }
                : undefined
            }
            title={
              isHead
                ? t("git:historyHeadBadgeTitle")
                : isCheckedOutBranch
                  ? t("git:historyHeadBranchTitle", { value0: ref.name })
                  : isTag
                    ? t("git:historyTagBadgeTitle", { value0: ref.name })
                    : isRemote
                      ? t("git:historyRemoteBadgeTitle", { value0: ref.name })
                      : t("git:historyBranchBadgeTitle", { value0: ref.name })
            }
            className={cn(
              "inline-flex max-w-[8rem] shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-ui-xs font-medium",
              // The chip is a right-click target; without this the pointer stays the
              // text cursor over the label.
              onRefContextMenu ? "cursor-pointer" : undefined,
              // Checked out is a filled accent chip, not a tinted outline: a 15% tint
              // looked identical to the plain branch chips on the dark surface.
              isHead || isCheckedOutBranch
                ? "border-[var(--color-status-open)] bg-[var(--color-status-open)] font-semibold text-[var(--color-background)]"
                : isTag
                  ? "border-[var(--color-status-merged)]/50 bg-[var(--color-status-merged)]/15 text-[var(--color-status-merged)]"
                  : isRemote
                    ? "border-border bg-muted/50 text-muted-foreground"
                    : "border-border bg-muted text-foreground/90",
            )}
          >
            <Icon className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
            {isCheckedOutBranch ? (
              <span className="shrink-0 text-ui-xs font-bold opacity-75" aria-hidden="true">
                {t("git:historyHeadBadge")}
              </span>
            ) : null}
          </span>
        );
      })}
      {ordered.length > maxVisible ? (
        <span
          className="shrink-0 text-ui-xs text-muted-foreground"
          title={ordered
            .slice(maxVisible)
            .map((ref) => (ref.kind === "head" ? t("git:historyHeadBadge") : ref.name))
            .join("\n")}
        >
          {t("git:historyMoreRefs", { value0: ordered.length - maxVisible })}
        </span>
      ) : null}
    </span>
  );
}
