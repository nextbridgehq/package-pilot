import React, { useEffect, useState } from 'react';
import { MessageBar, MessageBarBody, MessageBarActions, Button } from '@fluentui/react-components';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export const UpdaterBanner: React.FC = () => {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const result = await check();
        if (result?.available) {
          setUpdate(result);
        } else if (result) {
            // in some versions result is just update, if it has .available check it
            if ((result as any).available === false) {
                return;
            }
            setUpdate(result);
        }
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    };
    checkForUpdates();
  }, []);

  const handleInstall = async () => {
    if (!update) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      console.error('Failed to install update:', error);
      setInstalling(false);
    }
  };

  if (!update) return null;

  return (
    <MessageBar intent="success" layout="multiline">
      <MessageBarBody>
        A new version of Package Pilot is available!
      </MessageBarBody>
      <MessageBarActions>
        <Button onClick={handleInstall} disabled={installing}>
          {installing ? 'Installing...' : 'Install and Restart'}
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
};
