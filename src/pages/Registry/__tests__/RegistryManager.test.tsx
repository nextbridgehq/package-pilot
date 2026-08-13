import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistryManager } from '../RegistryManager';

// Mock the Tauri API methods used by RegistryManager
vi.mock('../../../bindings', () => ({
  commands: {
    startRegistry: vi.fn(),
    stopRegistry: vi.fn(),
    getRegistryStatus: vi.fn().mockResolvedValue({ status: "ok", data: { running: false, pid: null } }),
    listRegistryPackages: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
    publishToRegistry: vi.fn(),
  }
}));

import { commands } from '../../../bindings';

describe('RegistryManager Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly in stopped state', async () => {
    render(<RegistryManager />);

    expect(await screen.findByText('Local Registry (Verdaccio)')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Registry/i })).toBeInTheDocument();
  });

  it('handles starting the registry', async () => {
    (commands.startRegistry as any).mockResolvedValue({ status: "ok", data: 'Registry started' });
    (commands.getRegistryStatus as any)
      .mockResolvedValueOnce({ status: "ok", data: { running: false, pid: null } })
      .mockResolvedValueOnce({ status: "ok", data: { running: true, pid: 1234 } });

    render(<RegistryManager />);

    const startButton = await screen.findByRole('button', { name: /Start Registry/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(commands.startRegistry).toHaveBeenCalledWith(4873);
    });
  });
});
