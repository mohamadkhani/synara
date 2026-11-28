// FILE: gitHistorySelection.ts
// Purpose: Pure rules for the Git Graph's branch selection: the default set (current
//          branch plus its upstream), the lane budget, the drop that keeps a ninth
//          branch from widening the graph past the budget, and the filtering that keeps
//          the stored set valid as branches come and go.
// Layer: Git history UI helper
// Exports: GIT_HISTORY_BRANCH_BUDGET, GIT_HISTORY_SELECTION_STORAGE_KEY,
//          computeDefaultBranchSelection, sanitizeBranchSelection, toggleBranchSelection

/**
 * How many branches the graph walks at once. The palette hands out ten distinct colours,
 * so eight selected branches always keep their own hue.
 */
export const GIT_HISTORY_BRANCH_BUDGET = 8;

/**
 * The pane persists no other view state, so the branch selection is the one thing it
 * stores itself: one namespaced localStorage key holding a map from repository checkout
 * path to the ordered ref names the user selected. Path-keyed (rather than a key per
 * repository) so switching worktrees never races a key change, and so a deleted
 * checkout's entry is harmless.
 */
export const GIT_HISTORY_SELECTION_STORAGE_KEY = "synara:git-history:selected-refs:v1";

/** The conventional names of a repository's default branch. */
const DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);

/**
 * Every candidate that names the default branch, most authoritative first: the reported
 * default, then a local `main`/`master`, then the remote tracking branch of each. Empty when
 * the repository has neither.
 */
export function defaultBranchNamesFor(
  candidates: readonly string[],
  defaultBranch: string | null,
): string[] {
  const candidateSet = new Set(candidates);
  const names: string[] = [];
  const push = (name: string | null | undefined) => {
    if (name && candidateSet.has(name) && !names.includes(name)) names.push(name);
  };
  push(defaultBranch);
  for (const shortName of DEFAULT_BRANCH_NAMES) push(shortName);
  for (const candidate of candidates) {
    const shortName = candidate.includes("/") ? candidate.slice(candidate.indexOf("/") + 1) : null;
    if (shortName && DEFAULT_BRANCH_NAMES.has(shortName)) push(candidate);
  }
  return names;
}

/** The deterministic default: the current branch and its upstream, then fallbacks. */
export function computeDefaultBranchSelection(input: {
  candidates: readonly string[];
  currentBranch: string | null;
  upstreamBranch: string | null;
  defaultBranch: string | null;
  budget?: number;
}): string[] {
  const budget = Math.max(1, input.budget ?? GIT_HISTORY_BRANCH_BUDGET);
  const candidateSet = new Set(input.candidates);
  const selection: string[] = [];
  const add = (name: string | null | undefined) => {
    if (name && candidateSet.has(name) && !selection.includes(name)) selection.push(name);
  };

  if (input.currentBranch) {
    add(input.currentBranch);
    add(input.upstreamBranch);
  } else {
    // A detached HEAD has no current branch; the repository default is the next best
    // single ref to show.
    add(input.defaultBranch);
  }

  // The default branch is what a reader falls back to when the current branch is a topic
  // branch: `main`/`master` stays in the walk whenever it exists, local first and then its
  // remote tracking branch. It is added before the budget is applied, so it survives a full
  // selection.
  for (const name of defaultBranchNamesFor(input.candidates, input.defaultBranch)) add(name);

  return selection.slice(0, budget);
}

/** Keeps only the selected refs that are still candidate branches, in their stored order. */
export function sanitizeBranchSelection(
  selected: readonly string[],
  candidates: readonly string[],
): string[] {
  const candidateSet = new Set(candidates);
  return selected.filter((name) => candidateSet.has(name));
}

/**
 * Turns one branch on or off.
 *
 * Turning a branch on past the budget drops the least relevant already-selected branch:
 * the one whose position in `relevanceOrder` is greatest (current branch first, then the
 * default, then the remaining branches), with branches outside that order treated as the
 * least relevant. The dropped name is returned so the chip can say why it turned off.
 * The last selected branch is never dropped: the graph always walks something.
 */
export function toggleBranchSelection(input: {
  selected: readonly string[];
  branch: string;
  relevanceOrder: readonly string[];
  budget?: number;
}): { selected: string[]; dropped: string | null } {
  const budget = Math.max(1, input.budget ?? GIT_HISTORY_BRANCH_BUDGET);
  if (input.selected.includes(input.branch)) {
    if (input.selected.length <= 1) return { selected: [...input.selected], dropped: null };
    return { selected: input.selected.filter((name) => name !== input.branch), dropped: null };
  }

  const next = [...input.selected, input.branch];
  if (next.length <= budget) return { selected: next, dropped: null };

  const rank = new Map(input.relevanceOrder.map((name, index) => [name, index]));
  const droppable = next.filter((name) => name !== input.branch);
  let dropped = droppable[0]!;
  let droppedRank = rank.get(dropped) ?? Number.POSITIVE_INFINITY;
  for (const name of droppable) {
    const nameRank = rank.get(name) ?? Number.POSITIVE_INFINITY;
    if (nameRank > droppedRank) {
      dropped = name;
      droppedRank = nameRank;
    }
  }

  return { selected: next.filter((name) => name !== dropped), dropped };
}
