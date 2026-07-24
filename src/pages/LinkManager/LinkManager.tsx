import React, { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Tab,
  TabList,
  Toaster,
  useId,
  useToastController,
  Toast,
  ToastTitle,
  ToastTrigger,
  SkeletonItem,
} from "@fluentui/react-components";
import { useLinkStore } from "../../store/useLinkStore";
import { useProjectStore } from "../../store/useProjectStore";
import { TerminalRef } from "../../components/common/Terminal";
import { LinkListItem } from "./LinkListItem";
import { LinkCreateForm } from "./LinkCreateForm";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { useVirtualizer } from "@tanstack/react-virtual";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
});

export const LinkManager: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { activeLinks, pendingDeletions, fetchLinks, removeLink, markForDeletion, undoDeletion, loading, pendingTab, setPendingTab } = useLinkStore();
  const { projects, pendingDeletions: projectPendingDeletions } = useProjectStore();
  const [tab, setTab] = useState("active");
  const toasterId = useId("link-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const pendingProjectPaths = new Set(
    projects.filter(p => projectPendingDeletions.has(p.id)).map(p => p.path)
  );
  const displayLinks = activeLinks.filter((l) => !pendingDeletions.has(l.id) && !pendingProjectPaths.has(l.target_path));

  const [runningLinks] = useState<Record<string, boolean>>({});
  const terminalRefs = React.useRef<Record<string, TerminalRef | null>>({});
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: displayLinks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 90,
    overscan: 5,
  });

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    if (pendingTab) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTab(pendingTab);
      setPendingTab(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [pendingTab, setPendingTab]);

  const handleRunScript = async (linkId: string, targetPath: string, sourcePackage: string) => {
    const terminal = terminalRefs.current[linkId];
    if (terminal) {
      terminal.writeCommand(`npx ${sourcePackage} --help`);
    }
  };

  const handleRemove = async (id: string) => {
    markForDeletion(id);
    dispatchToast(
      <Toast>
        <ToastTitle
          action={
            <ToastTrigger>
              <Button
                appearance="transparent"
                onClick={() => {
                  undoDeletion(id);
                }}
              >
                Undo
              </Button>
            </ToastTrigger>
          }
        >
          Link removed
        </ToastTitle>
      </Toast>,
      { intent: "success" }
    );
  };

  return (
    <div className={styles.container}>
      <Toaster toasterId={toasterId} position="top-end" />
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Title3>Link Manager</Title3>
        {activeLinks.length > 0 && (
          <Text
            weight="semibold"
            size={300}
            style={{
              backgroundColor: tokens.colorBrandBackground2,
              color: tokens.colorBrandForeground2,
              padding: "2px 10px",
              borderRadius: "12px",
            }}
          >
            {activeLinks.length} {activeLinks.length === 1 ? "link" : "links"}
          </Text>
        )}
      </div>

      <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(data.value as string)}>
        <Tab value="create">Create Link</Tab>
        <Tab value="active">Active Links ({activeLinks.length})</Tab>
      </TabList>

      {tab === "create" && (
        <LinkCreateForm onSuccess={() => setTab("active")} toasterId={toasterId} />
      )}

      {tab === "active" && (
        <div>
          {loading && displayLinks.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[1, 2].map((i) => (
                <Card key={`skeleton-${i}`} className={shared.card} style={{ marginBottom: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <SkeletonItem shape="rectangle" style={{ width: "30%", height: "20px" }} />
                    <SkeletonItem shape="rectangle" style={{ width: "80%", height: "16px" }} />
                  </div>
                </Card>
              ))}
            </div>
          ) : displayLinks.length === 0 ? (
            <Card className={shared.card} style={{ padding: "40px", textAlign: "center" }}>
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                No active links. Create one to get started.
              </Text>
            </Card>
          ) : (
            <div ref={parentRef} style={{ height: "calc(100vh - 250px)", overflow: "auto" }}>
              <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const link = displayLinks[virtualItem.index];
                  return (
                    <div
                      key={link.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                        paddingBottom: "8px"
                      }}
                    >
                      <LinkListItem
                        link={link}
                        running={runningLinks[link.id]}
                        onRemove={handleRemove}
                        onRunScript={handleRunScript}
                        onRefresh={fetchLinks}
                        terminalRef={(el) => {
                          terminalRefs.current[link.id] = el;
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
