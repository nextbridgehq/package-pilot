import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { SecurityPanel } from "../SecurityPanel";
import { useProjectStore } from "../../../store/useProjectStore";
import { commands } from "../../../bindings";

vi.mock("../../../bindings", () => ({
  commands: {
    runSecurityAudit: vi.fn(),
  },
}));

const runSecurityAudit = commands.runSecurityAudit as unknown as ReturnType<typeof vi.fn>;

const project = {
  id: "p1",
  name: "demo",
  path: "/repo",
  package_manager: "Npm",
  packages: [],
  workspace_tool: "Turbo",
  created_at: "",
  last_accessed: "",
} as any;

describe("SecurityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no project is selected", () => {
    useProjectStore.setState({ selectedProject: null });
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <SecurityPanel />
      </FluentProvider>,
    );
    expect(container.firstElementChild?.firstChild).toBeNull();
  });

  it("runs the audit for the selected project and shows results", async () => {
    useProjectStore.setState({ selectedProject: project });
    const user = userEvent.setup();
    runSecurityAudit.mockResolvedValue({
      status: "ok",
      data: JSON.stringify({ vulnerabilities: {} }),
    });

    render(
      <FluentProvider theme={webLightTheme}>
        <SecurityPanel />
      </FluentProvider>,
    );

    await user.click(screen.getByRole("button", { name: /run security audit/i }));

    expect(await screen.findByText(/No vulnerabilities found/)).toBeInTheDocument();
    expect(runSecurityAudit).toHaveBeenCalledWith("p1");
  });
});
