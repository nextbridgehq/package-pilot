import React from "react";
import { Button } from "@fluentui/react-components";
import { FolderOpenRegular } from "@fluentui/react-icons";
import { open } from "@tauri-apps/plugin-dialog";

interface FilePickerButtonProps {
  label?: string;
  onSelect: (path: string) => void;
  directory?: boolean;
  iconOnly?: boolean;
  defaultPath?: string;
}

export const FilePickerButton: React.FC<FilePickerButtonProps> = ({
  label = "Browse",
  onSelect,
  directory = true,
  iconOnly = false,
  defaultPath,
}) => {
  const handleClick = async () => {
    try {
      const selected = await open({
        directory,
        multiple: false,
        title: "Select folder",
        defaultPath,
      });
      if (selected && typeof selected === "string") {
        onSelect(selected);
      }
    } catch (error) {
      console.error("Folder selection error:", error);
    }
  };

  return (
    <Button
      appearance={iconOnly ? "transparent" : "secondary"}
      icon={<FolderOpenRegular />}
      onClick={handleClick}
      title={iconOnly ? label : undefined}
    >
      {!iconOnly && label}
    </Button>
  );
};