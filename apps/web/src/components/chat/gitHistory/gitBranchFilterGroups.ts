// FILE: gitBranchFilterGroups.ts
// Purpose: Namespace grouping for the branch filter menu. A repository with hundreds of
//          remote branches shows a few submenus instead of one flat list.
// Layer: Git history UI helper
// Exports: groupRemoteBranchesByNamespace, BRANCH_FILTER_RESULT_LIMIT, RemoteBranchGroup

import type { GitBranch } from "@synara/contracts";

/** How many filtered branches a search shows before the list stops growing. */
export const BRANCH_FILTER_RESULT_LIMIT = 60;

export interface RemoteBranchGroup {
  /** First segment after the remote name (`origin/synara/x` -> `synara`). */
  readonly namespace: string;
  readonly branches: readonly GitBranch[];
}

/**
 * Groups remote branches by the namespace after the remote name; branches without one
 * fall under their remote name. Groups are ordered by size, then by name.
 */
export function groupRemoteBranchesByNamespace(
  remoteBranches: readonly GitBranch[],
): RemoteBranchGroup[] {
  const groups = new Map<string, GitBranch[]>();
  for (const branch of remoteBranches) {
    const remoteName = branch.remoteName ?? "";
    const shortName =
      remoteName.length > 0 && branch.name.startsWith(`${remoteName}/`)
        ? branch.name.slice(remoteName.length + 1)
        : branch.name;
    const separatorIndex = shortName.indexOf("/");
    const namespace =
      separatorIndex > 0 ? shortName.slice(0, separatorIndex) : remoteName || shortName;
    const bucket = groups.get(namespace);
    if (bucket) bucket.push(branch);
    else groups.set(namespace, [branch]);
  }
  return [...groups.entries()]
    .map(([namespace, branches]) => ({
      namespace,
      branches: branches.toSorted((left, right) => left.name.localeCompare(right.name)),
    }))
    .toSorted(
      (left, right) =>
        right.branches.length - left.branches.length ||
        left.namespace.localeCompare(right.namespace),
    );
}
