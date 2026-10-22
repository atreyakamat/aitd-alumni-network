import { describe, expect, it, vi } from 'vitest';
import { filenameFromDisposition, saveBlob, saveJson } from '@/lib/download';

describe('filenameFromDisposition', () => {
  it('reads quoted and unquoted filenames', () => {
    expect(filenameFromDisposition('attachment; filename="users-2026.csv"', 'x')).toBe('users-2026.csv');
    expect(filenameFromDisposition('attachment; filename=jobs.csv', 'x')).toBe('jobs.csv');
  });

  it('prefers RFC 5987 filename*', () => {
    expect(filenameFromDisposition("attachment; filename=\"a.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", 'x')).toBe(
      'résumé.pdf'
    );
  });

  it('falls back when missing', () => {
    expect(filenameFromDisposition(undefined, 'fallback.csv')).toBe('fallback.csv');
    expect(filenameFromDisposition('inline', 'fallback.csv')).toBe('fallback.csv');
  });
});

describe('saveBlob / saveJson', () => {
  it('creates an object URL and clicks a download link', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    saveBlob(new Blob(['a,b']), 'file.csv');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('file.csv');

    saveJson({ a: 1 }, 'data.json');
    expect(click).toHaveBeenCalledTimes(2);
  });
});
