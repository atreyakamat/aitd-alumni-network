import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareLink } from '@/lib/share';

const setNavigator = (key: 'share' | 'clipboard', value: unknown) =>
  Object.defineProperty(window.navigator, key, { value, configurable: true, writable: true });

afterEach(() => {
  setNavigator('share', undefined);
  setNavigator('clipboard', undefined);
});

describe('shareLink', () => {
  it('prefers the native share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    await expect(shareLink({ title: 'T', url: 'https://x/y' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'T', url: 'https://x/y' });
  });

  it('reports a dismissed share sheet without falling back', async () => {
    const writeText = vi.fn();
    setNavigator('share', vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })));
    setNavigator('clipboard', { writeText });
    await expect(shareLink({ url: 'https://x' })).resolves.toBe('dismissed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing fails or is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    await expect(shareLink({ url: 'https://x' })).resolves.toBe('copied');

    setNavigator('share', vi.fn().mockRejectedValue(new Error('NotAllowed')));
    await expect(shareLink({ url: 'https://x' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('reports failure when nothing works', async () => {
    await expect(shareLink({ url: 'https://x' })).resolves.toBe('failed');
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(shareLink({ url: 'https://x' })).resolves.toBe('failed');
  });
});
