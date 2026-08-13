import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AnalyticsDashboard } from "../AnalyticsDashboard";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

describe("AnalyticsDashboard Component", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <FluentProvider theme={webDarkTheme}>
        <AnalyticsDashboard />
      </FluentProvider>
    );
    expect(container).toBeTruthy();
  });
});
