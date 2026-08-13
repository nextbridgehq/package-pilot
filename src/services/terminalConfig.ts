import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

/**
 * Every face here must be monospace. xterm measures one character cell and
 * assumes all glyphs match it; a proportional face (the previous `Inter`)
 * makes text drift out of its cells and overlap. Consolas ships with every
 * Windows install, so the stack can never fall back to a proportional font.
 */
export const TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

export const TERMINAL_FONT_SIZE = 13;

/** Windows Terminal / PowerShell default scheme, flattened to monochrome. */
const CAMPBELL_DARK: ITheme = {
  background: "#0C0C0C",
  foreground: "#FFFFFF",
  cursor: "#FFFFFF",
  selectionBackground: "#3A3D41",
  black: "#0C0C0C",
  red: "#FFFFFF",
  green: "#FFFFFF",
  yellow: "#FFFFFF",
  blue: "#FFFFFF",
  magenta: "#FFFFFF",
  cyan: "#FFFFFF",
  white: "#FFFFFF",
  brightBlack: "#767676",
  brightRed: "#FFFFFF",
  brightGreen: "#FFFFFF",
  brightYellow: "#FFFFFF",
  brightBlue: "#FFFFFF",
  brightMagenta: "#FFFFFF",
  brightCyan: "#FFFFFF",
  brightWhite: "#FFFFFF",
};

/** Flattened to monochrome for light surfaces. */
const CAMPBELL_LIGHT: ITheme = {
  background: "#FFFFFF",
  foreground: "#1A1A1A",
  cursor: "#1A1A1A",
  selectionBackground: "#CCE5FF",
  black: "#0C0C0C",
  red: "#1A1A1A",
  green: "#1A1A1A",
  yellow: "#1A1A1A",
  blue: "#1A1A1A",
  magenta: "#1A1A1A",
  cyan: "#1A1A1A",
  white: "#1A1A1A",
  brightBlack: "#4C4C4C",
  brightRed: "#1A1A1A",
  brightGreen: "#1A1A1A",
  brightYellow: "#1A1A1A",
  brightBlue: "#1A1A1A",
  brightMagenta: "#1A1A1A",
  brightCyan: "#1A1A1A",
  brightWhite: "#1A1A1A",
};

export function buildTerminalTheme(mode: "dark" | "light"): ITheme {
  return mode === "light" ? { ...CAMPBELL_LIGHT } : { ...CAMPBELL_DARK };
}

/**
 * Resolves the app's theme setting ("light" | "dark" | "system") to a
 * concrete terminal color mode. "system" defers to the OS preference via
 * matchMedia, same signal a native terminal would use.
 */
export function resolveTerminalMode(theme: "light" | "dark" | "system"): "dark" | "light" {
  if (theme === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

/**
 * Ctrl+` must reach the window listener so the panel toggle works while the
 * terminal has focus (return false => xterm does not consume the event).
 * Every other key - including Esc, which readline and vim need - must still
 * reach the shell (return true => xterm handles/forwards it as usual).
 * Extracted as a pure function so it is directly unit-testable without
 * spying on xterm internals.
 */
export function shouldXtermConsumeKey(event: { ctrlKey: boolean; key: string }): boolean {
  if (event.ctrlKey && event.key === "`") return false;
  return true;
}

export function createConfiguredTerminal(mode: "dark" | "light" = "dark") {
  const term = new Terminal({
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    theme: buildTerminalTheme(mode),
  });

  term.attachCustomKeyEventHandler(shouldXtermConsumeKey);

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  return { term, fitAddon };
}
