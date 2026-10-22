export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/**
 * Share a link with the native share sheet when available, otherwise copy it
 * to the clipboard. Dismissing the share sheet is reported as `dismissed`
 * (not an error); any other share failure falls back to the clipboard.
 */
export async function shareLink({ title, url }: { title?: string; url: string }): Promise<ShareOutcome> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'dismissed';
    }
  }
  try {
    if (!nav?.clipboard?.writeText) return 'failed';
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

type Toast = (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => unknown;

/** `shareLink` plus the standard toasts ("Link copied" / failure). */
export async function shareLinkWithToast(target: { title?: string; url: string }, toast: Toast): Promise<ShareOutcome> {
  const outcome = await shareLink(target);
  if (outcome === 'copied') toast({ title: 'Link copied', description: 'The link is on your clipboard.' });
  if (outcome === 'failed') {
    toast({ variant: 'destructive', title: 'Could not copy link', description: 'Please copy the link from the address bar.' });
  }
  return outcome;
}
