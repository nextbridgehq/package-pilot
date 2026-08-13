import React from "react";

export const MIN_TERMINAL_HEIGHT = 120;
export const DEFAULT_TERMINAL_HEIGHT = 320;
export const TERMINAL_HEIGHT_KEY = "pp.terminal.height";

/** Floor keeps the panel usable; ceiling stops it swallowing the app. */
export function clampHeight(px: number, viewportHeight: number): number {
  const max = Math.round(viewportHeight * 0.7);
  return Math.min(Math.max(px, MIN_TERMINAL_HEIGHT), max);
}

const readStoredHeight = (): number => {
  const raw = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TERMINAL_HEIGHT;
  return clampHeight(raw, window.innerHeight || 1000);
};

export function useTerminalPanelHeight() {
  const [height, setHeight] = React.useState<number>(readStoredHeight);

  // Detaching a drag in progress is the unmount path's job too, so the
  // teardown lives in a ref both `onUp` and the unmount effect can call.
  const endDragRef = React.useRef<(() => void) | null>(null);

  const startDrag = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;

    // Dragging the top edge upward grows the panel, hence the inversion.
    const onMove = (move: MouseEvent) => {
      setHeight(clampHeight(startHeight + (startY - move.clientY), window.innerHeight || 1000));
    };
    const detach = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      endDragRef.current = null;
    };
    const onUp = () => {
      detach();
      setHeight((current) => {
        localStorage.setItem(TERMINAL_HEIGHT_KEY, String(current));
        return current;
      });
    };

    // Replace any drag still attached (defensive: a lost mouseup would
    // otherwise strand its listeners).
    endDragRef.current?.();
    endDragRef.current = detach;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height]);

  // Closing the panel mid-drag (Ctrl+`) unmounts this hook while
  // mousemove/mouseup are still attached to window - detach them.
  React.useEffect(() => () => endDragRef.current?.(), []);

  // A height that was legal when it was set can exceed the ceiling after the
  // window shrinks, letting the panel swallow the app.
  React.useEffect(() => {
    const onResize = () => {
      setHeight((current) => clampHeight(current, window.innerHeight || 1000));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { height, startDrag };
}
