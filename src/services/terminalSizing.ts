import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { commands } from "../bindings";

/**
 * Fitting a hidden or zero-size element yields nonsense geometry that then
 * propagates to the PTY. The panel used to fit exactly once, while closed,
 * which is how the shell ended up disagreeing with the renderer.
 */
export function fitIfVisible(
  container: HTMLElement | null,
  fitAddon: FitAddon,
): boolean {
  if (!container) return false;
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
  try {
    fitAddon.fit();
    return true;
  } catch {
    return false;
  }
}

/** Push the renderer's dimensions to the shell. Rows first - see resize_pty. */
export function syncPtySize(sessionId: string, term: Terminal): void {
  if (!term.rows || !term.cols) return;
  commands.resizePty(sessionId, term.rows, term.cols).catch(() => {
    /* session may already be gone; nothing useful to do */
  });
}

/**
 * Coalesces resize bursts to one callback per animation frame, so a
 * drag-resize issues one PTY resize per frame instead of one per pixel.
 */
export function observePaneResize(
  container: HTMLElement,
  onResize: () => void,
): () => void {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onResize();
    });
  });
  observer.observe(container);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
