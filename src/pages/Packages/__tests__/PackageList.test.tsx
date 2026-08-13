import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { PackageList } from "../PackageList";
import { useProjectStore } from "../../../store/useProjectStore";

// This test is intentionally narrow: it only proves the entry point this
// plan adds is reachable. PackageList's many other behaviors (refresh,
// remove, select mode) are pre-existing and out of scope here.
const project = {
  id: "p1",
  name: "demo",
  path: "/repo",
  package_manager: "Npm",
  packages: [],
  workspace_tool: "None",
  created_at: "",
  last_accessed: "",
} as any;

describe("PackageList security audit entry point", () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [project],
      selectedProject: project,
      pendingDeletions: new Set(),
    });
  });

  // "None" is exactly the workspace_tool value that hides the Workspace
  // page's nav item in Sidebar.tsx - this is the case this plan fixes.
  it("shows Run Security Audit for a project with no detected workspace tool", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <PackageList />
      </FluentProvider>,
    );

    expect(screen.getByRole("button", { name: /run security audit/i })).toBeInTheDocument();
  });

  it("shows Run Security Audit for a monorepo project too", () => {
    useProjectStore.setState({
      selectedProject: { ...project, workspace_tool: "Turbo" },
    });
    render(
      <FluentProvider theme={webLightTheme}>
        <PackageList />
      </FluentProvider>,
    );

    expect(screen.getByRole("button", { name: /run security audit/i })).toBeInTheDocument();
  });

  it("hides it when no project is selected", () => {
    useProjectStore.setState({ selectedProject: null });
    render(
      <FluentProvider theme={webLightTheme}>
        <PackageList />
      </FluentProvider>,
    );

    expect(screen.queryByRole("button", { name: /run security audit/i })).toBeNull();
  });
});
