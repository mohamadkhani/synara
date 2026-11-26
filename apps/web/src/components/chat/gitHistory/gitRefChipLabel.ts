// FILE: gitRefChipLabel.ts
// Purpose: The label a ref chip shows. Remote chips drop the `origin/` prefix when the
//          repository has a single remote, so every remote chip does not repeat it.
// Layer: Git history UI helper
// Exports: resolveRefChipLabel

import type { GitHistoryCommit } from "@synara/contracts";

export function resolveRefChipLabel(
  ref: GitHistoryCommit["refs"][number],
  remoteNames: readonly string[],
): string {
  // With several remotes the prefix is what tells `origin/x` and `upstream/x` apart.
  if (ref.kind !== "remote" || remoteNames.length !== 1) return ref.name;
  const prefix = `${remoteNames[0]}/`;
  return ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name;
}
