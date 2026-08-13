import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fitIfVisible, syncPtySize } from "./terminalSizing";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const container = (width: number, height: number) => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width });
  Object.defineProperty(el, "clientHeight", { value: height });
  return el;
};

describe("fitIfVisible", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fit a zero-size container", () => {
    const fitAddon = { fit: vi.fn() } as any;
    expect(fitIfVisible(container(0, 0), fitAddon)).toBe(false);
    expect(fitAddon.fit).not.toHaveBeenCalled();
  });

  it("does not fit a null container", () => {
    const fitAddon = { fit: vi.fn() } as any;
    expect(fitIfVisible(null, fitAddon)).toBe(false);
    expect(fitAddon.fit).not.toHaveBeenCalled();
  });

  it("fits a visible container", () => {
    const fitAddon = { fit: vi.fn() } as any;
    expect(fitIfVisible(container(800, 300), fitAddon)).toBe(true);
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
  });

  it("swallows a fit error rather than breaking the caller", () => {
    const fitAddon = { fit: vi.fn(() => { throw new Error("no renderer"); }) } as any;
    expect(fitIfVisible(container(800, 300), fitAddon)).toBe(false);
  });
});

describe("syncPtySize", () => {
  beforeEach(() => vi.clearAllMocks());

  // Argument order matters: resize_pty takes rows before cols.
  it("sends rows before cols", () => {
    syncPtySize("s1", { rows: 30, cols: 120 } as any);
    expect(invokeMock).toHaveBeenCalledWith("resize_pty", {
      sessionId: "s1",
      rows: 30,
      cols: 120,
    });
  });

  it("ignores a terminal with no measured size", () => {
    syncPtySize("s1", { rows: 0, cols: 0 } as any);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
