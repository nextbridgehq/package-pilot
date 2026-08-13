import React from "react";
import { makeStyles, tokens, Button, mergeClasses } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { TerminalSession } from "../../store/useTerminalStore";

const useStyles = makeStyles({
  strip: {
    display: "flex",
    alignItems: "stretch",
    gap: "2px",
    overflowX: "auto",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    fontSize: "12px",
    border: "none",
    borderTop: "2px solid transparent",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabActive: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopColor: tokens.colorBrandStroke1,
    color: tokens.colorNeutralForeground1,
  },
  tabExited: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  exitedDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: tokens.colorPaletteRedForeground1,
    flexShrink: 0,
  },
});

interface Props {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  /** Sessions whose backend shell exited on its own - not user-closed. */
  exitedSessionIds?: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export const TerminalTabs: React.FC<Props> = ({
  sessions,
  activeSessionId,
  exitedSessionIds,
  onSelect,
  onClose,
}) => {
  const styles = useStyles();

  // Standard ARIA tablist keyboard model: arrows move between tabs, Home/End
  // jump to the ends, and both wrap.
  const moveSelection = (fromIndex: number, key: string) => {
    const last = sessions.length - 1;
    switch (key) {
      case "ArrowRight":
        return fromIndex === last ? 0 : fromIndex + 1;
      case "ArrowLeft":
        return fromIndex === 0 ? last : fromIndex - 1;
      case "Home":
        return 0;
      case "End":
        return last;
      default:
        return -1;
    }
  };

  return (
    <div className={styles.strip} role="tablist">
      {sessions.map((session, index) => {
        const isActive = session.id === activeSessionId;
        const isExited = exitedSessionIds?.has(session.id) ?? false;
        return (
          <div
            key={session.id}
            role="tab"
            aria-selected={isActive}
            aria-label={isExited ? `${session.title} (exited)` : undefined}
            // Roving tabIndex: the strip is a single tab stop, so Tab moves
            // past the whole panel rather than through every session.
            tabIndex={isActive ? 0 : -1}
            className={mergeClasses(styles.tab, isActive && styles.tabActive, isExited && styles.tabExited)}
            onClick={() => onSelect(session.id)}
            onKeyDown={(e) => {
              // Ignore keys that bubbled up from the close button.
              if (e.target !== e.currentTarget) return;

              if (e.key === "Enter" || e.key === " ") {
                // Space would otherwise scroll the page behind the panel.
                e.preventDefault();
                onSelect(session.id);
                return;
              }

              const next = moveSelection(index, e.key);
              if (next >= 0) {
                e.preventDefault();
                onSelect(sessions[next].id);
              }
            }}
          >
            {isExited && <span className={styles.exitedDot} aria-hidden="true" />}
            <span>{session.title}</span>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label={`Close ${session.title}`}
              onClick={(e) => {
                // Closing must not also activate the tab being removed.
                e.stopPropagation();
                onClose(session.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
