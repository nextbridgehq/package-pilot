import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTerminalPanelHeight,
  clampHeight,
  MIN_TERMINAL_HEIGHT,
  TERMINAL_HEIGHT_KEY,
} from "../useTerminalPanelHeight";

const setViewportHeight = (px: number) => {
  Object.defineProperty(window, "innerHeight", {
    value: px,
    writable: true,
    configurable: true,
  });
};

// Counts live window listeners by type so leak assertions are real rather
// than a proxy for "we remembered to call removeEventListener".
let liveListeners: Record<string, number> = {};
const countListeners = (type: string) => liveListeners[type] ?? 0;

type AnyListenerFn = (...args: unknown[]) => void;
const realAdd = window.addEventListener.bind(window) as unknown as AnyListenerFn;
const realRemove = window.removeEventListener.bind(window) as unknown as AnyListenerFn;

beforeEach(() => {
  liveListeners = {};
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, ...rest: unknown[]) => {
    liveListeners[type] = (liveListeners[type] ?? 0) + 1;
    realAdd(type, ...rest);
  }) as typeof window.addEventListener);
  vi.spyOn(window, "removeEventListener").mockImplementation(((type: string, ...rest: unknown[]) => {
    liveListeners[type] = Math.max(0, (liveListeners[type] ?? 0) - 1);
    realRemove(type, ...rest);
  }) as typeof window.removeEventListener);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clampHeight", () => {
  it("enforces the floor", () => {
    expect(clampHeight(10, 1000)).toBe(MIN_TERMINAL_HEIGHT);
  });

  it("enforces a 70% viewport ceiling", () => {
    expect(clampHeight(9000, 1000)).toBe(700);
  });

  it("passes a reasonable height through", () => {
    expect(clampHeight(350, 1000)).toBe(350);
  });
});

describe("useTerminalPanelHeight", () => {
  beforeEach(() => localStorage.clear());

  it("restores a persisted height", () => {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, "420");
    const { result } = renderHook(() => useTerminalPanelHeight());
    expect(result.current.height).toBe(420);
  });

  it("falls back to a default when storage is empty or corrupt", () => {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, "not-a-number");
    const { result } = renderHook(() => useTerminalPanelHeight());
    expect(result.current.height).toBeGreaterThanOrEqual(MIN_TERMINAL_HEIGHT);
  });

  it("persists a dragged height", () => {
    const { result } = renderHook(() => useTerminalPanelHeight());
    act(() => {
      result.current.startDrag({
        clientY: 500,
        preventDefault() {},
      } as unknown as React.MouseEvent);
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 400 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem(TERMINAL_HEIGHT_KEY)).not.toBeNull();
  });

  // Without this, dragging the panel tall and then shrinking the window
  // leaves the panel occupying nearly the whole app.
  it("re-clamps when the viewport shrinks below the stored height", () => {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, "700");
    setViewportHeight(1000);
    const { result } = renderHook(() => useTerminalPanelHeight());
    expect(result.current.height).toBe(700);

    act(() => {
      setViewportHeight(400);
      window.dispatchEvent(new Event("resize"));
    });

    // 70% of 400
    expect(result.current.height).toBe(280);
  });

  it("leaves the height alone when the viewport still accommodates it", () => {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, "300");
    setViewportHeight(1000);
    const { result } = renderHook(() => useTerminalPanelHeight());

    act(() => {
      setViewportHeight(900);
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.height).toBe(300);
  });

  it("removes the resize listener on unmount", () => {
    const { unmount } = renderHook(() => useTerminalPanelHeight());
    const before = countListeners("resize");
    unmount();
    expect(countListeners("resize")).toBe(before - 1);
  });

  // A drag interrupted by the panel closing (Ctrl+`) previously left
  // mousemove/mouseup attached to window forever.
  it("removes drag listeners if it unmounts mid-drag", () => {
    const { result, unmount } = renderHook(() => useTerminalPanelHeight());

    act(() => {
      result.current.startDrag({
        clientY: 500,
        preventDefault() {},
      } as unknown as React.MouseEvent);
    });

    expect(countListeners("mousemove")).toBeGreaterThan(0);
    unmount();
    expect(countListeners("mousemove")).toBe(0);
    expect(countListeners("mouseup")).toBe(0);
  });
});
