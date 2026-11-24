// FILE: gitHistoryParsing.ts
// Purpose: Pure parsers for the commit-history view: `git log` records and `%D`
//          ref decorations, kept out of GitCore so they are testable without a repo.
// Layer: Server Git parsing helpers

import type { GitCommitRef, GitHistoryCommit } from "@synara/contracts";

/**
 * Field separator inside one log record. Refs cannot contain control characters, but a
 * commit message is user data and may contain this byte, so the parsers fold every
 * surplus split part back into the trailing message field instead of truncating it. A
 * separator embedded in a non-trailing field is still not recoverable.
 */
export const COMMIT_HISTORY_FIELD_SEPARATOR = "\u001f";
/**
 * Record separator between log entries. `git log --format` appends a newline after
 * each record, so every record after the first starts with "\n". A message that
 * contains this byte is not escaped by git and would split its record; that is a
 * documented limitation of this format.
 */
export const COMMIT_HISTORY_RECORD_SEPARATOR = "\u001e";

/** `git log` format for list rows: id, short id, parents, author, date, refs, subject. */
export const COMMIT_HISTORY_LIST_FORMAT =
  ["%H", "%h", "%P", "%an", "%ae", "%cI", "%D", "%s"].join("%x1f") + "%x1e";

/** `git log` format for one commit: list fields plus the full message body. */
export const COMMIT_HISTORY_DETAIL_FORMAT =
  ["%H", "%h", "%P", "%an", "%ae", "%cI", "%D", "%s", "%B"].join("%x1f") + "%x1e";

const HEAD_DECORATION = "HEAD";
const TAG_DECORATION_PREFIX = "tag: ";
const LOCAL_BRANCH_PREFIX = "refs/heads/";
const REMOTE_BRANCH_PREFIX = "refs/remotes/";
const TAG_PREFIX = "refs/tags/";

/**
 * Parse one commit's `%D` decoration list, as produced under `--decorate=full`.
 * Symbolic refs (`origin/HEAD -> origin/main`) are dropped; the commit itself is
 * still decorated with the ref it points at by that ref's own decoration entry.
 * The local branch HEAD points at is marked `checkedOut` here, so no consumer has
 * to rely on the order of decoration entries.
 */
export function parseCommitRefDecorations(decoration: string): GitCommitRef[] {
  const refs: GitCommitRef[] = [];
  const seen = new Set<string>();
  const push = (ref: GitCommitRef) => {
    const key = `${ref.kind}\u0000${ref.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  const pushBranch = (name: string, checkedOut: boolean) =>
    push({ name, kind: "branch", checkedOut });

  for (const rawEntry of decoration.split(", ")) {
    const entry = rawEntry.trim();
    if (entry.length === 0) continue;

    if (entry.startsWith(TAG_DECORATION_PREFIX)) {
      const name = stripRefPrefix(entry.slice(TAG_DECORATION_PREFIX.length), TAG_PREFIX);
      if (name.length > 0) push({ name, kind: "tag", checkedOut: false });
      continue;
    }

    const arrowIndex = entry.indexOf(" -> ");
    if (arrowIndex >= 0) {
      const source = entry.slice(0, arrowIndex).trim();
      const target = entry.slice(arrowIndex + 4).trim();
      // Only a checked-out `HEAD -> refs/heads/...` pair names a real ref pair;
      // `refs/remotes/*/HEAD` is a symbolic alias we do not render.
      if (source === HEAD_DECORATION) {
        push({ name: HEAD_DECORATION, kind: "head", checkedOut: false });
        const branchName = stripRefPrefix(target, LOCAL_BRANCH_PREFIX);
        if (branchName.length > 0) pushBranch(branchName, true);
        else {
          const remoteName = stripRefPrefix(target, REMOTE_BRANCH_PREFIX);
          if (remoteName.length > 0) push({ name: remoteName, kind: "remote", checkedOut: false });
        }
      }
      continue;
    }

    if (entry === HEAD_DECORATION) {
      push({ name: HEAD_DECORATION, kind: "head", checkedOut: false });
      continue;
    }

    const localBranch = stripRefPrefix(entry, LOCAL_BRANCH_PREFIX);
    if (localBranch.length > 0) {
      pushBranch(localBranch, false);
      continue;
    }
    const remoteBranch = stripRefPrefix(entry, REMOTE_BRANCH_PREFIX);
    if (remoteBranch.length > 0) {
      push({ name: remoteBranch, kind: "remote", checkedOut: false });
      continue;
    }
    const tag = stripRefPrefix(entry, TAG_PREFIX);
    if (tag.length > 0) push({ name: tag, kind: "tag", checkedOut: false });
  }

  return refs;
}

function stripRefPrefix(refName: string, prefix: string): string {
  if (!refName.startsWith(prefix)) return "";
  return refName.slice(prefix.length).trim();
}

function splitCommitRecords(stdout: string): string[] {
  return stdout
    .split(COMMIT_HISTORY_RECORD_SEPARATOR)
    .map((record) => record.replace(/^\r?\n/, ""))
    .filter((record) => record.trim().length > 0);
}

function parseParents(value: string): string[] {
  return value
    .split(" ")
    .map((sha) => sha.trim())
    .filter((sha) => sha.length > 0);
}

function parseHistoryFields(record: string): string[] {
  return record.split(COMMIT_HISTORY_FIELD_SEPARATOR);
}

/**
 * Parse `COMMIT_HISTORY_LIST_FORMAT` output. Malformed records (missing id or short
 * id) are skipped rather than failing the whole page.
 */
export function parseCommitHistoryLog(stdout: string): GitHistoryCommit[] {
  const commits: GitHistoryCommit[] = [];
  for (const record of splitCommitRecords(stdout)) {
    const fields = parseHistoryFields(record);
    const [
      sha = "",
      shortSha = "",
      parents = "",
      authorName = "",
      authorEmail = "",
      committedAt = "",
      decoration = "",
      ...subjectParts
    ] = fields;
    if (sha.length === 0 || shortSha.length === 0) continue;
    commits.push({
      sha,
      shortSha,
      parents: parseParents(parents),
      authorName,
      authorEmail,
      committedAt,
      refs: parseCommitRefDecorations(decoration),
      subject: subjectParts.join(COMMIT_HISTORY_FIELD_SEPARATOR),
    });
  }
  return commits;
}

export interface ParsedCommitDetail {
  readonly commit: GitHistoryCommit;
  /** Full commit message; `subject` is its first line. */
  readonly message: string;
}

/** Parse a single record from `COMMIT_HISTORY_DETAIL_FORMAT`. */
export function parseCommitDetailLog(stdout: string): ParsedCommitDetail | null {
  const record = splitCommitRecords(stdout)[0];
  if (record === undefined) return null;
  const fields = parseHistoryFields(record);
  const [
    sha = "",
    shortSha = "",
    parents = "",
    authorName = "",
    authorEmail = "",
    committedAt = "",
    decoration = "",
    subject = "",
    ...bodyParts
  ] = fields;
  if (sha.length === 0 || shortSha.length === 0) return null;
  const body = bodyParts.join(COMMIT_HISTORY_FIELD_SEPARATOR);
  return {
    commit: {
      sha,
      shortSha,
      parents: parseParents(parents),
      authorName,
      authorEmail,
      committedAt,
      refs: parseCommitRefDecorations(decoration),
      subject,
    },
    message: body.trim().length > 0 ? body.trimEnd() : subject,
  };
}
