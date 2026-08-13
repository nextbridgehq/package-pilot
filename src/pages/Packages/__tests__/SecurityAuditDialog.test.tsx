import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { SecurityAuditDialog } from "../SecurityAuditDialog";
import { commands } from "../../../bindings";

vi.mock("../../../bindings", () => ({
  commands: {
    runSecurityAudit: vi.fn(),
  },
}));

const runSecurityAudit = commands.runSecurityAudit as unknown as ReturnType<typeof vi.fn>;

describe("SecurityAuditDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSecurityAudit.mockResolvedValue({
      status: "ok",
      data: JSON.stringify({ vulnerabilities: {} }),
    });
  });

  it("runs the audit exactly once when opened", async () => {
    const user = userEvent.setup();
    render(
      <FluentProvider theme={webLightTheme}>
        <SecurityAuditDialog projectId="p1" />
      </FluentProvider>,
    );

    await user.click(screen.getByRole("button", { name: /run security audit/i }));

    expect(await screen.findByText(/No vulnerabilities found/)).toBeInTheDocument();
    expect(runSecurityAudit).toHaveBeenCalledTimes(1);
    expect(runSecurityAudit).toHaveBeenCalledWith("p1");
  });

  it("runs a fresh audit each time it is reopened", async () => {
    const user = userEvent.setup();
    render(
      <FluentProvider theme={webLightTheme}>
        <SecurityAuditDialog projectId="p1" />
      </FluentProvider>,
    );

    await user.click(screen.getByRole("button", { name: /run security audit/i }));
    await screen.findByText(/No vulnerabilities found/);
    await user.click(await screen.findByRole("button", { name: /close/i }));

    await user.click(screen.getByRole("button", { name: /run security audit/i }));
    expect(runSecurityAudit).toHaveBeenCalledTimes(2);
  });

  it("does not start a second audit while one is already running", async () => {
    const user = userEvent.setup();
    let resolveAudit!: (value: { status: "ok"; data: string }) => void;
    runSecurityAudit.mockImplementation(
      () => new Promise((resolve) => { resolveAudit = resolve; }),
    );

    render(
      <FluentProvider theme={webLightTheme}>
        <SecurityAuditDialog projectId="p1" />
      </FluentProvider>,
    );

    // Open once - audit #1 starts and is still pending (loading = true).
    await user.click(screen.getByRole("button", { name: /run security audit/i }));
    expect(runSecurityAudit).toHaveBeenCalledTimes(1);

    // Close, then reopen immediately while #1 is still unresolved.
    await user.click(screen.getByRole("button", { name: /close/i }));
    await user.click(screen.getByRole("button", { name: /run security audit/i }));

    // The guard must have prevented a second call while loading was still true.
    expect(runSecurityAudit).toHaveBeenCalledTimes(1);

    // Resolve #1 so the test doesn't leave a dangling unresolved promise.
    resolveAudit({ status: "ok", data: JSON.stringify({ vulnerabilities: {} }) });
    await screen.findByText(/No vulnerabilities found/);
  });
});
