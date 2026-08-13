import { render, screen } from "@testing-library/react";
import { Dashboard } from "../Dashboard";
import { describe, it, expect, vi } from "vitest";
import React from "react";

vi.mock("../../store/useProjectStore", () => ({
  useProjectStore: () => ({
    projects: [],
    fetchProjects: vi.fn(),
  })
}));

vi.mock("../../store/useLinkStore", () => ({
  useLinkStore: () => ({
    activeLinks: [],
    fetchLinks: vi.fn(),
  })
}));

vi.mock("../../store/useWatcherStore", () => ({
  useWatcherStore: () => ({
    watcherStatus: {},
    fetchStatus: vi.fn(),
  })
}));

describe("Dashboard", () => {
  it("renders the dashboard with quick actions", () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    expect(screen.getByText("Add Project")).toBeInTheDocument();
    expect(screen.getByText("Create Link")).toBeInTheDocument();
  });
});
