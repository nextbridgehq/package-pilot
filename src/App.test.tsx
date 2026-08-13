import { render } from "@testing-library/react";
import App from "./App";
import { describe, it, expect, vi } from "vitest";

// The globally-mocked `invoke` (see setupTests.ts) resolves to `undefined`
// for any unmocked command. App mounts and unconditionally calls
// fetchConfig() on mount, which then reads `result.data.appearance.theme` -
// without this, that crashes with an unhandled rejection every render.
vi.mock("./bindings", async () => {
  const actual = await vi.importActual<typeof import("./bindings")>("./bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getConfig: vi.fn().mockResolvedValue({
        status: "ok",
        data: {
          general: { default_package_manager: "npm", projects_directory: null, auto_build_on_link: false, allow_lifecycle_scripts: false, auto_install_deps: false },
          registry: { port: 4873, storage_path: "", auto_start: false },
          watcher: { debounce_ms: 500, auto_rebuild: false, ignore_patterns: [] },
          appearance: { theme: "light" },
        },
      }),
    },
  };
});

// The docked terminal panel renders for real here (not mocked, unlike the
// terminal-focused test suites) and now observes its pane size on mount.
// (ResizeObserver is polyfilled globally in setupTests.ts.)
describe("App", () => {
  it("renders correctly", () => {
    // Basic smoke test to ensure rendering does not crash
    const { container } = render(<App />);
    expect(container).toBeInTheDocument();
  });
});
