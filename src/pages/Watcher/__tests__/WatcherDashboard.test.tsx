import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { WatcherDashboard } from "../WatcherDashboard";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

describe("WatcherDashboard Component", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <FluentProvider theme={webDarkTheme}>
        <WatcherDashboard />
      </FluentProvider>
    );
    expect(container).toBeTruthy();
  });
});
