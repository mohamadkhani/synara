import { describe, expect, it } from "vitest";

import {
  COMMIT_HISTORY_FIELD_SEPARATOR as F,
  COMMIT_HISTORY_RECORD_SEPARATOR as R,
  parseCommitDetailLog,
  parseCommitHistoryLog,
  parseCommitRefDecorations,
} from "./gitHistoryParsing.ts";

describe("parseCommitRefDecorations", () => {
  it("maps head, local branch, remote branch, and tag decorations", () => {
    expect(
      parseCommitRefDecorations(
        "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.0",
      ),
    ).toEqual([
      { name: "HEAD", kind: "head", checkedOut: false },
      { name: "main", kind: "branch", checkedOut: true },
      { name: "origin/main", kind: "remote", checkedOut: false },
      { name: "v1.0.0", kind: "tag", checkedOut: false },
    ]);
  });

  it("reports a detached head without inventing a branch", () => {
    expect(parseCommitRefDecorations("HEAD, tag: refs/tags/v2")).toEqual([
      { name: "HEAD", kind: "head", checkedOut: false },
      { name: "v2", kind: "tag", checkedOut: false },
    ]);
  });

  it("drops symbolic remote HEAD aliases", () => {
    expect(
      parseCommitRefDecorations(
        "refs/remotes/origin/HEAD -> refs/remotes/origin/main, refs/remotes/origin/main",
      ),
    ).toEqual([{ name: "origin/main", kind: "remote", checkedOut: false }]);
  });

  it("marks the checked-out branch even when other branches precede it", () => {
    // The UI reads `checkedOut`, so the head pair's position among decorations is
    // irrelevant; a second branch on the same commit stays unmarked.
    const refs = parseCommitRefDecorations(
      "refs/heads/other, HEAD -> refs/heads/main, refs/heads/main",
    );
    expect(refs).toEqual([
      { name: "other", kind: "branch", checkedOut: false },
      { name: "HEAD", kind: "head", checkedOut: false },
      { name: "main", kind: "branch", checkedOut: true },
    ]);
  });

  it("returns an empty list for an undecorated commit", () => {
    expect(parseCommitRefDecorations("")).toEqual([]);
  });
});

describe("parseCommitHistoryLog", () => {
  const record = (fields: string[]) => `${fields.join(F)}${R}`;

  it("parses parents, author, date, refs, and subject from a page", () => {
    const stdout =
      record([
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "aaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc",
        "Ada Lovelace",
        "ada@example.com",
        "2025-01-02T03:04:05+02:00",
        "HEAD -> refs/heads/main",
        "Merge branch 'feature'",
      ]) +
      "\n" +
      record([
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "bbbbbbb",
        "",
        "Grace Hopper",
        "grace@example.com",
        "2025-01-01T00:00:00Z",
        "",
        "Initial commit",
      ]);

    const commits = parseCommitHistoryLog(stdout);

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortSha: "aaaaaaa",
      parents: [
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "cccccccccccccccccccccccccccccccccccccccc",
      ],
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
      committedAt: "2025-01-02T03:04:05+02:00",
      subject: "Merge branch 'feature'",
      refs: [
        { name: "HEAD", kind: "head", checkedOut: false },
        { name: "main", kind: "branch", checkedOut: true },
      ],
    });
    expect(commits[1]?.parents).toEqual([]);
    expect(commits[1]?.refs).toEqual([]);
  });

  it("skips malformed records instead of failing the page", () => {
    const stdout = `${["", "", "orphan"].join(F)}${R}\n${["", ""].join(F)}${R}`;
    expect(parseCommitHistoryLog(stdout)).toEqual([]);
  });

  it("returns no commits for empty output", () => {
    expect(parseCommitHistoryLog("")).toEqual([]);
  });

  it("preserves a field separator inside the subject", () => {
    const stdout = record([
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "aaaaaaa",
      "",
      "Ada Lovelace",
      "ada@example.com",
      "2025-01-02T03:04:05+02:00",
      "",
      "Subject with \u001f separator",
    ]);

    expect(parseCommitHistoryLog(stdout)[0]?.subject).toBe("Subject with \u001f separator");
  });
});

describe("parseCommitDetailLog", () => {
  it("returns the full message alongside the commit", () => {
    const fields = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "aaaaaaa",
      "",
      "Ada Lovelace",
      "ada@example.com",
      "2025-01-02T03:04:05+02:00",
      "refs/heads/main, tag: refs/tags/v1",
      "Subject line",
      "Subject line\n\nBody paragraph.\n",
    ];
    const parsed = parseCommitDetailLog(fields.join(F) + R + "\n");

    expect(parsed?.message).toBe("Subject line\n\nBody paragraph.");
    expect(parsed?.commit.subject).toBe("Subject line");
    expect(parsed?.commit.refs).toEqual([
      { name: "main", kind: "branch", checkedOut: false },
      { name: "v1", kind: "tag", checkedOut: false },
    ]);
  });

  it("falls back to the subject when the body is empty", () => {
    const fields = ["aaa", "aa", "", "A", "a@b", "2025-01-01T00:00:00Z", "", "Only subject", ""];
    expect(parseCommitDetailLog(fields.join(F) + R)).toMatchObject({
      message: "Only subject",
      commit: { subject: "Only subject" },
    });
  });

  it("preserves a field separator inside the message body", () => {
    const fields = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "aaaaaaa",
      "",
      "Ada Lovelace",
      "ada@example.com",
      "2025-01-02T03:04:05+02:00",
      "",
      "Subject",
      "Subject\n\nBody with \u001f separator\n",
    ];
    const parsed = parseCommitDetailLog(fields.join(F) + R + "\n");

    expect(parsed?.commit.subject).toBe("Subject");
    expect(parsed?.message).toBe("Subject\n\nBody with \u001f separator");
  });

  it("returns null for missing output", () => {
    expect(parseCommitDetailLog("")).toBeNull();
  });
});
