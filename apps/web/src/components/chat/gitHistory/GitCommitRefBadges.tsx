// FILE: GitCommitRefBadges.tsx
// Purpose: The ref chips shown on a commit row and in the commit detail header:
//          HEAD, checked-out branch, other local branches, remote branches, and tags.
//          Remote chips drop the `origin/` prefix when the repository has one remote, and
//          the chip widens with the pane so a branch name is not cut off in a wide dock.
// Layer: Git history UI

import type { GitHistoryCommit } from "@synara/contracts";
import type { MouseEvent as ReactMouseEvent } from "react";

import { GitBranchIcon, GlobeIcon, TagIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";
import { dedupeRemoteRefs, resolveRefChipLabel } from "./gitRefChipLabel";

const REF_KIND_PRIORITY: Record<GitHistoryCommit["refs"][number]["kind"], number> = {
  head: 0,
  branch: 1,
  tag: 2,
  remote: 3,
};

/** The default branch's short name: the one ref every reader expects to see first. */
const DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);

/**
 * The remote a remote ref belongs to, or null when it names no configured remote. Mirrors
 * `dedupeRemoteRefs`, which drops the remote name from a label the same way.
 */
function remoteOf(ref: GitHistoryCommit["refs"][number], remoteNames: readonly string[]) {
  if (ref.kind !== "remote") return null;
  return remoteNames.find((name) => ref.name.startsWith(`${name}/`)) ?? null;
}

/**
 * The branch's own name with the `origin/` prefix (and a leading `feature/`-style directory
 * kept) intact, used only to rank a ref.
 */
function shortRefName(ref: GitHistoryCommit["refs"][number], remoteNames: readonly string[]) {
  const remote = remoteOf(ref, remoteNames);
  return remote ? ref.name.slice(remote.length + 1) : ref.name;
}

/** `origin/HEAD` points at the remote's default branch; it is not a branch of its own. */
function isRemoteHead(ref: GitHistoryCommit["refs"][number], remoteNames: readonly string[]) {
  const remote = remoteOf(ref, remoteNames);
  return remote !== null && ref.name === `${remote}/HEAD`;
}

/**
 * Ranks refs so the ones a reader looks for survive the row's two-chip cap: the checked-out
 * branch, HEAD, the default branch (`main`/`master`, local or remote), other local branches,
 * tags, then the remaining remote branches by name.
 *
 * Without the default-branch rank a shared tip listed `origin/main` below its sibling
 * remote branches and it was never actually shown.
 */
export function orderRefsForDisplay(
  commit: GitHistoryCommit,
  remoteNames: readonly string[],
): GitHistoryCommit["refs"] {
  const rank = (ref: GitHistoryCommit["refs"][number]) => {
    if (ref.kind === "branch" && ref.checkedOut) return 0;
    if (ref.kind === "head") return 1;
    if (DEFAULT_BRANCH_NAMES.has(shortRefName(ref, remoteNames))) return 2;
    return 10 + REF_KIND_PRIORITY[ref.kind];
  };
  const refs = commit.refs
    .filter((ref) => !isRemoteHead(ref, remoteNames))
    .toSorted(
      (left, right) =>
        rank(left) - rank(right) ||
        REF_KIND_PRIORITY[left.kind] - REF_KIND_PRIORITY[right.kind] ||
        left.name.localeCompare(right.name),
    );
  return refs;
}

export function GitCommitRefBadges(props: {
  commit: GitHistoryCommit;
  className?: string;
  /** Caps the row width: extra refs collapse into a "+N" chip. */
  maxVisible?: number;
  /** Configured remotes; a single remote lets its chips drop the `origin/` prefix. */
  remoteNames?: readonly string[];
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
  const ordered = dedupeRemoteRefs(
    orderRefsForDisplay(commit, props.remoteNames ?? []).filter(
      (ref) => !(ref.kind === "head" && checkedOutBranch !== undefined),
    ),
    props.remoteNames ?? [],
  );
  const visible = ordered.slice(0, maxVisible);
  const overflowCount = Math.max(0, ordered.length - maxVisible);

  return (
    <span className={cn("flex shrink-0 items-center gap-1", props.className)}>
      {visible.map((ref) => {
        const isHead = ref.kind === "head";
        const isTag = ref.kind === "tag";
        const isRemote = ref.kind === "remote";
        const Icon = isTag ? TagIcon : isRemote ? GlobeIcon : GitBranchIcon;
        const isCheckedOutBranch = ref.kind === "branch" && ref.checkedOut;
        const label = isHead
          ? t("git:historyHeadBadge")
          : resolveRefChipLabel(ref, props.remoteNames ?? []);
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
              // Grows with the pane so widening the dock reveals more of the name; the
              // row is a container, so these steps follow its real width.
              "inline-flex max-w-[8rem] shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-ui-xs font-medium @min-[26rem]:max-w-[13rem] @min-[34rem]:max-w-[20rem] @min-[46rem]:max-w-[28rem]",
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
      {overflowCount > 0 ? (
        <span
          className="shrink-0 text-ui-xs text-muted-foreground"
          title={ordered
            .slice(maxVisible)
            .map((ref) => (ref.kind === "head" ? t("git:historyHeadBadge") : ref.name))
            .join("\n")}
        >
          {t("git:historyMoreRefs", { value0: overflowCount })}
        </span>
      ) : null}
    </span>
  );
}
