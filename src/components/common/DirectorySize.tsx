import React from "react";
import { Text, tokens } from "@fluentui/react-components";
import { formatBytes } from "../../utils/formatters";

interface DirectorySizeProps {
  size?: number | null;
}

export const DirectorySize: React.FC<DirectorySizeProps> = ({ size }) => {
  if (size === undefined || size === null) {
    return <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Calculating size...</Text>;
  }

  return <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{formatBytes(size)}</Text>;
};
