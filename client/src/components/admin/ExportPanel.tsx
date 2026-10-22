'use client';

import * as React from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { adminApi, getApiErrorMessageAsync, EXPORT_ENTITIES, type ExportEntity } from '@/lib/api';
import { filenameFromDisposition, saveBlob } from '@/lib/download';

const LABELS: Record<ExportEntity, string> = {
  users: 'Users',
  transactions: 'Transactions',
  donations: 'Donations',
  jobs: 'Jobs',
  events: 'Events',
};

/** CSV export buttons for admin data (PRD §6.10 / §12.3). */
export function ExportPanel() {
  const { toast } = useToast();
  const [pending, setPending] = React.useState<ExportEntity | null>(null);

  const handleExport = async (entity: ExportEntity) => {
    setPending(entity);
    try {
      const response = await adminApi.exportEntity(entity);
      const today = new Date().toISOString().slice(0, 10);
      const filename = filenameFromDisposition(
        response.headers?.['content-disposition'],
        `${entity}-${today}.csv`
      );
      saveBlob(response.data, filename);
      toast({ title: 'Export ready', description: `${LABELS[entity]} exported to ${filename}.` });
    } catch (err) {
      toast({
        title: `Could not export ${LABELS[entity].toLowerCase()}`,
        description: await getApiErrorMessageAsync(err, 'Please try again in a moment.'),
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <Card id="data-exports">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-green-600" />
          Data exports
        </CardTitle>
        <CardDescription>Download CSV snapshots. Every export is recorded in the audit log.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {EXPORT_ENTITIES.map((entity) => (
            <Button
              key={entity}
              variant="outline"
              onClick={() => handleExport(entity)}
              disabled={pending !== null}
              aria-busy={pending === entity}
            >
              {pending === entity ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {LABELS[entity]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
