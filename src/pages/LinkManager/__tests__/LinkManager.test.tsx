import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinkManager } from "../LinkManager";
import { useLinkStore } from "../../../store/useLinkStore";
import { useProjectStore } from "../../../store/useProjectStore";
import { commands } from "../../../bindings";

vi.mock("../../../bindings", () => ({
  commands: {
    runSandboxScript: vi.fn().mockResolvedValue({ status: "ok", data: "Smoke test passed: successfully imported mylib" }),
    checkPackageCli: vi.fn().mockResolvedValue({ status: "ok", data: false }),
    getPackageScripts: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
    getWatchCommand: vi.fn().mockResolvedValue({ status: "ok", data: null }),
    writePty: vi.fn(),
    openInExplorer: vi.fn(),
  }
}));

vi.mock("../../../store/useLinkStore");
vi.mock("../../../store/useProjectStore");
vi.mock("../../../store/useSettingsStore", () => ({
  useSettingsStore: vi.fn().mockReturnValue({ config: null })
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 90,
    measureElement: vi.fn(),
  }),
}));

// ResizeObserver is polyfilled globally in setupTests.ts.

describe("LinkManager - Smoke Test Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (useLinkStore as any).mockReturnValue({
      activeLinks: [{
        id: "link-1",
        source_package: "mylib",
        target_project: "my-app",
        source_path: "/src/mylib",
        target_path: "/src/my-app",
        status: "Active",
        method: "symlink",
        watch_enabled: false
      }],
      pendingDeletions: new Set(),
      fetchLinks: vi.fn(),
      removeLink: vi.fn(),
      markForDeletion: vi.fn(),
      undoDeletion: vi.fn(),
      loading: false,
      pendingTab: null,
      setPendingTab: vi.fn(),
    });

    (useProjectStore as any).mockReturnValue({
      projects: [],
      pendingDeletions: new Set(),
    });
  });

  it("should call projectApi.runSandboxScript when smoke test button is clicked and transition states", async () => {
    let resolveScript: (value: string) => void;
    (commands.runSandboxScript as any).mockReturnValue(
      new Promise((resolve) => {
        resolveScript = resolve;
      })
    );

    render(<LinkManager />);
    
    // Virtualizer requires waiting for items to render
    const runBtn = await screen.findByTitle("Run Import & CLI Smoke Test in Sandbox");
    
    fireEvent.click(runBtn);
    
    // Assert spinner state is active
    const spinner = await screen.findByRole("progressbar");
    expect(spinner).toBeInTheDocument();
    
    expect(commands.runSandboxScript).toHaveBeenCalledWith("/src/my-app");
    
    // Resolve the script properly wrapped in act to avoid warnings
    act(() => {
      resolveScript("Smoke test passed");
    });
    
    // Assert toast is rendered
    const toast = await screen.findByText("Smoke test completed for mylib");
    expect(toast).toBeInTheDocument();
    
    // Assert spinner is removed
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });
});
