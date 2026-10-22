'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/api';
import type { MarketplaceListing } from '@/types';

interface DeleteListingDialogProps {
  listing: MarketplaceListing | null;
  onClose: () => void;
  /** Reject to keep the dialog open with the error shown. */
  onConfirm: (listing: MarketplaceListing) => Promise<unknown>;
}

export function DeleteListingDialog({ listing, onClose, onConfirm }: DeleteListingDialogProps) {
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (listing) setError(null);
  }, [listing]);

  const confirm = async () => {
    if (!listing || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onConfirm(listing);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not delete the listing.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!listing} onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete listing?</DialogTitle>
          <DialogDescription>
            This will permanently remove &quot;{listing?.title}&quot; from the marketplace. To hide it temporarily, pause it
            instead.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Delete listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
