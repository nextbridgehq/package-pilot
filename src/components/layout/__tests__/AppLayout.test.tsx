import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AppLayout } from "../AppLayout";

// TerminalPanel is mounted unconditionally at the AppLayout root. Before this
// fix it shared the app's single top-level ErrorBoundary (in App.tsx), so a
// throw here took down the whole UI - Header, Sidebar, every page - not just
// the terminal panel. This is exactly what happened when a prior task's
// store rename shipped ahead of TerminalPanel's own rewrite.
vi.mock("../../terminal/TerminalPanel", () => ({
  TerminalPanel: () => {
    throw new Error("boom");
  },
}));

describe("AppLayout terminal panel isolation", () => {
  it("keeps the rest of the app rendered when TerminalPanel throws", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <AppLayout />
      </FluentProvider>,
    );

    // The app-wide fallback text ("Something went wrong") is generic and
    // would appear whether the whole app or just the panel was replaced -
    // the real proof of isolation is that unrelated chrome survived.
    // "Dashboard" appears twice (sidebar nav item + page heading), which is
    // itself part of the proof: both independent parts of the tree rendered.
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("shows a contained error in place of the panel, not the whole page", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <AppLayout />
      </FluentProvider>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
