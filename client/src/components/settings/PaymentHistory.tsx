'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertCircle, Download, Loader2, Receipt } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage, getApiErrorMessageAsync, transactionApi, type Transaction } from '@/lib/api';
import { filenameFromDisposition, saveBlob } from '@/lib/download';
import { formatDate } from '@/lib/utils';
import { Pagination } from '@/components/shared/Pagination';

const PAGE_SIZE = 10;

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  SUCCESS: 'success',
  PENDING: 'warning',
  FAILED: 'destructive',
  REFUNDED: 'secondary',
};

const formatAmount = (amount: number | string, currency: string) => {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(
      value
    );
  } catch {
    return `${value} ${currency}`;
  }
};

export function describeTransaction(t: Transaction): string {
  if (t.type === 'MEMBERSHIP') {
    const tier = t.memberships?.find((m) => m.tier?.name)?.tier?.name;
    return tier ? `${tier} membership` : 'Membership';
  }
  if (t.type === 'DONATION') {
    const chapter = t.donations?.find((d) => d.chapter?.name)?.chapter?.name;
    return chapter ? `Donation to ${chapter}` : 'Donation';
  }
  return t.type;
}

export function PaymentHistory() {
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['transactions', 'my', page],
    queryFn: async () => (await transactionApi.getMyTransactions({ page, limit: PAGE_SIZE })).data,
    placeholderData: keepPreviousData,
  });

  const downloadReceipt = async (t: Transaction) => {
    setDownloadingId(t.id);
    try {
      const res = await transactionApi.downloadReceipt(t.id);
      saveBlob(res.data, filenameFromDisposition(res.headers?.['content-disposition'], `receipt-${t.id}.pdf`));
    } catch (err) {
      toast({
        title: 'Could not download receipt',
        description: await getApiErrorMessageAsync(err, 'Please try again later.'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const rows = query.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />
          Payment history
        </CardTitle>
        <CardDescription>Memberships and donations made from this account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? (
          <div className="flex items-start gap-3 text-sm" role="alert">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
            <div className="space-y-2">
              <p>{getApiErrorMessage(query.error, 'Could not load your payments.')}</p>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : query.isLoading ? (
          <div className="space-y-3" aria-label="Loading payments">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">You haven&apos;t made any payments yet.</p>
            <Button variant="link" asChild>
              <Link href="/donations">Support the alumni network</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="divide-y">
              {rows.map((t) => (
                <li key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{describeTransaction(t)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{formatAmount(t.amount, t.currency)}</span>
                    <Badge variant={statusVariant[t.status] ?? 'secondary'}>{t.status.toLowerCase()}</Badge>
                    {t.receiptAvailable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadReceipt(t)}
                        disabled={downloadingId === t.id}
                        aria-label={`Download receipt for ${describeTransaction(t)} on ${formatDate(t.createdAt)}`}
                      >
                        {downloadingId === t.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span className="ml-1 hidden sm:inline">Receipt</span>
                      </Button>
                    ) : (
                      <span className="w-[88px] hidden sm:block" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination pagination={query.data?.pagination} onPageChange={setPage} disabled={query.isFetching} noun="payments" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
