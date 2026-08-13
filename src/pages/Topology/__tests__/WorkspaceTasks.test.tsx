import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { WorkspaceTasks } from "../WorkspaceTasks";
import { useProjectStore } from "../../../store/useProjectStore";
import { useTerminalStore } from "../../../store/useTerminalStore";
import { commands } from "../../../bindings";

vi.mock("../../../bindings", () => ({
  commands: {
    runWorkspaceTask: vi.fn(),
    runPackageTask: vi.fn(),
  },
}));

const runWorkspaceTask = commands.runWorkspaceTask as unknown as ReturnType<typeof vi.fn>;
const runPackageTask = commands.runPackageTask as unknown as ReturnType<typeof vi.fn>;

const project = (workspaceTool: string) => ({
  id: "p1",
  name: "monorepo",
  path: "/repo",
  package_manager: "Pnpm",
  packages: [
    { name: "api", version: "1.0.0", path: "/repo/api" },
    { name: "web", version: "1.0.0", path: "/repo/web" },
  ],
  ignored_packages: [],
  only_cli: false,
  workspace_tool: workspaceTool,
});

const renderFor = (workspaceTool: string) => {
  useProjectStore.setState({ selectedProject: project(workspaceTool) as any });
  return render(
    <FluentProvider theme={webLightTheme}>
      <WorkspaceTasks />
    </FluentProvider>,
  );
};

describe("WorkspaceTasks buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({
      isOpen: false,
      sessions: [],
      activeSessionId: null,
      splitSessionId: null,
      pendingCommand: null,
    });
    runWorkspaceTask.mockResolvedValue({ status: "ok", data: "session-1" });
    runPackageTask
      .mockResolvedValueOnce({ status: "ok", data: "session-api" })
      .mockResolvedValueOnce({ status: "ok", data: "session-web" })
      .mockResolvedValue({ status: "ok", data: "session-other" });
  });

  // The panel renders for any non-None tool, so each must actually work.
  for (const tool of ["Turbo", "Lerna", "Pnpm", "Yarn", "Npm"]) {
    it(`runs build, test and lint and opens a terminal for ${tool}`, async () => {
      const user = userEvent.setup();
      renderFor(tool);

      for (const task of ["build", "test", "lint"]) {
        runWorkspaceTask.mockClear();
        await user.click(screen.getByRole("button", { name: task }));

        await waitFor(() => expect(runWorkspaceTask).toHaveBeenCalledWith("p1", task));
      }

      expect(useTerminalStore.getState().isOpen).toBe(true);
      expect(useTerminalStore.getState().sessions.map((s) => s.id)).toEqual(["session-1"]);
    });

    it(`runs multiplexed dev across packages for ${tool}`, async () => {
      const user = userEvent.setup();
      renderFor(tool);

      await user.click(screen.getByRole("button", { name: /Run All Dev/i }));

      await waitFor(() => expect(runPackageTask).toHaveBeenCalledTimes(2));
      expect(runPackageTask).toHaveBeenCalledWith("p1", "api", "dev");
      expect(runPackageTask).toHaveBeenCalledWith("p1", "web", "dev");
      expect(useTerminalStore.getState().sessions.map((s) => s.title)).toEqual([
        "api",
        "web",
      ]);
    });
  }

  it("surfaces a backend failure instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    runWorkspaceTask.mockResolvedValue({ status: "error", error: "Task name is required" });
    renderFor("Pnpm");

    await user.click(screen.getByRole("button", { name: "build" }));

    expect(await screen.findByText(/Could not run "build"/)).toBeInTheDocument();
    expect(await screen.findByText(/Task name is required/)).toBeInTheDocument();
    // A failed run must not open an empty terminal.
    expect(useTerminalStore.getState().isOpen).toBe(false);
  });

  it("does not render for a non-workspace project", () => {
    const { container } = renderFor("None");
    expect(container.querySelector("button")).toBeNull();
  });
});
