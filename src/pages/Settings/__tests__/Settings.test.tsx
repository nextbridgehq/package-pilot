import { render, screen } from "@testing-library/react";
import { Settings } from "../Settings";
import { describe, it, expect, vi } from "vitest";
import React from "react";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    general: { default_package_manager: "npm", projects_directory: null, auto_build_on_link: false, allow_lifecycle_scripts: false, auto_install_deps: false },
    registry: { port: 4873, storage_path: "", auto_start: false },
    watcher: { debounce_ms: 500, auto_rebuild: false, ignore_patterns: [] },
    appearance: { theme: "light" }
  }
}));

vi.mock("../../../bindings", () => ({
  commands: {
    getConfig: vi.fn().mockResolvedValue({ status: "ok", data: mockConfig }),
    saveConfig: vi.fn().mockResolvedValue({ status: "ok", data: null }),
  }
}));

// Store will use actual Zustand implementation which works because we mocked bindings

describe("Settings", () => {
  it("renders the settings tabs and general settings by default", async () => {
    render(<Settings />);
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    
    // Check tabs
    expect(screen.getAllByText("General")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Watcher")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Appearance")[0]).toBeInTheDocument();

    // Check general settings content
    expect(screen.getByText("Default Package Manager")).toBeInTheDocument();
    expect(screen.getByText("Auto Build on Link")).toBeInTheDocument();
    expect(screen.getByText("Allow Lifecycle Scripts")).toBeInTheDocument();
    expect(screen.getByText("Auto Install Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Default Projects Directory")).toBeInTheDocument();
  });
});
