// FILE: GitHistoryPanel.browser.tsx
// Purpose: Exercises the Git Graph panel's interactive paths: the remote-branch
//          checkout confirmation, the commit detail maximize toggle, and the commit
//          and ref context menus.
// Layer: Browser UI test

import "../../../index.css";

import { DEFAULT_SERVER_SETTINGS_VIEW, type GitHistoryCommit } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { serverQueryKeys } from "~/lib/serverReactQuery";

const harness = vi.hoisted(() => ({
  listBranches: vi.fn(),
  listCommitHistory: vi.fn(),
  workingTreeDiffStats: vi.fn(),
  githubRepository: vi.fn(),
  readCommitDiff: vi.fn(),
  checkoutRemoteBranch: vi.fn(),
  checkout: vi.fn(),
  checkoutCommit: vi.fn(),
  cherryPickCommit: vi.fn(),
  revertCommit: vi.fn(),
  createBranch: vi.fn(),
  createTag: vi.fn(),
  deleteBranchRef: vi.fn(),
  pushBranch: vi.fn(),
  pullBranch: vi.fn(),
  mergeBranch: vi.fn(),
  rebaseBranch: vi.fn(),
  stashCreate: vi.fn(),
  stashList: vi.fn(),
  stashApply: vi.fn(),
  stashDrop: vi.fn(),
  confirm: vi.fn(),
  contextMenuShow: vi.fn(),
  listWorktrees: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/nativeApi", () => {
  const api = {
    git: {
      listBranches: harness.listBranches,
      listCommitHistory: harness.listCommitHistory,
      workingTreeDiffStats: harness.workingTreeDiffStats,
      githubRepository: harness.githubRepository,
      readCommitDiff: harness.readCommitDiff,
      checkoutRemoteBranch: harness.checkoutRemoteBranch,
      checkout: harness.checkout,
      checkoutCommit: harness.checkoutCommit,
      cherryPickCommit: harness.cherryPickCommit,
      revertCommit: harness.revertCommit,
      createBranch: harness.createBranch,
      createTag: harness.createTag,
      deleteBranchRef: harness.deleteBranchRef,
      pushBranch: harness.pushBranch,
      pullBranch: harness.pullBranch,
      mergeBranch: harness.mergeBranch,
      rebaseBranch: harness.rebaseBranch,
      stashCreate: harness.stashCreate,
      stashList: harness.stashList,
      stashApply: harness.stashApply,
      stashDrop: harness.stashDrop,
    },
    server: { listWorktrees: harness.listWorktrees },
    dialogs: { confirm: harness.confirm },
    contextMenu: { show: harness.contextMenuShow },
  };
  return { readNativeApi: () => api, ensureNativeApi: () => api };
});
vi.mock("../../ui/toast", () => ({ toastManager: { add: harness.toastAdd } }));

import { GitHistoryPanel } from "./GitHistoryPanel";

const commit: GitHistoryCommit = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  parents: [],
  subject: "Add feature",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  committedAt: "2025-01-02T03:04:05+02:00",
  refs: [
    { name: "feature/local", kind: "branch", checkedOut: false },
    { name: "origin/feature", kind: "remote", checkedOut: false },
  ],
};

const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(serverQueryKeys.settings(), DEFAULT_SERVER_SETTINGS_VIEW);
  return render(
    <QueryClientProvider client={client}>
      <div style={{ height: 480 }}>
        <GitHistoryPanel activeCwd="/repo" primaryCwd="/repo" theme="light" />
      </div>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await page.viewport(1024, 800);
  // Skip the one-time settings migration so `useAppSettings` never reaches the server.
  localStorage.setItem("synara:server-settings-migrated:v1", "1");
  harness.listBranches.mockResolvedValue({
    branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    isRepo: true,
    hasOriginRemote: true,
    remoteNames: ["origin"],
  });
  harness.listCommitHistory.mockResolvedValue({ commits: [commit], hasMore: false });
  harness.workingTreeDiffStats.mockResolvedValue({ additions: 0, deletions: 0, fileCount: 0 });
  harness.githubRepository.mockResolvedValue({ repository: null, repositories: [] });
  harness.readCommitDiff.mockResolvedValue({
    commit,
    message: commit.subject,
    patch: "",
    truncated: false,
  });
  harness.checkoutRemoteBranch.mockResolvedValue({
    branch: "feature",
    created: true,
    updated: true,
  });
  harness.checkout.mockResolvedValue(undefined);
  harness.checkoutCommit.mockResolvedValue(undefined);
  harness.cherryPickCommit.mockResolvedValue({ commitSha: "b".repeat(40), subject: "picked" });
  harness.revertCommit.mockResolvedValue({ commitSha: "b".repeat(40), subject: "reverted" });
  harness.createBranch.mockResolvedValue(undefined);
  harness.createTag.mockResolvedValue({ ok: true });
  harness.deleteBranchRef.mockResolvedValue({ remoteName: null, requiresForce: false });
  harness.pushBranch.mockResolvedValue({ ok: true });
  harness.pullBranch.mockResolvedValue({
    status: "pulled",
    branch: "main",
    upstreamBranch: "origin/main",
  });
  harness.mergeBranch.mockResolvedValue({ ok: true });
  harness.rebaseBranch.mockResolvedValue({ ok: true });
  harness.stashCreate.mockReset();
  harness.stashCreate.mockResolvedValue({ message: "wip" });
  harness.stashList.mockReset();
  harness.stashList.mockResolvedValue({ stashes: [] });
  harness.stashApply.mockReset();
  harness.stashApply.mockResolvedValue({ status: "applied" });
  harness.stashDrop.mockReset();
  harness.stashDrop.mockResolvedValue(undefined);
  harness.confirm.mockResolvedValue(false);
  harness.contextMenuShow.mockReset();
  harness.contextMenuShow.mockResolvedValue(undefined);
  harness.listWorktrees.mockResolvedValue({ worktrees: [] });
  harness.toastAdd.mockReset();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  document.body.innerHTML = "";
  localStorage.removeItem("synara:server-settings-migrated:v1");
  localStorage.removeItem("synara:app-settings:v1");
});

describe("GitHistoryPanel", () => {
  it("does not check out a remote branch when the confirmation is declined", async () => {
    harness.contextMenuShow.mockResolvedValue("checkout-branch");
    harness.confirm.mockResolvedValue(false);
    await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    await vi.waitFor(() => expect(harness.confirm).toHaveBeenCalledOnce());
    expect(harness.checkoutRemoteBranch).not.toHaveBeenCalled();
  });

  it("checks out the remote branch after confirmation", async () => {
    harness.contextMenuShow.mockResolvedValue("checkout-branch");
    harness.confirm.mockResolvedValue(true);
    await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.checkoutRemoteBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        remoteBranch: "origin/feature",
      }),
    );
  });

  it("toggles the selected commit into the expanded detail layout", async () => {
    await mount();

    await page.getByTitle("Add feature").click();
    await expect.element(page.getByRole("button", { name: "Expand details" })).toBeVisible();
    await page.getByRole("button", { name: "Expand details" }).click();
    await expect.element(page.getByRole("button", { name: "Collapse details" })).toBeVisible();
  });

  it("runs the commit action chosen from the row context menu", async () => {
    harness.contextMenuShow.mockResolvedValue("cherry-pick");
    await mount();

    await page.getByTitle("Add feature").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.cherryPickCommit).toHaveBeenCalledWith({ cwd: "/repo", sha: commit.sha }),
    );
  });

  it("opens the delete dialog from a branch ref context menu", async () => {
    harness.contextMenuShow.mockResolvedValue("delete-branch");
    const screen = await mount();

    await page.getByTitle("Local branch feature/local").click({ button: "right" });

    await expect.element(page.getByRole("button", { name: "Delete" })).toBeVisible();
    expect(harness.deleteBranchRef).not.toHaveBeenCalled();
    // Unmount with the dialog still open: leaving the portal behind for afterEach's
    // body reset makes React remove nodes that are no longer its children.
    await screen.unmount();
  });

  it("keeps drawing lanes when the history is deeper than the pane's cap", async () => {
    // Thirty lanes on one row exceed the twenty-four-column cap of this viewport. The row
    // clips to the cap and keeps drawing lanes; it does not turn the list into one rail.
    const parents = Array.from({ length: 30 }, (_value, index) => `q${index}`.padEnd(40, "0"));
    harness.listCommitHistory.mockResolvedValue({
      commits: [{ ...commit, sha: "1".repeat(40), subject: "deep row", parents, refs: [] }],
      hasMore: false,
    });
    const screen = await mount();

    const row = page.getByTitle("deep row");
    await expect.element(row).toBeVisible();
    // Capped at the pane's twenty-four columns, not flattened into one rail.
    expect(row.element().querySelector("svg")?.getAttribute("width")).toBe("288");
    // Several lanes are drawn: a rail would draw a single path.
    expect(row.element().querySelectorAll("path").length).toBeGreaterThan(1);
    await expect.element(page.getByText(/parallel branches/)).toBeVisible();
    await screen.unmount();
  });

  it("groups remote branches by namespace and filters them by name", async () => {
    harness.listBranches.mockResolvedValue({
      branches: [
        { name: "main", current: true, isDefault: true, worktreePath: null },
        {
          name: "origin/main",
          isRemote: true,
          remoteName: "origin",
          current: false,
          isDefault: false,
          worktreePath: null,
        },
        {
          name: "origin/synara/fix-one",
          isRemote: true,
          remoteName: "origin",
          current: false,
          isDefault: false,
          worktreePath: null,
        },
        {
          name: "origin/codex/thing",
          isRemote: true,
          remoteName: "origin",
          current: false,
          isDefault: false,
          worktreePath: null,
        },
      ],
      isRepo: true,
      hasOriginRemote: true,
      remoteNames: ["origin"],
    });
    const screen = await mount();

    await page.getByRole("button", { name: "Branches" }).click();
    await expect.element(page.getByRole("menuitem", { name: /synara/ })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: /codex/ })).toBeVisible();

    await page.getByLabelText("Filter branches").fill("fix-one");
    await expect
      .element(page.getByRole("menuitemradio", { name: "origin/synara/fix-one" }))
      .toBeVisible();
    // The other namespaces drop out of the filtered list.
    expect(page.getByRole("menuitemradio", { name: "origin/codex/thing" }).elements()).toHaveLength(
      0,
    );

    await page.getByRole("menuitemcheckbox", { name: "Show remote branches" }).click();
    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeRemoteBranches: false }),
      ),
    );
    // Close the menu before unmounting so its portal is not torn down with the root.
    await screen.unmount();
  });

  it("shows the short remote name on the chip and the full ref on hover", async () => {
    const screen = await mount();

    const chip = page.getByTitle("Remote branch origin/feature");
    await expect.element(chip).toBeVisible();
    await expect.element(chip).toHaveTextContent("feature");
    expect(chip.element().textContent).not.toContain("origin/");
    await screen.unmount();
  });

  it("stashes the staged row with the title typed into its dialog", async () => {
    harness.workingTreeDiffStats.mockResolvedValue({ additions: 1, deletions: 0, fileCount: 1 });
    harness.contextMenuShow.mockResolvedValue("stash-changes");
    const screen = await mount();

    await page.getByTitle("Staged changes", { exact: true }).click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-changes"]);

    await expect.element(page.getByText("Stash staged changes", { exact: true })).toBeVisible();
    await page.getByLabelText("Stash title").fill("before the refactor");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledWith({
        cwd: "/repo",
        message: "before the refactor",
        scope: "staged",
        includeUnstaged: false,
      }),
    );
    await screen.unmount();
  });

  it("stashes the unstaged row without the staged scope", async () => {
    harness.workingTreeDiffStats.mockResolvedValue({ additions: 1, deletions: 0, fileCount: 1 });
    harness.contextMenuShow.mockResolvedValue("stash-changes");
    const screen = await mount();

    await page.getByTitle("Unstaged changes", { exact: true }).click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-changes"]);

    await expect.element(page.getByText("Stash unstaged changes", { exact: true })).toBeVisible();
    await page.getByLabelText("Stash title").fill("scratch edits");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledWith({
        cwd: "/repo",
        message: "scratch edits",
        scope: "unstaged",
        includeStaged: false,
      }),
    );
    await screen.unmount();
  });

  it("lists stashes and runs pop and delete from their context menu", async () => {
    harness.stashList.mockResolvedValue({
      stashes: [
        {
          stashRef: "stash@{0}",
          message: "On main: wip one",
          sha: "c".repeat(40),
          createdAt: "2026-11-26T10:00:00Z",
        },
      ],
    });
    harness.contextMenuShow.mockResolvedValue("stash-pop");
    const screen = await mount();

    const stashRow = page.getByTitle("stash@{0}: On main: wip one");
    await expect.element(stashRow).toBeVisible();
    await stashRow.click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-apply", "stash-pop", "stash-delete"]);

    await vi.waitFor(() =>
      expect(harness.stashApply).toHaveBeenCalledWith({
        cwd: "/repo",
        stashRef: "stash@{0}",
        mode: "pop",
      }),
    );

    harness.contextMenuShow.mockResolvedValue("stash-delete");
    await stashRow.click({ button: "right" });

    await expect.element(page.getByText("Delete stash", { exact: true })).toBeVisible();
    expect(harness.stashDrop).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Delete" }).click();

    await vi.waitFor(() =>
      expect(harness.stashDrop).toHaveBeenCalledWith({ cwd: "/repo", stashRef: "stash@{0}" }),
    );
    await screen.unmount();
  });

  it("applies a stash without dropping it when the menu asks for apply", async () => {
    harness.stashList.mockResolvedValue({
      stashes: [
        {
          stashRef: "stash@{1}",
          message: "On main: parked",
          sha: "d".repeat(40),
          createdAt: "2026-11-26T09:00:00Z",
        },
      ],
    });
    harness.contextMenuShow.mockResolvedValue("stash-apply");
    const screen = await mount();

    await page.getByTitle("stash@{1}: On main: parked").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.stashApply).toHaveBeenCalledWith({
        cwd: "/repo",
        stashRef: "stash@{1}",
        mode: "apply",
      }),
    );
    await screen.unmount();
  });

  it("offers push, merge, and rebase for a local branch and runs the push it confirms", async () => {
    harness.contextMenuShow.mockResolvedValue("branch-push");
    const screen = await mount();

    await page.getByTitle("Local branch feature/local").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("checkout-branch");
    expect(ids).toContain("branch-push");
    expect(ids).toContain("branch-merge");
    expect(ids).toContain("branch-rebase");

    await expect.element(page.getByText("Push branch", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("git push --set-upstream origin feature/local"))
      .toBeVisible();
    await page.getByRole("button", { name: "Push" }).click();

    await vi.waitFor(() =>
      expect(harness.pushBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        branch: "feature/local",
        remote: "origin",
        setUpstream: true,
        forceWithLease: false,
      }),
    );
    await screen.unmount();
  });

  it("drops checkout and offers pull for the checked-out branch that tracks an upstream", async () => {
    harness.listCommitHistory.mockResolvedValue({
      commits: [{ ...commit, refs: [{ name: "main", kind: "branch", checkedOut: true }] }],
      hasMore: false,
    });
    harness.listBranches.mockResolvedValue({
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
          upstreamRemote: "origin",
        },
      ],
      isRepo: true,
      hasOriginRemote: true,
      remoteNames: ["origin"],
    });
    harness.contextMenuShow.mockResolvedValue("branch-pull");
    const screen = await mount();

    await page.getByTitle("Checked-out branch main").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).not.toContain("checkout-branch");
    expect(ids).toContain("branch-push");
    expect(ids).toContain("branch-pull");
    expect(ids).not.toContain("branch-merge");

    await expect.element(page.getByText("Pull branch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("git pull origin main")).toBeVisible();
    await page.getByRole("button", { name: "Pull" }).click();

    await vi.waitFor(() =>
      expect(harness.pullBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        remote: "origin",
        branch: "main",
        rebase: false,
      }),
    );
    await screen.unmount();
  });

  it("hides pull for the checked-out branch when it has no upstream", async () => {
    harness.listCommitHistory.mockResolvedValue({
      commits: [{ ...commit, refs: [{ name: "main", kind: "branch", checkedOut: true }] }],
      hasMore: false,
    });
    harness.contextMenuShow.mockResolvedValue(undefined);
    await mount();

    await page.getByTitle("Checked-out branch main").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("branch-push");
    expect(ids).not.toContain("branch-pull");
  });

  it("offers merge and rebase for a non-current remote branch", async () => {
    harness.contextMenuShow.mockResolvedValue("branch-rebase");
    const screen = await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("branch-merge");
    expect(ids).toContain("branch-rebase");
    expect(ids).not.toContain("branch-pull");

    await expect.element(page.getByText("Rebase branch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("git rebase origin/feature")).toBeVisible();
    await page.getByRole("button", { name: "Rebase" }).click();

    await vi.waitFor(() =>
      expect(harness.rebaseBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        ref: "origin/feature",
        autosquash: false,
      }),
    );
    await screen.unmount();
  });
});

interface MenuItemLike {
  id: string;
  children?: readonly MenuItemLike[];
}

/** Every id in a context menu, including the rows nested in submenus. */
function contextMenuIds(items: readonly MenuItemLike[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
    if (item.children) ids.push(...contextMenuIds(item.children));
  }
  return ids;
}
