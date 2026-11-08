'use client';

import * as React from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { magazineApi, type Magazine } from '@/lib/videos';

export default function MagazinePage() {
  const [items, setItems] = React.useState<Magazine[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await magazineApi.list({ limit: 24 });
      setItems(res.items ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the magazine.'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container max-w-6xl space-y-6 py-6">
      <div>
        <h1 className="font-headline text-3xl text-primary">College Magazine</h1>
        <p className="text-muted-foreground">Read the latest and past editions of the AIEM magazine.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => void load()}>Try again</Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">No editions published yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <div className="aspect-[3/4] w-full overflow-hidden bg-muted">
                {m.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user upload
                  <img src={mediaSrc(m.coverImageUrl)} alt={`${m.title} cover`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-primary/5">
                    <BookOpen className="h-10 w-10 text-primary/40" aria-hidden />
                  </div>
                )}
              </div>
              <CardContent className="space-y-2 p-3">
                <div>
                  <h3 className="line-clamp-1 font-medium">{m.title}</h3>
                  {m.edition && <p className="text-xs text-muted-foreground">{m.edition}</p>}
                </div>
                <Button asChild size="sm" className="w-full">
                  <a href={mediaSrc(m.fileUrl)} target="_blank" rel="noreferrer">
                    <BookOpen className="mr-2 h-4 w-4" aria-hidden /> Read
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
