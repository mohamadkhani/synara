// FILE: gitRefChipLabel.ts
// Purpose: The labels a ref chip row shows. A mirrored remote (a fork that repeats the
//          upstream branches) is dropped so the same branch is not listed twice, and a
//          remote chip drops its `origin/` prefix so the remote name is not repeated.
// Layer: Git history UI helper
// Exports: resolveRefChipLabel, dedupeRemoteRefs

import type { GitHistoryCommit } from "@synara/contracts";

type GitCommitRef = GitHistoryCommit["refs"][number];

/** The remote a remote ref belongs to, or null when the ref names no known remote. */
function remoteOf(ref: GitCommitRef, remoteNames: readonly string[]): string | null {
  if (ref.kind !== "remote") return null;
  return remoteNames.find((name) => ref.name.startsWith(`${name}/`)) ?? null;
}

/**
 * Keeps one remote chip per short branch name. A fork mirrors the upstream branches, so
 * the same commit is decorated twice (`origin/x` and `fork/x`); showing `x` once is
 * enough. `origin` wins when several remotes own the name. Local refs and tags stay.
 */
export function dedupeRemoteRefs(
  refs: readonly GitCommitRef[],
  remoteNames: readonly string[],
): GitCommitRef[] {
  const shortNameOf = (ref: GitCommitRef): string => {
    const remote = remoteOf(ref, remoteNames);
    return remote ? ref.name.slice(remote.length + 1) : ref.name;
  };
  const preferredRemote = remoteNames.includes("origin") ? "origin" : remoteNames[0];
  const bestIndex = new Map<string, number>();
  refs.forEach((ref, index) => {
    if (ref.kind !== "remote") return;
    const shortName = shortNameOf(ref);
    if (!bestIndex.has(shortName) || remoteOf(ref, remoteNames) === preferredRemote) {
      bestIndex.set(shortName, index);
    }
  });
  return refs.filter(
    (ref) => ref.kind !== "remote" || bestIndex.get(shortNameOf(ref)) === refs.indexOf(ref),
  );
}

export function resolveRefChipLabel(ref: GitCommitRef, remoteNames: readonly string[]): string {
  if (ref.kind !== "remote") return ref.name;
  const remote = remoteOf(ref, remoteNames);
  // A ref whose remote is no longer configured keeps its full name.
  return remote ? ref.name.slice(remote.length + 1) : ref.name;
}
