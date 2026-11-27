// FILE: useGitHistoryBranchSelection.ts
// Purpose: React state for the Git Graph branch chip bar: the persisted per-repository
//          selection, the deterministic default (current branch + upstream), and the
//          budgeted toggle that reports which branch it dropped.
// Layer: Git history UI hook

import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import {
  GIT_HISTORY_BRANCH_BUDGET,
  GIT_HISTORY_SELECTION_STORAGE_KEY,
  computeDefaultBranchSelection,
  sanitizeBranchSelection,
  toggleBranchSelection,
} from "./gitHistorySelection";

const SELECTION_BY_REPO_SCHEMA = Schema.Record(Schema.String, Schema.Array(Schema.String));
type SelectionByRepo = typeof SELECTION_BY_REPO_SCHEMA.Type;
type SelectionByRepoEncoded = typeof SELECTION_BY_REPO_SCHEMA.Encoded;

// Module-scope so the storage hook's effects keep one identity across renders.
const EMPTY_SELECTION_BY_REPO: SelectionByRepo = {};

export interface GitHistoryBranchSelection {
  /** The refs the graph walks, most relevant first. Never empty once branches load. */
  readonly selected: readonly string[];
  /** Branch the last toggle dropped for the budget; its chip explains the drop. */
  readonly dropped: string | null;
  readonly toggle: (branch: string) => void;
  readonly showOnly: (branch: string) => void;
  readonly hideRest: (branch: string) => void;
  readonly showAll: () => void;
}

export function useGitHistoryBranchSelection(input: {
  cwd: string | null;
  /** Every selectable branch, current branch first, then default, locals, remotes. */
  candidates: readonly string[];
  /** The same order as `candidates`; later entries are less relevant when dropping. */
  relevanceOrder: readonly string[];
  currentBranch: string | null;
  upstreamBranch: string | null;
  defaultBranch: string | null;
  budget?: number;
}): GitHistoryBranchSelection {
  const budget = input.budget ?? GIT_HISTORY_BRANCH_BUDGET;
  const { cwd, candidates, relevanceOrder, currentBranch, upstreamBranch, defaultBranch } = input;
  const [selectionByRepo, setSelectionByRepo] = useLocalStorage<
    SelectionByRepo,
    SelectionByRepoEncoded
  >(GIT_HISTORY_SELECTION_STORAGE_KEY, EMPTY_SELECTION_BY_REPO, SELECTION_BY_REPO_SCHEMA);
  const [dropped, setDropped] = useState<string | null>(null);

  // Drop refs that are no longer candidates (a deleted branch, or remote refs when the
  // "Show remote branches" switch turns off) from the stored set. An entry that loses all
  // its refs is removed, so the next render falls back to the default.
  useEffect(() => {
    if (!cwd) return;
    setSelectionByRepo((previous) => {
      const stored = previous[cwd];
      if (!stored || stored.length === 0) return previous;
      const sanitized = sanitizeBranchSelection(stored, candidates);
      if (sanitized.length === stored.length) return previous;
      if (sanitized.length === 0) {
        const remaining: Record<string, readonly string[]> = { ...previous };
        delete remaining[cwd];
        return remaining;
      }
      return { ...previous, [cwd]: sanitized };
    });
  }, [candidates, cwd, setSelectionByRepo]);

  // A branch notice belongs to one repository, so it does not survive a worktree switch.
  useEffect(() => {
    setDropped(null);
  }, [cwd]);

  const selected = useMemo(() => {
    const stored = cwd ? selectionByRepo[cwd] : undefined;
    if (stored && stored.length > 0) return sanitizeBranchSelection(stored, candidates);
    return computeDefaultBranchSelection({
      candidates,
      currentBranch,
      upstreamBranch,
      defaultBranch,
      budget,
    });
  }, [budget, candidates, currentBranch, cwd, defaultBranch, selectionByRepo, upstreamBranch]);

  const apply = useCallback(
    (next: readonly string[], nextDropped: string | null) => {
      if (!cwd) return;
      setSelectionByRepo((previous) => ({ ...previous, [cwd]: [...next] }));
      setDropped(nextDropped);
    },
    [cwd, setSelectionByRepo],
  );

  const toggle = useCallback(
    (branch: string) => {
      const result = toggleBranchSelection({ selected, branch, relevanceOrder, budget });
      apply(result.selected, result.dropped);
    },
    [apply, budget, relevanceOrder, selected],
  );

  const showOnly = useCallback(
    (branch: string) => {
      apply(sanitizeBranchSelection([branch], candidates), null);
    },
    [apply, candidates],
  );

  // Keep the clicked branch and the checked-out branch; hide every other selected branch.
  const hideRest = useCallback(
    (branch: string) => {
      const keep = currentBranch && currentBranch !== branch ? [currentBranch, branch] : [branch];
      apply(sanitizeBranchSelection(keep, candidates), null);
    },
    [apply, candidates, currentBranch],
  );

  // As many branches as the budget allows, most relevant first.
  const showAll = useCallback(() => {
    apply(relevanceOrder.slice(0, budget), null);
  }, [apply, budget, relevanceOrder]);

  return { selected, dropped, toggle, showOnly, hideRest, showAll };
}
