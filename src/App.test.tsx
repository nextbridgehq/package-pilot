import { render } from "@testing-library/react";
import App from "./App";
import { describe, it, expect } from "vitest";

describe("App", () => {
  it("renders correctly", () => {
    // Basic smoke test to ensure rendering does not crash
    const { container } = render(<App />);
    expect(container).toBeInTheDocument();
  });
});
