// FILE: GitStashDialog.browser.tsx
// Purpose: Confirms the stash dialog asks for a title, offers the opposite-scope
//          include checkbox, and sends the exact scope and flags it shows.
// Layer: Browser UI test

import "../../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  stashCreate: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    git: {
      stashCreate: harness.stashCreate,
    },
  }),
}));
vi.mock("../../ui/toast", () => ({ toastManager: { add: harness.toastAdd } }));

import { GitStashDialog, type GitStashScope } from "./GitStashDialog";

const clients: QueryClient[] = [];
const onOpenChange = vi.fn();

async function mount(scope: GitStashScope) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const screen = await render(
    <QueryClientProvider client={client}>
      <GitStashDialog open cwd="/repo" scope={scope} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  return screen;
}

beforeEach(async () => {
  // A desktop viewport keeps DialogPopup out of its bottom-sheet layout.
  await page.viewport(1024, 800);
  harness.stashCreate.mockReset();
  harness.stashCreate.mockResolvedValue({ message: "wip" });
  harness.toastAdd.mockReset();
  onOpenChange.mockReset();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("GitStashDialog", () => {
  it("requires a title and sends the staged scope with the include-unstaged flag", async () => {
    const screen = await mount("staged");

    await expect.element(page.getByText("Stash staged changes", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Include unstaged changes" }))
      .not.toBeChecked();
    await expect.element(page.getByRole("button", { name: "Stash" })).toBeDisabled();

    await page.getByLabelText("Stash title").fill("before the refactor");
    await page.getByRole("checkbox", { name: "Include unstaged changes" }).click();
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        message: "before the refactor",
        scope: "staged",
        includeUnstaged: true,
      }),
    );
    await screen.unmount();
  });

  it("keeps staged changes out of the unstaged stash request by default", async () => {
    const screen = await mount("unstaged");

    await expect.element(page.getByText("Stash unstaged changes", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Include staged changes" }))
      .not.toBeChecked();

    await page.getByLabelText("Stash title").fill("park the scratch edits");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        message: "park the scratch edits",
        scope: "unstaged",
        includeStaged: false,
      }),
    );
    await screen.unmount();
  });

  it("adds the staged changes when the unstaged stash ticks the box", async () => {
    const screen = await mount("unstaged");

    await page.getByRole("checkbox", { name: "Include staged changes" }).click();
    await page.getByLabelText("Stash title").fill("everything");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        message: "everything",
        scope: "unstaged",
        includeStaged: true,
      }),
    );
    await screen.unmount();
  });
});
