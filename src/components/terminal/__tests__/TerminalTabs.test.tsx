import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { TerminalTabs } from "../TerminalTabs";

const sessions = [
  { id: "1", title: "api", cwd: "/repo" },
  { id: "2", title: "web", cwd: "/repo" },
];

const renderTabs = (overrides = {}) => {
  const props = {
    sessions,
    activeSessionId: "1",
    exitedSessionIds: new Set<string>(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <FluentProvider theme={webLightTheme}>
      <TerminalTabs {...props} />
    </FluentProvider>,
  );
  return props;
};

describe("TerminalTabs", () => {
  it("renders one tab per session, titled by package name", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /api/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /web/ })).toBeInTheDocument();
  });

  it("marks the active tab as selected", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /api/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /web/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selects a tab on click", async () => {
    const user = userEvent.setup();
    const props = renderTabs();
    await user.click(screen.getByRole("tab", { name: /web/ }));
    expect(props.onSelect).toHaveBeenCalledWith("2");
  });

  it("closes a tab without selecting it", async () => {
    const user = userEvent.setup();
    const props = renderTabs();
    await user.click(screen.getByRole("button", { name: /close web/i }));
    expect(props.onClose).toHaveBeenCalledWith("2");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("closes a tab without selecting it when activated via keyboard", async () => {
    const user = userEvent.setup();
    const props = renderTabs();
    const closeButton = screen.getByRole("button", { name: /close web/i });
    closeButton.focus();
    await user.keyboard("{Enter}");
    expect(props.onClose).toHaveBeenCalledWith("2");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  // ARIA tablist pattern: the strip is ONE tab stop, and arrows move within
  // it. Without a roving tabIndex every tab is its own stop, so tabbing
  // through a 4-session panel takes 8 presses to get past.
  it("gives only the active tab a tab stop", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /api/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /web/ })).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with arrow keys", async () => {
    const user = userEvent.setup();
    const props = renderTabs();
    screen.getByRole("tab", { name: /api/ }).focus();

    await user.keyboard("{ArrowRight}");
    expect(props.onSelect).toHaveBeenCalledWith("2");
  });

  it("wraps around at the ends", async () => {
    const user = userEvent.setup();
    const props = renderTabs();
    screen.getByRole("tab", { name: /api/ }).focus();

    await user.keyboard("{ArrowLeft}");
    expect(props.onSelect).toHaveBeenCalledWith("2");
  });

  it("jumps to first and last with Home and End", async () => {
    const user = userEvent.setup();
    const props = renderTabs({ activeSessionId: "1" });
    screen.getByRole("tab", { name: /api/ }).focus();

    await user.keyboard("{End}");
    expect(props.onSelect).toHaveBeenCalledWith("2");

    props.onSelect.mockClear();
    await user.keyboard("{Home}");
    expect(props.onSelect).toHaveBeenCalledWith("1");
  });

  // Space on a focused tab must not scroll the page underneath.
  it("prevents the default page scroll when activating with Space", () => {
    renderTabs();
    const tab = screen.getByRole("tab", { name: /api/ });
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    tab.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  // A background dev-server tab that crashes has no other way to tell the
  // user something's wrong until they happen to click into it.
  it("marks an exited session's tab visually and in its accessible name", () => {
    renderTabs({ exitedSessionIds: new Set(["2"]) });
    const exited = screen.getByRole("tab", { name: /web/ });
    const stillRunning = screen.getByRole("tab", { name: /api/ });

    expect(exited.getAttribute("aria-label") ?? exited.textContent).toMatch(/exited/i);
    expect(stillRunning.getAttribute("aria-label") ?? stillRunning.textContent).not.toMatch(/exited/i);
  });
});
