import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.fn();
const saveBlob = vi.fn();
const exportEntity = vi.fn();

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/download', () => ({
  filenameFromDisposition: (header: unknown, fallback: string) => {
    const match = /filename="([^"]+)"/.exec(String(header ?? ''));
    return match ? match[1] : fallback;
  },
  saveBlob: (...args: unknown[]) => saveBlob(...args),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, adminApi: { ...actual.adminApi, exportEntity: (...args: unknown[]) => exportEntity(...args) } };
});

import { ExportPanel } from '@/components/admin/ExportPanel';

const response = (headers: Record<string, string> = {}) => ({
  data: new Blob(['ID\r\n1']),
  headers: { 'content-disposition': 'attachment; filename="users-2026-11-08.csv"', ...headers },
});

describe('<ExportPanel>', () => {
  beforeEach(() => {
    toast.mockReset();
    saveBlob.mockReset();
    exportEntity.mockReset();
  });

  it('saves the file under the name the server chose and says it is ready', async () => {
    exportEntity.mockResolvedValue(response());
    render(<ExportPanel />);

    await userEvent.click(screen.getAllByRole('button', { name: /users/i })[0]);

    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(saveBlob.mock.calls[0][1]).toBe('users-2026-11-08.csv');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Export ready' }));
  });

  it('warns that the file holds only part of the data when the server cut it at its row limit', async () => {
    exportEntity.mockResolvedValue(response({ 'x-export-truncated': 'true' }));
    render(<ExportPanel />);

    await userEvent.click(screen.getAllByRole('button', { name: /users/i })[0]);

    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Export is incomplete',
        description: expect.stringMatching(/row limit/i),
      })
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Export ready' }));
  });
});
