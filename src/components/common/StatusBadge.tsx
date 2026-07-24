import React from "react";
import { Badge } from "@fluentui/react-components";
import { LinkStatus } from "../../types/link";

interface StatusBadgeProps {
  status: LinkStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getColor = () => {
    if (typeof status === "object" && "Error" in status) {
      return "danger" as const;
    }
    switch (status) {
      case "Active":
        return "success" as const;
      case "Syncing":
        return "informative" as const;
      case "Broken":
        return "danger" as const;
      case "Inactive":
        return "warning" as const;
      default:
        return "informative" as const;
    }
  };

  const getLabel = () => {
    if (typeof status === "object" && "Error" in status) {
      return "Error";
    }
    return status;
  };

  return (
    <Badge color={getColor()} appearance="filled" title={typeof status === "object" ? status.Error : undefined}>
      {getLabel()}
    </Badge>
  );
};