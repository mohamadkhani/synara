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
  harness.confirm.mockResolvedValue(false);
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
    await mount();

    await page.getByTitle("Local branch feature/local").click({ button: "right" });

    await expect.element(page.getByRole("button", { name: "Delete" })).toBeVisible();
    expect(harness.deleteBranchRef).not.toHaveBeenCalled();
  });
});
