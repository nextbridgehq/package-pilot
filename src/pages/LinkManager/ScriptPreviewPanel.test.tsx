import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScriptPreviewPanel } from "./ScriptPreviewPanel";
import { projectApi } from "../../services/tauriApi";
import { LinkMethod } from "../../types/link";
import { useSettingsStore } from "../../store/useSettingsStore";

vi.mock("../../services/tauriApi", () => ({
  projectApi: {
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
    expect(projectApi.getPackageScripts).not.toHaveBeenCalled();
  });

  it("shows the safe message when no lifecycle scripts are found", async () => {
    vi.mocked(projectApi.getPackageScripts).mockResolvedValue([
      { name: "test", command: "vitest run", is_lifecycle: false, risk_level: "low" },
    ]);

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });

  it("shows the warning panel with risk badges when lifecycle scripts are found", async () => {
    vi.mocked(projectApi.getPackageScripts).mockResolvedValue([
      { name: "postinstall", command: "node setup.js", is_lifecycle: true, risk_level: "high" },
    ]);

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/lifecycle script.*detected/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/postinstall: node setup.js/)).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText(/will NOT run unless you enable lifecycle scripts in Settings/i)).toBeInTheDocument();
  });

  it("shows the Yalc-specific warning when method is Yalc and lifecycle scripts are found", async () => {
    vi.mocked(projectApi.getPackageScripts).mockResolvedValue([
      { name: "prepare", command: "node build.js", is_lifecycle: true, risk_level: "high" },
    ]);

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Yalc"} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Yalc always runs prepare\/prepack scripts/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/prepare: node build.js/)).toBeInTheDocument();
    expect(
      screen.queryByText(/will NOT run unless you enable lifecycle scripts in Settings/i)
    ).not.toBeInTheDocument();
  });

  it("shows a WILL-run warning, not the will-NOT-run claim, when lifecycle scripts are already allowed", async () => {
    mockAllowLifecycleScripts(true);
    vi.mocked(projectApi.getPackageScripts).mockResolvedValue([
      { name: "prepublishOnly", command: "npm run check", is_lifecycle: true, risk_level: "medium" },
    ]);

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/these WILL run because "Allow Lifecycle Scripts" is enabled/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByText(/will NOT run unless you enable lifecycle scripts in Settings/i)
    ).not.toBeInTheDocument();
  });

  it("shows the safe message for Yalc when no lifecycle scripts are found", async () => {
    vi.mocked(projectApi.getPackageScripts).mockResolvedValue([
      { name: "test", command: "vitest run", is_lifecycle: false, risk_level: "low" },
    ]);

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Yalc"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });

  it("does not crash when the backend call rejects", async () => {
    vi.mocked(projectApi.getPackageScripts).mockRejectedValue(new Error("boom"));

    render(<ScriptPreviewPanel sourcePath="/some/package" method={"Symlink"} />);

    await waitFor(() =>
      expect(screen.getByText(/No lifecycle scripts detected/i)).toBeInTheDocument()
    );
  });
});
